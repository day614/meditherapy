/**
 * 발주일 지킴(2026-10-21) — 실행판에서 저장한 발주일이 곧 빈칸이 되는 일이 있었다(649행 7번 · 655행 1번: 저장 기록은 남는데 칸은 비어 있음).
 * 실행판 코드에는 그 칸을 기록 없이 지우는 곳이 없어, 저장 뒤 확인 + 1분마다 지켜보다 지워졌으면 되살리고 언제 지워졌는지 남긴다.
 *  · rb.ordguard  = { 실행판ID: { v: 'yy/MM/dd', at: 저장 시각(ms), who } } — 3일 지켜본다
 *  · rb.ordwipe   = [ { id, row, v, wipedBy: 처음 빈칸을 본 시각, savedAt } ] — 최근 30건(원인 찾기용)
 */
var RB_ORDG_PROP = 'rb.ordguard', RB_ORDG_WIPE = 'rb.ordwipe', RB_ORDG_DAYS = 3;

function ordGuardRead_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(RB_ORDG_PROP) || '{}') || {}; } catch (e) { return {}; } }
function ordGuardWrite_(o) {
  var cut = Date.now() - RB_ORDG_DAYS * 864e5, P = PropertiesService.getScriptProperties();
  Object.keys(o).forEach(function (k) { if (!(o[k] && o[k].at > cut)) delete o[k]; });
  if (Object.keys(o).length) P.setProperty(RB_ORDG_PROP, JSON.stringify(o)); else P.deleteProperty(RB_ORDG_PROP);
}

/** apiWriteSheet 가 발주일을 쓴 직후(잠금 안): 반영 → 다시 읽어 비었으면 저장 실패로 알린다 · 지켜볼 목록에 넣는다 */
function ordGuardAfterWrite_(sh, row, cId, items) {
  var it = (items || []).filter(function (x) { return x.name === '발주일'; })[0];
  if (!it) return;
  SpreadsheetApp.flush();
  var got = sh.getRange(row, it.col + 1).getValue();
  if (got === '' || got == null) throw new Error('발주일이 시트에 들어가지 않았습니다(' + row + '행) — 다시 저장해 주세요. 계속되면 관리자에게 알려 주세요.');
  var id = cId >= 0 ? str_(sh.getRange(row, cId + 1).getValue()) : '';
  if (!id) return;
  var o = ordGuardRead_(), who = '';
  try { who = me_(); } catch (e) { who = ''; }
  o[id] = { v: str_(it.after), at: Date.now(), who: who };
  ordGuardWrite_(o);
}

/** 실행판에서 발주일을 지웠으면 지킴 목록에서 뺀다 */
function ordGuardForget_(sh, row, cId) {
  var id = cId >= 0 ? str_(sh.getRange(row, cId + 1).getValue()) : '';
  var o = ordGuardRead_();
  if (id && o[id]) { delete o[id]; ordGuardWrite_(o); }
}

/** 1분 작업(journalDrain): 지켜보는 건의 발주일이 비었으면 마지막 저장값으로 되살리고 기록 */
function ordGuardCheck_() {
  var o = ordGuardRead_(), ids = Object.keys(o);
  if (!ids.length) { ordGuardWrite_(o); return 0; }
  var sh = statusSheet_(), C = sheetCols_(sh), cOrd = colIdx_(C.idx, ['발주일']);
  if (cOrd < 0) return 0;
  var ix = statusIdIndex_(sh, C), fixed = [];
  ids.forEach(function (id) {
    var rows = ix.map[id] || [];
    if (rows.length !== 1) return;
    var cell = sh.getRange(rows[0], cOrd + 1), v = cell.getValue();
    if (v !== '' && v != null) return;
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return;
    try {
      if (str_(cell.getValue()) !== '') return;
      var d = toDate_(o[id].v);
      cell.setValue(d || asText_(o[id].v));
      fixed.push({ id: id, row: rows[0], v: o[id].v, savedAt: new Date(o[id].at).toISOString(), wipedBy: new Date().toISOString(), who: o[id].who });
      writeAudits_([{ tab: RB.STATUS_TAB, row: rows[0], col: cOrd + 1, what: '발주일 되살림(저장 뒤 빈칸이 됨 — 실행판 기록 밖에서 지워짐)', before: '', after: o[id].v }]);
    } finally { lock.releaseLock(); }
  });
  if (fixed.length) {
    var P = PropertiesService.getScriptProperties(), w = [];
    try { w = JSON.parse(P.getProperty(RB_ORDG_WIPE) || '[]') || []; } catch (e) { w = []; }
    P.setProperty(RB_ORDG_WIPE, JSON.stringify(w.concat(fixed).slice(-30)));
    try { console.warn('발주일 되살림 ' + JSON.stringify(fixed)); } catch (e2) { /* 넘어간다 */ }
    cacheDrop_(rowsCacheKey_('po'));
    try { bumpVer_('r'); } catch (eV) { /* 넘어간다 */ }
  }
  ordGuardWrite_(o);
  return fixed.length;
}

/** 한 번만(10/21): 지워진 발주일 되살림 — 649행 MP0129BO2 14차(마지막 저장 26/10/12) · 655행 HP0079OB1 1차(26/10/13). 지금도 비어 있을 때만 */
function ordRestore1021_() {
  var o = ordGuardRead_(), now = Date.now();
  [['RB261002-42AC3B', '26/10/12'], ['RB261013-D8B4E4', '26/10/13']].forEach(function (x) { if (!o[x[0]]) o[x[0]] = { v: x[1], at: now, who: '되살림 10/21' }; });
  ordGuardWrite_(o);
  return ordGuardCheck_();
}
