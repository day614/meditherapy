/**
 * ============================================================
 * 지급 줄 2단계 — 지급 줄을 원본으로 쓰기(전환 스위치 [_실행판_설정] lines.on = Y)
 * ------------------------------------------------------------
 *  · 건 상세의 지급 줄 표가 줄을 통째로 저장한다(apiSaveLines).
 *  · 입고 등록은 입고 줄을 더하고, 고른 예정 줄에서 고른 금액만큼 뺀다(apiAddInbound).
 *  · 저장할 때마다 AP 탭을 지급 줄 + 건 정보로 다시 쓴다(apRebuildFromLines_, 계산 없음).
 *  · 발주현황의 입고수량 · 발주잔량 · 제품입고일 · 입고일정 칸은 목록 표시용으로 지급 줄에서 채운다.
 *  · 발주현황의 지급월 열 · 회차(1~20) 칸은 전환 뒤 쓰지 않는다.
 * ============================================================
 */

var RB_LINE_KINDS = ['선금', '예정', '입고', '지급월 없음'];


/** 지급월 고르기 목록: 2025-07 ~ 오늘부터 24개월 뒤 ('yy-mm') */
function payMonthOptions_() {
  var out = [], now = new Date();
  var end = now.getFullYear() * 12 + now.getMonth() + 24;
  for (var t = 2025 * 12 + 6; t <= end; t++) {
    var y = Math.floor(t / 12), m = t % 12 + 1;
    out.push(String(y).slice(2) + '-' + (m < 10 ? '0' : '') + m);
  }
  return out;
}

function ymOf_(when) {
  var p = payYm_(when);
  return p ? String(p.y).slice(2) + '-' + (p.m < 10 ? '0' : '') + p.m : '';
}

function lineToRow_(L) {
  var d = L.date instanceof Date ? L.date : (L.date ? (toDate_(L.date) || L.date) : '');
  return [L.id, L.lineId, L.kind, d, (L.qty === '' || L.qty == null) ? '' : num_(L.qty),
    (L.amt === '' || L.amt == null) ? '' : num_(L.amt), String(L.payYm || ''), asText_(str_(L.memo).slice(0, 300)),
    L.src || '', new Date(), str_(L.ch)];
}

function rowToLine_(r) {
  return {
    id: str_(r[0]), lineId: str_(r[1]), kind: str_(r[2]),
    date: r[3] instanceof Date ? Utilities.formatDate(r[3], Session.getScriptTimeZone(), 'yyyy-MM-dd') : str_(r[3]),
    qty: r[4] === '' ? '' : num_(r[4]), amt: r[5] === '' ? '' : num_(r[5]), payYm: str_(r[6]), memo: str_(r[7]).replace(/^'/, ''),   // 쓸 때 붙인 글자 표시(') 는 떼고
    ch: str_(r[10])
  };
}

/**
 * 지급 줄 탭 머리글 확인 — 쓰기 전에 1행이 RB_LINE.HEAD 와 같은지 본다(열 순서가 바뀐 탭에 엉뚱한 칸으로 쓰지 않게).
 * 마지막 머리글(채널)만 비었으면 예전 탭이라 채워 넣는다. 한 번 맞으면 캐시에 기억한다(저장마다 칸을 읽지 않게).
 */
function linesHeadCheck_(sh) {
  var W = RB_LINE.HEAD.length, hc = null;
  try { hc = CacheService.getScriptCache(); } catch (e) { hc = null; }
  if (hc && hc.get('lines:headok')) return;
  var h = sh.getRange(1, 1, 1, W).getValues()[0].map(function (x) { return str_(x); });
  if (h[W - 1] === '' && h.slice(0, W - 1).join('|') === RB_LINE.HEAD.slice(0, W - 1).join('|')) {
    sh.getRange(1, W).setValue(RB_LINE.HEAD[W - 1]).setFontWeight('bold');
    h[W - 1] = RB_LINE.HEAD[W - 1];
  }
  if (h.join('|') !== RB_LINE.HEAD.join('|')) {
    throw new Error(RB_LINE.TAB + ' 탭의 머리글(1행)이 예상과 달라 저장하지 않았습니다. 관리자에게 알려 주세요.' +
      ' (예상: ' + RB_LINE.HEAD.join(', ') + ' / 지금: ' + h.join(', ') + ')');
  }
  try { if (hc) hc.put('lines:headok', '1', RB_TTL); } catch (e) { /* 넘어간다 */ }
}

/**
 * 지급 줄 탭 전체. rows = 실행판ID 가 있는 줄, pos = 그 줄의 시트 행 번호(rows 와 같은 순서),
 * free = 비어 있는 행 번호(지운 줄 자리 — 새 줄을 넣을 때 먼저 쓴다), last = 마지막 행.
 */
function readLinesAll_() {
  var sh = sheet_(RB_LINE.TAB);
  if (!sh) return { sh: sh, rows: [], pos: [], free: [], last: 0 };
  var last = sh.getLastRow();                       // (열 수 확인은 쓰는 쪽 머리글 확인에서 한다 — 읽을 때마다 묻지 않는다)
  if (last < 2) return { sh: sh, rows: [], pos: [], free: [], last: last };
  var raw = sh.getRange(2, 1, last - 1, RB_LINE.HEAD.length).getValues();
  var rows = [], pos = [], free = [];
  raw.forEach(function (r, i) { if (str_(r[0])) { rows.push(r); pos.push(i + 2); } else free.push(i + 2); });
  return { sh: sh, rows: rows, pos: pos, free: free, last: last };
}

/**
 * 한 건의 줄만 그 자리에 쓴다(탭 전체를 다시 쓰지 않는다).
 * 예전에는 한 건을 고쳐도 1천 줄 넘는 탭을 통째로 다시 쓰고, 캐시도 전 줄을 다시 만들어(줄마다 날짜 변환) 저장이 10초 넘게 걸렸다.
 *  · 그 건이 쓰던 행에 새 줄을 덮어쓰고, 줄어든 만큼은 비운다. 늘어난 줄은 빈 행(지운 자리) → 맨 아래 순서로 넣는다.
 *  · 캐시(실행판ID → 줄 목록)는 그 건 하나만 바꿔 끼운다.
 */
function writeLinesFor_(all, id, mine) {
  var sh = all.sh, W = RB_LINE.HEAD.length;
  var slots = [];
  all.rows.forEach(function (r, i) { if (str_(r[0]) === id) slots.push(all.pos[i]); });
  var blank = [];
  for (var b = 0; b < W; b++) blank.push('');
  var writes = {}, k = 0;
  for (; k < mine.length && k < slots.length; k++) writes[slots[k]] = mine[k];
  for (var j = k; j < slots.length; j++) writes[slots[j]] = blank;
  var free = (all.free || []).slice(), next = Math.max(all.last || 1, 1) + 1;
  for (; k < mine.length; k++) writes[free.length ? free.shift() : next++] = mine[k];
  // 맨 아래에 붙일 때만 행 수를 묻는다(그 자리에 덮어쓰기만 하면 묻지 않는다)
  if (next - 1 > (all.last || 0) && next - 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), next - 1 - sh.getMaxRows());
  // 머리글 확인(맞지 않으면 쓰지 않고 멈춘다) — 한 번 맞으면 캐시에 기억한다
  linesHeadCheck_(sh);
  // 이어진 행끼리 묶어 한 번에 쓴다
  var rowsN = Object.keys(writes).map(Number).sort(function (a, c) { return a - c; });
  var i0 = 0;
  while (i0 < rowsN.length) {
    var i1 = i0;
    while (i1 + 1 < rowsN.length && rowsN[i1 + 1] === rowsN[i1] + 1) i1++;
    var block = [];
    for (var q = i0; q <= i1; q++) block.push(writes[rowsN[q]]);
    sh.getRange(rowsN[i0], 7, block.length, 1).setNumberFormat('@');     // 지급월 'yy-mm' 이 날짜로 바뀌지 않게
    sh.getRange(rowsN[i0], 1, block.length, W).setValues(block);
    i0 = i1 + 1;
  }
  try {
    var m = cacheGet_(RB_LINES_CK);
    if (m) {
      if (mine.length) m[id] = mine.map(rowToLine_); else delete m[id];
      cachePut_(RB_LINES_CK, m, RB_TTL);
    }
  } catch (e) { cacheDrop_(RB_LINES_CK); }
  bumpVer_('l');
}

/** 지급 줄 탭 전체를 다시 쓴다(줄 수가 천 단위라 통째로 쓰는 게 단순하고 빠르다) */
function writeLinesAll_(sh, rows) {
  var W = RB_LINE.HEAD.length;
  linesHeadCheck_(sh);
  var old = Math.max(sh.getLastRow() - 1, 0);
  if (rows.length) {
    if (sh.getMaxRows() < rows.length + 1) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 1 - sh.getMaxRows());
    sh.getRange(2, 7, rows.length, 1).setNumberFormat('@');      // 지급월 'yy-mm' 이 날짜로 바뀌지 않게
    sh.getRange(2, 1, rows.length, W).setValues(rows);
  }
  if (old > rows.length) sh.getRange(2 + rows.length, 1, old - rows.length, W).clearContent();
  try { cachePut_(RB_LINES_CK, linesMapOf_(rows), RB_TTL); } catch (e) { cacheDrop_(RB_LINES_CK); }
  bumpVer_('l');
}

/**
 * 첫 화면에 지급 줄을 같이 실어 보낸다(건 상세를 열 때마다 서버에 가지 않게).
 * 캐시: 실행판ID → 줄 목록. 지급 줄을 쓸 때마다 새로 담는다.
 */
var RB_LINES_CK = 'lines:v1';
function linesMapOf_(rows) {
  var m = {};
  rows.forEach(function (r) { var L = rowToLine_(r); if (L.id) (m[L.id] = m[L.id] || []).push(L); });
  return m;
}
/** build=false 면 캐시에 있을 때만(빠른 길 — 시트를 열지 않는다) */
function linesMapCached_(build) {
  var m = cacheGet_(RB_LINES_CK);
  if (!m && build) {
    m = linesMapOf_(readLinesAll_().rows);
    cachePut_(RB_LINES_CK, m, RB_TTL);
  }
  return m || null;
}

/** 한 건의 지급 줄을 통째로 바꾼다(부르는 쪽이 잠금을 쥔다). 줄ID 가 없으면 새로 단다. */
function replaceLinesFor_(id, lines, src, all, fullRewrite) {
  all = all || readLinesAll_();                    // 부르는 쪽이 이미 읽었으면 그걸 쓴다(탭을 두 번 읽지 않게)
  if (!all.sh) throw new Error('지급 줄 탭이 없습니다. 관리자 화면에서 [지급 줄로 전환]을 먼저 해 주세요.');
  var others = all.rows.filter(function (r) { return str_(r[0]) !== id; });
  var used = {}, n = 0;
  all.rows.forEach(function (r) { if (str_(r[0]) === id) used[str_(r[1])] = 1; });
  lines.forEach(function (L) { if (L.lineId) used[L.lineId] = 1; });
  var mine = lines.map(function (L) {
    L.id = id;
    if (!L.lineId) { do { n++; L.lineId = id + '-n' + n; } while (used[L.lineId]); used[L.lineId] = 1; }
    L.src = L.src || src || '';
    return lineToRow_(L);
  });
  if (fullRewrite) writeLinesAll_(all.sh, others.concat(mine));   // 예전 방식(속도 비교용 · 빈 행 정리용)
  else writeLinesFor_(all, id, mine);
  return mine.map(rowToLine_);
}

/** 지급 줄 → 발주 DB 표시 칸(입고수량 · 발주잔량 · 제품입고일 · 입고일정) */
function syncOrderFromLines_(sh, C, row, lines) {
  var S = statusFieldCols_(C);
  var cArr = colIdx_(C.idx, ['제품입고일']), cEta = colIdx_(C.idx, ['입고일정']), cRec = colIdx_(C.idx, ['입고기록']);
  var cState = colIdx_(C.idx, ['진행상태']);
  // 그 행을 한 번만 읽고, 값이 실제로 달라진 칸만 쓴다(예전에는 칸마다 따로 읽고 써서 왕복이 8번 넘었다)
  var rv = sh.getRange(row, 1, 1, C.lc).getValues()[0];
  var cell = function (c) { return c >= 0 ? rv[c] : ''; };
  var pend = {};                                   // 바뀐 칸만 모았다가 붙은 칸끼리 한 번에 쓴다(돌려주기 전에)
  var put = function (c, v) {
    if (c < 0) return;
    var shown = (typeof v === 'string' && v.charAt(0) === "'") ? v.slice(1) : v;
    if (String(rv[c] == null ? '' : rv[c]) === String(shown == null ? '' : shown)) return;
    pend[c + 1] = v;
    rv[c] = shown;
  };
  var qty = num_(cell(S.qty));
  var ins = lines.filter(function (L) { return L.kind === '입고'; });
  var inQty = ins.reduce(function (a, L) { return a + (num_(L.qty) || 0); }, 0);
  var fmt = function (L) { var d = toDate_(L.date); return d ? fmtDate_(d) : str_(L.date); };
  var byDate = function (a, b) { return String(a.date) < String(b.date) ? -1 : (String(a.date) > String(b.date) ? 1 : 0); };
  var arr = ins.slice().sort(byDate).map(fmt).filter(String);
  var eta = lines.filter(function (L) { return L.kind === '예정' && L.date; }).sort(byDate).map(fmt);
  eta = eta.filter(function (d, i) { return eta.indexOf(d) === i; });
  // [입고 완료 처리]로 잔량을 마감한 건(종결 칸에 값)은 잔량을 0 으로 둔다
  // 새 양식엔 종결 칸이 없다 — 진행상태 '종결'(입고 완료 처리도 종결로 바꾼다)
  var cClosed = colIdx_(C.idx, ['종결']);
  var closedNow = cClosed >= 0 ? str_(cell(cClosed)) !== '' : (cState >= 0 && str_(cell(cState)) === '종결');
  // 이관한 예전 건은 지급 줄 수량이 '금액 ÷ 단가'(선금 몫 빠짐 · 입고 대신 예정 줄)라 실제 입고수량보다 적다.
  // 마감한 건에서 지급 줄 합계가 지금 입고수량보다 적으면 발주 DB 의 입고수량 · 제품입고일(실제 기록)을 지우지 않는다.
  var sheetIn = S.inQty >= 0 ? num_(cell(S.inQty)) : 0;
  if (closedNow && sheetIn > inQty + 0.5) {
    put(S.remain, 0);
    put(cEta, asText_(eta.join(', ')));
    var keptArr = cArr >= 0 ? str_(cell(cArr)) : (cRec >= 0 ? dbRecParse_(cell(cRec)).map(function (p) { return p.d; }).join(', ') : '');
    setRowCells_(sh, row, pend);
    return { inQty: sheetIn, remain: 0, closed: true, arrivedAt: keptArr, eta: eta.join(', '), kept: true };
  }
  var remain = closedNow ? 0 : Math.max(0, qty - inQty);
  put(S.inQty, inQty);
  put(S.remain, remain);
  put(cArr, asText_(arr.join(', ')));
  if (eta.length || remain === 0) put(cEta, asText_(eta.join(', ')));     // 예정 줄이 없으면 그대로(등록 때 입고목표로 채운 값) — 다 받았으면 비운다
  if (cRec >= 0) put(cRec, asText_(dbRecText_(ins.slice().sort(byDate).map(function (L) { return { d: fmt(L), q: num_(L.qty) || '' }; }))));
  setRowCells_(sh, row, pend);
  return { inQty: inQty, remain: remain, closed: closedNow, arrivedAt: arr.join(', '), eta: eta.join(', ') };
}

/**
 * 입고 완료 처리(잔량 마감) — 남은 잔량을 더 안 받기로 했을 때.
 * on=true : 남은 예정 줄을 지우고(AP 에서도 빠짐) 종결 칸 · 진행상태 '종결' · 발주잔량 0.
 * on=false: 마감 취소 — 종결 칸을 비우고 진행상태를 마감 전 상태로(종결 칸에 '· 이전 승인' 처럼 남겨 둔 것, 없으면 '발주'),
 *          잔량을 다시 계산(지운 예정 줄은 되살리지 않음).
 */
function apiCloseRemain(statusRow, expect, on) {
  requireEditor_();
  var id = str_((expect || {}).id);
  if (!id) throw new Error('실행판ID 가 없습니다.');
  var sh = statusSheet_(), out;
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var vOuter = deferVer_();      // 변경 번호 · 반영(flush)은 잠금 놓기 직전 한 번
  try {
    var C = sheetCols_(sh);
    var row = checkStatusRow_(sh, C, Number(statusRow) || 0, expect);
    id = lineOwnerId_(sh, C, row, id);
    var kc = statusKeyCols_(sh, C.hr);
    var cClosed = colIdx_(C.idx, ['종결']);
    var allC = readLinesAll_();
    var cur = allC.rows.filter(function (r) { return str_(r[0]) === id; }).map(rowToLine_);
    var removed = [], reState = '';
    if (on) {
      var keep = cur.filter(function (L) { if (L.kind === '예정') { removed.push(L); return false; } return true; });
      if (removed.length) cur = replaceLinesFor_(id, keep.map(cleanLine_), '입고 완료 처리', allC);
      // 마감 전 진행상태를 종결 칸에 같이 남긴다 — 마감 취소 때 그대로 되돌리게(예전엔 승인 건도 발주로 내려갔다)
      var stWas = kc.state >= 0 ? str_(sh.getRange(row, kc.state + 1).getValue()) : '';
      if (cClosed >= 0) sh.getRange(row, cClosed + 1).setValue('잔량 마감 ' + ymd_(new Date()) + (['계획', '상신', '승인', '발주'].indexOf(stWas) > -1 ? ' · 이전 ' + stWas : ''));
      if (kc.state >= 0) sh.getRange(row, kc.state + 1).setValue('종결');
    } else {
      var mWas = cClosed >= 0 ? str_(sh.getRange(row, cClosed + 1).getValue()).match(/· 이전 (계획|상신|승인|발주)$/) : null;
      if (cClosed >= 0) sh.getRange(row, cClosed + 1).setValue('');
      reState = mWas ? mWas[1] : '발주';
      if (kc.state >= 0 && str_(sh.getRange(row, kc.state + 1).getValue()) === '종결') sh.getRange(row, kc.state + 1).setValue(reState);
    }
    out = syncOrderFromLines_(sh, C, row, cur);
    if (on && cClosed < 0 && S_remainCol_(C) >= 0) sh.getRange(row, S_remainCol_(C) + 1).setValue(0);   // 종결 칸이 없는 시트
    out.lines = cur;
    if (reState) out.state = reState;              // 화면이 되돌릴 진행상태
    appendHist_([{ kind: '입고', id: id, doc: expect.doc, code: expect.code, name: expect.name,
      item: on ? '입고 완료 처리(잔량 마감)' : '입고 완료 처리 취소',
      after: on ? '잔량 0 · 예정 줄 ' + removed.length + '개 지움(' + linesSummary_(removed).slice(0, 300) + ')' : '잔량 다시 계산 ' + out.remain,
      where: RB.STATUS_TAB + ' ' + row + '행' }]);
  } finally {
    try { endVer_(vOuter); } catch (e) { /* 넘어간다 */ }
    try { if (typeof T !== 'undefined' && T && T.mark) T.mark('반영(시트 계산)'); } catch (eT) { /* 넘어간다 */ }
    lock.releaseLock();
  }
  cacheDrop_(rowsCacheKey_('po'));
  try { apRebuildSoon_(); } catch (e) { /* 20시에 */ }
  return out;
}
function S_remainCol_(C) { return statusFieldCols_(C).remain; }

function cleanLine_(L) {
  var kind = str_(L.kind);
  if (RB_LINE_KINDS.indexOf(kind) < 0) throw new Error('알 수 없는 줄 종류입니다: ' + kind);
  var date = str_(L.date);
  if (date && !/^\d{4}-\d{1,2}-\d{1,2}$/.test(date)) throw new Error('입고일은 달력에서 골라주세요.');
  var payYm = str_(L.payYm);
  if (kind !== '지급월 없음' && !/^\d{2}-\d{2}$/.test(payYm)) throw new Error('지급월을 골라주세요(' + kind + ' 줄).');
  var qty = str_(L.qty) === '' ? '' : num_(L.qty), amt = str_(L.amt) === '' ? '' : num_(L.amt);
  if (kind !== '지급월 없음' && !(amt > 0)) throw new Error('금액을 넣어주세요(' + kind + ' 줄).');
  var ch = str_(L.ch);
  if (ch) checkChoices_({ channel: ch });
  return { lineId: str_(L.lineId), kind: kind, date: date, qty: qty, amt: amt, payYm: payYm, memo: str_(L.memo), ch: ch };
}

function linesSummary_(ls) {
  return ls.map(function (L) { return L.kind + ' ' + (L.payYm || '-') + ' ' + Number(L.amt || 0).toLocaleString() + (L.ch ? ' [' + L.ch + ']' : ''); }).join(' / ');
}

/** 화면: 한 건의 지급 줄 */
function apiGetLines(id) {
  var all = readLinesAll_();
  return {
    months: payMonthOptions_(),
    lines: all.rows.filter(function (r) { return str_(r[0]) === str_(id); }).map(rowToLine_)
  };
}

/** 화면: 한 건의 지급 줄 저장(통째로) */
function apiSaveLines(statusRow, expect, lines, reason, base, op) {
  requireEditor_();
  return saveLinesCore_(statusRow, expect, lines, reason, { base: base, op: op });
}

var RB_LINE_F = ['kind', 'date', 'qty', 'amt', 'payYm', 'memo', 'ch'];
/** 비교용으로만 맞춘 줄(검사는 하지 않는다 — 화면이 읽어 둔 옛 줄) */
function cleanLineLoose_(L) {
  L = L || {};
  return { lineId: str_(L.lineId), kind: str_(L.kind), date: str_(L.date).slice(0, 10), qty: str_(L.qty) === '' ? '' : num_(L.qty),
    amt: str_(L.amt) === '' ? '' : num_(L.amt), payYm: str_(L.payYm), memo: str_(L.memo), ch: str_(L.ch) };
}
function lineFieldEq_(a, b, k) {
  var x = a == null ? '' : a[k], y = b == null ? '' : b[k];
  if (k === 'qty' || k === 'amt') return (x === '' ? '' : Number(x)) === (y === '' ? '' : Number(y));
  if (k === 'date') return String(x || '').slice(0, 10) === String(y || '').slice(0, 10);
  return String(x == null ? '' : x) === String(y == null ? '' : y);
}
/**
 * 지급 줄 3자 합치기: base = 화면이 읽어 둔 줄, now = 지금 시트, mine = 화면이 보낸 줄.
 *  · 내가 안 건드린 칸은 지금 시트 값(남이 바꾼 값)을, 내가 고친 칸은 내 값을 쓴다(칸 단위).
 *  · 남이 새로 넣은 줄(입고 등록 등)은 그대로 둔다. 남이 지운 줄은 내가 안 고쳤으면 지운 대로, 고쳤으면 새 줄로 남긴다.
 *  · 내가 지운 줄은 지운다. 내가 새로 넣은 줄은 더한다.
 */
function mergeLines_(base, now, mine) {
  var bm = {}, nm = {}, mm = {};
  base.forEach(function (L) { if (L.lineId) bm[L.lineId] = L; });
  now.forEach(function (L) { if (L.lineId) nm[L.lineId] = L; });
  mine.forEach(function (L) { if (L.lineId) mm[L.lineId] = 1; });
  var out = [];
  mine.forEach(function (m) {
    if (!m.lineId) { out.push(m); return; }
    var b = bm[m.lineId], c = nm[m.lineId];
    if (!c) {
      if (b && RB_LINE_F.every(function (k) { return lineFieldEq_(m, b, k); })) return;      // 남이 지웠고 나는 안 건드림 → 지운 대로
      var x = JSON.parse(JSON.stringify(m)); x.lineId = ''; out.push(x); return;             // 내가 고친 줄 → 새 줄로 살린다
    }
    if (!b) { out.push(m); return; }
    if (!lineFieldEq_(c, b, 'kind')) { out.push(cleanLineLoose_(c)); return; }   // 남이 예정 → 입고로 바꾼 줄은 그 줄 그대로(예정 날짜 고침은 의미가 없어짐)
    var g = { lineId: m.lineId };
    RB_LINE_F.forEach(function (k) { g[k] = lineFieldEq_(m, b, k) ? c[k] : m[k]; });
    out.push(g);
  });
  now.forEach(function (c) { if (c.lineId && !bm[c.lineId] && !mm[c.lineId]) out.push(cleanLineLoose_(c)); });   // 남이 새로 넣은 줄
  return out;
}

/** 단계별 걸린 시간(ms) — 느린 곳을 찾을 때 쓴다. 결과의 timing 과 실행 기록(console.log)에 남긴다. */
function rbTimer_() {
  var t0 = Date.now(), last = t0, out = {};
  return {
    mark: function (k) { var n = Date.now(); out[k] = (out[k] || 0) + (n - last); last = n; },
    done: function () { out.total = Date.now() - t0; return out; }
  };
}

/** 지급 줄 비교용 — 수정시각 · 만든곳은 빼고 줄 내용만 */
function lineSig_(L) {
  return [L.lineId, L.kind, String(L.date || '').slice(0, 10), L.qty, L.amt, L.payYm, L.memo, L.ch].join('\u0001');
}

/**
 * 지급 줄 저장 본체. opt.fullRewrite = 예전 방식(탭 통째로 다시 쓰기, 속도 비교용).
 * 줄 내용이 하나도 안 바뀌었으면 이력 · AP 다시 쓰기를 건너뛴다(같은 내용 저장이 AP 를 다시 만들지 않게).
 */
/** 지급 줄 열쇠 = 찾은 행의 실행판ID 칸(형식 상관없이). 칸이 비었으면 화면이 준 열쇠를 그대로 쓴다. */
function lineOwnerId_(sh, C, row, id) {
  var kc = statusKeyCols_(sh, C.hr);
  var v = kc.id >= 0 ? str_(sh.getRange(row, kc.id + 1).getValue()) : '';
  return v || id;
}

function saveLinesCore_(statusRow, expect, lines, reason, opt) {
  opt = opt || {};
  var T = rbTimer_();
  reason = str_(reason).slice(0, 500);
  var id = str_((expect || {}).id);
  if (!id) throw new Error('실행판ID 가 없습니다.');
  var clean = (lines || []).map(cleanLine_);
  T.mark('검사');
  var sh = statusSheet_(), out, changed = true;
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var vOuter = deferVer_();      // 변경 번호 · 반영(flush)은 잠금 놓기 직전 한 번
  T.mark('잠금');
  // 같은 요청 번호(op)가 다시 오면(응답이 끊겨 화면이 자동 재전송) 처음 결과를 돌려준다 — 줄ID 없는 새 줄이 또 더해지지 않게
  var opKey = str_(opt.op) ? 'op:ln:' + str_(opt.op).slice(0, 40) : '';
  var dup = opGet_(opKey);
  if (dup) { try { endVer_(vOuter); } catch (e) { /* 넘어간다 */ } lock.releaseLock(); dup.duplicate = true; return dup; }
  try {
    var C = sheetCols_(sh);
    var row = checkStatusRow_(sh, C, Number(statusRow) || 0, expect);
    id = lineOwnerId_(sh, C, row, id);
    T.mark('발주DB행찾기');
    // 지금 입고예정 칸(예정 줄이 없는 건은 등록 때 입고목표로 채운 값) — 바뀌면 이력에 남기려고 쓰기 전에 읽어 둔다
    var cEtaS = colIdx_(C.idx, ['입고일정']), etaCellWas = cEtaS >= 0 ? str_(sh.getRange(row, cEtaS + 1).getDisplayValue()) : '';
    var all = readLinesAll_();
    var before = all.rows.filter(function (r) { return str_(r[0]) === id; }).map(rowToLine_);
    T.mark('지급줄읽기');
    // 화면이 표를 읽은 뒤(base) 다른 사람이 입고 등록 등으로 줄을 바꿨으면 — 막지 않고 둘 다 살린다(칸 단위로 합치기)
    if (opt.base && opt.base.length !== undefined && (!opt.base.length || typeof opt.base[0] === 'object')) clean = mergeLines_(opt.base.map(cleanLineLoose_), before, clean);
    var saved = replaceLinesFor_(id, clean, '실행판 지급 줄', all, !!opt.fullRewrite);
    T.mark('지급줄쓰기');
    opPut_(opKey, { lines: saved });               // 줄을 쓴 뒤 바로 표시(아래에서 실패해도 다시 보낸 요청이 또 쓰지 않게)
    out = syncOrderFromLines_(sh, C, row, saved);
    T.mark('발주DB칸맞추기');
    out.lines = saved;
    opPut_(opKey, out);
    changed = before.map(lineSig_).join('\u0002') !== saved.map(lineSig_).join('\u0002');
    if (!changed) { out.unchanged = true; return out; }
    var hist = [{ kind: '지급 줄', id: id, doc: expect.doc, code: expect.code, name: expect.name,
      item: '지급 줄 ' + before.length + '→' + saved.length + '줄',
      before: linesSummary_(before).slice(0, 500), after: linesSummary_(saved).slice(0, 500), where: RB.STATUS_TAB + ' ' + row + '행' }];
    // 납기 변경: 남은 예정 줄의 마지막 날짜가 바뀌면 따로 남긴다(분석 화면의 '납기 변경' 횟수).
    // 예정 → 입고 전환으로 앞쪽 예정이 빠지는 건 변경이 아니다. 처음 넣거나 예정이 다 없어진 경우도 빼고 센다.
    var etaOf = function (ls) {
      return ls.filter(function (L) { return L.kind === '예정' && L.date; }).map(function (L) { return String(L.date).slice(0, 10); }).sort();
    };
    var eb = etaOf(before), ea = etaOf(saved);
    if (!eb.length && etaCellWas && ea.length && etaNorm_(etaCellWas) !== etaNorm_(ea.join(', '))) {
      hist.push({ kind: '입고일정', id: id, doc: expect.doc, code: expect.code, name: expect.name, item: '입고예정',
        before: etaCellWas, after: ea.join(', '), reason: reason, where: RB.STATUS_TAB + ' ' + row + '행' });
    }
    // 화면이 사유를 물었으면(같은 예정 줄의 날짜가 바뀐 경우 포함) 그것도 납기 변경으로 남긴다
    if (eb.length && ea.length && (eb[eb.length - 1] !== ea[ea.length - 1] || (reason && eb.join(',') !== ea.join(',')))) {
      hist.push({ kind: '입고일정', id: id, doc: expect.doc, code: expect.code, name: expect.name, item: '입고예정(지급 줄)',
        before: eb.join(', '), after: ea.join(', '), reason: reason, where: RB.STATUS_TAB + ' ' + row + '행' });
    }
    appendHist_(hist);
    T.mark('이력');
  } finally {
    try { endVer_(vOuter); } catch (e) { /* 넘어간다 */ }
    try { if (typeof T !== 'undefined' && T && T.mark) T.mark('반영(시트 계산)'); } catch (eT) { /* 넘어간다 */ }
    lock.releaseLock();
    if (out) {
      cacheDrop_(rowsCacheKey_('po'));             // 줄이 그대로여도 발주 DB 칸(입고수량 · 입고일정 …)은 맞춰 썼을 수 있다
      if (changed) {
        try { out.ap = apRebuildSoon_(); } catch (e) { out.apError = e.message; }
        T.mark('AP예약');
      }
      out.timing = T.done();
      try { console.log('saveLines ' + id + ' ' + JSON.stringify(out.timing)); } catch (e) { /* 넘어간다 */ }
    }
  }
  return out;
}

/**
 * 관리자 진단: ?diag=savebench&id=<실행판ID> — 그 건의 지금 지급 줄을 바꾸지 않고 그대로 다시 저장해
 * 예전 방식(탭 통째로) · 지금 방식(그 건만)의 단계별 시간을 잰다. 내용이 같아 이력 · AP 는 건드리지 않는다.
 * (지급 줄의 수정시각 칸만 바뀐다)
 */
function saveBench_(id) {
  requireAdmin_();
  id = str_(id);
  if (!id) throw new Error('&id=실행판ID 를 넣어 주세요.');
  var sh = statusSheet_(), C = sheetCols_(sh), kc = statusKeyCols_(sh, C.hr);
  var ids = sh.getRange(C.hr + 1, kc.id + 1, Math.max(1, sh.getLastRow() - C.hr), 1).getValues();
  var row = 0;
  for (var i = 0; i < ids.length; i++) if (str_(ids[i][0]) === id) { row = C.hr + 1 + i; break; }
  if (!row) throw new Error('발주 DB 에 ' + id + ' 가 없습니다.');
  var cur = readLinesAll_().rows.filter(function (r) { return str_(r[0]) === id; }).map(rowToLine_);
  var expect = { id: id };
  var a = saveLinesCore_(row, expect, cur, '', { fullRewrite: true });
  var b = saveLinesCore_(row, expect, cur, '', {});
  var c = saveLinesCore_(row, expect, cur, '', {});
  // 실제 저장에만 붙는 단계를 따로 잰다(쓰지 않는 것만): 강제 재계산 · 트리거 목록 · 탭 찾기 · 이력 탭 준비
  var P = {}, t;
  t = Date.now(); SpreadsheetApp.flush(); P.flush_재계산 = Date.now() - t;
  t = Date.now(); ScriptApp.getProjectTriggers(); P.트리거목록 = Date.now() - t;
  t = Date.now(); RB_SHEETS = null; sheet_(RB.STATUS_TAB); P.탭찾기_전체훑기 = Date.now() - t;
  t = Date.now(); ss_().getSheetByName(RB.STATUS_TAB); P.탭찾기_이름으로 = Date.now() - t;
  t = Date.now(); var ah = tab_(RB.T_AUDIT, RB.HIST_HEAD); ah.getLastRow(); ah.getRange(1, 4).getValue(); P.이력탭준비 = Date.now() - t;
  t = Date.now(); CacheService.getScriptCache().get('rb:ver:l'); P.캐시한칸 = Date.now() - t;
  return { 건: id, 줄수: cur.length, 지급줄탭: readLinesAll_().rows.length + '줄',
           예전방식_탭통째로: a.timing, 지금방식_그건만: b.timing, 지금방식_두번째: c.timing,
           실제저장에만붙는단계: P,
           내용바뀜: [!a.unchanged, !b.unchanged, !c.unchanged] };
}

/**
 * 단가 변경 → 지급 줄 금액 따라가기(editOrder_ 잠금 안에서 부른다).
 *  · 예정 · 입고 줄만 새 단가로: 수량이 있는 줄은 금액 = 수량 × 지급 단가(화면 lnPayUnit 과 같은 셈:
 *    원 단가 − 선금 합 ÷ 발주수량), 수량이 없는 줄은 옛 지급 단가 대비 비율로.
 *  · 선금 줄 · 지급월 없음 줄 · 지급월이 이번 달보다 앞선 줄(이미 지급)은 그대로.
 *  · 통화는 진행 기록 checks._cur(없으면 업체명에 '중국' → 위안), 환율은 설정 fx.CNY · fx.USD(화면과 같음).
 * 바뀐 줄이 없으면 null. 돌려주는 값: { lines, n(바꾼 줄), kept(지난 지급월이라 둔 줄), inQty, remain, eta, arrivedAt }
 */
function linesFollowPrice_(sh, C, row, id, p, ex, reason) {
  var all = readLinesAll_();
  if (!all.sh) return null;
  var cur = all.rows.filter(function (r) { return str_(r[0]) === id; }).map(rowToLine_);
  if (!cur.length) return null;
  var st = progView_('po', id);
  var c = (st.checks || {})._cur;
  if (c !== 'KRW' && c !== 'CNY' && c !== 'USD') c = p.vendor.indexOf(RB.CHINA_KEYWORD) > -1 ? 'CNY' : 'KRW';
  var cfg = metaFast_('po').cfg || {};
  var fx = c === 'CNY' ? (Number(cfg['fx.CNY']) || RB.CHINA_MULTIPLIER) : (c === 'USD' ? (Number(cfg['fx.USD']) || 1400) : 1);
  var pre = cur.filter(function (L) { return L.kind === '선금'; }).reduce(function (a, L) { return a + (num_(L.amt) || 0); }, 0);
  var payUnit = function (price, qty) { var u = price * fx; return qty > 0 ? Math.max(0, u - pre / qty) : u; };
  var uOld = payUnit(p.oldPrice, p.oldQty), uNew = payUnit(p.newPrice, p.newQty);
  if (!(uNew > 0)) return null;
  var now = new Date(), ymNow = String(now.getFullYear()).slice(2) + '-' + pad2_(now.getMonth() + 1);
  var n = 0, kept = 0;
  var next = cur.map(function (L) {
    if (L.kind !== '예정' && L.kind !== '입고') return L;
    if (L.payYm && L.payYm < ymNow) { kept++; return L; }
    var q = num_(L.qty), amt;
    if (q > 0) amt = Math.round(q * uNew);
    else if (uOld > 0) amt = Math.round(num_(L.amt) * uNew / uOld);
    else return L;
    if (!(amt > 0) || amt === num_(L.amt)) return L;
    n++;
    var o = {}; Object.keys(L).forEach(function (k) { o[k] = L[k]; }); o.amt = amt;
    return o;
  });
  if (!n) return null;
  var before = cur.slice();
  var saved = replaceLinesFor_(id, next.map(cleanLine_), '단가 변경', all);
  var res = syncOrderFromLines_(sh, C, row, saved);
  appendHist_([{ kind: '지급 줄', id: id, doc: ex.doc, code: ex.code, name: ex.name,
    item: '단가 ' + p.oldPrice + '→' + p.newPrice + ' 따라 ' + n + '줄' + (kept ? ' (지난 지급월 ' + kept + '줄은 그대로)' : ''),
    before: linesSummary_(before).slice(0, 500), after: linesSummary_(saved).slice(0, 500), reason: reason, where: RB.STATUS_TAB + ' ' + row + '행' }]);
  res.lines = saved; res.n = n; res.kept = kept;
  return res;
}

/**
 * 발주수량을 바꾸면 남은 예정 줄 수량도 — 마지막(가장 늦은) 지급 전 예정 줄에서 늘리거나 줄인다(예전엔 그대로라 AP 가 모자라거나 남았다).
 * 예정 줄이 없거나 다 지난 지급월이면 바꾸지 않고 null(화면이 지급 줄을 직접 고치라고 알린다).
 */
function linesFollowQty_(sh, C, row, id, p, ex, reason) {
  var all = readLinesAll_();
  if (!all.sh) return null;
  var cur = all.rows.filter(function (r) { return str_(r[0]) === id; }).map(rowToLine_);
  if (!cur.length) return null;
  var now = new Date(), ymNow = String(now.getFullYear()).slice(2) + '-' + pad2_(now.getMonth() + 1);
  var inQ = cur.filter(function (L) { return L.kind === '입고'; }).reduce(function (a, L) { return a + (num_(L.qty) || 0); }, 0);
  var plan = cur.filter(function (L) { return L.kind === '예정'; });
  var planQ = plan.reduce(function (a, L) { return a + (num_(L.qty) || 0); }, 0);
  var delta = Math.max(0, p.newQty - inQ) - planQ;
  if (!delta) return null;
  var open = plan.filter(function (L) { return !(L.payYm && L.payYm < ymNow) && num_(L.qty) > 0; });
  if (!open.length) return { n: 0, need: delta };
  open.sort(function (a, b) { return String(a.date || '') < String(b.date || '') ? -1 : 1; });
  var left = delta, changed = {};
  for (var i = open.length - 1; i >= 0 && left; i--) {          // 늘리면 마지막 줄에 · 줄이면 마지막 줄부터 0 까지
    var L = open[i], q = num_(L.qty), nq = left > 0 ? q + left : Math.max(0, q + left);
    left = left > 0 ? 0 : left + (q - nq);
    changed[L.lineId] = nq;
  }
  var n = 0;
  var next = cur.map(function (L) {
    if (changed[L.lineId] === undefined) return L;
    var q = num_(L.qty), nq = changed[L.lineId];
    var o = {}; Object.keys(L).forEach(function (k) { o[k] = L[k]; });
    o.qty = nq; o.amt = q > 0 ? Math.round(num_(L.amt) * nq / q) : num_(L.amt);
    n++;
    return o;
  }).filter(function (L) { return !(L.kind === '예정' && changed[L.lineId] === 0); });
  var before = cur.slice();
  var saved = replaceLinesFor_(id, next.map(cleanLine_), '발주수량 변경', all);
  var res = syncOrderFromLines_(sh, C, row, saved);
  appendHist_([{ kind: '지급 줄', id: id, doc: ex.doc, code: ex.code, name: ex.name,
    item: '발주수량 ' + p.oldQty + '→' + p.newQty + ' 따라 예정 ' + n + '줄' + (left ? ' (줄일 예정 줄이 모자람 ' + left + ')' : ''),
    before: linesSummary_(before).slice(0, 500), after: linesSummary_(saved).slice(0, 500), reason: reason, where: RB.STATUS_TAB + ' ' + row + '행' }]);
  res.lines = saved; res.n = n; res.need = left;
  return res;
}

/** 요청 번호(op) 결과 캐시 — 같은 요청이 다시 오면 처음 결과를 돌려준다(30분) */
function opGet_(key) {
  if (!key) return null;
  try { var hit = CacheService.getScriptCache().get(key); return hit ? JSON.parse(hit) : null; } catch (e) { return null; }
}
function opPut_(key, val) {
  if (!key) return;
  try { CacheService.getScriptCache().put(key, JSON.stringify(val), 1800); } catch (e) { /* 넘어간다 */ }
}

/**
 * 화면: 입고 등록. inb = { date, qty, payYm, unit(원 단가), memo, reduce: [{ lineId, amt }] }
 * 입고 줄을 하나 더하고, 입고 수량만큼 예정 줄에서 뺀다 — 고른 줄(reduce[0].lineId)부터, 모자라면 다음으로 빠른 예정에서(0 이 되면 그 예정 줄은 지운다).
 * noReduce = '예정과 상관없는 추가 입고'를 직접 고른 때만 예정을 그대로 둔다.
 */
function apiAddInbound(statusRow, expect, inb) {
  requireEditor_();
  var id = str_((expect || {}).id);
  if (!id) throw new Error('실행판ID 가 없습니다.');
  inb = inb || {};
  var qty = num_(inb.qty), unit = num_(inb.unit);
  if (!(qty > 0)) throw new Error('입고 수량을 넣어주세요.');
  if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(str_(inb.date))) throw new Error('입고일을 골라주세요.');
  if (!/^\d{2}-\d{2}$/.test(str_(inb.payYm))) throw new Error('지급월을 골라주세요.');
  if (!(unit > 0)) throw new Error('단가가 없어 입고 금액을 계산할 수 없습니다.');
  var sh = statusSheet_(), out;
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var vOuter = deferVer_();      // 변경 번호 · 반영(flush)은 잠금 놓기 직전 한 번
  // 같은 요청 번호(op)가 다시 오면(두 번 누름 · 자동 재시도) 처음 결과를 돌려주고 입고를 또 넣지 않는다
  var opKey = str_(inb.op) ? 'op:in:' + str_(inb.op).slice(0, 40) : '';
  var dup = opGet_(opKey);
  if (dup) { try { endVer_(vOuter); } catch (e) { /* 넘어간다 */ } lock.releaseLock(); dup.duplicate = true; return dup; }
  try {
    var C = sheetCols_(sh);
    var row = checkStatusRow_(sh, C, Number(statusRow) || 0, expect);
    id = lineOwnerId_(sh, C, row, id);
    var allL = readLinesAll_();
    var cur = allL.rows.filter(function (r) { return str_(r[0]) === id; }).map(rowToLine_);
    // 입고 수량만큼 예정 줄에서 뺀다(2026-10-15): 고른 예정 줄부터, 모자라면 다음으로 빠른 예정 줄에서 이어서.
    // 고른 줄이 없으면(빠른 입고 창에서 고르기 전 저장 등) 가장 빠른 예정부터. '예정과 상관없는 추가 입고'를 직접 고른 때(noReduce)만 안 뺀다.
    var red = {}, pick = '';
    (inb.reduce || []).forEach(function (x) { if (!pick && str_(x.lineId)) pick = str_(x.lineId); });
    if (!inb.noReduce) {
      cur.forEach(function (L, i) { L._i = i; });
      var pend = cur.filter(function (L) { return L.kind === '예정' && (num_(L.qty) > 0 || num_(L.amt) > 0); })
        .sort(function (a, b) { var pa = a.lineId === pick ? 0 : 1, pb = b.lineId === pick ? 0 : 1; if (pa !== pb) return pa - pb; return str_(a.date || '9') < str_(b.date || '9') ? -1 : (str_(a.date || '9') > str_(b.date || '9') ? 1 : 0); });
      var leftQ = qty;
      pend.forEach(function (L) {
        if (leftQ <= 0) return;
        var pq = num_(L.qty) > 0 ? num_(L.qty) : Math.round(num_(L.amt) / unit);
        if (!(pq > 0)) return;
        var take = Math.min(leftQ, pq);
        red[L._i] = { q: take, pq: pq, id: L.lineId || ('예정 ' + str_(L.date)) };
        leftQ -= take;
      });
    }
    var next = [];
    cur.forEach(function (L, i) {
      var rd = red[i];
      delete L._i;
      if (rd && L.kind === '예정') {
        if (rd.q >= rd.pq) return;                         // 다 빼면 그 예정 줄은 없앤다
        var a0 = num_(L.amt);
        L.qty = rd.pq - rd.q;
        L.amt = Math.round(a0 * L.qty / rd.pq);            // 그 줄 단가 그대로 남은 수량만큼
      }
      next.push(L);
    });
    var amtIn = Math.round(qty * unit);
    next.push({ kind: '입고', date: str_(inb.date), qty: qty, amt: amtIn, payYm: str_(inb.payYm), memo: str_(inb.memo), ch: str_(inb.ch) });
    var saved = replaceLinesFor_(id, next.map(cleanLine_), '실행판 입고 등록', allL);
    opPut_(opKey, { lines: saved });               // 입고 줄을 쓴 뒤 바로 표시 — 아래(발주 DB 칸 · 이력)에서 실패해도 다시 보낸 요청이 또 넣지 않게
    out = syncOrderFromLines_(sh, C, row, saved);
    out.lines = saved;
    opPut_(opKey, out);
    // 이력 쓰기가 실패해도 입고는 이미 들어갔다 — 오류로 돌려주면 화면이 다시 보내므로 기록만 남기고 넘어간다
    try { appendHist_([{ kind: '입고', id: id, doc: expect.doc, code: expect.code, name: expect.name, item: '입고 ' + inb.date,
      after: qty + '개 · ' + amtIn.toLocaleString() + '원 · 지급월 ' + inb.payYm + (str_(inb.ch) ? ' · 채널 ' + str_(inb.ch) : ''),
      reason: Object.keys(red).length ? '예정에서 뺌: ' + Object.keys(red).map(function (k) { return red[k].id + ' ' + red[k].q.toLocaleString() + '개'; }).join(', ') : (inb.noReduce ? '예정과 상관없는 추가 입고' : ''),
      where: RB.STATUS_TAB + ' ' + row + '행' }]); } catch (eH) { try { console.error('입고 이력 쓰기 실패 ' + id + ': ' + eH.message); } catch (e2) { /* 넘어간다 */ } }
  } finally {
    try { endVer_(vOuter); } catch (e) { /* 넘어간다 */ }
    try { if (typeof T !== 'undefined' && T && T.mark) T.mark('반영(시트 계산)'); } catch (eT) { /* 넘어간다 */ }
    lock.releaseLock();
  }
  cacheDrop_(rowsCacheKey_('po'));
  try { out.ap = apRebuildSoon_(); } catch (e) { out.apError = e.message; }
  return out;
}

/** 지급 줄 → AP 탭(A~R 예전 형식 + S~U 실행판ID · 종류 · 줄ID). 계산 없이 이어 붙인다. */
/**
 * AP 다시 쓰기는 무거워서(1천 행) 저장 응답을 늦췄다. 1분 뒤 한 번 도는 트리거로 미룬다.
 * 그 사이 저장이 여러 번 있어도 트리거는 하나만 둔다. 화면을 닫아도 서버에서 돈다.
 */
var RB_AP_SOON = 'apRebuildDeferred';
/**
 * 건 정보(진행상태 · 발주일 · 품목 · 업체 · 단가 · 품의번호)가 바뀌면 AP 도 1분 뒤 다시 쓴다.
 * 예전에는 지급 줄 저장 때만 다시 써서, 취소 · 정보 수정이 20시까지 AP 에 안 들어갔다. 실패해도 20시에 다시 만든다.
 */
function apRefreshSoon_() {
  try { apRebuildSoon_(); } catch (e) { /* 20시에 */ }
}

function apRebuildSoon_() {
  // 이미 예약해 둔 게 있으면(캐시 표시) 트리거 목록을 묻지 않는다 — 연달아 저장할 때마다 트리거 조회 · 생성이 붙지 않게
  var c = null;
  try { c = CacheService.getScriptCache(); if (c.get('ap:soon')) return { queued: true }; } catch (e) { c = null; }
  // 두 저장이 동시에 '없음'을 보고 둘 다 만들면 중복 — 만든 뒤 하나만 남긴다(triggerEnsure_).
  // 장부 옮기기 등 스크립트 잠금을 쥔 채 부르는 곳이 있어 잠금은 다시 잡지 않는다(잡았다 놓으면 바깥 잠금이 풀린다).
  triggerEnsure_(RB_AP_SOON, function () { ScriptApp.newTrigger(RB_AP_SOON).timeBased().after(60 * 1000).create(); }, false);
  try { if (c) c.put('ap:soon', '1', 300); } catch (e) { /* 넘어간다(AP 작업이 돌면서 지운다) */ }
  return { queued: true };
}
function apRebuildDeferred(e) {
  requireTriggerOrAdmin_(e, RB_AP_SOON);
  // 먼저 트리거와 예약 표시를 지운다 — 다시 쓰는 동안 들어온 저장은 새 트리거를 만든다
  try { CacheService.getScriptCache().remove('ap:soon'); } catch (err0) { /* 넘어간다 */ }
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === RB_AP_SOON) ScriptApp.deleteTrigger(t); });
  // AP 작업끼리는 'ap:running' 표시로 겹치지 않게 한다(20시 갱신 apUpdate_ 도 같은 표시를 쓴다).
  // 스크립트 잠금은 지급 줄 · 발주 DB 를 읽는 동안만 쥔다 — 예전에는 AP 탭을 다 쓸 때까지 쥐고 있어서,
  // AP 쓰기가 오래 걸리면(10/4 02:06 에 2분 넘게) 그동안 사용자 저장이 전부 '잠금 시간초과' 로 실패했다.
  var cache = CacheService.getScriptCache();
  if (!apRunClaim_(cache)) { apRebuildSoon_(); return; }
  var T = rbTimer_(), res = { by: '저장 뒤 자동' };
  try {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) { apRebuildSoon_(); res.error = '잠금 못 얻음 — 1분 뒤 다시'; return; }
    T.mark('잠금대기');
    var rows;
    try { rows = apBuildRows_(); } finally { lock.releaseLock(); }
    T.mark('읽기(잠금안)');
    var lr = apRebuildFromLines_(rows, T);
    res.rows = lr.rows; res.anomaly = lr.anomaly;
  } catch (err) {
    res.error = err.message;
  } finally {
    cache.remove('ap:running');
    res.timing = T.done();
    try { console.log('apRebuildDeferred ' + JSON.stringify(res)); } catch (e2) { /* 넘어간다 */ }
  }
  // 설정 탭에 쓰면 화면 설정 캐시가 버려져 다음 접속이 느려지므로 스크립트 속성에 남긴다
  res.ms = res.timing.total;
  res.at = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  PropertiesService.getScriptProperties().setProperty('ap.lastAuto', JSON.stringify(res));
}

/**
 * 'ap:running' 표시 잡기 — 확인과 표시를 짧은 잠금 안에서 한 번에(두 작업이 동시에 '없음'을 보고 둘 다 도는 일이 없게).
 * 잡았으면 true. 이미 돌고 있거나 잠금을 못 얻으면 false. (부르는 쪽은 스크립트 잠금을 쥐고 있지 않아야 한다)
 */
function apRunClaim_(cache) {
  var lk = LockService.getScriptLock();
  if (!lk.tryLock(10000)) return false;
  try {
    if (cache.get('ap:running')) return false;
    cache.put('ap:running', '1', 600);
    return true;
  } finally {
    lk.releaseLock();
  }
}

/** AP 에 쓸 행을 만든다(읽기만). 잠금 안에서 짧게 부른다. */
function apBuildRows_() {
  var ss = ss_();
  var lines = readLinesAll_().rows.map(rowToLine_);
  if (!lines.length) throw new Error('지급 줄이 없습니다.');
  return apFromLines_(lines, orderAttrsForAp_(ss));
}

function apRebuildFromLines_(prebuilt, T) {
  var ss = ss_();
  var rows = prebuilt || apBuildRows_();
  if (T) T.mark('AP행만들기');
  var bad = rows.filter(function (r) { return r[19] === '지급월 없음' || r[10] === RB_LINE_ORPHAN; }).length;   // 예외(빨간) 행: 지급월 없음 · 발주 DB 에 없는 건
  var dest = RB_AP.sheetByGid(ss, RB_AP.destGid);
  RB_AP.write(dest, rows.map(function (r) { return r.slice(0, 18); }), bad);
  if (T) T.mark('AP쓰기_A~R');
  var W = RB_LINE.AP_EXTRA.length;
  if (dest.getMaxColumns() < 18 + W) dest.insertColumnsAfter(dest.getMaxColumns(), 18 + W - dest.getMaxColumns());
  dest.getRange(1, 19, 1, W).setValues([RB_LINE.AP_EXTRA]).setFontWeight('bold');
  var last = dest.getMaxRows();
  // 새 값을 먼저 쓰고 그 아래 남은 행만 비운다(비운 뒤 쓰다 멈추면 S~U 가 빈 채로 남았다)
  if (rows.length) dest.getRange(2, 19, rows.length, W).setValues(rows.map(function (r) { return r.slice(18, 18 + W); }));
  if (last > rows.length + 1) dest.getRange(rows.length + 2, 19, last - rows.length - 1, W).clearContent();
  if (T) T.mark('AP쓰기_S~U(최대행 ' + last + ')');
  return { rows: rows.length, anomaly: bad };
}

/** 새 발주 등록 때(전환 뒤): 선금 · 잔금을 지급 줄로. f: 등록 값(원 단위 금액) */
function linesForNewOrder_(f) {
  var list = [];
  if (num_(f.pre) > 0) {
    var pd = toDate_(f.preAt);
    list.push({ kind: '선금', date: pd ? Utilities.formatDate(pd, Session.getScriptTimeZone(), 'yyyy-MM-dd') : '',
      qty: '', amt: Math.round(num_(f.pre)), payYm: ymOf_(f.preAt), memo: '등록 때 선금' });
  }
  if (num_(f.bal) > 0) {
    list.push({ kind: '예정', date: f.due || '', qty: f.qty, amt: Math.round(num_(f.bal)), payYm: ymOf_(f.balAt), memo: '등록 때 잔금' });
  }
  return list.filter(function (L) { return L.payYm; });
}



