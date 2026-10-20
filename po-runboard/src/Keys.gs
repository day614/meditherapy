/**
 * ============================================================
 * 영구 ID · 진행상태 · 실행판 등록 (B안: 발주계획 탭은 더 이상 쓰지 않는다)
 * ------------------------------------------------------------
 *  · 발주 DB(_실행판_발주, 2026-10-04 까지는 발주현황) B열 [실행판ID] 로 건을 구분한다(품의번호가 없어도 된다).
 *  · [진행상태] 열: 계획 · 상신 · 승인 · 발주 · 종결 · 취소.
 *  · 새 발주는 실행판에서 등록하면 발주 DB에 바로 한 행이 생긴다(상태 '계획').
 *  · 발주현황에 열이 없는 정보(작성일 · 요청팀 · 요청팀 담당자 · 소진완료목표일 등)는
 *    숨김 탭 [_실행판_발주부가정보] 에 실행판ID 로 둔다.
 *  · 취소는 행을 지우지 않고 [진행상태]만 '취소'로 바꾼다.
 * ============================================================
 */

var RB_KEY = {
  ID: '실행판ID',
  STATE: '진행상태',
  STOCK: '현재고',                 // 진행상태로 바꿔 쓰는 열의 예전 이름
  ID_COL: 2,                       // 실행판ID 로 바꿔 쓰는 열(B열, 예전 마스터코드)
  STATES: ['계획', '상신', '승인', '발주', '종결', '취소'],
  T_EXTRA: '_실행판_발주부가정보',
  EXTRA_HEAD: ['실행판ID', '작성일', '발주요청팀', '요청팀담당자', '소진완료목표일', '승인일',
               '선금지급예정', '선금', '잔금지급예정', '잔금', '등록자', '출처', '발주요청링크']
};

/** 머리글 행 전체에서 [실행판ID] · [진행상태] 열을 찾는다(0부터). 없으면 -1. */
var RB_KEYCOLS_MEMO = {};
function keyColsOf_(sh, hr, tag) {
  // 발주 DB 열 위치는 바뀌지 않는다(이관은 끝남). 기억해 둔 값을 믿는다
  // (예전에는 저장마다 마지막 열을 물어 맞춰 봤다). 쓰기 전에 그 행의 실행판ID 를 읽어 확인한다.
  var ck = 'keycols:v4:' + tag;
  if (RB_KEYCOLS_MEMO[ck] && RB_KEYCOLS_MEMO[ck].hr === hr) return RB_KEYCOLS_MEMO[ck];
  var hit = cacheGet_(ck);
  if (hit && hit.hr === hr) { RB_KEYCOLS_MEMO[ck] = hit; return hit; }
  var lc = sh.getLastColumn();
  var out = { id: -1, state: -1, lc: lc, hr: hr };
  if (hr < 1 || lc < 1) return out;
  sh.getRange(hr, 1, 1, lc).getValues()[0].forEach(function (h, i) {
    var s = String(h == null ? '' : h).replace(/\s/g, '');
    if (s === RB_KEY.ID && out.id < 0) out.id = i;
    if (s === RB_KEY.STATE && out.state < 0) out.state = i;
  });
  cachePut_(ck, out, RB_TTL);
  RB_KEYCOLS_MEMO[ck] = out;
  return out;
}

function statusKeyCols_(sh, hr) { return keyColsOf_(sh, hr, 'status'); }

/** 데이터 행마다 { id, state }. ID 열이 없으면 null. */
function readKeyValues_(sh, hr, nRows, kc) {
  if (kc.id < 0 || nRows < 1) return null;
  var c0 = kc.state >= 0 ? Math.min(kc.id, kc.state) : kc.id;
  var c1 = kc.state >= 0 ? Math.max(kc.id, kc.state) : kc.id;
  var v = sh.getRange(hr + 1, c0 + 1, nRows, c1 - c0 + 1).getValues();
  return v.map(function (r) {
    return { id: str_(r[kc.id - c0]), state: kc.state >= 0 ? str_(r[kc.state - c0]) : '' };
  });
}

/** 발주현황 한 행에 영구 ID · 진행상태를 입힌다. */
function applyKeys_(it, kv) {
  if (!kv) return;
  if (kv.id) { it.id = kv.id; it.fixedId = true; }
  if (kv.state && RB_KEY.STATES.indexOf(kv.state) > -1) {
    it.state = kv.state;
    if (kv.state === '종결' || kv.state === '취소') it.closed = true;
    if (kv.state === '취소') it.cancelled = true;
  }
}

var RB_ID_RE = /^RB\d{6}-[0-9A-F]{6}$/;
function newOrderId_() {
  var d = new Date();
  return 'RB' + String(d.getFullYear()).slice(2) + pad2_(d.getMonth() + 1) + pad2_(d.getDate()) + '-' +
    Utilities.getUuid().replace(/-/g, '').slice(0, 6).toUpperCase();
}


/* ============================================================
 * 부가정보 숨김 탭 (발주현황에 열이 없는 값)
 * ============================================================ */

function readExtras_() {
  var sh = sheet_(RB_KEY.T_EXTRA);
  if (!sh || sh.getLastRow() < 2) return {};
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, RB_KEY.EXTRA_HEAD.length).getValues();
  var out = {};
  v.forEach(function (r) {
    var id = str_(r[0]);
    if (!id) return;
    var dOrTxt = function (v) { return v instanceof Date ? fmtDate_(v) : str_(v); };
    out[id] = {
      madeAt: fmtDate_(toDate_(r[1])), team: str_(r[2]), reqOwner: str_(r[3]), useBy: fmtDate_(toDate_(r[4])),
      approvedAt: fmtDate_(toDate_(r[5])), preAt: dOrTxt(r[6]), pre: num_(r[7]), balAt: dOrTxt(r[8]), bal: num_(r[9]),
      link: str_(r[12])
    };
  });
  return out;
}

function appendExtras_(list) {
  if (!list.length) return;
  var sh = tab_(RB_KEY.T_EXTRA, RB_KEY.EXTRA_HEAD);
  if (sh.getLastColumn() < RB_KEY.EXTRA_HEAD.length) {        // 예전 탭에는 뒤쪽 머리글(발주요청링크)이 없다
    sh.getRange(1, 1, 1, RB_KEY.EXTRA_HEAD.length).setValues([RB_KEY.EXTRA_HEAD]).setFontWeight('bold');
  }
  list = list.map(function (r) { while (r.length < RB_KEY.EXTRA_HEAD.length) r.push(''); return r; });
  sh.getRange(sh.getLastRow() + 1, 1, list.length, RB_KEY.EXTRA_HEAD.length).setValues(list);
}

/** 발주현황 행에 부가정보(작성일 · 요청팀 등)를 붙인다. 이미 값이 있으면 그대로 둔다. */
function attachExtras_(rows) {
  var ex = readExtras_();
  rows.forEach(function (r) {
    var e = ex[r.id];
    if (!e) return;
    Object.keys(e).forEach(function (k) { if ((r[k] === '' || r[k] == null || r[k] === 0) && e[k]) r[k] = e[k]; });
  });
}

/* ============================================================
 * 발주현황에 행 쓰기
 * ============================================================ */

function statusFieldCols_(C) {
  return {
    doc: colIdx_(C.idx, ['품의번호']), brand: colIdx_(C.idx, ['브랜드']), channel: colIdx_(C.idx, ['채널']),
    code: colIdx_(C.idx, ['품목코드']), batch: colIdx_(C.idx, ['발주차수']), name: colIdx_(C.idx, ['품목명']),
    qty: colIdx_(C.idx, ['발주수량']), vendor: colIdx_(C.idx, ['업체명', '매입처']), price: colIdx_(C.idx, ['단가']),
    owner: colIdx_(C.idx, ['이', '담당', '담당자', '구매담당자']), ordered: colIdx_(C.idx, ['발주일']),
    due: colIdx_(C.idx, ['입고목표', '입고목표일']), eta: colIdx_(C.idx, ['입고일정']),
    inQty: colIdx_(C.idx, ['입고수량']), remain: colIdx_(C.idx, ['발주잔량']),
    memo: colIdx_(C.idx, ['비고', '메모']), cat: colIdx_(C.idx, ['구분']),
    madeAt: colIdx_(C.idx, ['작성일']), team: colIdx_(C.idx, ['발주요청팀']), reqOwner: colIdx_(C.idx, ['요청팀담당자']),
    useBy: colIdx_(C.idx, ['소진완료목표일']), preAt: colIdx_(C.idx, ['선금지급예정']), pre: colIdx_(C.idx, ['선금']),
    balAt: colIdx_(C.idx, ['잔금지급예정']), bal: colIdx_(C.idx, ['잔금']), link: colIdx_(C.idx, ['발주요청링크']),
    // 새 양식(2026-10 정리): 통화 · 발주금액(수식) · 입고기록(입고 날짜 · 수량 한 칸). 예전 양식이면 -1
    cur: colIdx_(C.idx, ['통화']), amt: colIdx_(C.idx, ['발주금액']), rec: colIdx_(C.idx, ['입고기록'])
  };
}
/** 예전 양식이면 입고수량 바로 오른쪽에 회차 수량 1~20 칸이 있다(머리글 '1'). 새 양식이면 없다 */
function dbHasParts_(C, inQtyCol) {
  if (inQtyCol < 0) return false;
  var h = C.head ? C.head[inQtyCol + 1] : null;
  if (h === undefined || h === null) { var k = Object.keys(C.idx || {}).filter(function (x) { return C.idx[x] === inQtyCol + 1; })[0]; h = k; }
  return String(h == null ? '' : h).trim() === '1';
}
/** 발주금액 칸 수식(같은 행 발주수량 × 단가) — A1 */
function dbAmtFormula_(S, row) {
  var q = colRB_(S.qty + 1) + row, p = colRB_(S.price + 1) + row;
  return '=IF(OR(' + q + '="",' + p + '=""),"",' + q + '*' + p + ')';
}

/** 이 열(0부터)에 값이 있는 마지막 행 다음 행(1부터). */
function nextFreeRow_(sh, hr, col0) {
  var last = sh.getLastRow();
  if (last <= hr) return hr + 1;
  var v = sh.getRange(hr + 1, col0 + 1, last - hr, 1).getValues();
  for (var i = v.length - 1; i >= 0; i--) if (str_(v[i][0])) return hr + 2 + i;
  return hr + 1;
}

/**
 * 발주 DB 맨 아래(품목명이 있는 마지막 행 다음)부터 여러 행을 한 번에 쓴다.
 * list: [{ id, state, doc, brand, channel, code, batch, name, qty, vendor, price, owner, ordered(Date|''), due(글자), memo }]
 * 계산 칸(입고수량 · 발주잔량)도 값으로 쓴다. 숨김 탭이라 서식은 맞추지 않는다.
 * 돌려주는 값: 첫 행 번호(1부터).
 */
function writeStatusRows_(sh, C, kc, list) {
  if (!list.length) return 0;
  var S = statusFieldCols_(C);
  if (S.name < 0 || S.qty < 0) throw new Error('발주 DB에서 [품목명] / [발주수량] 열을 찾을 수 없습니다.');
  var width = Math.max(kc.id, kc.state) + 1;
  Object.keys(S).forEach(function (k) { if (S[k] + 1 > width) width = S[k] + 1; });
  var hasParts = dbHasParts_(C, S.inQty);
  if (hasParts) width = Math.max(width, S.inQty + RB.PARTIAL_MAX + 1);

  var start = nextFreeRow_(sh, C.hr, S.name);
  var n = list.length;
  if (start + n - 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), start + n - 1 - sh.getMaxRows());
  var rg = sh.getRange(start, 1, n, width);
  var vals = rg.getValues(), fs = rg.getFormulas();

  var lines = list.map(function (f, r) {
    var line = vals[r].map(function (v, c) { return fs[r][c] ? fs[r][c] : v; });
    var put = function (c, v) { if (c >= 0) line[c] = v; };
    var qty = num_(f.qty), price = (f.price === '' || f.price == null) ? '' : num_(f.price);
    var ref = f.ordered instanceof Date ? { y: f.ordered.getFullYear(), m: f.ordered.getMonth() + 1 } : null;
    put(kc.id, f.id);
    put(kc.state, f.state || '계획');
    put(S.doc, f.doc || '');                 // 빈 행에 걸린 품의번호 수식이 엉뚱한 번호를 만들지 않게
    put(S.brand, f.brand || ''); put(S.channel, f.channel || ''); put(S.code, f.code ? asText_(f.code) : '');
    put(S.batch, asText_(f.batch || '')); put(S.name, asText_(f.name)); put(S.qty, qty);      // 글자 그대로(날짜 · 숫자로 바뀌지 않게)
    put(S.vendor, f.vendor || ''); put(S.price, price); put(S.owner, f.owner || '');
    put(S.ordered, f.ordered || '');
    put(S.due, f.due ? sheetDateTok_(f.due, ref) : '');
    // 새 발주는 입고예정 = 입고목표(규칙). 예전에는 잔금 예정 줄을 거쳐서만 채워, 잔금이 없거나 지급예정을 못 읽으면 빈칸이었다
    if (S.eta >= 0) put(S.eta, f.due && toDate_(f.due) ? asText_(fmtDate_(toDate_(f.due))) : '');
    if (hasParts) for (var pi = 1; pi <= RB.PARTIAL_MAX; pi++) put(S.inQty + pi, '');
    put(S.cur, f.cur || '');
    if (S.amt >= 0 && S.qty >= 0 && S.price >= 0) put(S.amt, dbAmtFormula_(S, start + r));
    put(S.rec, '');
    put(S.inQty, 0);
    put(S.remain, qty);
    put(S.memo, asText_(f.memo || ''));
    if (f.cat !== undefined) put(S.cat, f.cat || '');
    // 발주 DB 하나로 모은 열(있을 때만)
    ['madeAt', 'team', 'reqOwner', 'useBy', 'preAt', 'pre', 'balAt', 'bal', 'link'].forEach(function (key) {
      if (f[key] !== undefined) put(S[key], f[key]);
    });
    return line;
  });
  rg.setValues(lines);
  return start;
}

/* ============================================================
 * 한 번만: B열(마스터코드) → 실행판ID · 현재고 → 진행상태 · 발주계획 건 옮기기
 * ============================================================ */

/* ============================================================
 * 실행판에서 새 발주 등록
 * ============================================================ */

/**
 * 새 발주건 등록 → 발주 DB에 한 행(진행상태 '계획'). 발주계획 탭에는 쓰지 않는다(B안).
 * p: { brand, channel, code, batch, name, qty, vendor, price, owner, due, useBy, team, reqOwner, memo }
 */
function apiCreateOrder(p) {
  requireEditor_();
  var T = rbTimer_();
  p = p || {};
  var t = function (k, n) { return str_(p[k]).slice(0, n || 100); };
  var name = t('name', 200);
  var qty = num_(p.qty);
  var price = (p.price === '' || p.price == null) ? '' : num_(p.price);
  if (!name) throw new Error('품목명을 넣어주세요.');
  if (!t('code') && !p.newItem) throw new Error('품목코드가 없습니다. 품목을 검색해 고르거나 신제품으로 표시해 주세요.');
  // 필수: 선금 · 비고만 빼고 전부(화면과 같은 규칙). 신제품이면 품목코드 · 바코드는 없어도 된다.
  var need = [['batch', '차수'], ['cat', '구분'], ['brand', '브랜드'], ['channel', '채널'], ['vendor', '업체'],
    ['owner', '구매 담당'], ['due', '입고목표일'], ['useBy', '소진완료목표일'], ['team', '발주요청팀'],
    ['reqOwner', '요청팀 담당자'], ['link', '발주요청 링크'], ['balAt', '잔금 지급예정'], ['bal', '잔금']]
    .filter(function (x) { return !t(x[0]); }).map(function (x) { return x[1]; });
  // 단가 0(무상) · 선금 100% 면 잔금 0 — 잔금 칸이 비어 와도 막지 않는다
  if (need.indexOf('잔금') > -1 && (price === 0 || (num_(p.pre) > 0 && num_(p.preRate) >= 100))) need.splice(need.indexOf('잔금'), 1);
  if (price === '') need.push('단가');
  if (p.newItem) need = [];                  // 신제품은 품목명만 필수(나머지는 정해지면 발주 수정에서)
  if (need.length) throw new Error(need.join(' · ') + ' 을(를) 넣어주세요.');
  checkChoices_({ cat: t('cat', 30), brand: t('brand'), channel: t('channel'), team: t('team') });
  T.mark('목록검사');
  // 신제품 코드 중복 확인(품목 DB · BOM 전체를 읽어 무겁다)은 잠금 안에서 한 번만 한다 — 예전에는 잠금 밖 · 안에서 두 번 했다.
  if (!(qty > 0) && !(p.newItem && t('qty') === '')) throw new Error('발주수량을 넣어주세요.');
  if (price !== '' && !(price >= 0)) throw new Error('단가가 올바르지 않습니다.');
  var ymdOk = function (s) { return !s || /^\d{4}-\d{1,2}-\d{1,2}$/.test(String(s).trim()); };
  if (!ymdOk(p.due) || !ymdOk(p.useBy)) throw new Error('날짜는 달력에서 골라주세요.');
  T.mark('코드검사');

  var sh = statusSheet_();
  // 화면이 먼저 만든 ID(RByymmdd-XXXXXX)를 그대로 쓴다. 저장 전부터 화면에 올라가 있으므로.
  var id = /^RB\d{6}-[0-9A-F]{6}$/.test(str_(p.id)) ? str_(p.id) : newOrderId_();
  var row, out = {};
  // 선금 · 잔금 지급예정은 날짜(yyyy-MM-dd)면 날짜로, '11월말일' 같은 글자면 글자 그대로
  var dateOrText = function (k) { var v = t(k, 40); return /^\d{4}-\d{1,2}-\d{1,2}$/.test(v) ? toDate_(v) : v; };
  var money = function (k) { return (p[k] === '' || p[k] == null) ? '' : num_(p[k]); };
  // 품목 DB: 신제품이거나 DB에 아직 없는 코드면 같이 넣는다(이미 있으면 건너뜀 — 다시 불러도 된다).
  // 발주 DB 행을 쓴 뒤라 실패해도 던지지 않고 경고로 돌려준다(던지면 화면이 같은 건을 다시 보냈다).
  var regItem = function () {
    if (!t('code')) return '';
    try {
      appendItems_([{ code: t('code'), name: name, brand: t('brand'), channel: t('channel'), vendor: t('vendor'), price: price,
                      barcode: t('barcode', 40) }], p.newItem ? '실행판 신제품 등록 ' + id : '실행판 발주 등록 ' + id);
      if (p.newItem) productCodeRegister_(t('code'), name, t('brand'), '실행판 신제품 등록 ' + id);
      if (t('barcode', 40)) setItemBarcode_(t('code'), t('barcode', 40));
      return '';
    } catch (eI) { return '발주는 등록했지만 품목 DB(' + t('code').toUpperCase() + ') 에 못 넣었습니다: ' + eI.message; }
  };
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var vOuter = deferVer_();      // 이력마다 시트 반영(flush)하지 않고 잠금 놓기 직전 한 번
  T.mark('잠금');
  try {
    if (p.newItem && t('code') && (itemExists_(t('code')) || productCodeTaken_(t('code')))) throw new Error('품목코드 ' + t('code').toUpperCase() + ' 는 이미 있습니다(품목 DB · BOM · 신규코드채번). 신제품 체크를 풀고 검색에서 고르거나 [코드 만들기]로 새 코드를 받으세요.');
    var C = sheetCols_(sh);
    var kc = statusKeyCols_(sh, C.hr);
    if (kc.id < 0 || kc.state < 0) throw new Error('발주 DB에 [실행판ID] · [진행상태] 열이 없습니다. 관리자에게 알려 주세요.');
    // 이미 저장된 ID 면(응답을 못 받고 화면이 다시 보낸 경우) 새로 쓰지 않고 그 행을 돌려준다
    var nIds = sh.getLastRow() - C.hr;
    if (nIds > 0) {
      var have = sh.getRange(C.hr + 1, kc.id + 1, nIds, 1).getValues();
      for (var hi = have.length - 1; hi >= 0; hi--) {
        if (str_(have[hi][0]) === id) {
          // 지난번에 발주 DB 줄만 쓰고 지급 줄을 쓰다 실패했으면(응답 없이 끊김) 지급 줄을 마저 쓴다
          var aRow = C.hr + 1 + hi;
          if (!readLinesAll_().rows.some(function (r) { return str_(r[0]) === id; })) {
            var aMul = (t('vendor').indexOf(RB.CHINA_KEYWORD) > -1) ? RB.CHINA_MULTIPLIER : 1;
            var aBal = money('bal') || 0; if (p.balAuto) aBal = aBal * aMul;
            var aLines = replaceLinesFor_(id, linesForNewOrder_({ pre: money('pre') || 0, preAt: t('preAt', 40), bal: aBal, balAt: t('balAt', 40), due: p.due || '', qty: qty }), '실행판 등록(이어서)');
            syncOrderFromLines_(sh, C, aRow, aLines);
          }
          var aWarn = regItem();     // 지난번에 품목 DB 넣기 전에 끊겼으면 마저
          return { id: id, statusRow: aRow, already: true, warn: aWarn };
        }
      }
    }
    T.mark('ID중복확인');
    row = writeStatusRows_(sh, C, kc, [{
      id: id, state: '계획', brand: t('brand'), channel: t('channel'), code: t('code'), batch: t('batch', 20),
      name: name, qty: (p.newItem && t('qty') === '') ? '' : qty, vendor: t('vendor'), price: price, owner: t('owner', 40),
      ordered: '', due: p.due || '', memo: t('memo', 500), cat: t('cat', 30),
      // 발주 DB 하나로: 작성일 · 요청 정보 · 선금/잔금 · 링크도 같은 행에(열이 아직 없으면 무시되고 아래 부가정보 탭으로)
      madeAt: new Date(), team: t('team'), reqOwner: t('reqOwner', 40), useBy: p.useBy ? toDate_(p.useBy) : '',
      preAt: dateOrText('preAt'), pre: money('pre'), balAt: dateOrText('balAt'), bal: money('bal'), link: t('link', 500),
      cur: (['KRW', 'CNY', 'USD'].indexOf(str_(p.cur).toUpperCase()) > -1 ? str_(p.cur).toUpperCase() : (t('vendor').indexOf(RB.CHINA_KEYWORD) > -1 ? 'CNY' : 'KRW'))
    }]);
    T.mark('발주DB쓰기');
    if (statusFieldCols_(C).team < 0) {
      appendExtras_([[id, new Date(), t('team'), t('reqOwner', 40), p.useBy ? toDate_(p.useBy) : '', '',
                      dateOrText('preAt'), money('pre'), dateOrText('balAt'), money('bal'), me_(),
                      p.newItem && !t('code') ? '실행판 등록 · 신제품(품목코드 미생성)' : '실행판 등록', t('link', 500)]]);
    }
    // 선금 · 잔금 → 지급 줄. 금액은 원화: 잔금을 비워 자동으로 잡은 값은 중국 단가(위안)면 환산한다.
    var payMul = (t('vendor').indexOf(RB.CHINA_KEYWORD) > -1) ? RB.CHINA_MULTIPLIER : 1;
    var preAmt = money('pre') || 0, balAmt = money('bal') || 0;
    if (p.balAuto) balAmt = balAmt * payMul;
    var nl = linesForNewOrder_({ pre: preAmt, preAt: t('preAt', 40), bal: balAmt, balAt: t('balAt', 40), due: p.due || '', qty: qty });
    out.lines = replaceLinesFor_(id, nl, '실행판 등록');
    T.mark('지급줄쓰기');
    syncOrderFromLines_(sh, C, row, out.lines);
    T.mark('발주DB칸맞추기');
    try { apRebuildSoon_(); } catch (e) { /* AP 는 20시에라도 다시 만든다 */ }
    out.pay = { missed: (preAmt > 0 && !ymOf_(t('preAt', 40)) ? ['선금 지급예정을 날짜로 못 읽음'] : [])
      .concat(balAmt > 0 && !ymOf_(t('balAt', 40)) ? ['잔금 지급예정을 날짜로 못 읽음'] : []) };
    T.mark('AP예약');
    writeAudits_([{ tab: RB.STATUS_TAB, row: row, col: kc.id + 1, what: '실행판 신규 등록', before: '', after: id, item: name }]);
    T.mark('이력');
    // 품목 DB: 신제품이거나 DB에 아직 없는 코드면 같이 넣는다
    out.warn = regItem();
    T.mark('품목DB');
  } finally {
    try { endVer_(vOuter); } catch (e) { /* 넘어간다 */ }
    try { if (typeof T !== 'undefined' && T && T.mark) T.mark('반영(시트 계산)'); } catch (eT) { /* 넘어간다 */ }
    lock.releaseLock();
  }
  cacheDrop_(rowsCacheKey_('po'));              // 새 건이 다음 첫 화면(캐시)에도 바로 보이게
  // 단가 통화(원화 아니거나 업체명 규칙과 다를 때도 그대로 남긴다) — 진행 기록 checks._cur
  var cur = str_(p.cur).toUpperCase();
  var curDef = t('vendor').indexOf(RB.CHINA_KEYWORD) > -1 ? 'CNY' : 'KRW';     // 기록이 없을 때 화면이 쓰는 기본값과 다를 때만 남긴다
  if (['KRW', 'CNY', 'USD'].indexOf(cur) > -1 && cur !== curDef) {
    try { editProgress_(id, { name: name, batch: t('batch', 20), brand: t('brand'), code: t('code') }, 'po', function (st) { st.checks._cur = cur; }); } catch (e) { /* 통화 기록 실패가 등록을 막지는 않는다 */ }
  }
  T.mark('통화기록');
  out.id = id;
  out.statusRow = row;
  out.timing = T.done();
  return out;
}

/* ============================================================
 * 진행상태 바꾸기(취소 포함)
 * ============================================================ */

function apiSetState(statusRow, expect, state) {
  requireEditor_();
  state = str_(state);
  if (RB_KEY.STATES.indexOf(state) < 0) throw new Error('알 수 없는 진행상태입니다: ' + state);
  var row = Number(statusRow) || 0;
  if (row < 2) throw new Error('발주 DB에 없는 건입니다.');
  var sh = statusSheet_();
  var before;
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  // 장부(1분마다 옮기는 날짜 · 체크)에 남은 '상태 올리기'를 먼저 옮긴다 — 안 그러면 이 변경 뒤에 옮겨지며 상태를 상신 · 승인으로 되돌렸다
  try { drainJournal_(); } catch (eDJ) { /* 넘어간다 */ }
  var vOuter = deferVer_();      // 변경 번호 · 반영(flush)은 잠금 놓기 직전 한 번
  try {
    var C = sheetCols_(sh);
    var kc = statusKeyCols_(sh, C.hr);
    if (kc.state < 0) throw new Error('[진행상태] 열이 없습니다. 관리자에게 알려 주세요.');
    row = checkStatusRow_(sh, C, row, expect);
    var cell = sh.getRange(row, kc.state + 1);
    before = str_(cell.getValue());
    if (before === state) return { ok: true, state: state, before: before };
    cell.setValue(state);
    writeAudits_([{ tab: RB.STATUS_TAB, row: row, col: kc.state + 1, what: '진행상태', before: before, after: state,
      item: str_((expect || {}).name) }]);
    bumpVer_('r');
  } finally {
    try { endVer_(vOuter); } catch (e) { /* 넘어간다 */ }
    try { if (typeof T !== 'undefined' && T && T.mark) T.mark('반영(시트 계산)'); } catch (eT) { /* 넘어간다 */ }
    lock.releaseLock();
  }
  // 첫 화면 목록 캐시를 버린다(다른 발주 DB 저장과 같게). 안 버리면 다른 사람 첫 화면에 옛 진행상태(취소 전 등)가 최대 6시간 남았다.
  cacheDrop_(rowsCacheKey_('po'));
  apRefreshSoon_();
  return { ok: true, state: state, before: before };
}

/* ============================================================
 * 품목코드 넣기(신제품: 등록 뒤 코드가 생성되면)
 * ============================================================ */

function apiSetCode(statusRow, expect, code, barcode, force) {
  requireEditor_();
  code = str_(code).toUpperCase().slice(0, 40);
  barcode = str_(barcode).replace(/\s/g, '').slice(0, 40);
  if (barcode && !/^[0-9A-Za-z-]+$/.test(barcode)) throw new Error('바코드는 숫자 · 영문으로만 넣어주세요.');
  if (!code) throw new Error('품목코드를 넣어주세요.');
  if (!/^[A-Z0-9_-]+$/.test(code)) throw new Error('품목코드는 영문 · 숫자로만 넣어주세요.');
  var sh = statusSheet_();
  var row = Number(statusRow) || 0;
  var before;
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  try {
    var C = sheetCols_(sh);
    var cCode = colIdx_(C.idx, ['품목코드']);
    if (cCode < 0) throw new Error('[품목코드] 열을 찾을 수 없습니다.');
    row = checkStatusRow_(sh, C, row, expect);
    var cell = sh.getRange(row, cCode + 1);
    before = str_(cell.getValue());
    // 이미 품목 DB 에 다른 이름으로 있는 코드면 막는다(두 사람이 같은 때 [코드 만들기]를 누르면 같은 새 코드가 두 품목에 들어갔다) — 맞으면 화면이 확인 후 force 로 다시
    if (!force) {
      var nmS = str_(sh.getRange(row, 1, 1, C.lc).getValues()[0][statusFieldCols_(C).name] || (expect || {}).name);
      var dbIt = readItems_().filter(function (it) { return it.code === itemCodeKey_(code); })[0];
      var nz = function (x) { return str_(x).replace(/\s+/g, '').toUpperCase(); };
      if (dbIt && dbIt.name && nmS && nz(dbIt.name) !== nz(nmS) && nz(dbIt.name).indexOf(nz(nmS)) < 0 && nz(nmS).indexOf(nz(dbIt.name)) < 0) throw new Error('CODE_TAKEN:' + dbIt.name);
    }
    cell.setValue(asText_(code));
    writeAudits_([{ tab: RB.STATUS_TAB, row: row, col: cCode + 1, what: '품목코드', before: before, after: code,
      item: str_((expect || {}).name) }]);
    // 신제품 코드가 생겼으면 품목 DB에도 넣는다(이미 있으면 그대로)
    var rv = sh.getRange(row, 1, 1, C.lc).getValues()[0];
    var S = statusFieldCols_(C);
    var at = function (c) { return c >= 0 ? rv[c] : ''; };
    appendItems_([{ code: code, name: at(S.name) || str_((expect || {}).name), brand: at(S.brand), channel: at(S.channel),
                    vendor: at(S.vendor), price: at(S.price), barcode: barcode }], '실행판 품목코드 입력');
    productCodeRegister_(code, at(S.name) || str_((expect || {}).name), at(S.brand), '실행판 품목코드 입력');
    if (barcode) setItemBarcode_(code, barcode);
  } finally {
    lock.releaseLock();
  }
  cacheDrop_(rowsCacheKey_('po'));
  apRefreshSoon_();
  return { ok: true, before: before, code: code };
}

/* ============================================================
 * 품목 DB (숨김 탭 _실행판_품목)
 * ------------------------------------------------------------
 *  · 이후 새 품목은 [새 발주] 에서 [신제품] 으로 등록할 때 같이 들어간다.
 *  · 품목코드가 같으면 두 번 넣지 않는다.
 *  · 바코드 · 구코드1 · 구코드2(옛 마스터코드)는 백데이터로만 보관한다(화면에는 보내지 않는다). 글자로 둔다.
 * ============================================================ */

var RB_ITEM = {
  TAB: '_실행판_품목',
  HEAD: ['품목코드', '품목명', '브랜드', '채널', '업체', '단가', '바코드', '구코드1', '구코드2', '등록일', '등록자', '출처', '사양'],   // 사양(M열): 2026-10-08 추가 — BOM 보기 [품목코드 등록] 때 BOM 사양을 같이 저장
  CACHE: 'items:v2',
  ALIAS: {
    code: ['품목코드', '코드', '자재코드', 'itemcode', 'code'],
    name: ['품목명', '상품명', '품명', '제품명', 'itemname', 'name'],
    brand: ['브랜드', '브랜드명', 'brand'],
    channel: ['채널', 'channel'],
    vendor: ['업체', '업체명', '매입처', '거래처', 'vendor'],
    price: ['단가', 'price'],
    barcode: ['바코드', '상품바코드', '바코드번호', 'barcode', 'ean', 'ean13', 'upc', 'jan'],
    old1: ['구코드1'],
    old2: ['구코드2', '마스터코드']
  }
};

function itemCodeKey_(code) { return str_(code).toUpperCase().replace(/\s/g, ''); }

/** 품목 DB 전체 [{code, name, brand, channel, vendor, price}] */
function readItems_() {
  var hit = cacheGet_(RB_ITEM.CACHE);
  if (hit) return hit;
  var sh = sheet_(RB_ITEM.TAB);
  var out = [];
  if (sh && sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, RB_ITEM.HEAD.length).getValues().forEach(function (r) {
      var code = itemCodeKey_(r[0]);
      if (!code) return;
      if (/미사용/.test(str_(r[11]))) return;          // 되돌린 코드(번호만 남김)는 품목 목록에서 뺀다
      out.push({ code: code, name: str_(r[1]), brand: str_(r[2]), channel: str_(r[3]), vendor: str_(r[4]), price: num_(r[5]) || '', spec: str_(r[12]) });
    });
  }
  cachePut_(RB_ITEM.CACHE, out, RB_TTL);
  return out;
}

/** 화면: 새 발주 검색용 품목 목록 */
function apiItems() {
  var list = readItems_().slice(), have = {};
  list.forEach(function (it) { have[it.code] = 1; });
  try { bomIndex_().forEach(function (x) { if (x.code && !have[x.code]) { have[x.code] = 1; list.push({ code: x.code, name: x.name || x.code, brand: x.brand || '', channel: '', vendor: '', price: '', bom: 1 }); } }); } catch (e) { /* BOM 없이 */ }
  return list;
}

/** 품목 DB에 없는 코드만 덧붙인다. list: [{code, name, brand, channel, vendor, price}] → 넣은 개수 */
function appendItems_(list, src) {
  var have = {};
  readItems_().forEach(function (it) { have[it.code] = 1; });
  var now = new Date(), who = me_();
  var rows = [];
  list.forEach(function (it) {
    var code = itemCodeKey_(it.code);
    if (!code || have[code] || !str_(it.name)) return;
    have[code] = 1;
    rows.push([code, str_(it.name), str_(it.brand), str_(it.channel), str_(it.vendor),
               (it.price === '' || it.price == null) ? '' : num_(it.price), str_(it.barcode), str_(it.old1), str_(it.old2),
               now, who, src || '', str_(it.spec)]);
  });
  if (rows.length) {
    var sh = tab_(RB_ITEM.TAB, RB_ITEM.HEAD);
    itemDbHead_(sh);
    var r0 = sh.getLastRow() + 1;
    if (r0 + rows.length - 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), r0 + rows.length - 1 - sh.getMaxRows());
    // 값을 쓰기 전에 글자 서식부터: 먼저 쓰면 '02035' 가 숫자 2035 로 바뀌어 앞자리 0이 사라진다
    sh.getRange(r0, 1, rows.length, 1).setNumberFormat('@');          // 품목코드
    sh.getRange(r0, 7, rows.length, 3).setNumberFormat('@');          // 바코드 · 구코드1 · 구코드2
    sh.getRange(r0, 1, rows.length, RB_ITEM.HEAD.length).setValues(rows);
    cacheDrop_(RB_ITEM.CACHE); cacheDrop_(RB_II_CACHE);
  }
  return rows.length;
}

/** 품목 DB에서 이 코드의 바코드가 비어 있으면 채운다(이미 있으면 그대로). */
function setItemBarcode_(code, barcode) {
  var k = itemCodeKey_(code), b = str_(barcode);
  if (!k || !b) return false;
  var sh = sheet_(RB_ITEM.TAB);
  if (!sh || sh.getLastRow() < 2) return false;
  var n = sh.getLastRow() - 1;
  var v = sh.getRange(2, 1, n, 7).getValues();
  for (var i = 0; i < n; i++) {
    if (itemCodeKey_(v[i][0]) !== k) continue;
    if (str_(v[i][6])) return false;
    var cell = sh.getRange(i + 2, 7);
    cell.setNumberFormat('@');
    cell.setValue(b);
    cacheDrop_(RB_II_CACHE);
    return true;
  }
  return false;
}

/** 품목 DB 탭에 새로 붙인 머리 칸(사양 등)이 없으면 채운다 — 예전 탭은 12칸(출처까지) */
function itemDbHead_(sh) {
  var n = RB_ITEM.HEAD.length;
  if (sh.getMaxColumns() < n) sh.insertColumnsAfter(sh.getMaxColumns(), n - sh.getMaxColumns());
  var h = sh.getRange(1, 1, 1, n).getValues()[0];
  for (var i = 12; i < n; i++) if (!str_(h[i])) sh.getRange(1, i + 1).setValue(RB_ITEM.HEAD[i]).setFontWeight('bold');
}
/** 품목 DB 의 모든 코드(되돌린 · 미사용 포함) — 새 번호를 만들 때 겹치지 않게 */
function itemDbAllCodes_() {
  var sh = sheet_(RB_ITEM.TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(function (r) { return itemCodeKey_(r[0]); }).filter(String);
}
/** 되돌린 새 코드: 품목 DB 출처에 '실행판 되돌림 · 미사용'(품목 검색에서 빠지고 번호는 다시 쓰지 않는다) */
function itemDbMarkUnused_(code, label) {
  var k = itemCodeKey_(code), sh = sheet_(RB_ITEM.TAB);
  if (!k || !sh || sh.getLastRow() < 2) return false;
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, RB_ITEM.HEAD.length).getValues();
  for (var i = v.length - 1; i >= 0; i--) {
    if (itemCodeKey_(v[i][0]) !== k) continue;
    if (!/미사용/.test(str_(v[i][11]))) sh.getRange(i + 2, 12).setValue((str_(v[i][11]) ? str_(v[i][11]) + ' · ' : '') + (label || '실행판 되돌림 · 미사용'));
    cacheDrop_(RB_ITEM.CACHE); cacheDrop_(RB_II_CACHE);
    return true;
  }
  return false;
}
function itemExists_(code) {
  var k = itemCodeKey_(code);
  return !!k && readItems_().some(function (it) { return it.code === k; });
}

/* ============================================================
 * 품의번호 한꺼번에 넣기
 * ------------------------------------------------------------
 * 품의 1건(엑셀 품의서 번호)에 여러 발주건이 들어가므로, 목록에서 고른 건들에 같은 번호를 넣는다.
 *  · 발주 DB [품의번호] 칸에 글자로 적는다(행은 실행판ID 로 찾는다).
 *  · 진행상태가 '계획' 이면 '상신' 으로 올린다.
 *  · 품의번호 입력 대기열(rb.docq)에 넣어, 다음 새로 읽기 때 상신 항목 체크 + 상신일(오늘)이 자동으로 붙는다.
 *  · 이미 다른 품의번호가 있는 건은 overwrite 가 아니면 건너뛴다.
 * items: [{ statusRow, expect }]
 * ============================================================ */

function apiBulkDoc(items, doc, overwrite, day) {
  requireEditor_();
  doc = str_(doc).slice(0, 60);
  if (!doc) throw new Error('품의번호(엑셀 품의서 번호, MTB2C-…)를 넣어주세요.');
  if (docLooksWrong_(doc)) throw new Error('결재문서번호(' + doc + ')는 품의번호가 아닙니다. 엑셀 품의서의 품의번호(MTB2C-…)를 넣어주세요.');
  var list = (items || []).filter(function (x) { return Number(x && x.statusRow) >= 2; });
  if (!list.length) return { n: 0, skipped: [] };
  var sh = statusSheet_();
  var n = 0, skipped = [], skippedIds = [], audits = [], states = 0, wrote = [];
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var outer = deferVer_();
  try {
    var C = sheetCols_(sh);
    var cDoc = colIdx_(C.idx, ['품의번호']);
    if (cDoc < 0) throw new Error('[품의번호] 열을 찾을 수 없습니다.');
    // 모두 읽기(행 찾기 · 품의번호 칸 · 진행상태 칸) → 한꺼번에 쓰기. 예전에는 건마다 읽고 쓰기를 번갈아 해서 건마다 재계산을 기다렸다.
    var ix = statusIdIndex_(sh, C), kc = ix.kc, rows = [], by = {};
    list.forEach(function (x) {
      var name = str_((x.expect || {}).name);
      var row;
      try { row = findStatusRow_(ix, sh, C, Number(x.statusRow), x.expect); }
      catch (err) { skipped.push(name + ' — 행을 찾지 못함, 새로고침 필요'); skippedIds.push(str_((x.expect || {}).id || x.id)); return; }
      if (by[row]) return;
      by[row] = x; rows.push(row);
    });
    var docNow = colAt_(sh, cDoc, rows), stNow = kc.state >= 0 ? colAt_(sh, kc.state, rows) : {};
    var docRows = [], stRows = [];
    rows.forEach(function (row) {
      var x = by[row], name = str_((x.expect || {}).name);
      var before = str_(docNow[row]);
      if (before && before !== doc && !overwrite) { skipped.push(name + ' — 이미 품의번호 ' + before); skippedIds.push(str_((x.expect || {}).id || x.id)); return; }
      docRows.push(row);                                        // 남아 있던 품의번호 수식도 값으로 바뀐다
      audits.push({ tab: RB.STATUS_TAB, row: row, col: cDoc + 1, what: '품의번호(일괄)', before: before, after: doc, item: name });
      if (kc.state >= 0 && str_(stNow[row]) === '계획') {
        stRows.push(row);
        audits.push({ tab: RB.STATUS_TAB, row: row, col: kc.state + 1, what: '진행상태', before: '계획', after: '상신', item: name });
        states++;
      }
      n++;
      wrote.push({ id: str_((x.expect || {}).id), meta: { doc: doc, name: name, batch: str_((x.expect || {}).batch), code: str_((x.expect || {}).code) } });
    });
    setCellsSame_(sh, docRows, cDoc, doc, true);
    setCellsSame_(sh, stRows, kc.state, '상신');
    if (n) {
      // (시트에 직접 넣은 품의번호용) 대기열에도 남긴다
      var q = docQueueRead_(), today0 = ymd_(new Date());
      wrote.forEach(function (w) { var key = RB_ID_RE.test(w.id) ? 'id:' + w.id : norm_(doc); if (!q[key]) q[key] = today0; });   // 그 건 ID 로(같은 품의번호의 다른 줄까지 상신되지 않게)
      docQueueWrite_(q);
      writeAudits_(audits);
    }
  } finally {
    try { endVer_(outer); } catch (e) { /* 넘어간다 */ }
    lock.releaseLock();
  }
  cacheDrop_(rowsCacheKey_('po'));
  // 품의번호를 넣은 그 자리에서 상신 항목 체크 + 상신일(오늘). 예전에는 대기열(150개 한도)이 차면 빠져 체크가 안 됐다.
  var checked = 0;
  try { checked = markSubmitted_(wrote, /^\d{4}-\d{2}-\d{2}$/.test(str_(day)) ? str_(day) : ymd_(new Date())); } catch (e) { /* 체크 실패가 품의번호 저장을 막지는 않는다 */ }
  if (n) apRefreshSoon_();
  return { n: n, states: states, skipped: skipped, skippedIds: skippedIds, checked: checked };
}

/* ============================================================
 * 시트 칸 쓰기 도우미: 구매 담당 · 지급월
 * ============================================================ */

/** 발주 DB [구매담당자] 칸. list: [{statusRow, expect, owner}] → 쓴 칸 수 */
function writeOwnerCells_(list, fillOnly) {
  if (!list.length) return 0;
  var sh = statusSheet_();
  var n = 0, audits = [];
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var outer = deferVer_();
  try {
    var C = sheetCols_(sh);
    var cOwner = colIdx_(C.idx, ['이', '담당', '담당자', '구매담당자']);
    if (cOwner < 0) return 0;
    // 모두 읽기 → 값이 같은 칸끼리 한꺼번에 쓰기
    var ix = statusIdIndex_(sh, C), rows = [], by = {};
    list.forEach(function (x) {
      var row;
      try { row = findStatusRow_(ix, sh, C, Number(x.statusRow), x.expect); } catch (e) { return; }
      by[row] = x;                                     // 같은 행이 두 번 오면 나중 값
      if (rows.indexOf(row) < 0) rows.push(row);
    });
    var now = colAt_(sh, cOwner, rows), cells = [];
    rows.forEach(function (row) {
      var x = by[row], before = str_(now[row]);
      if (before === str_(x.owner)) return;
      if (fillOnly && before) return;                  // 첫 화면 자동 채우기: 시트에 이미 적힌 담당은 덮지 않는다
      cells.push({ row: row, value: str_(x.owner) });
      audits.push({ tab: RB.STATUS_TAB, row: row, col: cOwner + 1, what: '구매 담당', before: before, after: x.owner, item: str_((x.expect || {}).name) });
    });
    setCellsGrouped_(sh, cells, cOwner);
    n = cells.length;
    writeAudits_(audits);
  } finally {
    try { endVer_(outer); } catch (e) { /* 넘어간다 */ }
    lock.releaseLock();
  }
  if (n) cacheDrop_(rowsCacheKey_('po'));
  return n;
}

/**
 * 지급예정 글자를 지급 연 · 월로. '2026-11-30' · '26/11/30' · '11월말일' · '11월 15일' · '27\'1월말일'.
 * 연도가 없으면 오늘 기준으로 가까운 미래(지난 달보다 이전 달이면 내년).
 */
function payYm_(v) {
  if (v instanceof Date) return { y: v.getFullYear(), m: v.getMonth() + 1 };
  var s = str_(v).replace(/\s/g, '');
  if (!s) return null;
  var d = toDate_(s);
  if (d) return { y: d.getFullYear(), m: d.getMonth() + 1 };
  var mm = s.match(/^(?:(\d{2})['’])?(\d{1,2})월/);
  if (!mm) return null;
  var m = Number(mm[2]);
  if (m < 1 || m > 12) return null;
  if (mm[1]) return { y: 2000 + Number(mm[1]), m: m };
  var now = new Date(), y = now.getFullYear();
  if (m < now.getMonth()) y++;          // 두 달 넘게 지난 달이면 내년으로 본다
  return { y: y, m: m };
}

/* ============================================================
 * 진행상태 자동 올리기
 * ------------------------------------------------------------
 * 시트 쪽 매입예정 · AP 는 진행상태가 계획 · 상신인 행을 빼고 계산한다.
 * 그래서 날짜를 넣으면 상태가 따라 올라가야 AP 에 들어간다.
 *   상신일 → 상신, 승인일 → 승인, 발주일 → 발주
 * 앞으로만 올린다(이미 더 뒤 단계거나 종결 · 취소면 그대로). 날짜를 지워도 내리지 않는다.
 * list: [{ statusRow(모르면 0), expect }]
 * ============================================================ */

var RB_STATE_ORDER = ['계획', '상신', '승인', '발주'];
var RB_DATE_STATE = { submitted: '상신', approved: '승인', ordered: '발주' };

function bumpStates_(list, to) {
  if (RB_STATE_ORDER.indexOf(to) < 0 || !list || !list.length) return 0;
  var n = 0;
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var outer = deferVer_();
  try {
    n = bumpStatesLocked_(list, to);
  } finally {
    try { endVer_(outer); } catch (e) { /* 넘어간다 */ }
    lock.releaseLock();
  }
  if (n) { cacheDrop_(rowsCacheKey_('po')); apRefreshSoon_(); }
  return n;
}

/** bumpStates_ 본체 — 잠금은 부르는 쪽이 쥔다(장부 옮기기에서도 부른다). 읽기 두 번 · 쓰기 한 번. */
function bumpStatesLocked_(list, to) {
  var ti = RB_STATE_ORDER.indexOf(to);
  if (ti < 0 || !list || !list.length) return 0;
  var sh = statusSheet_(), C = sheetCols_(sh);
  var ix = statusIdIndex_(sh, C);
  if (ix.kc.state < 0) return 0;
  var rows = [], who = {};
  list.forEach(function (x) {
    if (!x || !x.expect || !(str_(x.expect.id) || str_(x.expect.doc))) return;
    var row;
    try { row = findStatusRow_(ix, sh, C, Number(x.statusRow) || 0, x.expect); } catch (e) { return; }
    if (!who[row]) { who[row] = x; rows.push(row); }
  });
  var cur = colAt_(sh, ix.kc.state, rows), hit = [], audits = [];
  rows.forEach(function (row) {
    var c = str_(cur[row]), ci = RB_STATE_ORDER.indexOf(c);
    if (c && ci < 0) return;                     // 종결 · 취소 등은 건드리지 않는다
    if (ci >= ti) return;
    hit.push(row);
    audits.push({ tab: RB.STATUS_TAB, row: row, col: ix.kc.state + 1, what: '진행상태(자동)', before: c, after: to,
      item: str_(who[row].expect.name) });
  });
  setCellsSame_(sh, hit, ix.kc.state, to);
  writeAudits_(audits);
  return hit.length;
}

/* ============================================================
 * 여러 행을 한꺼번에 고칠 때 쓰는 도우미(잠금 안에서 부른다)
 * 이 시트는 쓰기 뒤에 읽으면 시트 전체 재계산을 기다려 한 번에 1초 넘게 걸린다.
 * 그래서 [모두 읽기 → 계산 → 한꺼번에 쓰기] 순서를 지킨다. 칸마다 읽고 쓰기를 번갈아 하지 않는다.
 * ============================================================ */

/** 발주 DB 실행판ID → 행 번호 목록(ID 열을 한 번만 읽는다) */
function statusIdIndex_(sh, C) {
  var kc = statusKeyCols_(sh, C.hr), map = {};
  var n = sh.getLastRow() - C.hr;
  if (kc.id >= 0 && n > 0) {
    sh.getRange(C.hr + 1, kc.id + 1, n, 1).getValues().forEach(function (r, i) {
      var v = str_(r[0]);
      if (v) (map[v] = map[v] || []).push(C.hr + 1 + i);
    });
  }
  return { map: map, kc: kc };
}

/** 행 찾기 — 위 목록에서 실행판ID 로, 없으면 예전 방식(checkStatusRow_: 품의번호 + 품목코드 + 차수) */
function findStatusRow_(ix, sh, C, row, expect) {
  var id = str_((expect || {}).id);
  if (id && ix.kc.id >= 0) {
    var h = ix.map[id] || [];
    if (h.length === 1) return h[0];
    if (h.length > 1) throw new Error('발주 DB에 실행판ID ' + id + ' 가 ' + h.length + '행 있습니다. 관리자에게 알려주세요.');
  }
  return checkStatusRow_(sh, C, row, expect);
}

/** 한 열에서 여러 행의 값 { 행: 값 } — 가장 위 ~ 가장 아래 행을 한 번에 읽는다 */
function colAt_(sh, col0, rows) {
  var out = {};
  if (!rows.length) return out;
  var a = Math.min.apply(null, rows), b = Math.max.apply(null, rows);
  var v = sh.getRange(a, col0 + 1, b - a + 1, 1).getValues();
  rows.forEach(function (r) { out[r] = v[r - a][0]; });
  return out;
}

/** 같은 값을 여러 칸(한 열)에 한 번에 쓴다. textFmt 면 글자 서식부터 */
function setCellsSame_(sh, rows, col0, value, textFmt) {
  if (!rows.length) return;
  var L = colLetterRB_(col0 + 1);
  var rl = sh.getRangeList(rows.map(function (r) { return L + r; }));
  if (textFmt) rl.setNumberFormat('@');
  rl.setValue(value);
}

/** 칸마다 다른 값: 값이 같은 칸끼리 묶어 한 번에 쓴다. cells: [{ row, value }] */
function setCellsGrouped_(sh, cells, col0, textFmt) {
  var by = {}, vals = {};
  cells.forEach(function (c) {
    var k = (c.value instanceof Date) ? 'd' + c.value.getTime() : (typeof c.value) + ':' + String(c.value);
    (by[k] = by[k] || []).push(c.row);
    vals[k] = c.value;
  });
  Object.keys(by).forEach(function (k) { setCellsSame_(sh, by[k], col0, vals[k], textFmt); });
}

/* ============================================================
 * 등록 뒤 기본정보 고치기
 * ------------------------------------------------------------
 * 발주현황 칸: 입고목표 · 구분 · 브랜드 · 채널 · 업체 · 비고
 * 부가정보 탭: 발주요청팀 · 요청팀담당자 · 소진완료목표일 · 발주요청링크
 * (품목 · 수량 · 단가는 [발주정보 ✎] — 지급월 금액까지 같이 맞춘다)
 * patch: 바꿀 칸만 담는다. 날짜는 'yyyy-MM-dd' 또는 ''(지우기).
 * ============================================================ */

/* ============================================================
 * 발주 수정 — 한 패널에서 전부
 * ------------------------------------------------------------
 * 발주현황: 품목명 · 품목코드 · 차수 · 구분 · 브랜드 · 채널 · 업체 · 수량 · 단가 · 구매 담당 · 입고목표 · 비고
 *   수량 · 단가가 바뀌면 발주잔량을 다시 계산하고 사유를 _실행판_수량단가변경 에 남긴다.
 * 부가정보 탭: 요청팀 · 요청팀 담당자 · 소진완료목표일 · 링크 · 선금/잔금(지급예정 · 금액)
 *   선금 · 잔금은 실행판 등록 건(중국 업체 제외)만: 지급월 열에서 예전 금액을 빼고 새 금액을 넣는다.
 *   수량 · 단가를 바꾸고 잔금을 그대로 두면 잔금 = 새 발주금액 − 선금 으로 다시 잡는다.
 * 값이 있던 필수 칸은 비울 수 없다.
 * ============================================================ */

function findExtraRow_(ex, id) {
  if (!id || ex.getLastRow() < 2) return -1;
  var ids = ex.getRange(2, 1, ex.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (str_(ids[i][0]) === id) return i + 2;
  return -1;
}

function apiEditOrder(statusRow, expect, patch) {
  requireEditor_();
  return editOrder_(statusRow, expect, patch, null);
}

/**
 * 발주 DB 한 건 고치기 본체 — [발주 수정] 패널(apiEditOrder)과 [발주 정보 수정 ✎](apiWriteSheet info → writeInfo_)이 같이 쓴다.
 * 예전에는 두 패널이 따로 써서 한쪽만 고치면 규칙(잔량 다시 계산 · 이력)이 달라졌다.
 * opt.info = true 면 [발주 정보 수정]: 사유(reason)를 모든 칸 이력에 '발주정보' 로 남긴다.
 */
function editOrder_(statusRow, expect, patch, opt) {
  opt = opt || {};
  patch = patch || {};
  var has = function (k) { return Object.prototype.hasOwnProperty.call(patch, k); };
  var t = function (k, n) { return str_(patch[k]).slice(0, n || 100); };
  var ymdOk = function (s) { return !s || /^\d{4}-\d{1,2}-\d{1,2}$/.test(s); };
  if (!ymdOk(t('due')) || !ymdOk(t('useBy'))) throw new Error('날짜는 달력에서 골라주세요.');
  ['qty', 'price', 'pre', 'bal'].forEach(function (k) {
    if (has(k) && t(k) !== '' && isNaN(Number(t(k).replace(/,/g, '')))) throw new Error('수량 · 단가 · 선금 · 잔금은 숫자로 넣어주세요.');
  });
  var qpCh = has('qty') || has('price');
  if (qpCh && !t('reason', 300)) throw new Error('수량 · 단가를 바꾼 사유를 넣어주세요.');
  var id = str_((expect || {}).id), name = str_((expect || {}).name);
  var sh = statusSheet_();
  var audits = [], row, out = { ok: true }, ownerChanged = false;
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var outer = deferVer_();             // 이력 · 반영(flush)은 잠금 놓기 직전 한 번(예전: 수량단가 이력에서 중간 반영 → 뒤 읽기마다 재계산 대기)
  try {
    var C = sheetCols_(sh);
    row = checkStatusRow_(sh, C, Number(statusRow) || 0, expect);
    var S = statusFieldCols_(C);
    var cOwner = colIdx_(C.idx, ['이', '담당', '담당자', '구매담당자']);
    var lc = sh.getLastColumn();
    // 결재문서번호(상신 뒤 이력용) — 열이 없으면 발주 DB 맨 오른쪽에 처음 한 번 만든다
    var cAppr = colIdx_(C.idx, ['결재문서번호']);
    if (has('approvalNo') && cAppr < 0) {
      cAppr = lc;
      if (cAppr + 1 > RB.STATUS_COLS) throw new Error('발주 DB 열이 ' + RB.STATUS_COLS + '개를 넘어 결재문서번호 열을 만들 수 없습니다.');
      if (sh.getMaxColumns() < cAppr + 1) sh.insertColumnsAfter(sh.getMaxColumns(), cAppr + 1 - sh.getMaxColumns());
      sh.getRange(C.hr, cAppr + 1).setValue('결재문서번호').setFontWeight('bold');
      cacheDrop_('hdr:status:v3'); RB_COLS_MEMO = null;
      lc = cAppr + 1;
    }
    // 그 행을 한 번만 읽고, 이전 값은 여기서 본다(예전에는 칸마다 다시 읽어 앞 칸 쓰기 뒤 재계산을 매번 기다렸다)
    var rv = sh.getRange(row, 1, 1, lc).getValues()[0];
    var rv0 = rv.slice();
    var cur = function (c) { return c >= 0 ? rv[c] : ''; };

    // 값이 있던 필수 칸은 비울 수 없다
    var REQ = { name: S.name, batch: S.batch, cat: S.cat, brand: S.brand, channel: S.channel, vendor: S.vendor,
                qty: S.qty, price: S.price, owner: cOwner, due: S.due };
    Object.keys(REQ).forEach(function (k) {
      if (has(k) && !t(k) && str_(cur(REQ[k]))) throw new Error('필수 칸은 비울 수 없습니다(' + k + ').');
    });
    // 고정값 항목: 바뀐 값만 목록 검사(예전부터 있던 목록 밖 값은 그대로 둘 수 있다)
    var chk = {};
    [['cat', S.cat], ['brand', S.brand], ['channel', S.channel], ['team', S.team]].forEach(function (x) {
      if (has(x[0]) && t(x[0]) && t(x[0]) !== str_(cur(x[1]))) chk[x[0]] = t(x[0]);
    });
    checkChoices_(chk);
    // 수량을 실제로 바꿀 때만(입고가 발주보다 많이 들어온 건도 다른 칸은 고칠 수 있게)
    if (has('qty') && S.inQty >= 0 && num_(t('qty')) !== num_(cur(S.qty)) && num_(t('qty')) < num_(cur(S.inQty))) {
      throw new Error('이미 입고된 수량(' + num_(cur(S.inQty)).toLocaleString() + ')보다 적게 줄일 수 없습니다.');
    }

    var ref = orderRefYm_(cur(S.ordered));
    // 칸마다 쓰지 않고 모았다가(pend = { 열(1부터): 값 }) 붙은 칸끼리 한 번에 쓴다(writePend)
    var pend = {};
    var writePend = function () { setRowCells_(sh, row, pend); pend = {}; };
    var put = function (key, c, label, val) {
      if (!has(key) || c < 0) return;
      var before = rv0[c];
      pend[c + 1] = val;
      rv[c] = val;
      audits.push({ tab: RB.STATUS_TAB, row: row, col: c + 1, what: label, before: before, after: val, item: name });
    };
    put('name', S.name, '품목명', t('name', 200));
    put('code', S.code, '품목코드', t('code') ? asText_(t('code').toUpperCase()) : '');
    put('batch', S.batch, '발주차수', t('batch', 20));
    put('cat', S.cat, '구분', t('cat', 30));
    put('brand', S.brand, '브랜드', t('brand'));
    put('channel', S.channel, '채널', t('channel'));
    put('vendor', S.vendor, '업체명', t('vendor'));
    put('memo', S.memo, '비고', asText_(t('memo', 500)));
    put('due', S.due, '입고목표', t('due') ? sheetDateTok_(t('due'), ref) : '');      // 입고예정은 그대로(진행 중 입고예정은 따로 바꾼다)
    if (has('owner') && cOwner >= 0) { put('owner', cOwner, '구매 담당', t('owner', 40)); ownerChanged = true; }
    if (has('approvalNo') && cAppr >= 0) put('approvalNo', cAppr, '결재문서번호', t('approvalNo') ? asText_(t('approvalNo')) : '');

    var oldQty = num_(cur(S.qty)), oldPrice = num_(cur(S.price));
    put('qty', S.qty, '발주수량', num_(t('qty')));
    put('price', S.price, '단가', t('price') === '' ? '' : num_(t('price')));
    var newQty = num_(rv[S.qty]), newPrice = num_(rv[S.price]);
    if (qpCh) {
      var inQty = num_(cur(S.inQty));
      if (S.remain >= 0) pend[S.remain + 1] = Math.max(0, newQty - inQty);
      var qpList = [];
      if (has('qty')) qpList.push({ kind: '수량단가', id: id, doc: str_(cur(S.doc)), code: str_(rv[S.code]), name: str_(rv[S.name]),
        item: '발주수량', before: oldQty, after: newQty, reason: t('reason', 300), where: RB.STATUS_TAB + ' ' + row + '행' });
      if (has('price')) qpList.push({ kind: '수량단가', id: id, doc: str_(cur(S.doc)), code: str_(rv[S.code]), name: str_(rv[S.name]),
        item: '단가', before: oldPrice, after: newPrice, reason: t('reason', 300), where: RB.STATUS_TAB + ' ' + row + '행' });
      if (!opt.info) appendHist_(qpList);              // [발주 정보 수정]은 아래에서 모든 칸을 '발주정보' 로 남긴다
    }
    writePend();                                       // 지급 줄 맞추기가 시트에서 이 행을 읽기 전에 써 둔다
    // 단가를 바꾸면 지급 줄(예정 · 입고) 금액도 새 단가로 — 지급월이 지난 줄(이미 지급)과 선금 줄은 그대로
    if (has('price') && id && newPrice > 0 && newPrice !== oldPrice) {
      try {
        var lf = linesFollowPrice_(sh, C, row, id, { vendor: str_(rv[S.vendor]), oldPrice: oldPrice, newPrice: newPrice, oldQty: oldQty, newQty: newQty },
          { id: id, doc: str_(cur(S.doc)), code: str_(rv[S.code]), name: str_(rv[S.name]) }, t('reason', 300) || str_(patch.reason).slice(0, 300));
        if (lf) { out.lines = lf.lines; out.inQty = lf.inQty; out.remain = lf.remain; out.eta = lf.eta; out.arrivedAt = lf.arrivedAt; out.linesFollowed = lf.n; out.linesKept = lf.kept; }
      } catch (eLf) { out.linesError = eLf.message; }   // 단가 저장은 그대로 — 지급 줄은 표에서 직접 고치게 알린다
    }
    // 발주수량을 바꾸면 남은 예정 줄 수량 · 금액도(단가 맞추기 뒤에 — 새 단가로 나눈 금액 그대로 비율로)
    if (has('qty') && id && newQty > 0 && newQty !== oldQty) {
      try {
        var lq = linesFollowQty_(sh, C, row, id, { oldQty: oldQty, newQty: newQty },
          { id: id, doc: str_(cur(S.doc)), code: str_(rv[S.code]), name: str_(rv[S.name]) }, t('reason', 300) || str_(patch.reason).slice(0, 300));
        if (lq && lq.lines) { out.lines = lq.lines; out.inQty = lq.inQty; out.remain = lq.remain; out.eta = lq.eta; out.arrivedAt = lq.arrivedAt; out.linesQty = lq.n; }
        else if (lq && lq.need) out.linesQtyNeed = lq.need;          // 고칠 예정 줄이 없음 — 화면이 지급 줄을 고치라고 알린다
      } catch (eLq) { out.linesError = eLq.message; }
    }

    // 발주 DB 하나로 모은 열이 있으면 같은 행에 쓴다(없으면 예전처럼 부가정보 탭)
    var CC = statusFieldCols_(C);
    var useMain = CC.team >= 0;
    var exSet = {};                                   // 0부터 열 → 값
    if (has('team')) exSet[2] = t('team');
    if (has('reqOwner')) exSet[3] = t('reqOwner', 40);
    if (has('useBy')) exSet[4] = t('useBy') ? toDate_(t('useBy')) : '';
    if (has('link')) exSet[12] = t('link', 500);

    if (useMain && Object.keys(exSet).length) {
      // 부가정보 탭 대신 발주 DB 같은 행에
      var mainCol = { 2: CC.team, 3: CC.reqOwner, 4: CC.useBy, 12: CC.link };
      Object.keys(exSet).forEach(function (ci) {
        var col = mainCol[ci];
        if (col === undefined || col < 0) return;
        var before = rv0[col];
        pend[col + 1] = exSet[ci];
        audits.push({ tab: RB.STATUS_TAB, row: row, col: col + 1, what: RB_KEY.EXTRA_HEAD[ci], before: before, after: exSet[ci], item: name });
      });
      writePend();
      exSet = {};
    }
    if (Object.keys(exSet).length && id) {
      // 부가정보 탭(발주 DB 로 모으기 전 양식에서만 — 지금 운영은 위에서 끝난다)
      var ex = tab_(RB_KEY.T_EXTRA, RB_KEY.EXTRA_HEAD);
      if (ex.getLastColumn() < RB_KEY.EXTRA_HEAD.length) {
        ex.getRange(1, 1, 1, RB_KEY.EXTRA_HEAD.length).setValues([RB_KEY.EXTRA_HEAD]).setFontWeight('bold');
      }
      var at = findExtraRow_(ex, id);
      if (at < 0) {
        var line = RB_KEY.EXTRA_HEAD.map(function () { return ''; });
        line[0] = id; line[10] = me_(); line[11] = '실행판 발주 수정';
        Object.keys(exSet).forEach(function (ci) { line[Number(ci)] = exSet[ci]; });
        ex.getRange(ex.getLastRow() + 1, 1, 1, line.length).setValues([line]);
      } else {
        Object.keys(exSet).forEach(function (ci) { ex.getRange(at, Number(ci) + 1).setValue(exSet[ci]); });
      }
      audits.push({ tab: RB_KEY.T_EXTRA, row: at, col: 1, what: '부가정보 수정', before: '',
        after: Object.keys(exSet).map(function (ci) { return RB_KEY.EXTRA_HEAD[ci] + '=' + str_(exSet[ci]); }).join(' / '), item: name });
    }

    if (opt.info && audits.length) {
      // [발주 정보 수정]: 칸마다 사유와 함께 '발주정보' 로(예전 writeInfo_ 의 logInfo_ 와 같은 모양).
      // 같은 변경을 '칸 변경'(writeAudits_)으로 또 남기면 이력에 두 줄씩 쌓였다 — 사유가 붙는 이쪽 하나만.
      var why = str_(patch.reason).slice(0, 500);
      appendHist_(audits.map(function (a) {
        return { kind: '발주정보', id: id, doc: str_(rv[S.doc]), code: str_(rv[S.code]), name: str_(rv[S.name]), item: a.what,
                 before: a.before, after: a.after, reason: why, where: '현황 ' + row + '행' };
      }));
    } else {
      writeAudits_(audits);
    }
  } finally {
    try { endVer_(outer); } catch (e) { /* 넘어간다 */ }
    lock.releaseLock();
  }
  // 구매 담당은 진행 기록에도(화면 담당자 표시)
  if (ownerChanged && id) {
    try { bulkEditProgress_([{ id: id, meta: expect }], 'po', function (st) { st.ownerSet = t('owner', 40); }); } catch (e) { /* 시트에는 적었다 */ }
  }
  cacheDrop_(rowsCacheKey_('po'));
  if (audits.length) apRefreshSoon_();
  out.row = row;
  out.n = audits.length;
  return out;
}

/**
 * 품의번호 여러 개를 한 번에(엑셀 품의서에서 붙여넣기). list: [{ statusRow, expect, doc }]
 * 품의번호별로 묶어 apiBulkDoc 과 똑같이 처리한다(계획 → 상신, 상신 체크 · 상신일).
 */
function apiBulkDocMap(list, overwrite) {
  var groups = {}, order = [];
  (list || []).forEach(function (x) {
    var d = str_(x && x.doc);
    if (!d) return;
    if (!groups[d]) { groups[d] = []; order.push(d); }
    groups[d].push({ statusRow: x.statusRow, expect: x.expect });
  });
  var out = { n: 0, states: 0, docs: order.length, skipped: [] };
  order.forEach(function (d) {
    if (docLooksWrong_(d)) { out.skipped.push(d + ' — 결재문서번호라 건너뜀(엑셀 품의번호만 넣음)'); return; }
    var r = apiBulkDoc(groups[d], d, overwrite);
    out.n += r.n; out.states += r.states || 0;
    out.skipped = out.skipped.concat(r.skipped || []);
  });
  return out;
}

/** 결재문서번호(주식회사 메디테라피-…)는 품의번호가 아니다 — 엑셀 품의서 번호(MTB2C-…)만 받는다 */
function docLooksWrong_(v) {
  v = str_(v);
  return !!v && v.indexOf('메디테라피') > -1;
}

/**
 * 품의번호가 들어간 건: 상신일이 붙은 항목(발주품의서 작성)을 체크하고, 상신일이 비어 있으면 day 로 넣는다.
 * items: [{ id, meta }]. 이미 상신일이 있으면 날짜는 그대로 둔다.
 */
function markSubmitted_(items, day) {
  items = (items || []).filter(function (x) { return x && x.id; });
  if (!items.length) return 0;
  var M = metaFast_('po');
  var slots = dateSlots_(M.steps, M.cfg, 'po');
  var me = me_(), logRows = [];
  return bulkEditProgress_(items, 'po', function (st, it) {
    var before = JSON.stringify(st.checks) + (st.dates.submitted || '');
    if (!st.dates.submitted) st.dates.submitted = it.day || day;
    checkByDate_(st.checks, slots, 'submitted', true);
    if (!st.dates.__docAuto) st.dates.__docAuto = it.day || day;
    if (JSON.stringify(st.checks) + (st.dates.submitted || '') === before) return false;   // 바뀐 게 없으면 쓰지 않음
    logRows = logRows.concat(stepLogRows_('po', it.id, it.meta || {}, stampSteps_(st.checks, st.dates, M.steps), st.dates, M.steps, me));
  }, function () { if (logRows.length) logSteps_('po', logRows); });
}

/**
 * 화면: 일괄 승인 때 결재문서번호(2026-10-16) — 품의번호마다 다른 결재문서번호를 한 번에. list: [{ statusRow, expect, approvalNo }]
 * 건마다 editOrder_ 로(발주 수정과 같은 규칙 · 이력). 실패한 건은 돌려준다.
 */
function apiBulkApprovalNo(list) {
  requireEditor_();
  var out = { n: 0, fails: [], failIds: [] };
  (list || []).forEach(function (x) {
    if (!x || !str_(x.approvalNo)) return;
    try { editOrder_(x.statusRow, x.expect, { approvalNo: str_(x.approvalNo).slice(0, 80) }, null); out.n++; }
    catch (e) { out.fails.push(((x.expect && x.expect.name) || x.statusRow) + ': ' + e.message); out.failIds.push(str_((x.expect || {}).id)); }
  });
  return out;
}


/* ============================================================
 * 품의 — 상신 대기 → 상신 완료(결재문서번호) · 품의 취소 (2026-10-19)
 * [품의서 만들기]는 엑셀만 내려받고 그 품의를 '상신 대기'로 남긴다(상태는 그대로).
 * 아마란스에 올린 뒤 [상신 대기]에서 결재문서번호를 넣고 [상신 완료] → 품의번호 · 상신 · 상신일 · 체크 · 결재문서번호를 한 번에.
 * 예전엔 내려받은 직후 확인창 하나로 상신까지 넣어, 창을 옮기면 흐름이 끊기고 손으로 따로 넣어야 했다.
 * ============================================================ */
var RB_POPEND = 'rb:popend';
// 스크립트 속성 한 칸은 9KB(UTF-8 바이트) 까지 — 넘으면 여러 칸(rb:popend#0, #1 …)에 나눠 담고 rb:popend 에는 {"__chunks":n} 만 둔다.
// 예전(한 칸에 JSON 통째로) 값도 그대로 읽는다.
function poPendRead_() {
  try {
    var P = PropertiesService.getScriptProperties();
    var o = JSON.parse(P.getProperty(RB_POPEND) || '{}');
    if (o && typeof o === 'object' && o.__chunks > 0) {
      var js = '';
      for (var i = 0; i < o.__chunks; i++) js += P.getProperty(RB_POPEND + '#' + i) || '';
      o = JSON.parse(js || '{}');
    }
    return (o && typeof o === 'object') ? o : {};
  }
  catch (e) { return {}; }
}
function poPendWrite_(o) {
  var cut = ymd_(new Date(Date.now() - 90 * 864e5));
  Object.keys(o).forEach(function (k) { if (str_(o[k].at) < cut) delete o[k]; });
  var js = JSON.stringify(o), P = PropertiesService.getScriptProperties();
  var old = 0;
  try { old = Number((JSON.parse(P.getProperty(RB_POPEND) || '{}') || {}).__chunks) || 0; } catch (eO) { old = 0; }
  var put = {}, n = 0;
  if (Utilities.newBlob(js).getBytes().length <= 8500) put[RB_POPEND] = js;
  else {
    // 글자 2500자씩(한글 3바이트여도 7.5KB) 나눠 담는다
    for (var i = 0, e; i < js.length; i = e) {
      e = Math.min(js.length, i + 2500);
      if (e < js.length && /[\uD800-\uDBFF]/.test(js.charAt(e - 1))) e--;      // 이모지 반쪽이 칸 사이에 갈리지 않게
      put[RB_POPEND + '#' + (n++)] = js.slice(i, e);
    }
    if (n > 60) throw new Error('상신 대기 품의가 너무 많습니다(' + Object.keys(o).length + '건) — 올린 건은 [상신 완료], 안 쓸 건은 [버리기]로 정리해 주세요.');
    put[RB_POPEND] = JSON.stringify({ __chunks: n });
  }
  P.setProperties(put);
  for (var k = n; k < old; k++) P.deleteProperty(RB_POPEND + '#' + k);     // 줄어든 뒤 남은 칸 지움
}
function poPendList_() {
  var o = poPendRead_();
  return Object.keys(o).sort().map(function (k) { var g = o[k]; return { no: k, at: g.at, by: g.by, bucket: g.bucket, type: g.type, base: g.base, rows: g.rows || [] }; });
}
/** 화면: 상신 대기 목록 */
function apiPoPendList() { return poPendList_(); }
/** 화면: 품의서를 내려받은 품의를 상신 대기로. groups = [{ no, bucket, type, base, rows: [{ id, statusRow, expect }] }] */
function apiPoPendAdd(groups) {
  requireEditor_();
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var nos = [];
  try {
    var o = poPendRead_(), today = ymd_(new Date()), who = me_();
    // 발주 DB 에 이미 쓰인 품의번호(다른 건) — 두 사람이 같은 때 품의서를 만들면 같은 번호가 나와 앞 사람 상신 대기가 덮였다
    var docOf = {};
    try {
      var sh = statusSheet_(), C = sheetCols_(sh), cDoc = colIdx_(C.idx, ['품의번호']), kc = statusKeyCols_(sh, C.hr);
      if (cDoc >= 0 && sh.getLastRow() > C.hr) {
        var dv = sh.getRange(C.hr + 1, cDoc + 1, sh.getLastRow() - C.hr, 1).getValues(), iv = kc.id >= 0 ? sh.getRange(C.hr + 1, kc.id + 1, sh.getLastRow() - C.hr, 1).getValues() : [];
        dv.forEach(function (r, k) { var d = str_(r[0]); if (d) (docOf[d] = docOf[d] || {})[str_((iv[k] || [])[0])] = 1; });
      }
    } catch (eD) { docOf = {}; }
    var sameIds = function (a, b) { return a.length === b.length && a.every(function (x) { return b.indexOf(x) > -1; }); };
    (groups || []).forEach(function (g) {
      var no = str_(g && g.no).slice(0, 60);
      if (!no) { nos.push(''); return; }
      var rows = (g.rows || []).slice(0, 60).map(function (r) { var e = r.expect || {}; return { id: str_(r.id), statusRow: Number(r.statusRow) || 0, expect: { id: str_(e.id || r.id), doc: str_(e.doc), code: str_(e.code), batch: str_(e.batch), name: str_(e.name).slice(0, 60) } }; });
      var ids = rows.map(function (r) { return r.id; });
      var pre = no.replace(/\d+$/, '');
      // 같은 건들로 이미 상신 대기에 있으면 그 번호를 다시 쓴다(같은 품의서를 다시 받은 것)
      var again = Object.keys(o).filter(function (k) { return k.indexOf(pre) === 0 && sameIds((o[k].rows || []).map(function (r) { return r.id; }), ids); })[0];
      if (again) no = again;
      else {
        var taken = function (k) { return (o[k] && !sameIds((o[k].rows || []).map(function (r) { return r.id; }), ids)) || (docOf[k] && Object.keys(docOf[k]).some(function (id) { return ids.indexOf(id) < 0; })); };
        if (taken(no)) {
          var mx = 0;
          Object.keys(o).concat(Object.keys(docOf)).forEach(function (k) { if (k.indexOf(pre) === 0) { var n = Number(k.slice(pre.length)); if (n > mx) mx = n; } });
          no = pre + ('0' + (mx + 1)).slice(-Math.max(2, String(mx + 1).length));
        }
      }
      nos.push(no);
      o[no] = { at: today, by: who, bucket: str_(g.bucket), type: str_(g.type), base: str_(g.base), rows: rows };
    });
    poPendWrite_(o);
  } finally { lock.releaseLock(); }
  return { list: poPendList_(), nos: nos };
}
/** 화면: 상신 대기에서 버리기(엑셀만 받고 안 올린 품의) */
function apiPoPendDrop(no) {
  requireEditor_();
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  try { var o = poPendRead_(); delete o[str_(no)]; poPendWrite_(o); } finally { lock.releaseLock(); }
  return poPendList_();
}
/** 화면: 상신 완료 — 결재문서번호(아마란스) · 상신일을 넣으면 그 품의 건들에 품의번호 · 상신 · 상신일 · 체크 · 결재문서번호를 한 번에 */
function apiPoSubmit(no, approvalNo, day) {
  requireEditor_();
  no = str_(no); approvalNo = str_(approvalNo).slice(0, 80);
  if (!approvalNo) throw new Error('결재문서번호(아마란스 문서번호)를 넣어 주세요.');
  if (!docLooksWrong_(approvalNo) && !/\d{4}-\d+/.test(approvalNo)) throw new Error('결재문서번호는 아마란스 문서번호(예: 주식회사 메디테라피-2026-1944)입니다.');
  var g = poPendRead_()[no];
  if (!g) throw new Error(no + ' 는 상신 대기에 없습니다(이미 상신 완료했거나 버렸습니다). 새로고침해 주세요.');
  var list = (g.rows || []).filter(function (r) { return r.statusRow >= 2; }).map(function (r) { return { doc: no, statusRow: r.statusRow, expect: r.expect }; });
  if (!list.length) throw new Error('이 품의에 발주 DB 건이 없습니다.');
  var res = apiBulkDoc(list, no, true, day);
  var bad = {};
  (res.skippedIds || []).forEach(function (id) { if (id) bad[id] = 1; });
  // 품의번호를 못 넣은 건에는 결재문서번호도 넣지 않는다
  var ap = apiBulkApprovalNo(list.filter(function (x) { return !bad[str_((x.expect || {}).id)]; }).map(function (x) { return { statusRow: x.statusRow, expect: x.expect, approvalNo: approvalNo }; }));
  (ap.failIds || []).forEach(function (id) { if (id) bad[id] = 1; });
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  try {
    // 실패한 건만 상신 대기에 남긴다(다시 [상신 완료] 하게) — 예전엔 일부 실패해도 품의째 지워져 실패한 건을 손으로 넣어야 했다
    var o = poPendRead_(), left = o[no] ? (o[no].rows || []).filter(function (r) { return bad[r.id]; }) : [];
    if (left.length) o[no].rows = left; else delete o[no];
    poPendWrite_(o);
  } finally { lock.releaseLock(); }
  return { n: res.n, states: res.states || 0, checked: res.checked || 0, ap: ap.n, skipped: (res.skipped || []).concat(ap.fails || []), skippedIds: Object.keys(bad), pend: poPendList_() };
}
/**
 * 화면: 품의 취소 — 잘못 넣은 품의번호 · 상신(승인)을 되돌린다. items = [{ id, statusRow, expect }]
 * 품의번호 · 결재문서번호 지움 · 진행상태 상신/승인 → 계획 · 상신일 · 승인일 · 그 체크 지움 · 자동 상신 대기열에서 뺌.
 */
function apiPoCancel(items, why) {
  requireEditor_();
  why = str_(why);
  if (!why) throw new Error('취소 사유를 적어 주세요.');
  var list = (items || []).filter(function (x) { return x && Number(x.statusRow) >= 2; });
  if (!list.length) return { n: 0 };
  var sh = statusSheet_(), out = { n: 0, skipped: [], skippedIds: [] }, audits = [], ids = [];
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  // 장부(1분마다 옮기는 날짜 · 체크)에 남은 '상태 올리기'를 먼저 옮긴다 — 안 그러면 이 변경 뒤에 옮겨지며 상태를 상신 · 승인으로 되돌렸다
  try { drainJournal_(); } catch (eDJ) { /* 넘어간다 */ }
  var outer = deferVer_();
  try {
    var C = sheetCols_(sh), cDoc = colIdx_(C.idx, ['품의번호']), ix = statusIdIndex_(sh, C), kc = ix.kc;
    var cAp = colIdx_(C.idx, ['결재문서번호']);
    list.forEach(function (x) {
      var name = str_((x.expect || {}).name), row;
      var xid = str_((x.expect || {}).id || x.id);
      try { row = findStatusRow_(ix, sh, C, Number(x.statusRow), x.expect); } catch (e) { out.skipped.push(name + ' — 행을 찾지 못함'); out.skippedIds.push(xid); return; }
      // 계획 · 상신 · 승인만 — 발주 · 입고 · 종결 · 취소 건은 품의를 지우지 않는다(지급 · 입고가 걸린 건)
      var st0 = kc.state >= 0 ? str_(sh.getRange(row, kc.state + 1).getValue()) : '';
      if (['', '계획', '상신', '승인'].indexOf(st0) < 0) { out.skipped.push(name + ' — 진행상태 ' + st0 + '(계획 · 상신 · 승인만 취소)'); out.skippedIds.push(xid); return; }
      var doc = cDoc >= 0 ? str_(sh.getRange(row, cDoc + 1).getValue()) : '';
      if (doc) { sh.getRange(row, cDoc + 1).setValue(''); audits.push({ tab: RB.STATUS_TAB, row: row, col: cDoc + 1, what: '품의번호(품의 취소)', before: doc, after: '', item: name + ' — ' + why }); }
      if (cAp >= 0) { var ap = str_(sh.getRange(row, cAp + 1).getValue()); if (ap) { sh.getRange(row, cAp + 1).setValue(''); audits.push({ tab: RB.STATUS_TAB, row: row, col: cAp + 1, what: '결재문서번호(품의 취소)', before: ap, after: '', item: name }); } }
      if (kc.state >= 0) { var st = st0; if (st === '상신' || st === '승인') { sh.getRange(row, kc.state + 1).setValue('계획'); audits.push({ tab: RB.STATUS_TAB, row: row, col: kc.state + 1, what: '진행상태(품의 취소)', before: st, after: '계획', item: name }); } }
      var id = str_((x.expect || {}).id || x.id);
      if (id) ids.push({ id: id, meta: { doc: '', name: name, batch: str_((x.expect || {}).batch), code: str_((x.expect || {}).code) }, doc: doc });
      out.n++;
    });
    if (audits.length) writeAudits_(audits);
    var q = docQueueRead_(), qch = false;
    ids.forEach(function (w) { if (q['id:' + w.id]) { delete q['id:' + w.id]; qch = true; } if (w.doc && q[norm_(w.doc)]) { delete q[norm_(w.doc)]; qch = true; } });
    if (qch) docQueueWrite_(q);
  } finally {
    try { endVer_(outer); } catch (e) { /* 넘어간다 */ }
    lock.releaseLock();
  }
  cacheDrop_(rowsCacheKey_('po'));
  if (ids.length) {
    try {
      var M = metaFast_('po'), slots = dateSlots_(M.steps, M.cfg, 'po');
      bulkEditProgress_(ids, 'po', function (st) {
        var ch = false;
        ['submitted', 'approved'].forEach(function (f) { if (st.dates[f]) { delete st.dates[f]; ch = true; } if (checkByDate_(st.checks, slots, f, false).length) ch = true; });
        if (st.dates.__docAuto) { delete st.dates.__docAuto; ch = true; }
        return ch ? undefined : false;
      });
    } catch (eP) { out.skipped.push('진행 기록(상신일 · 체크)은 못 지움: ' + eP.message); }
  }
  try { bumpVer_('r'); apRefreshSoon_(); } catch (eV) { /* 넘어간다 */ }
  return out;
}
