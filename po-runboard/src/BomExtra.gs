/**
 * ============================================================
 * BOM 보태기(2026-10-20) — 화면 순서(순서 칸) · 제조사 핸들링피 · 품목 DB 맞추기(삭제 · 단가) · 빈 줄 지우기
 * ------------------------------------------------------------
 *  · 순서: BOM 탭 '순서' 칸(없으면 맨 오른쪽에 만든다)에 숫자. 실행판 화면 · 배포용 BOM 이 이 숫자 순서로 보인다(시트 줄 자리는 그대로).
 *    새 버전 줄은 원래 줄을 복사하니 같은 순서, 새로 넣은 자재는 비어 있어 맨 아래.
 *  · 핸들링피: 제조사마다 % · 방식(스크립트 속성 rb.hfee) — turnkey: 턴키 자재 줄마다 / all: 모든 자재 줄마다 / maker: 제조사(제품 줄) 단가에만.
 *    배송비/기타 칸에 수식(=단가 × 환율 × %). 한 번 정하면 그 제조사 제품 BOM 에 자재를 넣을 때 알아서.
 *  · 품목 DB: BOM 에서 줄을 지워 그 코드가 BOM 어디에도 안 남고 발주 · 입고 이력도 없으면 품목 DB 에서도 지운다(보관하지 않음 —
 *    그 번호는 다음 신제품 · 새 자재 등록 때 다시 쓴다). 되돌리기로 줄을 되살리면 BOM 줄 값으로 품목 DB 에 다시 등록.
 *    품목 DB 단가 = 지금 쓰는 BOM 줄(종료 없음 · 가장 늦은 초도)의 단가 × 환율.
 *  · 빈 줄: BOM 줄 삭제는 시트 줄을 지운다(빈 줄을 남기지 않는다).
 * ============================================================
 */

/* ---------- 품목 DB 맞추기 ---------- */

/** BOM 에서 지운 코드 중 어디에도 안 남은 것 → 품목 DB 에서 지운다(보관 없음). 잠금은 부르는 쪽이. 반환: 지운 코드 */
function itemDbDropOrphans_(codes, why, product) {
  var want = {};
  (codes || []).forEach(function (c) { c = itemCodeKey_(c); if (/^[A-Z]{1,2}\d{4}[A-Z]{2}\d+$/.test(c)) want[c] = 1; });
  if (!Object.keys(want).length) return [];
  var bs = bomSheet_(), B = bomCols_(bs), lr = bs.getLastRow();
  if (lr > 2) {
    var n = lr - 2, cs = bs.getRange(3, B.code + 1, n, 1).getValues(), ps = bs.getRange(3, B.product + 1, n, 1).getValues();
    for (var i = 0; i < n; i++) { delete want[itemCodeKey_(cs[i][0])]; delete want[itemCodeKey_(ps[i][0])]; }
  }
  if (!Object.keys(want).length) return [];
  var ordered = itemOrderCodes_();
  Object.keys(want).forEach(function (c) { if (ordered[c]) delete want[c]; });          // 발주 · 입고 이력이 있으면 남긴다
  var ish = sheet_(RB_ITEM.TAB);
  if (!Object.keys(want).length || !ish || ish.getLastRow() < 2) return [];
  var iv = ish.getRange(2, 1, ish.getLastRow() - 1, 1).getValues(), rows = [], gone = [];
  iv.forEach(function (r, i) { var c = itemCodeKey_(r[0]); if (!want[c]) return; rows.push(i + 2); if (gone.indexOf(c) < 0) gone.push(c); });
  if (!rows.length) return [];
  deleteRowsDesc_(ish, rows);
  cacheDrop_(RB_ITEM.CACHE); cacheDrop_(RB_II_CACHE); cacheDrop_(RB_II_REF);
  try {
    appendHist_(gone.map(function (c) { return { kind: '품목 삭제', code: c, name: '', item: '품목 삭제', before: '', after: 'BOM ' + (product || '') + ' 줄 삭제로 같이 지움(번호는 다시 씀)', reason: str_(why), where: RB_ITEM.TAB }; }));
  } catch (eL) { /* 이력은 넘어간다 */ }
  return gone;
}

/** 되돌리기로 BOM 줄을 되살렸을 때: 품목 DB 에 없으면 BOM 줄 값(품목명 · 브랜드 · 업체 · 사양)으로 다시 등록 */
function itemDbRestore_(code) {
  code = itemCodeKey_(code);
  if (!code || itemDbAllCodes_().indexOf(code) > -1) return false;
  var r = bomRegFromRows_([code], 'BOM 되돌리기 · 다시 등록');
  if (r.length) { try { itemDbPriceSync_(r); } catch (e) { /* 넘어간다 */ } }
  return r.length > 0;
}

/** 품목 DB 단가 = 지금 쓰는 BOM 줄(종료 없음 · 가장 늦은 초도)의 단가 × 환율. 자재 코드(?P0000XX0)만. codes = null 이면 전부. 반환: 바꾼 수 */
function itemDbPriceSync_(codes, v0) {
  var want = null;
  if (codes) { want = {}; codes.forEach(function (c) { c = itemCodeKey_(c); if (/^[A-Z]P\d{4}[A-Z]{2}\d+$/.test(c)) want[c] = 1; }); if (!Object.keys(want).length) return 0; }
  var bs = bomSheet_(), B = bomCols_(bs), lr = bs.getLastRow();
  if (lr < 3) return 0;
  var v = v0 ? v0.filter(Boolean) : bs.getRange(3, 1, lr - 2, B.lc).getValues(), cur = {};      // v0 = 그 품목 줄(저장 직후 — BOM 탭 전체를 다시 읽지 않게)
  v.forEach(function (r) {
    var c = itemCodeKey_(r[B.code]);
    if (!/^[A-Z]P\d{4}[A-Z]{2}\d+$/.test(c) || (want && !want[c]) || str_(r[B.end]) || str_(r[B.unit]) === '') return;
    var s = bomRnum_(r[B.start]) || 0, u = num_(r[B.unit]), fx = B.fx >= 0 ? (num_(r[B.fx]) || 1) : 1;
    if (!cur[c] || s >= cur[c].s) cur[c] = { s: s, p: Math.round(u * fx * 100) / 100 };
  });
  var ish = sheet_(RB_ITEM.TAB);
  if (!ish || ish.getLastRow() < 2) return 0;
  var col = RB_ITEM_EDIT.price + 1, n = ish.getLastRow() - 1;
  var ic = ish.getRange(2, 1, n, 1).getValues(), pr = ish.getRange(2, col, n, 1), ip = pr.getValues(), hist = [], hit = [];
  for (var i = 0; i < n; i++) {
    var c = itemCodeKey_(ic[i][0]), w = cur[c];
    if (!w || (str_(ip[i][0]) !== '' && num_(ip[i][0]) === w.p)) continue;
    hist.push({ kind: '품목 DB', code: c, name: '', item: '단가', before: str_(ip[i][0]), after: String(w.p), where: RB_ITEM.TAB + ' ' + (i + 2) + '행 · BOM 단가 맞춤' });
    ip[i][0] = w.p; hit.push(i);
  }
  if (!hit.length) return 0;
  if (hit.length > 20) pr.setValues(ip);                 // 많이 바뀌면 칸 하나를 통째로(한 번에)
  else hit.forEach(function (i) { ish.getRange(i + 2, col).setValue(ip[i][0]); });
  cacheDrop_(RB_ITEM.CACHE); cacheDrop_(RB_II_CACHE);
  try { appendHist_(hist.length > 50 ? [{ kind: '품목 DB', code: '', name: '', item: '단가', before: '', after: hist.length + '건 BOM 단가로 맞춤', where: RB_ITEM.TAB }] : hist); } catch (e) { /* 넘어간다 */ }
  return hit.length;
}

/* ---------- 빈 줄 지우기 ---------- */

/** BOM 탭에서 이 줄들이 정말 비었으면(모든 칸) 아래부터 지운다. 반환: 지운 수 */
function bomDropBlankRows_(sh, C, rows) {
  var rs = (rows || []).map(Number).filter(function (r, i, a) { return r >= 3 && a.indexOf(r) === i; }).sort(function (a, b) { return b - a; }), n = 0;
  rs.forEach(function (r) {
    if (r > sh.getLastRow()) return;
    if (sh.getRange(r, 1, 1, C.lc).getValues()[0].some(function (x) { return str_(x) !== ''; })) return;
    sh.deleteRow(r); n++;
  });
  return n;
}
/** 1회: BOM 탭 데이터 사이 빈 줄(예전 삭제가 비우기만 한 줄) 모두 지우기 */
function bomCompactAll_() {
  var lock = LockService.getScriptLock(); waitLock_(lock);
  var n = 0;
  try {
    var sh = bomSheet_(), C = bomCols_(sh), lr = sh.getLastRow();
    if (lr < 3) return 0;
    var v = sh.getRange(3, 1, lr - 2, C.lc).getValues(), blank = [];
    v.forEach(function (r, i) { if (!r.some(function (x) { return str_(x) !== ''; })) blank.push(i + 3); });
    deleteRowsDesc_(sh, blank);
    n = blank.length;
    SpreadsheetApp.flush();
  } finally { lock.releaseLock(); }
  if (n) { bomDropCache_([]); bomDropAllRows_(); }
  return n;
}

/* ---------- 화면 순서(순서 칸) ---------- */

/** BOM 탭에 '순서' 칸이 없으면 맨 오른쪽에 만든다 → 칸 번호(0부터) */
function bomOrdCol_(sh, C) {
  if (C.ord >= 0) return C.ord;
  var lc = C.lc;
  if (sh.getMaxColumns() <= lc) sh.insertColumnAfter(lc);
  sh.getRange(2, lc).copyTo(sh.getRange(2, lc + 1), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  sh.getRange(2, lc + 1).setValue(RB_BOM_HEAD.ord);
  SpreadsheetApp.flush();
  return lc;
}
/**
 * 화면: [순서 바꾸기] 저장. order = [{ row, id, code, ord }] — 줄마다 순서 숫자. 시트 줄 자리는 그대로, 순서 칸만 쓴다.
 */
function apiBomReorder(product, order, why) {
  requireEditor_();
  product = str_(product).toUpperCase();
  order = order || [];
  if (!order.length) throw new Error('순서가 비었습니다.');
  var lock = bomLock_(), n = 0;
  try {
    var sh = bomSheet_(), C = bomCols_(sh), all = bomReadProduct_(sh, C, product), pairs = [];
    order.forEach(function (o) {
      var r = Number(o.row), x = all[r - 3];
      if (!x || itemCodeKey_(x[C.code]) !== itemCodeKey_(o.code) || bomIdDiff_(C, x, o.id)) throw new Error('BOM 시트가 그사이 바뀌었습니다(' + o.code + '). BOM 보기를 다시 열어 주세요.');
      var want = Number(o.ord) || '';
      if (C.ord >= 0 && str_(x[C.ord]) === str_(want)) return;
      pairs.push([r, want]);
    });
    if (pairs.length) {
      var oc = bomOrdCol_(sh, C);
      bomSetColRuns_(sh, oc + 1, pairs);
      SpreadsheetApp.flush();
      n = pairs.length;
      bomLogWrite_(bomSS_(), [[new Date(), me_(), product, '', '', '순서 변경', '', '', '', '', n + '줄 순서', str_(why).slice(0, 200), '', '참고', Utilities.getUuid().slice(0, 8) + '-ord', '']]);
    }
  } finally {
    lock.releaseLock();
  }
  if (n) { costTableMark_(); bomAfterSave_([product], false); }
  var res = apiBomGet(product);
  res.moved = n;
  return res;
}

/* ---------- 제조사 핸들링피 ---------- */

var RB_HF_PROP = 'rb.hfee';
/** 핸들링피가 없는 제조사(담당자 확인 10/20) — 시트에 % 수식이 있어도 설정으로 읽지 않는다 */
var RB_HF_NONE = ['다원'];
/**
 * 1회(담당자 확인 10/20): 핸들링피 없는 제조사(다원) 제품 BOM 의 배송비/기타 칸 % 수식(=단가 × 3% 등)은 %가 아니라 배송비 —
 * 지금 계산된 값을 그 칸에 값으로 넣는다(소요원가는 그대로). BOM변경이력에 줄마다 남긴다. 반환: 바꾼 줄 수
 */
function hfFreezeNone_() {
  var lock = LockService.getScriptLock(); waitLock_(lock);
  var logs = [], n = 0;
  try {
    var sh = bomSheet_(), C = bomCols_(sh), lr = sh.getLastRow();
    if (lr < 3 || C.ship < 0 || C.unit < 0) return 0;
    var v = sh.getRange(3, 1, lr - 2, C.lc).getValues(), f = sh.getRange(3, C.ship + 1, lr - 2, 1).getFormulas(), uL = colRB_(C.unit + 1);
    var byP = {}; v.forEach(function (x, i) { var p = itemCodeKey_(x[C.product]); if (p) (byP[p] = byP[p] || []).push(i); });
    var now = new Date(), tag = Utilities.getUuid().slice(0, 8);
    Object.keys(byP).forEach(function (p) {
      var maker = hfMakerOf_(byP[p].map(function (i) { return v[i]; }), C, p);
      if (RB_HF_NONE.indexOf(hfKey_(maker)) < 0) return;
      byP[p].forEach(function (i) {
        var r = i + 3, s = f[i][0];
        if (!hfFormulaLike_(s, uL, r)) return;
        var val = Math.round(num_(v[i][C.ship]) * 10000) / 10000;
        sh.getRange(r, C.ship + 1).setValue(val);
        n++;
        logs.push([now, '실행판', p, '', '', '정정', str_(v[i][C.type]), str_(v[i][C.code]), str_(v[i][C.code]), '배송비/기타 ' + s, '배송비/기타 ' + val,
          '담당자 확인 10/20 · ' + maker + ' 은 핸들링피 없음 — % 수식을 배송비 값으로', '', '참고', tag + '-hf0-' + r, '']);
      });
    });
    if (logs.length) bomLogWrite_(bomSS_(), logs);
    SpreadsheetApp.flush();
  } finally { lock.releaseLock(); }
  if (n) { bomDropCache_([]); bomDropAllRows_(); }
  return n;
}
/** 1회: 시트 수식에서 읽어 넣었던 설정 중 핸들링피 없는 제조사(다원)는 지운다(사람이 직접 정한 건 그대로) */
function hfDropNone_() {
  var a = hfAll_(), gone = [];
  RB_HF_NONE.forEach(function (k) { if (a[k] && a[k].who === '시트 수식에서 읽음') { delete a[k]; gone.push(k); } });
  if (gone.length) PropertiesService.getScriptProperties().setProperty(RB_HF_PROP, JSON.stringify(a));
  return gone.join(', ');
}
function hfKey_(v) { return str_(v).replace(/\(주\)|㈜|주식회사|\s/g, '').toUpperCase(); }
function hfAll_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(RB_HF_PROP) || '{}') || {}; } catch (e) { return {}; } }
function hfOf_(vendor) { var a = hfAll_(), k = hfKey_(vendor); return k && a[k] && num_(a[k].pct) > 0 ? a[k] : null; }

/** 화면: 제조사별 핸들링피 설정 전부 { 키: { vendor, pct, mode, sa, at, who } } */
function apiHfAll() { return hfAll_(); }

/** 이 품목의 제조사 = 제품 줄(코드 = 품목코드) 중 지금 쓰는 줄(종료 없음 · 가장 늦은 초도)의 업체 */
function hfMakerOf_(rows, C, product) {
  var best = null;
  rows.forEach(function (x) {
    if (!x || itemCodeKey_(x[C.code]) !== product) return;
    var s = bomRnum_(x[C.start]) || 0, open = !str_(x[C.end]);
    if (!best || (open && !best.open) || (open === best.open && s >= best.s)) best = { s: s, open: open, v: str_(x[C.vendor]) };
  });
  return best ? best.v : '';
}

/** 방식 이름 — turnkey(턴키 자재만) · all(모든 자재) · maker(제조사 단가에만). 예전 저장값 mat(+sa) 도 읽는다 */
function hfMode_(cfg) { var m = cfg && cfg.mode; return m === 'maker' || m === 'all' || m === 'turnkey' ? m : (cfg && cfg.sa ? 'all' : 'turnkey'); }
var RB_HF_LABEL = { turnkey: '턴키 자재만', all: '모든 자재', maker: '제조사 단가에만' };
/** 핸들링피 수식이 들어가야 할 줄인지(지금 쓰는 줄만) */
function hfWants_(x, C, product, cfg) {
  if (!x || str_(x[C.end])) return false;
  var t = str_(x[C.type]), code = itemCodeKey_(x[C.code]), m = hfMode_(cfg);
  if (m === 'maker') return code === product && (t === '제품' || t === '');
  if (code === product || /^(제품|세트|반제품)$/.test(t)) return false;
  return m === 'all' || str_(x[C.buy]).indexOf('턴키') > -1;
}
/** 이 칸이 핸들링피 수식(이 줄 단가 × %)인지 — 비었거나 이 수식이면 고쳐 써도 된다 */
function hfFormulaLike_(f, unitCol, row) {
  return !!f && new RegExp(unitCol + '\\$?' + row + '(?![0-9])').test(f) && /%|\*\s*0?\.\d/.test(f);
}
/**
 * 줄들에 핸들링피 수식을 넣는다(배송비/기타 칸). 손으로 넣은 다른 값이 있는 칸은 건드리지 않고 skipped 로 알린다.
 * rows: 시트 행 번호 · ids: 줄ID(둘 다 없으면 이 품목 전부) · 잠금은 부르는 쪽이. 반환 { vendor, pct, mode, n, skipped:[행] }
 */
function hfApplyRows_(sh, C, product, rows, cfgIn, ids) {
  if (C.ship < 0 || C.unit < 0) return null;
  var all = bomReadProduct_(sh, C, product), vendor = hfMakerOf_(all, C, product), cfg = cfgIn || hfOf_(vendor);
  if (!cfg) return null;
  var pick = rows && rows.length ? rows : all.map(function (x, i) { return x && (!ids || (C.id >= 0 && ids.indexOf(str_(x[C.id])) > -1)) ? i + 3 : 0; }).filter(Boolean);
  var uL = colRB_(C.unit + 1), fL = C.fx >= 0 ? colRB_(C.fx + 1) : '', pct = Math.round(num_(cfg.pct) * 1000) / 1000, n = 0, skipped = [];
  pick.forEach(function (r) {
    var x = all[r - 3];
    if (!hfWants_(x, C, product, cfg)) return;
    var cell = sh.getRange(r, C.ship + 1), f = cell.getFormula(), v = x[C.ship];
    if (!f && str_(v) !== '' && num_(v) !== 0) { skipped.push(r); return; }        // 손으로 넣은 배송비 등 — 그대로
    if (f && !hfFormulaLike_(f, uL, r)) { skipped.push(r); return; }
    var want = '=' + uL + r + (fL ? '*' + fL + r : '') + '*' + pct + '%';
    if (f === want) return;
    cell.setFormula(want);
    SpreadsheetApp.flush();
    bomFixCost_(sh, C, r, x);                       // 소요원가가 값으로 박힌 줄이면 차이만큼(수식이면 그대로 따라감)
    n++;
  });
  return { vendor: vendor, pct: pct, mode: hfMode_(cfg), n: n, skipped: skipped };
}

/**
 * 화면: BOM 보기 위쪽 [핸들링피] 저장. vendor = 이 품목 제조사, pct = %(0 이면 설정 지움), mode = turnkey | all | maker.
 * applyTo = 품목코드면 그 품목 지금 줄에 바로 넣는다(빈 칸 · 핸들링피 수식 칸만). 이후 이 제조사 신제품 · 자재 추가는 저장 때 알아서.
 */
function apiHfSet(vendor, pct, mode, applyTo, why) {
  requireEditor_();
  var k = hfKey_(vendor);
  if (!k) throw new Error('제조사(제품 줄 업체)가 비어 있어 핸들링피를 정할 수 없습니다.');
  pct = num_(pct);
  if (pct < 0 || pct > 50) throw new Error('핸들링피는 0 ~ 50% 사이로 넣어 주세요.');
  mode = RB_HF_LABEL[mode] ? mode : 'turnkey';
  var lock = bomLock_(), out = {};
  try {
    var a = hfAll_(), before = a[k] ? a[k].pct + '% ' + RB_HF_LABEL[hfMode_(a[k])] : '없음';
    if (pct > 0) a[k] = { vendor: str_(vendor), pct: pct, mode: mode, at: fmtDate_(new Date()), who: me_() };
    else delete a[k];
    PropertiesService.getScriptProperties().setProperty(RB_HF_PROP, JSON.stringify(a));
    out.all = a;
    var after = pct > 0 ? pct + '% ' + RB_HF_LABEL[mode] : '없음';
    var product = str_(applyTo).toUpperCase();
    if (product && pct > 0) {
      var sh = bomSheet_(), C = bomCols_(sh);
      out.applied = hfApplyRows_(sh, C, product, null, a[k]);
    }
    bomLogWrite_(bomSS_(), [[new Date(), me_(), product || '', '', '', '핸들링피 설정', '', '', '', str_(vendor) + ' ' + before, str_(vendor) + ' ' + after +
      (out.applied ? ' · 이 품목 ' + out.applied.n + '줄 적용' + (out.applied.skipped.length ? ' · 손입력 칸 ' + out.applied.skipped.length + '줄 그대로' : '') : ''), str_(why).slice(0, 200), '', '참고', Utilities.getUuid().slice(0, 8) + '-hf', '']]);
  } finally {
    lock.releaseLock();
  }
  if (out.applied && out.applied.n) { bomAfterSave_([str_(applyTo).toUpperCase()], false); out.bom = apiBomGet(str_(applyTo).toUpperCase()); }
  return out;
}

/**
 * 1회(배포 뒤): 시트에 이미 손으로 넣은 핸들링피 수식(배송비/기타 = 단가 × 3% 등)에서 제조사별 % · 방식을 읽어 설정을 채운다.
 * 이미 정한 제조사는 건드리지 않는다. 방식: 제품 줄에만 있으면 제조사 단가 · 사급 줄에도 있으면 모든 자재 · 아니면 턴키 자재만. % 는 가장 많이 쓴 값.
 */
function hfSeedFromSheet_() {
  var sh = bomSheet_(), C = bomCols_(sh), lr = sh.getLastRow();
  if (lr < 3 || C.ship < 0 || C.unit < 0) return '';
  var v = sh.getRange(3, 1, lr - 2, C.lc).getValues(), f = sh.getRange(3, C.ship + 1, lr - 2, 1).getFormulas(), uL = colRB_(C.unit + 1);
  var byP = {}; v.forEach(function (x, i) { var p = itemCodeKey_(x[C.product]); if (p) (byP[p] = byP[p] || []).push(i); });
  var tally = {};
  Object.keys(byP).forEach(function (p) {
    var rows = byP[p].map(function (i) { return v[i]; }), maker = hfMakerOf_(rows, C, p), k = hfKey_(maker);
    if (!k) return;
    byP[p].forEach(function (i) {
      var s = f[i][0], r = i + 3;
      if (!hfFormulaLike_(s, uL, r)) return;
      var m = s.match(/(\d+(?:\.\d+)?)\s*%/) || s.match(/\*\s*(0?\.\d+)/), pct = m ? (s.indexOf('%') > -1 ? Number(m[1]) : Math.round(Number(m[1]) * 10000) / 100) : 0;
      if (!(pct > 0 && pct <= 50)) return;
      var t = tally[k] || (tally[k] = { vendor: maker, pcts: {}, mat: 0, sa: 0, prod: 0 });
      t.pcts[pct] = (t.pcts[pct] || 0) + 1;
      if (itemCodeKey_(v[i][C.code]) === p) t.prod++; else { t.mat++; if (str_(v[i][C.buy]).indexOf('사급') > -1) t.sa++; }
    });
  });
  var a = hfAll_(), added = [];
  Object.keys(tally).forEach(function (k) {
    if (a[k] || RB_HF_NONE.indexOf(k) > -1) return;
    var t = tally[k], pct = Object.keys(t.pcts).sort(function (x, y) { return t.pcts[y] - t.pcts[x]; })[0];
    var mode = t.prod > t.mat ? 'maker' : (t.sa ? 'all' : 'turnkey');
    a[k] = { vendor: t.vendor, pct: Number(pct), mode: mode, at: fmtDate_(new Date()), who: '시트 수식에서 읽음' };
    added.push(t.vendor + ' ' + pct + '% ' + RB_HF_LABEL[mode]);
  });
  if (added.length) PropertiesService.getScriptProperties().setProperty(RB_HF_PROP, JSON.stringify(a));
  return added.join(', ');
}

/** 1회(10/20): BOM 에 쓰이는데 품목 DB 에 없는 코드(단종 품목 자재 등) — BOM 줄 값(품목명 · 브랜드 · 업체 · 사양)으로 품목 DB 에 등록. 반환: 등록한 코드 */
function bomRegMissingAll_() {
  var sh = bomSheet_(), C = bomCols_(sh), lr = sh.getLastRow();
  if (lr < 3) return [];
  var have = {}; itemDbAllCodes_().forEach(function (c) { have[c] = 1; });
  var want = {};
  sh.getRange(3, C.code + 1, lr - 2, 1).getValues().forEach(function (r) { var c = itemCodeKey_(r[0]); if (/^[A-Z]{1,2}\d{4}[A-Z]{2}\d+$/.test(c) && !have[c]) want[c] = 1; });
  var codes = Object.keys(want);
  if (!codes.length) return [];
  var done = bomRegFromRows_(codes, 'BOM 에 있던 코드 등록(10/20)');
  try { itemDbPriceSync_(done); } catch (e) { /* 넘어간다 */ }
  return done;
}
