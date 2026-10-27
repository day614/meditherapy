/**
 * ============================================================
 * 일일보고(2026-10-27) — 주간보고 계산(apiWeeklyReport)을 하루로 돌린 보고서. 날짜마다 _실행판_일일보고 탭에 그날 보고서를 남겨
 * 날짜를 고르면 그날 상태 그대로 다시 본다(지연 · 대기 같은 '그때 상태'는 지나면 다시 계산해도 같지 않다).
 *  · 오늘 보고서는 열 때마다 저장(덮어씀) · 18시 넘으면 1분 작업이 하루 한 번 저장
 *  · 지난 날짜에 저장본이 없으면 지금 기록으로 다시 계산해 보여 준다([이 날짜로 저장] 가능)
 *  · 병목 · 이슈는 화면에서 적어 날짜별로 저장(엑셀에도)
 * ============================================================
 */
var RB_DAILY_TAB = '_실행판_일일보고';
var RB_DAILY_HEAD = ['날짜', '저장 시각', '저장자', '병목·이슈(JSON)', '보고서1', '보고서2', '보고서3', '보고서4', '보고서5', '보고서6', '보고서7', '보고서8'];
var RB_DAILY_CHUNK = 45000;

function dailyToday_() { return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd'); }
function dailyOkDate_(d) { return /^\d{4}-\d{2}-\d{2}$/.test(str_(d)) ? str_(d) : ''; }
function dailyTab_() { return tab_(RB_DAILY_TAB, RB_DAILY_HEAD); }
function dailyCell_(v) { return v instanceof Date ? Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd') : str_(v).replace(/^'/, ''); }
function dailyFind_(sh, date) {
  var n = sh.getLastRow() - 1; if (n < 1) return 0;
  var v = sh.getRange(2, 1, n, 1).getValues();
  for (var i = 0; i < v.length; i++) if (dailyCell_(v[i][0]) === date) return i + 2;
  return 0;
}
/** 보고서 글자: '이번 주' → '당일', '다음 주' → '향후 7일' (표 제목 · 칸 이름 · 요약만 — 내용 칸은 그대로) */
function dailyRelabel_(r) {
  var f = function (t) { return str_(t).replace(/이번 주/g, '당일').replace(/다음 주 예정/g, '향후 7일 예정').replace(/다음 주/g, '향후 7일').replace(/주간/g, '일일'); };
  (r.summary.kpi || []).forEach(function (k) { k.label = f(k.label); k.sub = f(k.sub); });
  var fixT = function (it) { it.t = f(it.t); it.cols = (it.cols || []).map(f); };
  (r.summary.tables || []).forEach(fixT);
  (r.parts || []).forEach(function (p) { p.h = f(p.h); if (p.note) p.note = f(p.note); (p.subs || []).forEach(function (s) { s.t = f(s.t); (s.items || []).forEach(fixT); }); });
  r.daily = 1;
  return r;
}
function dailyCompute_(date) { return dailyRelabel_(apiWeeklyReport(date, date, 'day')); }
function dailyRead_(sh, at) {
  var v = sh.getRange(at, 1, 1, RB_DAILY_HEAD.length).getValues()[0], js = '';
  for (var i = 4; i < v.length; i++) js += str_(v[i]);
  var rep = null, issues = [];
  try { rep = JSON.parse(js); } catch (e) { rep = null; }
  try { issues = JSON.parse(str_(v[3]) || '[]'); } catch (e2) { issues = []; }
  return { date: dailyCell_(v[0]), savedAt: str_(v[1]), savedBy: str_(v[2]), rep: rep, issues: Array.isArray(issues) ? issues : [] };
}
function dailyWrite_(date, rep, issues, who) {
  var sh = dailyTab_(), lock = LockService.getScriptLock(); waitLock_(lock);
  try {
    var at = dailyFind_(sh, date) || (sh.getLastRow() + 1);
    var js = rep ? JSON.stringify(rep) : '', parts = [];
    for (var i = 0; i < 8; i++) parts.push(js.substr(i * RB_DAILY_CHUNK, RB_DAILY_CHUNK));
    if (js.length > 8 * RB_DAILY_CHUNK) throw new Error('보고서가 너무 커서 저장하지 못했습니다.');
    var row = ["'" + date, Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'), who || me_().split('@')[0], JSON.stringify(issues || [])].concat(parts);
    if (!rep) { var old = dailyFind_(sh, date) ? sh.getRange(at, 5, 1, 8).getValues()[0] : parts; row = row.slice(0, 4).concat(old); }
    ensureRows_(sh, at);
    sh.getRange(at, 1, 1, RB_DAILY_HEAD.length).setValues([row]);
  } finally { lock.releaseLock(); }
}

/** 화면: 그날 보고서 { date, saved, savedAt, savedBy, recomputed, rep, issues } — refresh = 지금 기록으로 다시 계산해 저장 */
function apiDailyReport(date, refresh) {
  var today = dailyToday_(); date = dailyOkDate_(date) || today;
  if (date > today) throw new Error('앞으로의 날짜는 볼 수 없습니다.');
  var sh = dailyTab_(), at = dailyFind_(sh, date), old = at ? dailyRead_(sh, at) : null;
  if (old && old.rep && !refresh && date !== today) return { date: date, saved: true, savedAt: old.savedAt, savedBy: old.savedBy, rep: old.rep, issues: old.issues };
  var rep = dailyCompute_(date), issues = old ? old.issues : [];
  if (date === today || refresh) {
    if (canEdit_()) { dailyWrite_(date, rep, issues); return { date: date, saved: true, savedAt: Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'), savedBy: me_().split('@')[0], rep: rep, issues: issues, live: date === today }; }
  }
  return { date: date, saved: false, recomputed: true, rep: rep, issues: issues };
}
/** 화면: 병목 · 이슈(직접 작성) 저장 — rows = [[구분, 이슈 내용, 품목 · 업체, 원인, 대응 방안, 해결 예정일, 담당], …] */
function apiDailyIssues(date, rows) {
  requireEditor_();
  date = dailyOkDate_(date); if (!date) throw new Error('날짜가 없습니다.');
  var clean = (rows || []).map(function (r) { return (r || []).slice(0, 7).map(function (x) { return str_(x).slice(0, 500); }); }).filter(function (r) { return r.some(function (x) { return x; }); }).slice(0, 50);
  var sh = dailyTab_(), at = dailyFind_(sh, date);
  if (!at) dailyWrite_(date, dailyCompute_(date), clean); else dailyWrite_(date, null, clean);
  return { issues: clean };
}
/** 화면: 저장된 날짜 목록(최근 순) */
function apiDailyList() {
  var sh = dailyTab_(), n = sh.getLastRow() - 1; if (n < 1) return [];
  var v = sh.getRange(2, 1, n, 4).getValues();
  return v.map(function (r) { var is = []; try { is = JSON.parse(str_(r[3]) || '[]'); } catch (e) { is = []; } return { date: dailyCell_(r[0]), savedAt: str_(r[1]), savedBy: str_(r[2]), issues: is.length }; })
    .filter(function (x) { return dailyOkDate_(x.date); }).sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 400);
}
/** 1분 작업: 18시가 넘으면 오늘 보고서를 하루 한 번 저장(아무도 안 열어도 그날 기록이 남게) */
function dailyAutoSave_() {
  try {
    var now = new Date(), h = Number(Utilities.formatDate(now, 'Asia/Seoul', 'H'));
    if (h < 18) return;
    var today = dailyToday_(), c = CacheService.getScriptCache(), ck = 'daily:auto:' + today;
    if (c.get(ck)) return;
    c.put(ck, '1', 21600);
    var sh = dailyTab_(), at = dailyFind_(sh, today), old = at ? dailyRead_(sh, at) : null;
    if (old && old.savedAt && old.savedAt.slice(11) >= '18:00' && old.savedAt.slice(0, 10) === today) return;     // 18시 뒤에 이미 저장됨
    dailyWrite_(today, dailyCompute_(today), old ? old.issues : [], '자동(18시)');
  } catch (e) { try { console.log('일일보고 자동 저장 실패: ' + e.message); } catch (e2) { /* 넘어간다 */ } }
}
