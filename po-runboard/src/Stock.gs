/**
 * 재고시트 입고예정 대조(읽기만)
 * ------------------------------------------------------------
 * 메디 · 히디프 재고시트의 품목별 입고예정(날짜 칸마다 수량)을 읽어 화면에 준다. 화면이 실행판 예정 줄(같은 품목코드 발주들의 합)과
 * 날짜 · 수량을 맞대어, 다르면 목록 입고예정 글자를 빨갛게 · [재고시트 상이] 버튼으로 거른다.
 *  · 메디: 2행 = 날짜(01/01 ~), 1행 I칸 = 연도, C열 마스터코드, G열 '입고 예정' 행
 *  · 히디프: 2행 = 날짜(01/01 ~, 1행은 빈 줄), C열 마스터코드, G열 'RTF(구매팀)' 행(연도 칸이 없어 올해로 본다)
 * 오늘부터 연말까지만 본다(시트가 한 해 단위). 일본 코드(..JP1)는 보지 않는다. 시트는 고치지 않는다. 30분 캐시.
 */
var RB_STOCK_SRC = [
  { brand: '메디', ss: '1dD0MHMVBxFN0efhT-MLe7oeww_n8NqJCARH3PLMnm-A', gid: 1047430116, dateRow: 2, yearRow: 1, codeCol: 3, kindCol: 7, kind: '입고 예정', blockKind: '일 평균', firstCol: 9 },
  { brand: '히디프', ss: '1yLf66PpjP9IXgvq6Era7RoNWioaGCB10ZoE3kgSJrgs', gid: 963391381, dateRow: 2, yearRow: 0, codeCol: 3, kindCol: 7, kind: 'RTF(구매팀)', blockKind: '수요예측_물류팀', firstCol: 9 }
];
var RB_STOCK_CK = 'stock:plan:v3';

function stockPlanOf_(src, today) {
  var ss = SpreadsheetApp.openById(src.ss), sh = ss.getSheets().filter(function (x) { return x.getSheetId() === src.gid; })[0];
  if (!sh) throw new Error(src.brand + ' 재고시트 탭을 찾지 못했습니다.');
  var lr = sh.getLastRow(), lc = sh.getLastColumn();
  var head = sh.getRange(src.dateRow, 1, 1, lc).getDisplayValues()[0];
  var year = today.getFullYear();
  if (src.yearRow) { var yv = sh.getRange(src.yearRow, src.firstCol).getDisplayValue(); if (/^\d{4}$/.test(String(yv).trim())) year = Number(yv); }
  if (year !== today.getFullYear()) return { year: year, plan: {}, note: src.brand + ' 재고시트가 ' + year + '년 시트라 올해와 맞대지 않습니다' };
  var mmdd = Utilities.formatDate(today, Session.getScriptTimeZone(), 'MM/dd');
  var c0 = -1;
  for (var j = src.firstCol - 1; j < head.length; j++) { if (/^\d{2}\/\d{2}$/.test(String(head[j]).trim()) && String(head[j]).trim() >= mmdd) { c0 = j; break; } }
  var codes = sh.getRange(1, src.codeCol, lr, 1).getValues(), kinds = sh.getRange(1, src.kindCol, lr, 1).getDisplayValues();
  var plan = {};
  var rows = [];
  // 품목코드 칸은 품목 묶음마다 세로로 병합돼 있고, 병합에 가려진 아래 줄에는 옛 코드가 남아 있을 수 있다(예: 묶음은 HX0065AA1, 숨은 칸은 H0076AA1).
  // 그래서 줄마다 C열을 읽지 않고, 묶음 첫 줄(blockKind)의 코드를 그 묶음 전체의 코드로 쓴다 — 화면에 보이는 그대로.
  var cur = '';
  for (var i = 0; i < lr; i++) {
    var kd = String(kinds[i][0]).trim();
    if (kd === src.blockKind) cur = str_(codes[i][0]).toUpperCase().replace(/\s/g, '');
    if (!cur || !/^[A-Z]X?\d{4}[A-Z]{2}\d+$/.test(cur) || /JP\d+$/.test(cur)) continue;      // 일본 코드는 보지 않는다
    if (!plan[cur]) plan[cur] = {};
    if (kd === src.kind) rows.push({ i: i, code: cur });
  }
  if (c0 >= 0 && rows.length) {
    var w = head.length - c0, block = sh.getRange(1, c0 + 1, lr, w).getValues();
    rows.forEach(function (x) {
      var r = block[x.i], m = plan[x.code];
      for (var k = 0; k < w; k++) {
        var v = Number(String(r[k] == null ? '' : r[k]).replace(/[, ]/g, '')) || 0, d = String(head[c0 + k]).trim();
        if (v && /^\d{2}\/\d{2}$/.test(d)) m[d] = (m[d] || 0) + v;
      }
    });
  }
  return { year: year, plan: plan };
}

/**
 * 화면: 재고시트 입고예정 { at, year, today('MM/dd'), plan: { 품목코드: { 'MM/dd': 수량 } }, notes } — 30분 캐시.
 * 두 재고시트를 읽는 데 30초 넘게 걸려서, 10분 작업(warmStock_)이 미리 읽어 둔다. 화면은 캐시만 받는다(없으면 빈 값 · 다음에 다시).
 */
function apiStockPlan(force) {
  // 새로 읽기(30초 넘게 · 외부 시트 두 개)는 저장 권한이 있는 사람만. 아니면 캐시 값만 준다.
  if (force && !canEdit_()) force = false;
  if (!force) {
    var hit = cacheGet_(RB_STOCK_CK); if (hit) return hit;
    return { pending: true, plan: {}, notes: ['재고시트를 읽는 중입니다(1~2분 뒤 자동으로 보입니다)'] };
  }
  return stockPlanBuild_();
}
/**
 * 10분 작업에서: 캐시가 없거나 25분 지났으면 다시 읽는다(한 번에 하나만).
 * '하는 중' 표시는 스크립트 잠금을 짧게(2초) 잡고 확인 · 표시를 한 번에 한다 — 예전에는 캐시 확인과 표시 사이에
 * 다른 실행이 끼어 두 번 읽을 수 있었다. 읽는 30초 동안은 잠금을 쥐지 않는다(남의 저장을 막지 않게).
 */
function warmStock_() {
  try {
    var c = CacheService.getScriptCache(), at = Number(c.get('stock:at') || 0);
    if (at && Date.now() - at < 25 * 60000 && cacheGet_(RB_STOCK_CK)) return;
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(2000)) return;                 // 다음 차례에
    try {
      if (c.get('stock:busy')) return;
      c.put('stock:busy', '1', 300);
    } finally { lock.releaseLock(); }
    try { stockPlanBuild_(); c.put('stock:at', String(Date.now()), 3600); } finally { c.remove('stock:busy'); }
  } catch (e) { try { console.log('warmStock 실패: ' + e.message); } catch (e2) { /* 넘어간다 */ } }
}
function stockPlanBuild_() {
  var today = new Date(), out = { at: fmtDate_(today) + ' ' + Utilities.formatDate(today, Session.getScriptTimeZone(), 'HH:mm'), year: today.getFullYear(),
    today: Utilities.formatDate(today, Session.getScriptTimeZone(), 'MM/dd'), plan: {}, notes: [] };
  RB_STOCK_SRC.forEach(function (src) {
    try {
      var r = stockPlanOf_(src, today);
      Object.keys(r.plan).forEach(function (c) { out.plan[c] = r.plan[c]; });
      if (r.note) out.notes.push(r.note);
    } catch (e) { out.notes.push(src.brand + ' 재고시트를 읽지 못했습니다: ' + e.message); }
  });
  try { cachePut_(RB_STOCK_CK, out, 3600); } catch (e) { /* 크면 넘어간다 */ }
  return out;
}
