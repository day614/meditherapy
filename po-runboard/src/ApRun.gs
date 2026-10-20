/**
 * ============================================================
 * AP 생성 이관 · 발주 DB 보호
 * ------------------------------------------------------------
 * 3단계: AP 탭 · 매입금액 스냅샷을 실행판이 만든다.
 *   [_실행판_설정] ap.source = runboard 면
 *     · 실행판 트리거(apDailyRun, 매일 20시)가 AP 를 다시 쓰고 스냅샷을 찍는다.
 *     · 시트 쪽 스크립트(dailyUpdate)는 AP · 스냅샷을 건너뛴다(매입예정_자동 탭은 2026-10-06 없앰).
 *   ap.source = sheet(기본)면 예전처럼 시트 쪽 스크립트가 한다.
 * 5단계: 발주 DB 탭(_실행판_발주)을 '실행판 전용'으로 보호한다(경고만 / 잠금).
 * ============================================================
 */

var RB_AP_TRIGGER = 'apDailyRun';
var RB_PROTECT_DESC = '실행판 전용 — 발주 DB는 발주 실행판에서 고칩니다';

/**
 * AP 탭 다시 쓰기 + 스냅샷. 다른 실행판 저장을 막지 않게 스크립트 잠금은 쓰지 않고, 겹쳐 돌지만 않게 한다.
 * strictSnap: 스냅샷이 실패하면 기록(ap.lastRun)을 남긴 뒤 오류를 던진다(트리거 → Apps Script 실패 알림 메일).
 *             수동 실행(apApRunNow)은 던지지 않고 결과의 snapshot 에 '실패: 사유' 를 적는다.
 */
function apUpdate_(who, strictSnap) {
  var cache = CacheService.getScriptCache();
  if (!apRunClaim_(cache)) throw new Error('AP 갱신이 이미 돌고 있거나 다른 저장이 끝나지 않았습니다. 1~2분 뒤에 다시 해 주세요.');
  // AP 작업끼리는 'ap:running' 표시로 겹치지 않게 한다(저장 뒤 자동 apRebuildDeferred 도 같은 표시).
  // 스크립트 잠금은 지급 줄 · 발주 DB 를 읽는 동안만 쥔다 — AP 탭 쓰기 · 스냅샷까지 쥐고 있으면 그동안 사용자 저장이 막힌다.
  var t0 = Date.now(), res = { by: who || me_() }, T = rbTimer_(), snapErr = null;
  try {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(120000)) throw new Error('다른 저장이 끝나지 않아 AP 갱신을 하지 못했습니다. 잠시 뒤 다시 해 주세요.');
    var rows;
    try { rows = apBuildRows_(); } finally { lock.releaseLock(); }
    T.mark('읽기(잠금안)');
    // 계산 없이 지급 줄 + 건 정보를 이어 붙인다
    var lr = apRebuildFromLines_(rows, T);
    res.rows = lr.rows; res.anomaly = lr.anomaly; res.from = '지급 줄';
    try { RB_AP.snapshot(); res.snapshot = 'ok'; } catch (e) { snapErr = e; res.snapshot = '실패: ' + e.message; console.error('apUpdate 스냅샷 실패: ' + e.message); }
    T.mark('스냅샷');
  } catch (e) {
    res.error = e.message;
    throw e;
  } finally {
    cache.remove('ap:running');
    res.timing = T.done();
    try { console.log('apUpdate ' + JSON.stringify(res)); } catch (e3) { /* 넘어간다 */ }
    res.ms = Date.now() - t0;
    res.at = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    try { writeConfig_({ 'ap.lastRun': JSON.stringify(res) }); } catch (e2) { /* 기록 실패는 넘어간다 */ }
  }
  if (snapErr && strictSnap) throw new Error('AP 는 다시 썼지만 매입금액 스냅샷이 실패했습니다: ' + snapErr.message);
  return res;
}

/** 트리거: 매일 20시. ap.source 가 runboard 일 때만 한다. 실패하면 오류를 던져 실행 기록 · 알림 메일에 남긴다. */
function apDailyRun(e) {
  requireTriggerOrAdmin_(e, RB_AP_TRIGGER);
  var cfg = readConfig_();
  if (String(cfg['ap.source'] || 'sheet') !== 'runboard') return;
  apUpdate_('자동(매일 20시)', true);   // 스냅샷 실패도 던져 실패 알림 메일이 가게
}

// ScriptApp.getProjectTriggers() 는 '지금 실행하는 사람'이 만든 트리거만 돌려준다.
var RB_TRIGGER_NOTE = '트리거 목록은 지금 보는 관리자가 만든 것만 보입니다. 다른 관리자가 만든 트리거는 여기 안 보일 수 있고, 전환 버튼은 내 트리거만 지우고 새로 만듭니다(겹치면 하루 두 번 돌 수 있음). 확실히 보려면 Apps Script 편집기 ⏰ 트리거 화면(모든 사용자)에서 확인하세요.';

function apTriggerOn_() {
  return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === RB_AP_TRIGGER; });
}

function apProtections_(sh) {
  return sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).filter(function (p) {
    return String(p.getDescription() || '').indexOf('실행판 전용') === 0;
  });
}

/** 관리자: 현재 상태 */
function apApStatus() {
  requireAdmin_();
  var cfg = readConfig_();
  var last = null;
  try { last = JSON.parse(cfg['ap.lastRun'] || 'null'); } catch (e) { last = null; }
  // 저장 뒤 자동으로 다시 쓴 기록이 더 새것이면 그걸 보여 준다
  try {
    var auto = JSON.parse(PropertiesService.getScriptProperties().getProperty('ap.lastAuto') || 'null');
    if (auto && (!last || String(auto.at) > String(last.at))) last = auto;
  } catch (e) { /* 그대로 */ }
  var sh = sheet_(RB.STATUS_TAB);
  if (sh && sh.getSheetId() === RB.LEGACY_STATUS_GID) sh = null;    // 이름만 바꿔 둔 예전 발주현황 = 이관 전
  var ps = sh ? apProtections_(sh) : [];
  return {
    source: String(cfg['ap.source'] || 'sheet'),
    trigger: apTriggerOn_(),
    triggerNote: RB_TRIGGER_NOTE,
    last: last,
    protect: !ps.length ? 'off' : (ps[0].isWarningOnly() ? 'warn' : 'lock'),
    lines: (function () { var l = sheet_(RB_LINE.TAB); return l ? Math.max(0, l.getLastRow() - 1) : 0; })(),
    dbRows: sh ? Math.max(0, sh.getLastRow() - 1) : -1,           // 발주 DB 행 수(-1 = 탭 없음 → 이관 필요)
    dbMigratedAt: String(cfg['db.migratedAt'] || '')
  };
}

/** 관리자: AP 를 누가 만들지. runboard 면 매일 20시 트리거를 만든다(있으면 하나만 남긴다). */
function apApSetSource(src) {
  requireAdmin_();
  src = src === 'runboard' ? 'runboard' : 'sheet';
  // 지급 줄로 전환한 뒤에는 발주현황 지급월 열을 더 안 채우므로, 시트 스크립트가 AP 를 만들면 틀린 AP 가 나온다.
  if (src === 'sheet' && String(readConfig_()['lines.on'] || 'N') === 'Y') {
    throw new Error('지급 줄로 전환한 뒤에는 시트 스크립트로 되돌릴 수 없습니다(발주현황 지급월 열을 더 채우지 않아 AP 가 틀려집니다).');
  }
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === RB_AP_TRIGGER) ScriptApp.deleteTrigger(t);
  });
  if (src === 'runboard') {
    ScriptApp.newTrigger(RB_AP_TRIGGER).timeBased().atHour(20).everyDays(1).inTimezone('Asia/Seoul').create();
  }
  writeConfig_({ 'ap.source': src });
  writeAudit_(RB.T_CONFIG, 1, 1, 'AP 생성 담당', '', src === 'runboard' ? '실행판' : '시트 스크립트');
  return apApStatus();
}

/** 관리자: 지금 AP 갱신 */
function apApRunNow() {
  requireAdmin_();
  apUpdate_(me_());
  return apApStatus();
}

/**
 * 관리자: 발주 DB 탭(_실행판_발주) 보호. mode: off(없음) · warn(고치면 경고) · lock(소유자 · 실행판만)
 * 실행판은 소유자 권한으로 쓰므로 잠가도 저장된다.
 */
function apProtect(mode) {
  requireAdmin_();
  mode = ['off', 'warn', 'lock'].indexOf(mode) > -1 ? mode : 'off';
  var sh = statusSheet_();
  apProtections_(sh).forEach(function (p) { p.remove(); });
  if (mode !== 'off') {
    var p = sh.protect().setDescription(RB_PROTECT_DESC);
    if (mode === 'warn') p.setWarningOnly(true);
    else {
      var owner = owner_();
      if (owner) p.addEditor(owner);
      var others = p.getEditors().filter(function (u) { return String(u.getEmail()).toLowerCase() !== String(owner).toLowerCase(); });
      if (others.length) p.removeEditors(others);
      if (p.canDomainEdit()) p.setDomainEdit(false);
    }
  }
  writeAudit_(RB.STATUS_TAB, 1, 1, '발주 DB 보호', '', mode);
  return apApStatus();
}

