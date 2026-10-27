/**
 * 전환 뒤 교차 확인(읽기만). ?diag=verify
 *  1) 설정 · 트리거 · 탭    2) 발주 DB(ID 중복 · 빈 ID · 오류 칸)
 *  3) 지급 줄(고아 줄 · 줄ID 중복 · 지급월 형식)
 *  4) AP 탭 ↔ 지급 줄로 지금 다시 만든 AP    5) 금액 합계 · 채널별 · 구분별
 *  6) 발주 DB(_실행판_발주) ↔ 예전 발주현황 — 실행판ID 로 짝지어 한쪽에만 있는 건 · 다른 칸(이관 확인 ·
 *     이관과 배포 사이에 예전 버전이 발주현황에 쓴 건 찾기)
 */
/** 확인에서 빼는 칸: 품목코드가 원래 없는 일회성 · 비용 처리 과거 건(종결). 사용자 확인 2026-10-02 — 무시하기로 */
var RB_KNOWN_NA = ['hdnew459501차|#n/a', 'mtb2c461001차|#n/a', 'mtb2c461061차|#n/a',
  'mtb2c46175일회성일회성|#n/a|n:아다피노이스스팟트리트먼트재작업', 'mtb2c46175일회성일회성|#n/a|n:아다피노이스스팟트리트먼트삽지',
  'hdnew46182p0279ms011차|#n/a', 'mtb2c46199|#n/a'];

function verifyAll_() {
  var ss = ss_();
  var tz = Session.getScriptTimeZone();
  var cfg = readConfig_();
  var out = {};
  var norm = function (v) {
    if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    if (typeof v === 'number') return String(Math.round(v * 100) / 100);
    return String(v == null ? '' : v).trim();
  };

  // 1) 설정 · 탭
  var names = ss.getSheets().map(function (s) { return s.getName(); });
  var lastRun = null;
  try { lastRun = JSON.parse(cfg['ap.lastRun'] || 'null'); } catch (e) { lastRun = null; }
  out['1_설정'] = {
    지급줄전환: cfg['lines.on'] || 'N', AP만드는곳: cfg['ap.source'] || 'sheet', 트리거20시: apTriggerOn_(),
    마지막AP: lastRun,
    남아있으면안되는탭: [RB.PLAN_TAB, RB_KEY.T_EXTRA].filter(function (n) { return names.indexOf(n) > -1; }),
    탭수: names.length, 탭: names
  };

  // 2) 발주 DB
  var sh = statusSheet_();
  var C = sheetCols_(sh);
  var kc = statusKeyCols_(sh, C.hr);
  var n = sh.getLastRow() - C.hr;
  var vals = sh.getRange(C.hr + 1, 1, n, C.lc).getValues();
  var disp = sh.getRange(C.hr + 1, 1, n, C.lc).getDisplayValues();
  var ids = {}, dupId = [], noId = 0, errCells = [];
  vals.forEach(function (r, i) {
    var id = kc.id >= 0 ? str_(r[kc.id]) : '';
    var filled = r.some(function (x) { return str_(x) !== ''; });
    if (!filled) return;
    if (!id) noId++;
    else if (ids[id]) dupId.push(id); else ids[id] = C.hr + 1 + i;
    if (RB_KNOWN_NA.indexOf(id) > -1) return;             // 무시하기로 한 과거 일회성 건
    disp[i].forEach(function (d, j) {
      if (/^#(REF!|N\/A|VALUE!|ERROR!|DIV\/0!|NAME\?)/.test(d) && errCells.length < 30) errCells.push(colLetterRB_(j + 1) + (C.hr + 1 + i) + ' ' + str_(C.head[j]) + '=' + d);
    });
  });
  out['2_발주DB'] = { 건수: Object.keys(ids).length, 실행판ID없는행: noId, ID중복: dupId, 오류칸: errCells };

  // 3) 지급 줄
  var lines = readLinesAll_().rows.map(rowToLine_);
  var kinds = {}, orphan = [], seenLine = {}, dupLine = [], badYm = [], badAmt = [];
  lines.forEach(function (L) {
    kinds[L.kind] = (kinds[L.kind] || 0) + 1;
    if (!ids[L.id] && orphan.length < 20) orphan.push(L.id + ' ' + L.lineId);
    if (seenLine[L.lineId]) dupLine.push(L.lineId); else seenLine[L.lineId] = 1;
    if (L.kind !== '지급월 없음' && L.payYm && !/^\d{2}-\d{2}$/.test(L.payYm)) badYm.push(L.lineId + ' ' + L.payYm);
    if (L.amt !== '' && isNaN(Number(L.amt))) badAmt.push(L.lineId + ' ' + L.amt);
  });
  out['3_지급줄'] = { 줄수: lines.length, 종류별: kinds, DB에없는건의줄: orphan, 줄ID중복: dupLine.slice(0, 20), 지급월형식오류: badYm.slice(0, 20), 금액오류: badAmt.slice(0, 20) };

  // 4) AP 탭 ↔ 지급 줄로 다시 만든 AP
  var attrs = orderAttrsForAp_(ss);
  var rebuilt = apFromLines_(lines, attrs).map(function (r) { return r.slice(0, 18).map(norm); });
  var dest = RB_AP.sheetByGid(ss, RB_AP.destGid);
  var apN = Math.max(0, dest.getLastRow() - 1);
  var apVals = apN ? dest.getRange(2, 1, apN, 21).getValues() : [];
  var apHead = dest.getRange(1, 1, 1, 21).getValues()[0].map(str_);
  var apRows = apVals.filter(function (r) { return r.slice(0, 18).some(function (x) { return str_(x) !== ''; }); });
  var apNorm = apRows.map(function (r) { return r.slice(0, 18).map(norm); });
  var show = function (r) { return [r[0], r[1], r[4], r[6], r[7], r[8], r[11], r[13]].join(' | '); };
  out['4_AP탭_vs_지급줄재계산'] = bagDiff_(apNorm.map(function (r) { return r.join('|'); }), rebuilt.map(function (r) { return r.join('|'); }), 'AP탭', '재계산', function (k) { return show(k.split('|')); });
  out['4_AP탭_vs_지급줄재계산'].AP머리글 = apHead;

  // 5) 금액: 합계 · 지급월별 차이 · 채널별(매입예산) · 구분(E열)
  var sumBy = function (rows, col) {
    var m = {};
    rows.forEach(function (r) { var k = String(r[col] || ''), a = Number(String(r[11]).replace(/,/g, '')) || 0; if (k) m[k] = (m[k] || 0) + a; });
    return m;
  };
  var a1 = sumBy(apNorm, 13), a2 = sumBy(rebuilt, 13);
  var yms = Object.keys(a1).concat(Object.keys(a2)).filter(function (x, i, arr) { return arr.indexOf(x) === i; }).sort();
  var diffs = yms.filter(function (y) { return Math.round(a1[y] || 0) !== Math.round(a2[y] || 0); })
    .map(function (y) { return y + ' AP ' + Math.round(a1[y] || 0) + ' / 재계산 ' + Math.round(a2[y] || 0); });
  var tot = function (m) { return Math.round(Object.keys(m).reduce(function (s, k) { return s + m[k]; }, 0)); };
  var byCh = sumBy(apNorm, 3);
  Object.keys(byCh).forEach(function (k) { byCh[k] = Math.round(byCh[k]); });
  var eCnt = {};
  apNorm.forEach(function (r) { eCnt[r[4]] = (eCnt[r[4]] || 0) + 1; });
  out['5_금액'] = { AP합계: tot(a1), 재계산합계: tot(a2), 지급월별다른곳: diffs, 채널별합계: byCh, AP_E열: eCnt };

  // 6) 발주 DB ↔ 예전 발주현황
  try { out['6_발주현황대비'] = verifyVsLegacy_(sh, C, vals, norm); } catch (e) { out['6_발주현황대비'] = { 오류: e.message }; }
  return out;
}

/** 발주 DB 와 예전 발주현황을 실행판ID 로 짝지어 옮긴 열을 비교한다(첫 20개씩). */
function verifyVsLegacy_(sh, C, vals, norm) {
  var P = dbMigratePlan_();                          // 발주현황을 발주 DB 열 순서로 읽은 값
  var names = P.cols.map(function (c) { return c.h; });
  var iId = names.indexOf('실행판ID');
  var dbCol = names.map(function (h) {
    for (var j = 0; j < C.head.length; j++) if (String(C.head[j] == null ? '' : C.head[j]).trim() === h) return j;
    return -1;
  });
  var legacy = {}, db = {}, legacyNoId = 0, dbNoId = 0;
  P.vals.forEach(function (r, i) {
    var id = str_(r[iId]);
    if (!id) { legacyNoId++; return; }
    if (!legacy[id]) legacy[id] = { row: P.srcRows[i], v: r };
  });
  vals.forEach(function (r, i) {
    var id = dbCol[iId] >= 0 ? str_(r[dbCol[iId]]) : '';
    if (!id) { if (r.some(function (x) { return str_(x) !== ''; })) dbNoId++; return; }
    if (!db[id]) db[id] = { row: C.hr + 1 + i, v: r };
  });
  var onlyLegacy = [], onlyDb = [], diffs = [], nDiff = 0;
  Object.keys(legacy).forEach(function (id) {
    if (!db[id]) { onlyLegacy.push(id + ' (발주현황 ' + legacy[id].row + '행 ' + str_(legacy[id].v[names.indexOf('품목명')]) + ')'); return; }
    names.forEach(function (h, j) {
      if (dbCol[j] < 0) return;
      var a = norm(legacy[id].v[j]), b = norm(db[id].v[dbCol[j]]);
      if (a === b) return;
      nDiff++;
      if (diffs.length < 20) diffs.push(id + ' [' + h + '] 발주현황 ' + legacy[id].row + '행=' + a + ' / 발주 DB ' + db[id].row + '행=' + b);
    });
  });
  Object.keys(db).forEach(function (id) { if (!legacy[id]) onlyDb.push(id + ' (발주 DB ' + db[id].row + '행)'); });
  return {
    발주현황건수: Object.keys(legacy).length, 발주DB건수: Object.keys(db).length,
    발주현황에만: onlyLegacy.length, 발주현황에만_예: onlyLegacy.slice(0, 20),
    발주DB에만: onlyDb.length, 발주DB에만_예: onlyDb.slice(0, 20),
    다른칸: nDiff, 다른칸_예: diffs,
    ID없는행: { 발주현황: legacyNoId, 발주DB: dbNoId },
    발주DB에없는열: names.filter(function (h, j) { return dbCol[j] < 0; }),
    이관시각: String(readConfig_()['db.migratedAt'] || '')
  };
}

/** 두 목록을 '같은 줄 여러 개'까지 맞춰 비교 */
function bagDiff_(a, b, an, bn, fmt) {
  var bag = {};
  b.forEach(function (k) { bag[k] = (bag[k] || 0) + 1; });
  var onlyA = [];
  a.forEach(function (k) { if (bag[k]) bag[k]--; else onlyA.push(k); });
  var onlyB = [];
  Object.keys(bag).forEach(function (k) { for (var i = 0; i < bag[k]; i++) onlyB.push(k); });
  var f = fmt || function (k) { return k; };
  var o = {};
  o[an] = a.length; o[bn] = b.length; o.같음 = a.length - onlyA.length;
  o[an + '에만'] = onlyA.length; o[bn + '에만'] = onlyB.length;
  o[an + '에만_예'] = onlyA.slice(0, 12).map(f); o[bn + '에만_예'] = onlyB.slice(0, 12).map(f);
  return o;
}

/** ?diag=prog&id= — 한 건의 진행 기록(체크 · 날짜) */
function diagProg_(id) {
  var p = readProgress_('po');
  var rec = findProg_(p, id);
  if (!rec) return { err: '진행 기록 없음 ' + id };
  return { 행: rec.row, 체크: rec.checks, 날짜: rec.dates };
}

/** ?diag=hist&q=낱말 — 변경이력에서 낱말이 든 최근 줄 */
function diagHist_(q) {
  var sh = sheet_(RB.T_AUDIT);
  if (!sh || sh.getLastRow() < 2) return [];          // 탭이 없거나 머리글만 있으면 빈 결과(예전: 0행 범위 오류)
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, RB.HIST_HEAD.length).getDisplayValues();
  var hits = v.filter(function (r) { return r.join(' ').indexOf(q) > -1; });
  return hits.slice(-20).map(function (r) { return [r[0], r[1].split('@')[0], r[3], r[7], r[8], r[10]].join(' | '); });
}
