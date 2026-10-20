/**
 * ============================================================
 * BOM 보태기(2026-10-20) — 줄 순서 바꾸기 · 제조사 핸들링피 · 품목 DB 맞추기(삭제 · 단가)
 * ------------------------------------------------------------
 *  · 순서: BOM 보기 [순서 바꾸기] — 그 품목 줄이 차지한 시트 자리(행)는 그대로 두고 내용만 새 순서로 다시 쓴다.
 *    다른 품목 줄 번호는 안 바뀐다. 배포용 '실행판 최종 BOM' 탭도 이 순서를 따른다(다음 다시 쓰기 때).
 *  · 핸들링피: 제조사마다 % · 방식을 한 번 정해 두면(스크립트 속성 rb.hfee) 그 제조사 제품 BOM 에 자재를 넣을 때 알아서
 *    배송비/기타 칸에 수식(=단가 × 환율 × %)이 들어간다. 방식 — mat: 자재 줄마다(턴키 · 사급 포함은 고름) / maker: 제조사(제품 줄) 단가에만.
 *  · 품목 DB: BOM 에서 줄을 지워 그 코드가 BOM 어디에도 안 남고 발주 · 입고 이력도 없으면 품목 DB 에서도 지운다(삭제보관 탭에 원래 값).
 *    되돌리기로 줄을 되살리면 품목 DB 도 되살린다. BOM 단가를 바꾸면 품목 DB 단가(원화 = 단가 × 환율)도 지금 쓰는 줄 값으로.
 * ============================================================
 */

/* ---------- 품목 DB 맞추기 ---------- */

/** BOM 에서 지운 코드 중 어디에도 안 남은 것 → 품목 DB 에서 지운다. 잠금은 부르는 쪽이 잡고 있다. 반환: 지운 코드 */
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
  var iv = ish.getRange(2, 1, ish.getLastRow() - 1, RB_ITEM.HEAD.length).getValues(), rows = [], back = [], gone = [], now = new Date(), who = me_();
  iv.forEach(function (r, i) {
    var c = itemCodeKey_(r[0]);
    if (!want[c]) return;
    rows.push(i + 2);
    if (gone.indexOf(c) < 0) gone.push(c);
    back.push([now, who, c, RB_ITEM.TAB, i + 2, c, JSON.stringify(r.map(function (x) { return x instanceof Date ? fmtDate_(x) : x; }))]);
  });
  if (!rows.length) return [];
  var bk = tab_(RB_DEL_TAB, RB_DEL_HEAD), r0 = bk.getLastRow() + 1;
  ensureRows_(bk, r0 + back.length - 1);
  bk.getRange(r0, 1, back.length, RB_DEL_HEAD.length).setValues(back);           // 지운 코드는 다시 발급하지 않는다(bomKnownCodes_ 가 이 탭도 본다)
  try { if (!bk.isSheetHidden()) bk.hideSheet(); } catch (eH) { /* 넘어간다 */ }
  deleteRowsDesc_(ish, rows);
  cacheDrop_(RB_ITEM.CACHE); cacheDrop_(RB_II_CACHE); cacheDrop_(RB_II_REF);
  try {
    appendHist_(gone.map(function (c) { return { kind: '품목 삭제', code: c, name: '', item: '품목 삭제', before: '', after: 'BOM ' + (product || '') + ' 줄 삭제로 같이 지움', reason: str_(why), where: RB_DEL_TAB + '에 원래 값 보관' }; }));
  } catch (eL) { /* 이력은 넘어간다 */ }
  return gone;
}

/** 되돌리기로 BOM 줄을 되살렸을 때: 품목 DB 에 없고 삭제보관 탭에 있으면 마지막 값으로 되살린다 */
function itemDbRestore_(code) {
  code = itemCodeKey_(code);
  if (!code || itemDbAllCodes_().indexOf(code) > -1) return false;
  var bk = sheet_(RB_DEL_TAB);
  if (!bk || bk.getLastRow() < 2) return false;
  var v = bk.getRange(2, 1, bk.getLastRow() - 1, RB_DEL_HEAD.length).getValues();
  for (var i = v.length - 1; i >= 0; i--) {
    if (str_(v[i][3]) !== RB_ITEM.TAB || itemCodeKey_(v[i][5]) !== code) continue;
    var r; try { r = JSON.parse(str_(v[i][6])); } catch (e) { return false; }
    if (!r || !r.length) return false;
    var ish = tab_(RB_ITEM.TAB, RB_ITEM.HEAD);
    itemDbHead_(ish);
    var at = ish.getLastRow() + 1, row = RB_ITEM.HEAD.map(function (h, j) { return r[j] == null ? '' : r[j]; });
    ensureRows_(ish, at);
    ish.getRange(at, 1).setNumberFormat('@'); ish.getRange(at, 7, 1, 3).setNumberFormat('@');
    ish.getRange(at, 1, 1, row.length).setValues([row]);
    cacheDrop_(RB_ITEM.CACHE); cacheDrop_(RB_II_CACHE);
    return true;
  }
  return false;
}

/** 품목 DB 단가 = 지금 쓰는 BOM 줄(종료 없음 · 가장 늦은 초도)의 단가 × 환율. 자재 코드(?P0000XX0)만. 반환: 바꾼 수 */
function itemDbPriceSync_(codes) {
  var want = {};
  (codes || []).forEach(function (c) { c = itemCodeKey_(c); if (/^[A-Z]P\d{4}[A-Z]{2}\d+$/.test(c)) want[c] = null; });
  if (!Object.keys(want).length) return 0;
  var bs = bomSheet_(), B = bomCols_(bs), lr = bs.getLastRow();
  if (lr < 3) return 0;
  var v = bs.getRange(3, 1, lr - 2, B.lc).getValues();
  v.forEach(function (r) {
    var c = itemCodeKey_(r[B.code]);
    if (!(c in want) || str_(r[B.end])) return;
    var s = bomRnum_(r[B.start]) || 0, u = num_(r[B.unit]), fx = B.fx >= 0 ? (num_(r[B.fx]) || 1) : 1;
    if (str_(r[B.unit]) === '') return;
    if (!want[c] || s >= want[c].s) want[c] = { s: s, p: Math.round(u * fx * 100) / 100 };
  });
  var ish = sheet_(RB_ITEM.TAB);
  if (!ish || ish.getLastRow() < 2) return 0;
  var col = RB_ITEM_EDIT.price + 1, n = ish.getLastRow() - 1;
  var ic = ish.getRange(2, 1, n, 1).getValues(), ip = ish.getRange(2, col, n, 1).getValues(), hist = [], k = 0;
  for (var i = 0; i < n; i++) {
    var c = itemCodeKey_(ic[i][0]), w = want[c];
    if (!w || str_(ip[i][0]) === String(w.p) || num_(ip[i][0]) === w.p) continue;
    ish.getRange(i + 2, col).setValue(w.p);
    hist.push({ kind: '품목 DB', code: c, name: '', item: '단가', before: str_(ip[i][0]), after: String(w.p), where: RB_ITEM.TAB + ' ' + (i + 2) + '행 · BOM 단가 맞춤' });
    k++;
  }
  if (k) { cacheDrop_(RB_ITEM.CACHE); cacheDrop_(RB_II_CACHE); try { appendHist_(hist); } catch (e) { /* 넘어간다 */ } }
  return k;
}

/* ---------- 줄 순서 바꾸기 ---------- */

/**
 * 화면: [순서 바꾸기] 저장. order = [{ row, id, code }] — 이 품목 BOM 줄 전부를 원하는 순서로.
 * 그 품목이 차지한 행 자리는 그대로(위에서부터) 두고 내용(값 · 수식)만 새 순서로 옮겨 쓴다.
 */
function apiBomReorder(product, order, why) {
  requireEditor_();
  product = str_(product).toUpperCase();
  order = order || [];
  if (!order.length) throw new Error('순서가 비었습니다.');
  var lock = bomLock_(), moved = 0;
  try {
    var sh = bomSheet_(), C = bomCols_(sh), all = bomReadProduct_(sh, C, product), pos = [];
    all.forEach(function (x, i) { if (x) pos.push(i + 3); });
    if (pos.length !== order.length) throw new Error('BOM 시트가 그사이 바뀌었습니다(줄 수 ' + pos.length + ' ≠ ' + order.length + '). BOM 보기를 다시 열어 주세요.');
    var seen = {};
    order.forEach(function (o) {
      var r = Number(o.row), x = all[r - 3];
      if (!x || seen[r] || itemCodeKey_(x[C.code]) !== itemCodeKey_(o.code) || bomIdDiff_(C, x, o.id)) throw new Error('BOM 시트가 그사이 바뀌었습니다(' + o.code + '). BOM 보기를 다시 열어 주세요.');
      seen[r] = 1;
    });
    // 다른 줄을 가리키는 수식(예: =SUM(R622:R630)*9%)이 있으면 옮기면 엉뚱한 줄을 가리킨다 — 막는다
    var fA = {};
    pos.forEach(function (r) {
      var f = sh.getRange(r, 1, 1, C.lc).getFormulas()[0];
      fA[r] = f;
      f.forEach(function (s) {
        if (!s) return;
        var m, re = /\$?[A-Z]{1,3}\$?(\d+)/g;
        while ((m = re.exec(s.replace(/"[^"]*"/g, '')))) if (Number(m[1]) !== r) throw new Error(r + '행에 다른 줄을 가리키는 수식(' + s + ')이 있어 순서를 바꿀 수 없습니다. 그 칸을 값으로 바꾸거나(핸들링피는 위쪽 [핸들링피]로) 다시 해 주세요.');
      });
    });
    var src = order.map(function (o) { return Number(o.row); });
    pos.forEach(function (r, i) { if (src[i] !== r) moved++; });
    if (!moved) return { moved: 0 };
    var vals = {}, fR = {};
    pos.forEach(function (r) { var rg = sh.getRange(r, 1, 1, C.lc); vals[r] = rg.getValues()[0]; fR[r] = rg.getFormulasR1C1()[0]; });
    // 붙어 있는 자리끼리 한 번에 쓴다(값) → 수식 칸은 R1C1(상대 참조라 줄이 바뀌어도 같은 뜻)으로 다시
    for (var i = 0; i < pos.length;) {
      var j = i; while (j + 1 < pos.length && pos[j + 1] === pos[j] + 1) j++;
      sh.getRange(pos[i], 1, j - i + 1, C.lc).setValues(src.slice(i, j + 1).map(function (s) { return vals[s]; }));
      i = j + 1;
    }
    pos.forEach(function (r, i) { fR[src[i]].forEach(function (f, c) { if (f) sh.getRange(r, c + 1).setFormulaR1C1(f); }); });
    SpreadsheetApp.flush();
    bomLogWrite_(bomSS_(), [[new Date(), me_(), product, '', '', '순서 변경', '', '', '', pos.length + '줄', moved + '줄 자리 바뀜', str_(why).slice(0, 200), '', '참고', Utilities.getUuid().slice(0, 8) + '-ord', '']]);
  } finally {
    lock.releaseLock();
  }
  bomAfterSave_([product], false);              // 이 품목 자리 안에서만 바뀜 — 다른 품목 캐시는 그대로
  var res = apiBomGet(product);
  res.moved = moved;
  return res;
}

/* ---------- 제조사 핸들링피 ---------- */

var RB_HF_PROP = 'rb.hfee';
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

/** 핸들링피 수식이 들어가야 할 줄인지 — mat: 자재 줄(턴키, sa 면 사급도) / maker: 제품 줄 */
function hfWants_(x, C, product, cfg) {
  if (!x || str_(x[C.end])) return false;
  var t = str_(x[C.type]), code = itemCodeKey_(x[C.code]);
  if (cfg.mode === 'maker') return code === product && (t === '제품' || t === '');
  if (code === product || /^(제품|세트|반제품)$/.test(t)) return false;
  var buy = str_(x[C.buy]);
  return buy.indexOf('턴키') > -1 || (cfg.sa && buy.indexOf('사급') > -1);
}
/** 이 칸이 핸들링피 수식(이 줄 단가 × %)인지 — 비었거나 이 수식이면 고쳐 써도 된다 */
function hfFormulaLike_(f, unitCol, row) {
  return !!f && new RegExp(unitCol + '\\$?' + row + '(?![0-9])').test(f) && /%|\*\s*0?\.\d/.test(f);
}
/**
 * 줄들에 핸들링피 수식을 넣는다(배송비/기타 칸). 손으로 넣은 다른 값이 있는 칸은 건드리지 않고 skipped 로 알린다.
 * rows: 시트 행 번호(없으면 이 품목 전부) · 잠금은 부르는 쪽이. 반환 { vendor, pct, mode, n, skipped:[행] }
 */
function hfApplyRows_(sh, C, product, rows, cfgIn) {
  if (C.ship < 0 || C.unit < 0) return null;
  var all = bomReadProduct_(sh, C, product), vendor = hfMakerOf_(all, C, product), cfg = cfgIn || hfOf_(vendor);
  if (!cfg) return null;
  var pick = rows && rows.length ? rows : all.map(function (x, i) { return x ? i + 3 : 0; }).filter(Boolean);
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
  return { vendor: vendor, pct: pct, mode: cfg.mode, n: n, skipped: skipped };
}

/**
 * 화면: BOM 보기 위쪽 [핸들링피] 저장. vendor = 이 품목 제조사, pct = %(0 이면 설정 지움), mode = 'mat' | 'maker', sa = 사급 자재도.
 * applyTo = 품목코드면 그 품목 지금 줄에 바로 넣는다(빈 칸 · 핸들링피 수식 칸만). 이후 이 제조사 신제품 · 자재 추가는 저장 때 알아서.
 */
function apiHfSet(vendor, pct, mode, sa, applyTo, why) {
  requireEditor_();
  var k = hfKey_(vendor);
  if (!k) throw new Error('제조사(제품 줄 업체)가 비어 있어 핸들링피를 정할 수 없습니다.');
  pct = num_(pct);
  if (pct < 0 || pct > 50) throw new Error('핸들링피는 0 ~ 50% 사이로 넣어 주세요.');
  mode = mode === 'maker' ? 'maker' : 'mat';
  var lock = bomLock_(), out = {};
  try {
    var a = hfAll_(), before = a[k] ? a[k].pct + '% ' + (a[k].mode === 'maker' ? '제조사 단가' : '자재별') + (a[k].sa ? '(사급 포함)' : '') : '없음';
    if (pct > 0) a[k] = { vendor: str_(vendor), pct: pct, mode: mode, sa: !!sa, at: fmtDate_(new Date()), who: me_() };
    else delete a[k];
    PropertiesService.getScriptProperties().setProperty(RB_HF_PROP, JSON.stringify(a));
    out.all = a;
    var after = pct > 0 ? pct + '% ' + (mode === 'maker' ? '제조사 단가' : '자재별') + (sa ? '(사급 포함)' : '') : '없음';
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
