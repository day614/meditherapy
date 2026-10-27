/**
 * 속도 측정
 *  · perfReads_(): ?diag=perf — 화면이 부르는 읽기 함수를 서버 안에서 하나씩 돌려 걸린 시간(ms)을 잰다(시트는 바꾸지 않음).
 *    캐시가 있을 때(평소)와 시트에서 다시 읽을 때(캐시 없음)를 나눠 본다.
 *  · apiPerfReport(list): 화면이 잰 시간(서버 왕복 · 화면 그리기 포함)을 사람별로 캐시에 모아 둔다(6시간). ?diag=perflog 로 본다.
 */

// 시안(사본 시트) ID — 쓰기 측정(perfwrites · perfw · perfsave)은 RB.SS_ID 가 이 값일 때(사본 배포)만 돈다.
var RB_COPY_SS_ID = '16dUjhBKvKb-D1kuS2C9KvUixzEvL1Gt2ZVlktrbVcQE';
function requireCopySS_() {
  if (RB.SS_ID !== RB_COPY_SS_ID) throw new Error('시안(사본 시트)에서만 돕니다. 운영 시트에서는 쓰기 측정을 하지 않습니다.');
}
function perfTime_(label, fn, out) {
  var t0 = Date.now(), ok = true, note = '';
  try { var r = fn(); if (r && r.length !== undefined) note = (r.length || 0) + '건'; else if (r && r.rows) note = r.rows.length + '줄'; if (r && r.timing) note += ' ' + JSON.stringify(r.timing); }
  catch (e) { ok = false; note = '오류 ' + String(e.message || e).slice(0, 80); }
  out.push({ 작업: label, ms: Date.now() - t0, 비고: note + (ok ? '' : ' ✗') });
}

function perfReads_() {
  requireAdmin_();
  var out = [], boot = null;
  perfTime_('첫 화면(캐시 있음) apiBootstrap(0)', function () { boot = apiBootstrap(0, 'po'); return boot; }, out);
  perfTime_('첫 화면(시트 다시 읽기) apiBootstrap(1)', function () { boot = apiBootstrap(1, 'po'); return boot; }, out);
  perfTime_('첫 화면(전부 다시) apiBootstrap(2)', function () { return apiBootstrap(2, 'po'); }, out);
  perfTime_('샘플 탭 첫 화면 apiBootstrap(0, sample)', function () { return apiBootstrap(0, 'sample'); }, out);
  perfTime_('변경 확인(2분마다) apiVer', function () { return apiVer(); }, out);
  perfTime_('진행 기록만 다시 apiProgressOnly', function () { return apiProgressOnly('po'); }, out);
  perfTime_('지급 줄만 다시 apiLinesOnly', function () { return apiLinesOnly(); }, out);
  var row = boot && boot.rows ? boot.rows.filter(function (r) { return r.statusRow && r.code; })[0] : null;
  if (row) perfTime_('건 상세 지급 줄 apiGetLines', function () { return apiGetLines(row.id).lines; }, out);
  perfTime_('품목 DB apiItems', function () { return apiItems(); }, out);
  perfTime_('공지 apiNotice', function () { return apiNotice(); }, out);
  // BOM — 예전에는 캐시를 지우고 '캐시 없음'을 쟀다(그동안 다른 사람이 빈 캐시를 만났다).
  // 이제 지우지 않는다: 캐시 없을 때 하는 일(시트 통째 읽기 → 캐시 다시 채우기, bomBuildCache_)을 직접 재고, 캐시는 새 값으로 채워진 채 둔다.
  perfTime_('BOM 시트 다시 읽기 · 캐시 새로 채움(캐시 없을 때 하는 일) bomBuildCache_', function () { return bomBuildCache_().list; }, out);
  perfTime_('BOM 목록(캐시) apiBomList', function () { return apiBomList(); }, out);
  var code = row ? row.code : 'M0129AA2';
  perfTime_('BOM 보기 한 품목(캐시) apiBomGet ' + code, function () { return apiBomGet(code).rows; }, out);
  perfTime_('BOM 검색 apiBomSearch "크림"', function () { return apiBomSearch('크림'); }, out);
  perfTime_('BOM 두 품목 비교 apiBomCompare', function () { return apiBomCompare('H0002AA3', 'H0002TW1').rows; }, out);
  perfTime_('BOM 검사 apiBomReviewList', function () { return apiBomReviewList(); }, out);
  perfTime_('BOM 구분 목록 apiBomTypes', function () { return apiBomTypes(); }, out);
  perfTime_('새 코드 제안 apiBomNextProductCode', function () { return apiBomNextProductCode('M', '', ['AA'], '제품').codes; }, out);
  perfTime_('설정 AP 상태 apApStatus', function () { return apApStatus(); }, out);
  perfTime_('분석 탭 apiSupplyStats', function () { return apiSupplyStats(); }, out);
  return { 측정: out, 합계ms: out.reduce(function (a, x) { return a + x.ms; }, 0), 안내: '서버 안에서만 잰 시간입니다(화면 · 네트워크 왕복 0.5~1.5초는 빠짐). 화면에서 잰 시간은 ?diag=perflog' };
}

/** 화면이 잰 시간을 모아 둔다(사람별 · 6시간). list = [{ n: 함수, ms, ok, at }] */
function apiPerfReport(list) {
  // 보기만 하는 사람은 조용히 넘긴다 — 저장 권한 없이 숨김 탭(_실행판_속도)에 줄을 붙이지 않게
  var okE = false;
  try { okE = canEdit_(); } catch (eE) { okE = false; }
  if (!okE) return true;
  var who = '';
  try { who = me_(); } catch (e) { who = '?'; }
  // 스크립트 잠금은 잡지 않는다 — 측정 기록이 사용자 저장을 줄 세우지 않게(예전엔 1분마다 사람 수만큼 잠금을 잡았다).
  // 사람마다 칸이 따로라 겹칠 일은 같은 사람이 창 두 개를 띄운 때뿐(그때 몇 건 빠져도 측정용이라 괜찮다).
  var key = 'perf:' + who, c = CacheService.getScriptCache(), have = [], slow = [];
  try { have = JSON.parse(c.get(key) || '[]'); } catch (e) { have = []; }
  (list || []).slice(0, 200).forEach(function (x) {
    var o = { n: String(x.n || '').slice(0, 40), ms: Math.round(Number(x.ms) || 0), ok: x.ok !== false, at: String(x.at || '').slice(0, 19) };
    if (x.t) o.t = String(x.t).slice(0, 400);
    have.push(o);
    if (o.ms >= 3000 && o.n !== 'apiPerfReport') slow.push(o);
  });
  if (have.length > 500) have = have.slice(have.length - 500);
  try { c.put(key, JSON.stringify(have), 21600); } catch (e) { /* 크면 넘어간다 */ }
  var ks = []; try { ks = JSON.parse(c.get('perf:who') || '[]'); } catch (e) { ks = []; }
  if (ks.indexOf(who) < 0) { ks.push(who); try { c.put('perf:who', JSON.stringify(ks), 21600); } catch (e) { /* 넘어간다 */ } }
  // 3초 넘은 호출은 숨김 탭 _실행판_속도 에도 남긴다(캐시는 6시간이면 사라져서) — appendRow 라 잠금 없이 붙여도 겹치지 않는다
  if (slow.length) {
    try {
      var sh = tab_(RB_PERF_TAB, ['때', '누가', '작업', 'ms', '성공', '서버 단계별(ms)']);
      slow.slice(0, 30).forEach(function (o) { sh.appendRow([perfKst_(o.at), who.split('@')[0], o.n, o.ms, o.ok ? 'O' : 'X', o.t || '']); });
      try { if (!sh.isSheetHidden()) sh.hideSheet(); } catch (eH) { /* 넘어간다 */ }
      // 끝없이 쌓이지 않게 최근 RB_PERF_KEEP 줄만 남긴다(넘친 게 500줄 넘을 때만 한 번에 — 매번 지우지 않게)
      try {
        var lastP = sh.getLastRow();
        if (lastP - 1 > RB_PERF_KEEP + 500) sh.deleteRows(2, lastP - 1 - RB_PERF_KEEP);
      } catch (eT) { /* 넘어간다 */ }
    } catch (eS) { /* 측정 기록 실패는 넘어간다 */ }
  }
  return true;
}

/** 화면이 보낸 때(toISOString 앞 19자 = UTC)를 한국 시간 'yyyy-MM-dd HH:mm:ss' 로 — 예전에는 UTC 그대로 적혀 9시간 이르게 보였다 */
function perfKst_(at) {
  var s = String(at || '');
  try {
    var d = new Date(s + (/Z$|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z'));
    if (!isNaN(d)) return Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
  } catch (e) { /* 아래로 */ }
  return s.replace('T', ' ');
}

var RB_PERF_TAB = '_실행판_속도';
var RB_PERF_KEEP = 5000;         // 숨김 탭 _실행판_속도 에 남기는 최근 줄 수
/** 화면(설정 · 관리자): 속도 기록 — 함수별 + 느렸던 호출(서버 단계별) */
function apiPerfView() {
  var out = perfLog_();
  var all = out._all || [];
  delete out._all;
  out.느림 = all.filter(function (x) { return x.ms >= 3000 && x.n !== 'apiPerfReport'; }).sort(function (a, b) { return String(b.at) < String(a.at) ? -1 : 1; }).slice(0, 60);
  return out;
}

/** ?diag=perflog — 화면에서 잰 시간 묶어 보기(함수별 횟수 · 평균 · 가운데 · 최대) */
function perfLog_() {
  requireAdmin_();
  var c = CacheService.getScriptCache(), ks = [];
  try { ks = JSON.parse(c.get('perf:who') || '[]'); } catch (e) { ks = []; }
  var all = [];
  ks.forEach(function (k) { try { JSON.parse(c.get('perf:' + k) || '[]').forEach(function (x) { x.who = k.split('@')[0]; all.push(x); }); } catch (e) { /* 넘어간다 */ } });
  var by = {};
  all.forEach(function (x) { (by[x.n] = by[x.n] || []).push(x.ms); });
  var rows = Object.keys(by).map(function (n) {
    var l = by[n].slice().sort(function (a, b) { return a - b; });
    return { 작업: n, 횟수: l.length, 평균ms: Math.round(l.reduce(function (a, b) { return a + b; }, 0) / l.length), 가운데ms: l[Math.floor(l.length / 2)], 최대ms: l[l.length - 1] };
  }).sort(function (a, b) { return b.평균ms - a.평균ms; });
  return { 사람: ks.map(function (k) { return k.split('@')[0]; }), 기록: all.length, 함수별: rows, 최근: all.slice(-30), _all: all };
}

/**
 * ?diag=perfwrites — 시안(사본 시트)에서만: 저장 동작을 한 번씩 해 보고 걸린 시간을 잰 뒤 시험 건을 지운다
 * (발주 DB 행 · 지급 줄 · 진행 기록 · 변경이력 · 단계이력 · 변경내역 · 입고일정/발주정보/수량단가 기록).
 */
function perfWrites_() {
  requireAdmin_();
  requireCopySS_();
  var out = [], ch = choicesOf_(null), pick = function (k) { return (ch[k] || [])[0] || ''; };
  var id = '', row = 0, expect = null, sh = statusSheet_();
  var meta = function () { return { id: id, doc: '', name: '속도 시험(지움)', batch: '1차', brand: pick('brand'), owner: '시험', code: 'ZTEST0002' }; };
  try {
    perfTime_('새 발주 등록 apiCreateOrder', function () {
      var r = apiCreateOrder({ name: '속도 시험(지움)', code: 'ZTEST0002', qty: 1000, price: 100, vendor: '시험업체', batch: '1차', cat: pick('cat'), brand: pick('brand'),
        channel: ((ch.chByBrand || {})[pick('brand')] || [pick('channel')])[0], team: pick('team'), owner: '시험', due: '2026-12-01', useBy: '2027-01-31', reqOwner: '시험', link: 'https://example.com',
        balAt: '2026-12-31', bal: 100000, cur: 'KRW' });
      id = r.id; row = r.statusRow; expect = { id: id, doc: '', code: 'ZTEST0002', name: '속도 시험(지움)', batch: '1차' };
      return r;
    }, out);
    var st = readSteps_('po'), s0 = st[0], k0 = s0 ? itemKey_(s0, 0) : 'x';
    perfTime_('체크 하나 apiSetCheck', function () { return apiSetCheck(id, meta(), k0, true, 'po'); }, out);
    perfTime_('체크 끄기 apiSetCheck', function () { return apiSetCheck(id, meta(), k0, false, 'po'); }, out);
    perfTime_('메모 apiSetNote', function () { return apiSetNote(id, meta(), s0 ? s0.id : '_memo', '속도 시험', 'po'); }, out);
    perfTime_('날짜 apiSetDate', function () { return apiSetDate(id, meta(), 'ordered', '2026-10-07', 'po'); }, out);
    perfTime_('발주 수정(단가) apiEditOrder', function () { return apiEditOrder(row, expect, { price: '110', reason: '속도 시험' }); }, out);
    perfTime_('입고 등록 apiAddInbound', function () { return apiAddInbound(row, expect, { date: '2026-10-07', qty: 400, payYm: '26-11', unit: 110, memo: '' }); }, out);
    var ls = apiGetLines(id).lines;
    perfTime_('지급 줄 표 저장 apiSaveLines', function () { return apiSaveLines(row, expect, ls.map(function (L) { return { lineId: L.lineId, kind: L.kind, date: L.date, qty: L.qty, amt: L.amt, payYm: L.payYm, memo: L.memo || '', ch: L.ch || '' }; }), ''); }, out);
    perfTime_('잔량 마감 apiCloseRemain', function () { return apiCloseRemain(row, expect, true); }, out);
    perfTime_('마감 취소 apiCloseRemain', function () { return apiCloseRemain(row, expect, false); }, out);
    perfTime_('진행상태 apiSetState', function () { return apiSetState(row, expect, '발주'); }, out);
  } catch (e) {
    out.push({ 작업: '오류', ms: 0, 비고: e.message });
  } finally {
    try {
      if (id) {
        var lock = LockService.getScriptLock(); waitLock_(lock);
        try {
          RB_COLS_MEMO = null; var C2 = sheetCols_(sh), r2 = checkStatusRow_(sh, C2, row, expect);
          sh.deleteRow(r2);
          var all = readLinesAll_(); writeLinesAll_(all.sh, all.rows.filter(function (r) { return str_(r[0]) !== id; }));
          // 장부(진행 기록 · 이력)에 아직 시트로 안 옮긴 게 있으면 먼저 옮긴다 — 지운 뒤에 다시 써지지 않게
          try { if (typeof drainJournal_ === 'function') drainJournal_(); } catch (eJ) { out.push({ 작업: '정리 경고', ms: 0, 비고: '진행 장부 옮기기 실패 ' + eJ.message }); }
          try { if (typeof drainHist_ === 'function') drainHist_(); } catch (eH) { out.push({ 작업: '정리 경고', ms: 0, 비고: '이력 장부 옮기기 실패 ' + eH.message }); }
          var nm = '속도 시험(지움)', gone = {};
          gone.진행 = perfDropRows_(RB.T_PROGRESS, 0, id);
          gone.변경이력 = perfDropRows_(RB.T_AUDIT, 4, id);
          gone.단계이력 = perfDropRows_(RB.T_STEPLOG, 2, id);
          gone.변경내역 = perfDropRows_(RB.T_CHGLOG, 2, id);
          gone.입고일정변경 = perfDropRows_(RB.T_ETALOG, 5, nm);
          gone.발주정보변경 = perfDropRows_(RB.T_INFOLOG, 5, nm);
          gone.수량단가변경 = perfDropRows_(RB.T_QPLOG, 5, nm);
        } finally { lock.releaseLock(); }
        cacheDrop_(rowsCacheKey_('po')); try { cacheDrop_(RB_LINES_CK); } catch (e3) { /* 넘어간다 */ }
        try { cacheDrop_('prog:v2:po'); cacheDrop_(progHintKey_('po')); CacheService.getScriptCache().remove(progHintKey_('po')); } catch (e4) { /* 넘어간다 */ }
        out.push({ 작업: '(정리) 시험 건 지움', ms: 0, 비고: JSON.stringify(gone) });
      }
    } catch (e2) { out.push({ 작업: '정리 오류', ms: 0, 비고: e2.message }); }
  }
  return { 측정: out, 안내: '시안 시트(사본)에서 서버 안에서만 잰 시간 — 화면 · 네트워크 왕복은 빠짐' };
}

/** 정리용: 탭에서 col(0부터) 값이 key 인 행을 지운다(아래에서 위로, 이어진 구간은 한 번에). 지운 행 수. 잠금 안에서 부른다. */
function perfDropRows_(tabName, col, key) {
  var sh = sheet_(tabName);
  if (!sh || sh.getLastRow() < 2 || !key) return 0;
  var v = sh.getRange(2, col + 1, sh.getLastRow() - 1, 1).getValues(), rows = [];
  v.forEach(function (r, i) { if (str_(r[0]) === key) rows.push(i + 2); });
  for (var k = rows.length - 1; k >= 0; ) {
    var end = rows[k], start = end;
    while (k - 1 >= 0 && rows[k - 1] === start - 1) { k--; start--; }
    sh.deleteRows(start, end - start + 1);
    k--;
  }
  return rows.length;
}
