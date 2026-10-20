/**
 * 발주 DB · 지급 줄 값 정리(2026-10-20 담당자 확인) — 1분 작업이 배포판일 때 한 번만(스크립트 속성 rb.fix1020po)
 *  · 발주 품목코드 '#N/A' 7건(품목 DB 에 없는 일회성 품목) → 빈칸 · 품목코드 앞 탭 문자 2건 → 지움
 *  · 지급 줄 입고일이 숫자 2 로 들어간 2건(바이오에프티 · 지급월 26-03) → 2026-02-11(발주 입고일정)
 * 실행판ID · 줄ID 와 지금 값이 둘 다 맞는 칸만 고친다(그사이 누가 고쳤으면 건드리지 않음).
 */
var RB_FIX1020_PO = [
  { id: 'hdnew459501차|#n/a', from: '#N/A', to: '' },
  { id: 'mtb2c461001차|#n/a', from: '#N/A', to: '' },
  { id: 'mtb2c461061차|#n/a', from: '#N/A', to: '' },
  { id: 'mtb2c46175일회성일회성|#n/a|n:아다피노이스스팟트리트먼트재작업', from: '#N/A', to: '' },
  { id: 'mtb2c46175일회성일회성|#n/a|n:아다피노이스스팟트리트먼트삽지', from: '#N/A', to: '' },
  { id: 'hdnew46182p0279ms011차|#n/a', from: '#N/A', to: '' },
  { id: 'mtb2c46199|#n/a', from: '#N/A', to: '' },
  { id: 'mtb2b-20261130-02|m0043aa1', from: '\tM0043AA1', to: 'M0043AA1' },
  { id: 'hdrun-20261231-01|h0053aa1', from: '\tH0053AA1', to: 'H0053AA1' }
];
var RB_FIX1020_LINES = [
  { lineId: 'mtb2c460421차|m0150jp1-002', from: 2, to: '2026-02-11' },
  { lineId: 'mtb2c460421차|m0195jp1-002', from: 2, to: '2026-02-11' }
];
function dataFix1020po_() {
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var nPo = 0, nLn = 0, hist = [], miss = [];
  try {
    var sh = statusSheet_(), C = sheetCols_(sh), kc = statusKeyCols_(sh, C.hr), cCode = colIdx_(C.idx, ['품목코드']), cName = colIdx_(C.idx, ['품목명']);
    var n = sh.getLastRow() - C.hr;
    if (kc.id >= 0 && cCode >= 0 && n > 0) {
      var ids = sh.getRange(C.hr + 1, kc.id + 1, n, 1).getValues(), codes = sh.getRange(C.hr + 1, cCode + 1, n, 1).getValues();
      var names = cName >= 0 ? sh.getRange(C.hr + 1, cName + 1, n, 1).getValues() : null;
      RB_FIX1020_PO.forEach(function (f) {
        for (var i = 0; i < n; i++) {
          if (String(ids[i][0]) !== f.id) continue;
          var cur = String(codes[i][0]);
          if (cur.trim().toUpperCase() !== f.from.trim().toUpperCase() || (f.from.charAt(0) === '\t' && cur.charAt(0) !== '\t')) { miss.push(f.id); return; }
          sh.getRange(C.hr + 1 + i, cCode + 1).setValue(f.to);
          nPo++;
          hist.push({ kind: '정정', id: f.id, code: f.to, name: names ? String(names[i][0]) : '', item: '품목코드', before: cur.replace(/\t/g, '(탭)'), after: f.to || '(빈칸)',
            where: RB.STATUS_TAB + ' ' + (C.hr + 1 + i) + '행 · 담당자 확인 10/20' });
          return;
        }
        miss.push(f.id + '(없음)');
      });
    }
    var lsh = sheet_(RB_LINE.TAB), lr = lsh.getLastRow();
    if (lr >= 2) {
      var lv = lsh.getRange(2, 1, lr - 1, 4).getValues();          // 실행판ID · 줄ID · 종류 · 입고일
      RB_FIX1020_LINES.forEach(function (f) {
        for (var j = 0; j < lv.length; j++) {
          if (String(lv[j][1]) !== f.lineId) continue;
          if (Number(lv[j][3]) !== f.from || lv[j][3] instanceof Date) { miss.push(f.lineId); return; }
          var p = f.to.split('-');
          lsh.getRange(j + 2, 4).setValue(new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
          nLn++;
          hist.push({ kind: '입고', id: String(lv[j][0]), item: '지급 줄 입고일', before: String(f.from), after: f.to, where: RB_LINE.TAB + ' ' + (j + 2) + '행 · 담당자 확인 10/20' });
          return;
        }
        miss.push(f.lineId + '(없음)');
      });
    }
  } finally { lock.releaseLock(); }
  try { appendHist_(hist); } catch (eH) { /* 이력은 실패해도 된다 */ }
  try { cacheDrop_(rowsCacheKey_('po')); } catch (eC) { /* 넘어간다 */ }
  try { if (nLn) apRebuildSoon_(); } catch (eA) { /* 20시에 */ }
  return '발주 ' + nPo + ' · 지급 줄 ' + nLn + (miss.length ? ' · 건너뜀 ' + miss.join(', ') : '');
}
