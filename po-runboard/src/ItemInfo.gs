/**
 * ============================================================
 * 품목 정보 창 (BOM 보기 [품목 정보]) — 품목 DB(_실행판_품목) 전체를 보고 고친다
 * ------------------------------------------------------------
 *  · 품목코드는 고치지 않는다(코드는 BOM · 발주에 이어져 있다). 이름 · 브랜드 · 채널 · 업체 · 단가 · 사양 · 바코드만.
 *  · 바꾼 칸은 변경이력에 남긴다.
 * ============================================================
 */

var RB_ITEM_EDIT = { name: 1, brand: 2, channel: 3, vendor: 4, price: 5, barcode: 6, spec: 12 };   // 칸 위치(0부터)
var RB_ITEM_LABEL = { name: '품목명', brand: '브랜드', channel: '채널', vendor: '업체', price: '단가', barcode: '바코드', spec: '사양' };

function itemInfoRow_(r, i) {
  var d = r[9] instanceof Date ? Utilities.formatDate(r[9], Session.getScriptTimeZone(), 'yyyy-MM-dd') : str_(r[9]);
  return { row: i + 2, code: itemCodeKey_(r[0]), name: str_(r[1]), brand: str_(r[2]), channel: str_(r[3]), vendor: str_(r[4]),
    price: r[5] === '' ? '' : num_(r[5]), barcode: str_(r[6]), regAt: d, regBy: str_(r[10]), src: str_(r[11]), spec: str_(r[12]),
    unused: /미사용/.test(str_(r[11])) ? 1 : 0 };
}

/** 화면: 품목 DB 전부(미사용 포함 — 화면에서 따로 표시). withRef 면 품목마다 최근 업체 · 단가(ref)도 붙인다(예전 화면용) */
var RB_II_CACHE = 'iilist:v1';     // 품목 DB 줄(6시간) — 품목 DB 를 고치는 곳마다 RB_ITEM.CACHE 와 같이 버린다
var RB_II_REF = 'iiref:v1';        // 최근 업체 · 단가(30분) — 발주 DB · BOM 전체를 읽어 무겁다. 목록과 따로 받아 화면은 먼저 뜬다
function apiItemDbList(withRef) {
  var list = cacheGet_(RB_II_CACHE);
  if (!list) {
    list = [];
    var sh = sheet_(RB_ITEM.TAB);
    if (sh && sh.getLastRow() >= 2) {
      itemDbHead_(sh);
      var v = sh.getRange(2, 1, sh.getLastRow() - 1, RB_ITEM.HEAD.length).getValues();
      v.forEach(function (r, i) { if (itemCodeKey_(r[0])) list.push(itemInfoRow_(r, i)); });
    }
    cachePut_(RB_II_CACHE, list, RB_TTL);
  }
  if (withRef === false) return { list: list };
  var ref = itemRefPrices_();
  list.forEach(function (it) { var x = itemRefOf_(it.code, ref); if (x) it.ref = x; });
  return { list: list };
}

/** 화면: 품목코드 → 최근 업체 · 단가. 품목 정보 목록을 먼저 그린 뒤 따로 받아 채운다(발주 DB · BOM 을 읽어 느린 쪽) */
function apiItemDbRefs(codes) {
  var ref = itemRefPrices_(), out = {};
  var keys = Array.isArray(codes) && codes.length ? codes : Object.keys(ref.po).concat(Object.keys(ref.bom));
  keys.forEach(function (c) { c = itemCodeKey_(c); if (!c || out[c]) return; var x = itemRefOf_(c, ref); if (x) out[c] = x; });
  return { refs: out };
}

/** 화면: BOM 보기 단가 칸 옆 '≠ 발주 단가' 표시용 — 자재 코드별 최근 발주 단가(발주일이 가장 늦은 건 · 취소 빼고) */
function apiPoLastPrices() {
  var po = itemRefPrices_().po, out = {};
  Object.keys(po).forEach(function (c) { var x = po[c]; if (/^[A-Z]P\d{4}/.test(c) && x.price !== '') out[c] = { price: x.price, cur: x.cur, at: x.at, doc: x.doc }; });
  return out;
}

/** 자재(?P0000…)는 BOM 원가반영 단가가 먼저, 나머지(완제품 · 반제품 등)는 최종 발주가 먼저. 없으면 다른 쪽. */
function itemRefOf_(code, ref) {
  var po = ref.po[code], bom = ref.bom[code];
  var x = /^[A-Z]P\d{4}/.test(code) ? (bom || po || null) : (po || bom || null);
  // BOM 단가와 최근 발주 단가가 둘 다 있고 다르면 다른 쪽 값을 붙인다(화면이 ≠ 로 표시) — 통화가 같을 때만 비교
  // 자재만 — 완제품 · 반제품의 BOM 값은 세트 구성 줄 단가라 발주 단가와 견줄 수 없다(완제품 발주 단가는 BOM 보기 '✓ 같음 / 차이')
  if (x && po && bom && /^[A-Z]P\d{4}/.test(code) && po.price !== '' && bom.price !== '') {
    var other = x === bom ? po : bom, cu = function (c) { c = str_(c).toUpperCase(); return /^(|KRW|원|원화|₩)$/.test(c) ? 'KRW' : (/CNY|위안|RMB/.test(c) ? 'CNY' : (/USD|달러|\$/.test(c) ? 'USD' : c)); };
    if (cu(po.cur) === cu(bom.cur) && Math.abs(num_(po.price) - num_(bom.price)) > 0.0001) {
      x = JSON.parse(JSON.stringify(x));
      x.alt = { src: other.src, price: other.price, cur: other.cur, at: other.at || '', doc: other.doc || '', product: other.product || '', st: other.st || '' };
    }
  }
  return x;
}

/**
 * 품목코드별 최근 업체 · 단가.
 *  po : 발주 DB 에서 발주일이 가장 늦은 건(취소 · 발주일 없는 계획 건 빼고, 같은 날이면 아래 행) — 업체 · 단가 · 통화
 *  bom: BOM 에서 원가반영(F)이 있는 그 자재 줄 중 마지막 차수(아직 안 닫힌 줄 먼저, 그다음 초도 차수가 늦은 줄) — 업체 · 내용물/자재 단가 · 통화
 */
function itemRefPrices_() {
  var hit = cacheGet_(RB_II_REF);
  if (hit && hit.po && hit.bom) return hit;
  var po = {}, bom = {};
  try {
    var sh = sheet_(RB.STATUS_TAB);
    var C = sh && sheetCols_(sh), S = C && statusFieldCols_(C);
    if (S && S.code >= 0 && S.ordered >= 0 && sh.getLastRow() > C.hr) {
      var cSt = colIdx_(C.idx, ['진행상태']), cCur = colIdx_(C.idx, ['통화']);
      sh.getRange(C.hr + 1, 1, sh.getLastRow() - C.hr, C.lc).getValues().forEach(function (r, i) {
        var code = itemCodeKey_(r[S.code]);
        if (!code || (cSt >= 0 && str_(r[cSt]) === '취소')) return;
        var d = toDate_(r[S.ordered]);
        if (!d) return;
        var vendor = S.vendor >= 0 ? str_(r[S.vendor]) : '', price = S.price >= 0 && str_(r[S.price]) !== '' ? num_(r[S.price]) : '';
        if (!vendor && price === '') return;
        var t = d.getTime(), was = po[code];
        if (was && was.t > t) return;
        po[code] = { src: 'po', t: t, vendor: vendor, price: price, cur: cCur >= 0 ? str_(r[cCur]) : '', at: fmtDate_(d),
          doc: S.doc >= 0 ? str_(r[S.doc]) : '', batch: S.batch >= 0 ? str_(r[S.batch]) : '' };
      });
    }
  } catch (e) { /* 발주 DB 를 못 읽어도 품목 정보는 띄운다 */ }
  try {
    var bs = bomSheet_(), B = bomCols_(bs), lr = bs.getLastRow();
    if (B.costKey >= 0 && lr >= 3) {
      bs.getRange(3, 1, lr - 2, B.lc).getValues().forEach(function (r) {
        var ck = str_(r[B.costKey]);
        if (!ck || ck === '-') return;                               // 원가반영 줄만(참고 줄 빼고)
        var code = itemCodeKey_(r[B.code]);
        if (!code || code === itemCodeKey_(r[B.product])) return;    // 제품 줄 빼고 자재 · 반제품 줄
        if (str_(r[B.unit]) === '') return;
        var end = str_(r[B.end]), live = end === '' ? 1 : 0, st = bomRnum_(r[B.start]) || 0, en = bomRnum_(end) || 0;
        var was = bom[code];
        if (was && (was.live > live || (was.live === live && (was.st > st || (was.st === st && was.en > en))))) return;
        bom[code] = { src: 'bom', live: live, st: st, en: en, vendor: str_(r[B.vendor]), price: num_(r[B.unit]),
          cur: B.cur >= 0 ? str_(r[B.cur]) : '', fx: B.fx >= 0 ? (num_(r[B.fx]) || '') : '',
          product: str_(r[B.product]).toUpperCase(), end: end };
      });
    }
  } catch (e) { /* BOM 을 못 읽어도 품목 정보는 띄운다 */ }
  var out = { po: po, bom: bom };
  cachePut_(RB_II_REF, out, 1800);
  return out;
}

/**
 * 화면: 품목 한 줄 고치기. row = 시트 행(화면이 받은 값) · code 로 맞는지 다시 확인(그사이 줄이 밀렸으면 코드로 다시 찾음).
 * fields: { name, brand, channel, vendor, price, barcode, spec } 중 바꿀 것만.
 */
function apiItemDbSave(row, code, fields) {
  requireEditor_();
  code = itemCodeKey_(code);
  if (!code) throw new Error('품목코드가 비었습니다.');
  fields = fields || {};
  if (fields.barcode != null) {
    fields.barcode = str_(fields.barcode).replace(/\s/g, '').slice(0, 40);
    if (fields.barcode && !/^[0-9A-Za-z-]+$/.test(fields.barcode)) throw new Error('바코드는 숫자 · 영문으로만 넣어 주세요.');
  }
  if (fields.price != null && str_(fields.price) !== '' && isNaN(Number(str_(fields.price).replace(/,/g, '')))) throw new Error('단가는 숫자로 넣어 주세요.');
  if (fields.name != null && !str_(fields.name)) throw new Error('품목명은 비울 수 없습니다.');
  var fromUi = !!fields._ui, typoOk = !!fields._typo;
  delete fields._ui; delete fields._typo;
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var out, hist = [];
  try {
    var sh = sheet_(RB_ITEM.TAB);
    if (!sh || sh.getLastRow() < 2) throw new Error('품목 DB 탭이 없습니다.');
    itemDbHead_(sh);
    var r = Number(row) || 0;
    var n = RB_ITEM.HEAD.length;
    if (r < 2 || r > sh.getLastRow() || itemCodeKey_(sh.getRange(r, 1).getValue()) !== code) {
      var codes = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
      r = 0;
      for (var i = 0; i < codes.length; i++) if (itemCodeKey_(codes[i][0]) === code) { r = i + 2; break; }
      if (!r) throw new Error(code + ' 를 품목 DB 에서 찾지 못했습니다.');
    }
    var cur = sh.getRange(r, 1, 1, n).getValues()[0];
    // 화면에서 자재(번호 붙은 부자재 코드)의 업체를 다른 업체로 바꾸는 건 — 업체가 바뀌면 새 번호(BOM [이 차수 구성 정정])가 규칙. 오타 바로잡기라고 확인한 것만
    if (fromUi && !typoOk && fields.vendor != null && RB_ITEM_EDIT.vendor != null && /^[A-Z]P\d{4}[A-Z]{2}\d+$/.test(code)) {
      var wasV = str_(cur[RB_ITEM_EDIT.vendor]), toV = str_(fields.vendor);
      if (wasV && toV && wasV.replace(/\s/g, '') !== toV.replace(/\s/g, '')) throw new Error('VENDOR_CHANGE');
    }
    // 사양도 같은 규칙(사양이 바뀌면 새 번호) — 이 코드를 쓰는 모든 BOM 줄 사양이 같이 바뀌므로 표기 정리 · 오타인지 확인받는다
    if (fromUi && !typoOk && fields.spec != null && RB_ITEM_EDIT.spec != null && /^[A-Z]P\d{4}[A-Z]{2}\d+$/.test(code)) {
      var wasS = str_(cur[RB_ITEM_EDIT.spec]), toS = str_(fields.spec);
      if (wasS && wasS.replace(/\s/g, '') !== toS.replace(/\s/g, '')) throw new Error('SPEC_CHANGE');
    }
    Object.keys(RB_ITEM_EDIT).forEach(function (k) {
      if (fields[k] == null) return;
      var c = RB_ITEM_EDIT[k];
      var want = k === 'price' ? (str_(fields[k]) === '' ? '' : Number(str_(fields[k]).replace(/,/g, ''))) : str_(fields[k]).slice(0, k === 'spec' ? 500 : 200);
      var was = cur[c] instanceof Date ? str_(cur[c]) : cur[c];
      if (str_(was) === str_(want)) return;
      var cell = sh.getRange(r, c + 1);
      if (k === 'barcode') cell.setNumberFormat('@');
      cell.setValue(k === 'price' || k === 'barcode' ? want : asText_(want));     // 사양 '1/2' 같은 글이 날짜로 바뀌지 않게
      cur[c] = want;
      hist.push({ kind: '품목 DB', code: code, name: str_(cur[1]), item: RB_ITEM_LABEL[k], before: str_(was), after: str_(want), where: RB_ITEM.TAB + ' ' + r + '행' });
    });
    if (hist.length) SpreadsheetApp.flush();
    out = itemInfoRow_(cur, r - 2);
  } finally {
    lock.releaseLock();
  }
  if (hist.length) {
    try { appendHist_(hist); } catch (e) { /* 이력은 넘어간다 */ }
    cacheDrop_(RB_ITEM.CACHE); cacheDrop_(RB_II_CACHE);
    // 품목명 · 업체 · 사양을 고쳤으면 그 코드를 쓰는 BOM 줄도 같이(같은 자재코드 = 같은 값, 기준은 품목 DB)
    if (hist.some(function (h) { return h.item === RB_ITEM_LABEL.name || h.item === RB_ITEM_LABEL.vendor || h.item === RB_ITEM_LABEL.spec; })) { var only = {}; only[code] = 1; try { bomNameSync_(only, true); } catch (eS) { /* 10분 작업이 맞춘다 */ } }
  }
  out.changed = hist.length;
  return out;
}

/**
 * 화면: 자재 발주 때 BOM 값 가져오기 — 이 자재코드를 쓰는 BOM 줄 중 지금 쓰는 줄(종료 없음 · 가장 늦은 초도)의 업체 · 단가 · 통화 · MOQ · 사양.
 * 지금 쓰는 줄이 없으면 가장 최근 줄. 여러 품목이 같이 쓰면(공용) 그 가운데 가장 늦게 시작한 줄.
 */
function apiBomMatQuote(code) {
  code = itemCodeKey_(code);
  if (!code) return null;
  var sh = bomSheet_(), C = bomCols_(sh), lr = sh.getLastRow();
  if (lr < 3) return null;
  var v = sh.getRange(3, 1, lr - 2, C.lc).getValues();
  var best = null, n = 0;
  v.forEach(function (r, i) {
    if (itemCodeKey_(r[C.code]) !== code) return;
    n++;
    var o = bomRowObj_(r, C, i + 3);
    var live = str_(o.end) === '' ? 1 : 0, st = bomRnum_(o.start) || 0;
    if (!best || live > best.live || (live === best.live && st >= best.st)) best = { live: live, st: st, o: o };
  });
  if (!best) return null;
  var o = best.o;
  return { product: o.product, name: str_(o.name), type: str_(o.type), vendor: str_(o.vendor), buy: str_(o.buy), unit: num_(o.unit) || 0, cur: str_(o.cur), fx: num_(o.fx) || 1,
    moq: o.moq === '' ? '' : num_(o.moq), spec: str_(o.spec), start: str_(o.start), end: str_(o.end), live: best.live, rows: n };
}

/**
 * 화면: BOM [기존 코드 찾기]로 고른 코드들의 값 — 고르면 업체 · 단가 등이 같이 채워진다(2026-10-20).
 *  · 완제품(그 코드의 BOM 이 있음): 업체 = 그 BOM 제품 줄(제조사) · 단가 = 그 BOM 최종 차수 원가 합계(목록의 소요원가 합계와 같음)
 *  · 자재 · 반제품: 그 코드를 쓰는 BOM 줄 중 지금 쓰는 줄(종료 없음 · 가장 늦은 초도)의 업체 · 단가 · 통화 · MOQ · 사양 · 매입 · 임가공 · 배송비
 * BOM 에 없으면 품목 DB 의 이름 · 업체 · 사양만.
 */
function apiBomPickInfo(codes) {
  var want = (codes || []).map(itemCodeKey_).filter(String).slice(0, 50);
  if (!want.length) return {};
  var sh = bomSheet_(), C = bomCols_(sh), lr = sh.getLastRow();
  var v = lr > 2 ? sh.getRange(3, 1, lr - 2, C.lc).getValues() : [];
  var list = {}; try { apiBomList().forEach(function (x) { if (!x.semi) list[x.code] = x; }); } catch (eL) { list = {}; }
  var db = {}; try { readItems_().forEach(function (it) { db[itemCodeKey_(it.code)] = it; }); } catch (eD) { db = {}; }
  var out = {};
  want.forEach(function (code) {
    var it = db[code] || {}, best = null, prodRow = null;
    v.forEach(function (r, i) {
      if (itemCodeKey_(r[C.code]) !== code) return;
      var o = bomRowObj_(r, C, i + 3), live = str_(o.end) === '' ? 1 : 0, st = bomRnum_(o.start) || 0;
      var mine = o.product === code;                                    // 그 품목 자기 BOM 의 제품 줄
      if (mine) { if (!prodRow || live > prodRow.live || (live === prodRow.live && st >= prodRow.st)) prodRow = { live: live, st: st, o: o }; return; }
      if (!best || live > best.live || (live === best.live && st >= best.st)) best = { live: live, st: st, o: o };
    });
    var L = list[code];
    if (L) {                                                             // 완제품 — 단가는 그 BOM 원가 합계
      var po = prodRow ? prodRow.o : (best ? best.o : {});
      out[code] = { code: code, kind: 'prod', name: str_(L.name || it.name || po.name), vendor: str_(po.vendor || it.vendor), unit: Math.round((Number(L.cost) || 0) * 100) / 100,
        cur: '원화', fx: 1, spec: str_(po.spec || it.spec), moq: po.moq === undefined || po.moq === '' ? '' : num_(po.moq), buy: str_(po.buy) || '턴키', round: L.round || '' };
      return;
    }
    if (best) {
      var o = best.o;
      out[code] = { code: code, kind: /^[A-Z]X/.test(code) ? 'semi' : 'mat', name: str_(it.name || o.name), type: str_(o.type), vendor: str_(o.vendor), unit: num_(o.unit) || 0, cur: str_(o.cur) || '원화', fx: num_(o.fx) || 1,
        moq: o.moq === '' ? '' : num_(o.moq), spec: str_(o.spec), buy: str_(o.buy), proc: str_(o.proc) === '' ? '' : num_(o.proc), ship: str_(o.ship) === '' ? '' : num_(o.ship), from: o.product + ' ' + str_(o.start) + (o.end ? '~' + str_(o.end) : '~') };
      return;
    }
    out[code] = { code: code, kind: 'db', name: str_(it.name), vendor: str_(it.vendor), spec: str_(it.spec), unit: '' };
  });
  return out;
}
