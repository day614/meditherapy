/**
 * 1회(2026-10-20): _실행판_샘플 날짜 칸(요청일 · 전달예정일 · 전달일 · 견적수신일)에 글자로 들어간 날짜(예: '2026. 10 6')를 날짜 값으로.
 * 읽을 수 있는 것만 바꾸고 나머지는 그대로. 반환: 바꾼 칸 수
 */
function sampleDateFix_() {
  var sh = sheet_(RB.SAMPLE_TAB);
  if (!sh || sh.getLastRow() < 2) return 0;
  var lock = LockService.getScriptLock(); waitLock_(lock);
  var n = 0, hist = [];
  try {
    var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(function (h) { return str_(h); });
    ['요청일', '전달예정일', '전달일', '견적수신일'].forEach(function (name) {
      var c = head.indexOf(name);
      if (c < 0) return;
      var rg = sh.getRange(2, c + 1, sh.getLastRow() - 1, 1), v = rg.getValues(), cells = {};
      v.forEach(function (r, i) {
        var x = r[0];
        if (x instanceof Date || typeof x !== 'string' || !str_(x)) return;
        var d = toDate_(x);
        if (!d) return;
        cells[i + 2] = d; n++;
        hist.push({ kind: '샘플', item: name, before: x, after: Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd'), where: RB.SAMPLE_TAB + ' ' + (i + 2) + '행', reason: '글자로 들어간 날짜를 날짜 값으로' });
      });
      if (Object.keys(cells).length) setColCells_(sh, c + 1, cells);
    });
    SpreadsheetApp.flush();
  } finally { lock.releaseLock(); }
  try { if (hist.length) appendHist_(hist); } catch (e) { /* 넘어간다 */ }
  if (n) { try { cacheDrop_(rowsCacheKey_('sample')); } catch (e) { /* 넘어간다 */ } }
  return n;
}
