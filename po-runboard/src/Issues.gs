/**
 * ============================================================
 * 이슈(2026-10-27) — 발주건 · 샘플건마다 담당자가 이슈를 등록하고, 일일보고에서 팀장이 피드백을 쓰면 '확인'으로 닫힌다.
 * 확인된 이슈는 일일보고에 이슈로 나오지 않는다. 보고서가 찾아낸 자동 이슈(입고 지연 · 멈춘 샘플)도 피드백을 쓰면
 * 그 열쇠(auto:…)로 한 줄이 남아 같은 지연이 다시 이슈로 나오지 않는다(예정일 · 마지막 진행일이 바뀌면 새 이슈).
 * 대상키: 발주 'po:<실행판ID 소문자>' · 샘플 's:<프로젝트키>|<업체키>'(업체키 빈칸 = 프로젝트 전체)
 * ============================================================
 */
var RB_ISS_TAB = '_실행판_이슈';
var RB_ISS_HEAD = ['이슈ID', '종류', '대상키', '품목', '업체', '내용', '등록일시', '등록자', '상태', '피드백', '피드백자', '피드백일시'];

function issTab_() { return tab_(RB_ISS_TAB, RB_ISS_HEAD); }       // 없으면 머리글과 함께 만든다(sheet_ 는 없는 탭을 기억해 두어 쓰지 않는다)
function issNow_() { return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'); }
/** 시트가 날짜로 바꿔 둔 시각 칸 → 'yyyy-MM-dd HH:mm' (그대로 글자로 쓰면 'Tue Oct 27 …'이 되어 보고서에 'ct 27'로 찍혔다) */
function issTime_(v) { return v instanceof Date ? Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd HH:mm') : str_(v); }
function issWho_() { return me_().split('@')[0]; }
/** 이슈 전부 — [{ id, kind, ref, name, vendor, text, at, by, st, fb, fbBy, fbAt, row }] */
function issAll_() {
  var sh = ss_().getSheetByName(RB_ISS_TAB); if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, RB_ISS_HEAD.length).getValues().map(function (v, i) {
    return { id: str_(v[0]), kind: str_(v[1]), ref: str_(v[2]), name: str_(v[3]), vendor: str_(v[4]), text: str_(v[5]), at: issTime_(v[6]), by: str_(v[7]),
      st: str_(v[8]) || '열림', fb: str_(v[9]), fbBy: str_(v[10]), fbAt: issTime_(v[11]), row: i + 2 };
  }).filter(function (x) { return x.id; });
}
function issPub_(x) { var o = {}; Object.keys(x).forEach(function (k) { if (k !== 'row') o[k] = x[k]; }); return o; }

/** 화면: 한 건의 이슈 목록(ref) — refPrefix 로 끝이 '|'면 그 프로젝트 전체(업체별 포함) */
function apiIssueList(ref) {
  ref = str_(ref);
  var all = issAll_();
  return all.filter(function (x) { return ref.slice(-1) === '|' ? x.ref.indexOf(ref) === 0 : x.ref === ref; }).map(issPub_);
}

/** 화면: 이슈 등록 */
function apiIssueAdd(kind, ref, name, vendor, text) {
  requireEditor_();
  text = str_(text).slice(0, 1000); ref = str_(ref);
  if (!text) throw new Error('이슈 내용을 적어 주세요.');
  if (!/^(po|s):/.test(ref)) throw new Error('이슈를 달 건을 찾을 수 없습니다.');
  var sh = issTab_(), lock = LockService.getScriptLock(); waitLock_(lock);
  try {
    var id = 'I' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
    var at = sh.getLastRow() + 1; ensureRows_(sh, at);
    sh.getRange(at, 1, 1, RB_ISS_HEAD.length).setValues([[id, kind === '발주' ? '발주' : '샘플', ref, str_(name).slice(0, 200), str_(vendor).slice(0, 100), text, issNow_(), issWho_(), '열림', '', '', '']]);
  } finally { lock.releaseLock(); dailyDirty_(); }
  return apiIssueList(ref);
}

/**
 * 화면(일일보고 · 상세): 피드백 쓰기 → 확인. 자동 이슈(id 'auto:…')는 처음이면 한 줄을 만들어 확인으로 남긴다.
 * meta: 자동 이슈일 때 { kind, ref, name, vendor, text }. fb 가 빈칸이면 '확인'만.
 */
function apiIssueFeedback(id, fb, meta) {
  requireEditor_();
  id = str_(id); fb = str_(fb).slice(0, 1000); meta = meta || {};
  if (!id) throw new Error('이슈를 찾을 수 없습니다.');
  var sh = issTab_(), lock = LockService.getScriptLock(); waitLock_(lock);
  try {
    var hit = issAll_().filter(function (x) { return x.id === id; })[0], now = issNow_(), who = issWho_();
    if (hit) {
      sh.getRange(hit.row, 9, 1, 4).setValues([['확인', fb || hit.fb, who, now]]);
    } else {
      if (id.indexOf('auto:') !== 0) throw new Error('이슈를 찾을 수 없습니다(지워졌을 수 있음). 새로고침해 주세요.');
      var at = sh.getLastRow() + 1; ensureRows_(sh, at);
      sh.getRange(at, 1, 1, RB_ISS_HEAD.length).setValues([[id, meta.kind === '발주' ? '발주' : '샘플', str_(meta.ref), str_(meta.name).slice(0, 200), str_(meta.vendor).slice(0, 100), str_(meta.text).slice(0, 1000), now, '자동', '확인', fb, who, now]]);
    }
  } finally { lock.releaseLock(); dailyDirty_(); }
  return { ok: true, id: id, fbBy: issWho_(), fbAt: issNow_() };
}

/** 화면(상세): 확인 취소 → 다시 열림 · 등록한 이슈 지우기 */
function apiIssueReopen(id) {
  requireEditor_();
  var sh = issTab_(), lock = LockService.getScriptLock(); waitLock_(lock);
  try {
    var hit = issAll_().filter(function (x) { return x.id === str_(id); })[0];
    if (!hit) throw new Error('이슈를 찾을 수 없습니다.');
    sh.getRange(hit.row, 9).setValue('열림');
  } finally { lock.releaseLock(); dailyDirty_(); }
  return { ok: true };
}
function apiIssueDelete(id) {
  requireEditor_();
  var sh = issTab_(), lock = LockService.getScriptLock(); waitLock_(lock);
  try {
    var hit = issAll_().filter(function (x) { return x.id === str_(id); })[0];
    if (!hit) throw new Error('이슈를 찾을 수 없습니다.');
    if (hit.st === '확인') throw new Error('피드백까지 받은 이슈는 지울 수 없습니다.');
    sh.deleteRow(hit.row);
  } finally { lock.releaseLock(); dailyDirty_(); }
  return { ok: true };
}
