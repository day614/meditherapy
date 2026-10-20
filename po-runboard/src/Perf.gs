/**
 * 관리자 진단(읽기만): ?diag=perf — 저장이 왜 느린지 단계별로 잰다. 시트에 아무것도 쓰지 않는다.
 *  · 실행판이 쓰는 탭들 읽기 시간 · 크기
 *  · 캐시 읽기 시간 · 크기
 *  · 스프레드시트 전체 수식 수 · 매번 다시 계산되는 수식(NOW · TODAY · INDIRECT · OFFSET · IMPORTRANGE 등)
 *  · 실행판 탭(_실행판_…)을 참조하는 수식이 있는지(있으면 저장할 때마다 그 수식들이 다시 계산된다)
 */

// 진단이 여는 다른 시트 ID(BOM 시트는 RB.BOM_SS_ID)
var RB_SPEC_SS_ID = '1uGgQLfEXf67VOMylz9LpuSckIn6C0_1GHZRA0hhpB5w';   // 데이터사양(디자인 파일) 시트 — ?diag=bomproto
// 탭 하나를 통째로 읽을 때 칸 수 상한(이보다 크면 건너뛴다 — 너무 큰 탭이 실행 시간 · 메모리를 다 쓰지 않게). ?diag=bomtabs 와 같다.
var RB_DIAG_MAX_CELLS = 300000;
function perfDiag_() {
  requireAdmin_();
  var out = {}, t;
  var tm = function (name, fn) { var a = Date.now(); var r = fn(); out[name] = (out[name] || '') + (Date.now() - a) + 'ms'; return r; };

  var ss = tm('1_스프레드시트열기', function () { return ss_(); });
  tm('2_flush_쓴것없음', function () { SpreadsheetApp.flush(); });
  var p = tm('3_진행기록탭_통째읽기', function () { return readProgress_('po'); });
  out['3_진행기록_행수'] = p.raw.length;
  tm('4_진행기록탭_한행읽기', function () { return p.sh.getRange(2, 1, 1, RB.PROGRESS_HEAD.length).getValues(); });
  var anyId = Object.keys(p.map)[0];
  var one = tm('4b_한건찾기(readProgressOne_)', function () { return readProgressOne_('po', anyId); });
  out['4b_빠른길'] = !!(one && one.fast);
  tm('5_이력탭_마지막행', function () { return tab_(RB.T_AUDIT, RB.HIST_HEAD).getLastRow(); });
  out['5_이력탭_행수'] = tab_(RB.T_AUDIT, RB.HIST_HEAD).getLastRow();
  var L = tm('6_지급줄탭_통째읽기', function () { return readLinesAll_(); });
  out['6_지급줄_행수'] = L.rows.length;
  var pc = tm('7_캐시_진행기록읽기', function () { return cacheGet_('prog:v2:po'); });
  out['7_캐시_진행기록크기KB'] = pc ? Math.round(JSON.stringify(pc).length / 1024) : '없음';
  tm('8_캐시한칸', function () { return CacheService.getScriptCache().get('rb:ver:p'); });
  tm('9_잠금잡고놓기', function () { var l = LockService.getScriptLock(); if (l.tryLock(1000)) l.releaseLock(); });

  // 수식 조사 — 탭마다 수식 수, 매번 다시 계산되는 함수, 실행판 탭 참조
  var VOL = /\b(NOW|TODAY|RAND|RANDBETWEEN|INDIRECT|OFFSET|IMPORTRANGE|IMPORTDATA|IMPORTXML|IMPORTHTML|GOOGLEFINANCE)\s*\(/i;
  var HEAVY = /\b(QUERY|ARRAYFORMULA|FILTER|VLOOKUP|XLOOKUP|INDEX|MATCH|SUMIFS?|COUNTIFS?|SUMPRODUCT|UNIQUE|SORT)\s*\(/i;
  var a0 = Date.now(), tabs = [], totF = 0, totV = 0, refRB = [];
  ss.getSheets().forEach(function (sh) {
    var name = sh.getName(), lr = sh.getLastRow(), lc = sh.getLastColumn();
    var row = { 탭: name, 행: lr, 열: lc, 칸: lr * lc, 수식: 0, 휘발: 0, 무거운: 0, 예: '' };
    if (lr * lc >= RB_DIAG_MAX_CELLS) row.예 = '(칸 ' + lr * lc + '개 — ' + RB_DIAG_MAX_CELLS + '칸 넘어 수식 조사 건너뜀)';
    else if (lr > 0 && lc > 0) {
      var f = sh.getRange(1, 1, lr, lc).getFormulas();
      var seen = {};
      for (var i = 0; i < f.length; i++) for (var j = 0; j < f[i].length; j++) {
        var s = f[i][j];
        if (!s) continue;
        row.수식++;
        if (VOL.test(s)) { row.휘발++; if (!row.예) row.예 = s.slice(0, 80); }
        if (HEAVY.test(s)) row.무거운++;
        var m = s.match(/'?(_실행판_[^'!]+)'?!/);
        if (m && !seen[m[1]]) { seen[m[1]] = 1; refRB.push(name + ' → ' + m[1] + ' (' + s.slice(0, 60) + ')'); }
      }
    }
    totF += row.수식; totV += row.휘발;
    tabs.push(row);
  });
  out['10_수식조사시간'] = (Date.now() - a0) + 'ms';
  out['10_전체수식'] = totF;
  out['10_휘발수식'] = totV;
  out['10_실행판탭참조수식'] = refRB;
  out['10_탭별'] = tabs.sort(function (x, y) { return y.수식 - x.수식; });
  out['11_전체칸수'] = tabs.reduce(function (s, r) { return s + r.칸; }, 0);
  return out;
}

/**
 * ?diag=perfw — 쓰기 시간 재기. 업무 탭은 건드리지 않고, 잰 뒤 지우는 임시 탭(_실행판_측정)에만 쓴다.
 * 체크 저장 한 번이 하는 일을 그대로 흉내 낸다: 잠금 → 탭 통째 읽기 → 한 줄 쓰기 → 이력 붙이기 → 캐시 다시 쓰기 → 반영.
 * 운영 시트에 임시 탭을 만들고 지우므로 시안(사본 시트)에서만 돈다.
 */
function perfWriteDiag_() {
  requireAdmin_();
  requireCopySS_();
  var out = {}, ss = ss_();
  var tm = function (name, fn) { var a = Date.now(); var r = fn(); out[name] = (Date.now() - a) + 'ms'; return r; };
  var NAME = '_실행판_측정';
  var old = ss.getSheetByName(NAME);
  if (old) ss.deleteSheet(old);
  var sh = tm('0_임시탭만들기', function () { return ss.insertSheet(NAME); });
  try {
    tm('1_me_', function () { return me_(); });
    tm('2_권한확인(requireEditor_)', function () { RB_EDITOR_OK = false; requireEditor_(); });
    tm('3_단계설정(stepsFast_)', function () { return stepsFast_('po'); });
    var row = []; for (var i = 0; i < 11; i++) row.push('측정' + i);
    tm('4_한줄쓰기(반영전)', function () { sh.getRange(2, 1, 1, 11).setValues([row]); });
    tm('5_반영flush_한줄쓴뒤', function () { SpreadsheetApp.flush(); });
    tm('6_한줄쓰기+바로읽기', function () { sh.getRange(3, 1, 1, 11).setValues([row]); return sh.getRange(3, 1).getValue(); });
    tm('7_마지막행(쓰기뒤)', function () { sh.getRange(4, 1, 1, 11).setValues([row]); return sh.getLastRow(); });
    tm('8_이력처럼붙이기(서식+값)', function () { var r0 = sh.getLastRow() + 1; sh.getRange(r0, 4, 1, 8).setNumberFormat('@'); sh.getRange(r0, 1, 1, 11).setValues([row]); });
    tm('9_반영flush_다시', function () { SpreadsheetApp.flush(); });
    var big = cacheGet_('prog:v2:po') || {};
    tm('10_캐시137KB다시쓰기', function () { cachePut_('perf:tmp', big, 60); });
    tm('11_캐시지우기', function () { cacheDrop_('perf:tmp'); });
    tm('12_트리거목록', function () { return ScriptApp.getProjectTriggers().length; });
    tm('13_설정읽기(readConfig_)', function () { return readConfig_(); });
    // 10번 연달아(체크 10번 저장 흉내) — 매번 쓰고 반영
    var a = Date.now();
    for (var k = 0; k < 10; k++) { sh.getRange(10 + k, 1, 1, 11).setValues([row]); SpreadsheetApp.flush(); }
    out['14_쓰기+반영_10번평균'] = Math.round((Date.now() - a) / 10) + 'ms';
    a = Date.now();
    for (var k2 = 0; k2 < 10; k2++) sh.getRange(30 + k2, 1, 1, 11).setValues([row]);
    SpreadsheetApp.flush();
    out['15_쓰기10번+반영1번_합계'] = (Date.now() - a) + 'ms';
  } finally {
    try { ss.deleteSheet(sh); out['임시탭'] = '지움'; } catch (e) { out['임시탭'] = '못 지움: ' + e.message; }
  }
  return out;
}

/**
 * ?diag=perfsave — 체크 저장 한 번을 예전 방식 · 지금 방식 그대로 흉내 내 5번씩 잰다.
 * 업무 탭에는 쓰지 않는다: 읽기는 실제 진행 기록 탭, 쓰기는 잰 뒤 지우는 임시 탭과 임시 캐시 열쇠에만.
 * 스크립트 잠금을 10번 잡았다 놓고(그동안 다른 저장이 줄을 선다) 임시 탭을 만들므로 시안(사본 시트)에서만 돈다.
 */
function perfSaveDiag_() {
  requireAdmin_();
  requireCopySS_();
  var ss = ss_(), NAME = '_실행판_측정';
  var old = ss.getSheetByName(NAME);
  if (old) ss.deleteSheet(old);
  var sh = ss.insertSheet(NAME);
  var out = { 예전방식_ms: [], 지금방식_ms: [], 지금방식_잠금쥔시간_ms: [], 예전방식_잠금쥔시간_ms: [] };
  try {
    var row = []; for (var i = 0; i < 11; i++) row.push('측정' + i);
    var hist = []; for (var j = 0; j < 14; j++) hist.push('이력' + j);
    sh.getRange(1, 1, 50, 14).setValues(new Array(50).fill(0).map(function () { return hist.slice(); }));
    SpreadsheetApp.flush();
    var progTab = tab_(RB.T_PROGRESS, RB.PROGRESS_HEAD);
    var anyId = Object.keys((cacheGet_(progHintKey_('po')) || {}))[0] || '';
    var lock = LockService.getScriptLock();
    for (var k = 0; k < 5; k++) {
      // 예전: 잠금 → 탭 통째 읽기 → 쓰기 → 다시 읽어 확인 → 이력(마지막 행 · 서식 · 값) → 반영 → 캐시 → 반영
      var a = Date.now(); waitLock_(lock); var l0 = Date.now();
      readProgress_('po');
      sh.getRange(2, 1, 1, 11).setValues([row]);
      sh.getRange(2, 7).getValue();
      var r0 = sh.getLastRow() + 1; sh.getRange(r0, 4, 1, 11).setNumberFormat('@'); sh.getRange(r0, 1, 1, 14).setValues([hist]);
      SpreadsheetApp.flush();
      var m = cacheGet_('prog:v2:po'); cachePut_('perf:tmp', m || {}, 60);
      SpreadsheetApp.flush(); CacheService.getScriptCache().put('perf:ver', String(Date.now()), 60);
      out.예전방식_잠금쥔시간_ms.push(Date.now() - l0); lock.releaseLock(); out.예전방식_ms.push(Date.now() - a);
      // 지금: 잠금 → 한 줄 읽기 → 이력(쓰기 전이라 바로) → 쓰기 → 캐시 → 반영 한 번
      a = Date.now(); waitLock_(lock); l0 = Date.now();
      readProgressOne_('po', anyId);
      var r1 = sh.getLastRow() + 1; sh.getRange(r1, 4, 1, 11).setNumberFormat('@'); sh.getRange(r1, 1, 1, 14).setValues([hist]);
      sh.getRange(3, 1, 1, 11).setValues([row]);
      var m2 = cacheGet_('prog:v2:po'); cachePut_('perf:tmp', m2 || {}, 60);
      SpreadsheetApp.flush(); CacheService.getScriptCache().putAll({ 'perf:ver': String(Date.now()) }, 60);
      out.지금방식_잠금쥔시간_ms.push(Date.now() - l0); lock.releaseLock(); out.지금방식_ms.push(Date.now() - a);
    }
    var avg = function (x) { return Math.round(x.reduce(function (s, v) { return s + v; }, 0) / x.length); };
    out.평균 = { 예전: avg(out.예전방식_ms), 지금: avg(out.지금방식_ms), 예전_잠금: avg(out.예전방식_잠금쥔시간_ms), 지금_잠금: avg(out.지금방식_잠금쥔시간_ms) };
    out.참고 = '서버 호출 자체(구글 왕복 약 1초)는 빠져 있다. 화면에서 느끼는 저장 시간 ≈ 위 시간 + 약 1초';
    cacheDrop_('perf:tmp');
  } finally {
    try { ss.deleteSheet(sh); out.임시탭 = '지움'; } catch (e) { out.임시탭 = '못 지움: ' + e.message; }
  }
  return out;
}

/** ?diag=perfj — 장부 저장 한 번에 드는 시간(업무 데이터 안 건드림: 'perf:' 열쇠에 적고 바로 지움) */
function perfJournalDiag_() {
  requireAdmin_();
  var out = { 회: [] }, props = PropertiesService.getScriptProperties();
  var anyId = Object.keys((cacheGet_(progHintKey_('po')) || {}))[0] || '';
  for (var k = 0; k < 5; k++) {
    var a = Date.now(), t = {};
    var all = props.getProperties(); t.장부읽기 = Date.now() - a;
    var b = Date.now(); var key = 'perf:' + Utilities.getUuid().slice(0, 8);
    var s = JSON.stringify({ mode: 'po', id: anyId, kind: 'checks', changes: { x: true }, meta: { doc: 'd', name: 'n' } });
    props.setProperty(key, s); props.getProperty(key); t.적기확인 = Date.now() - b;
    b = Date.now(); var st = progView_('po', anyId, journalList_(all)); t.지금상태 = Date.now() - b;
    b = Date.now(); props.deleteProperty(key); t.지우기 = Date.now() - b;
    t.합계 = Date.now() - a;
    out.회.push(t);
  }
  out.평균합계ms = Math.round(out.회.reduce(function (x, t) { return x + t.합계; }, 0) / 5);
  out.참고 = '실제 저장 = 위 합계(지우기 빼고) + 권한확인 등 + 구글 왕복 약 1초. 잠금 없음.';
  return out;
}

/** ?diag=perfboot — 첫 화면 캐시가 왜 비는지: 캐시별 크기 · 칸 수 · 지금 들어 있는지(읽기만) */
function perfBootDiag_() {
  requireAdmin_();
  var out = {}, c = CacheService.getScriptCache();
  var meta = cacheGet_(metaKey_('po'));
  out.meta있음 = !!meta;
  var cfg = (meta && meta.cfg) || readConfig_();
  var rk = rowsCacheKey_('po', cfg);
  out.목록캐시열쇠 = rk;
  out.목록캐시칸수 = c.get(rk + ':n');
  out.진행캐시칸수 = c.get('prog:v2:po:n');
  var t = Date.now(); var rows = readOrderRows_(cfg); out.목록읽기ms = Date.now() - t;
  var s = JSON.stringify(rows);
  out.목록건수 = rows.length;
  out.목록글자수 = s.length;
  out.목록필요칸수 = Math.ceil(s.length / RB_CACHE_CHUNK);
  out.목록한칸최대바이트 = (function () { var mx = 0; for (var i = 0; i < s.length; i += RB_CACHE_CHUNK) mx = Math.max(mx, Utilities.newBlob(s.substr(i, RB_CACHE_CHUNK)).getBytes().length); return mx; })();
  out.참고 = '캐시 한 칸 한도 100KB(바이트), 칸 수 ' + RB_CACHE_MAX_PARTS + ' 넘으면 안 담는다';
  return out;
}

/** ?diag=bomscan — BOM 시트 구조 조사(읽기만): 탭 · 크기 · 수식 · 머리글 · 보호 · 외부 참조 */
function bomScanDiag_() {
  requireAdmin_();
  var ss = SpreadsheetApp.openById(RB.BOM_SS_ID);
  var out = { 이름: ss.getName(), 편집자수: ss.getEditors().length, 보기자수: ss.getViewers().length, 탭: [] };
  ss.getSheets().forEach(function (sh) {
    var lr = sh.getLastRow(), lc = sh.getLastColumn(), row = { 탭: sh.getName(), 숨김: sh.isSheetHidden(), 행: lr, 열: lc, 수식: 0, 외부참조: [], 보호: sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length + sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).length };
    if (lr * lc >= RB_DIAG_MAX_CELLS) row.건너뜀 = '칸 ' + lr * lc + '개 — ' + RB_DIAG_MAX_CELLS + '칸 넘어 수식 조사 안 함';
    else if (lr && lc) {
      var f = sh.getRange(1, 1, lr, lc).getFormulas(), colF = {};
      for (var i = 0; i < f.length; i++) for (var j = 0; j < f[i].length; j++) {
        var s = f[i][j]; if (!s) continue;
        row.수식++;
        if (!colF[j]) colF[j] = { 첫행: i + 1, 예: s.slice(0, 90), 개수: 0 };
        colF[j].개수++;
        var m = s.match(/IMPORTRANGE\(\s*"([^"]+)"/i); if (m && row.외부참조.indexOf(m[1]) < 0) row.외부참조.push(m[1]);
      }
      row.수식열 = Object.keys(colF).map(function (j) { return colRB_(Number(j) + 1) + ':' + colF[j].개수 + '개 (' + colF[j].첫행 + '행~) ' + colF[j].예; });
      if (sh.getName() === 'BOM') {
        row.머리글 = sh.getRange(1, 1, 3, lc).getDisplayValues().map(function (r) { return r.map(function (v, k) { return v ? colRB_(k + 1) + '=' + String(v).replace(/\n/g, ' ').slice(0, 30) : ''; }).filter(String).join(' | '); });
      }
    }
    out.탭.push(row);
  });
  return out;
}
/**
 * ?diag=bomaudit — BOM 시트 전체 검사(읽기만, 고치지 않는다). 옮기기 전에 무엇이 틀렸는지 · 자동으로 고칠 수 있는지 본다.
 */
function bomAuditDiag_() {
  requireAdmin_();
  var sh = bomSheet_(), C = bomCols_(sh), lr = sh.getLastRow();
  var v = sh.getRange(3, 1, lr - 2, C.lc).getValues();
  var fCost = C.cost >= 0 ? sh.getRange(3, C.cost + 1, lr - 2, 1).getFormulas() : [];
  var S = function (x) { return String(x == null ? '' : x).trim(); }, U = function (x) { return S(x).toUpperCase(); };
  var N = function (x) { var n = Number(String(x).replace(/,/g, '')); return isFinite(n) ? n : 0; };
  var R = function (t) { var m = S(t).match(/^(\d+)\s*차$/); return m ? Number(m[1]) : null; };
  var codeOk = /^[A-Z]{1,2}\d{4}[A-Z]{2}\d+$/, prodOk = /^[A-Z]X?\d{4}[A-Z]{2}\d+$/;
  var out = {}, add = function (k, item) { (out[k] = out[k] || []).push(item); };
  var byP = {}, rows = [];
  v.forEach(function (r, i) {
    var o = { row: i + 3, p: U(r[C.product]), code: U(r[C.code]), type: S(r[C.type]), start: S(r[C.start]), end: S(r[C.end]), ck: U(r[C.costKey]), vendor: S(r[C.vendor]),
      spec: C.spec >= 0 ? S(r[C.spec]) : '', buy: C.buy >= 0 ? S(r[C.buy]) : '', place: C.place >= 0 ? S(r[C.place]) : '', qty: r[C.qty], unit: r[C.unit], proc: C.proc >= 0 ? r[C.proc] : '', ship: C.ship >= 0 ? r[C.ship] : '', cost: r[C.cost], fx: C.fx >= 0 ? r[C.fx] : 1, name: S(r[C.name]), f: fCost[i] ? fCost[i][0] : '' };
    if (!o.p && !o.code && !o.type) return;
    rows.push(o);
    (byP[o.p] = byP[o.p] || []).push(o);
  });
  Object.keys(byP).forEach(function (P) {
    var list = byP[P];
    if (!P) { list.forEach(function (o) { add('제품코드 빈 줄', o.row + '행 ' + o.type + ' ' + o.code); }); return; }
    if (!prodOk.test(P)) add('제품코드 형식 아님', P + ' (' + list.length + '줄, ' + list[0].row + '행~)');
    var prods = list.filter(function (o) { return o.type === '제품'; });
    if (!prods.length) add('제품 줄 없음', P + ' (' + list[0].row + '행~)');
    // 다른 제품 구성이 섞임: 제품 줄 코드가 P가 아니면 그 줄부터 다음 제품 줄 전까지
    prods.forEach(function (o, k) {
      if (o.code === P || !prodOk.test(o.code)) return;
      var nextRow = 1e9;
      prods.forEach(function (q) { if (q.row > o.row && q.row < nextRow) nextRow = q.row; });
      var blk = list.filter(function (q) { return q.row >= o.row && q.row < nextRow; });
      add('다른 제품 구성 섞임 (자동 수정 가능)', P + ' 안 ' + o.row + '~' + blk[blk.length - 1].row + '행 ' + blk.length + '줄 → 제품코드 ' + o.code + ' 로' + (byP[o.code] ? ' (그 코드 자체 줄도 ' + byP[o.code].length + '개 있음 — 확인)' : ''));
    });
    // 같은 때 쓰는 제품 줄이 둘 이상(둘 다 원가반영)
    var openProd = prods.filter(function (o) { return o.code === P && o.ck && !R(o.end); });
    if (openProd.length > 1) add('제품 줄 중복 (원가 이중)', P + ' ' + openProd.map(function (o) { return o.row + '행 ' + N(o.cost); }).join(' · '));
    list.forEach(function (o) {
      if (!o.code) add('자재코드 빈 줄', P + ' ' + o.row + '행 ' + o.type + ' ' + o.name.slice(0, 20));
      else if (!codeOk.test(o.code)) add('자재코드 형식 아님', P + ' ' + o.row + '행 ' + o.type + ' "' + o.code + '"' + (o.ck ? ' · 원가반영 있음' : ' · 원가반영 없음(참고 줄)'));
      if (!o.start) add('초도 빈 줄', P + ' ' + o.row + '행 ' + o.type + ' ' + o.code);
      else if (!R(o.start)) add('초도 칸 이상', P + ' ' + o.row + '행 "' + o.start + '"');
      if (o.end && !R(o.end) && o.end !== '단종') add('종료 칸 이상 (직접 정리)', P + ' ' + o.row + '행 ' + o.type + ' ' + o.code + ' "' + o.end + '"');
      if (R(o.end) && R(o.start) && R(o.end) < R(o.start)) add('종료가 초도보다 앞', P + ' ' + o.row + '행 ' + o.code + ' ' + o.start + '~' + o.end);
      if (R(o.end) && o.ck) add('끝난 줄에 원가반영 (원가 이중 가능)', P + ' ' + o.row + '행 ' + o.code + ' ' + o.start + '~' + o.end);
      if (!o.end && !o.ck && codeOk.test(o.code)) add('지금 줄인데 원가반영 없음', P + ' ' + o.row + '행 ' + o.type + ' ' + o.code);
      if (o.ck && o.ck !== P) add('원가반영 값이 제품코드와 다름', P + ' ' + o.row + '행 F=' + o.ck);
      if (!o.buy && o.type !== '제품') add('매입정보 빈 줄', P + ' ' + o.row + '행 ' + o.type + ' ' + o.code);
      var calc = ((N(o.unit) * (N(o.fx) || 1)) + N(o.proc) + N(o.ship)) * (S(o.qty) === '' ? 1 : N(o.qty));
      if (!o.f && Math.abs(calc - N(o.cost)) > 1) add('소요원가 손입력이 계산과 다름', P + ' ' + o.row + '행 ' + o.code + ' 계산 ' + Math.round(calc * 100) / 100 + ' / 칸 ' + N(o.cost));
    });
    // 같은 자재(구분 + 코드 앞부분)가 같은 때 두 버전이 다 열려 있음
    var g = {};
    list.forEach(function (o) { if (codeOk.test(o.code) && !R(o.end) && !o.end) { var k = o.type + '|' + o.code.replace(/\d+$/, ''); (g[k] = g[k] || []).push(o); } });
    Object.keys(g).forEach(function (k) { var a = g[k]; if (a.length > 1 && a.some(function (o) { return o.code !== a[0].code; })) { var st = {}; a.forEach(function (o) { st[o.start] = 1; }); if (Object.keys(st).length === 1) add('같은 자재 두 버전이 같은 차수부터 열림', P + ' ' + a.map(function (o) { return o.row + '행 ' + o.code + ' ' + o.start + '~'; }).join(' · ')); } });
  });
  // 같은 자재코드인데 업체가 다름(코드 = 자재 규칙 위반)
  var byC = {};
  rows.forEach(function (o) { if (codeOk.test(o.code) && o.type !== '제품' && o.type !== '반제품') (byC[o.code] = byC[o.code] || []).push(o); });
  Object.keys(byC).forEach(function (c) {
    var vd = {}; byC[c].forEach(function (o) { var k = o.vendor.replace(/\s|\(주\)|주식회사|㈜/g, ''); if (k) (vd[k] = vd[k] || []).push(o.row); });
    if (Object.keys(vd).length > 1) add('같은 자재코드 업체 다름', c + ' ' + Object.keys(vd).map(function (k) { return k + '(' + vd[k].slice(0, 3).join(',') + '행)'; }).join(' / '));
  });
  var sum = {}, show = {};
  Object.keys(out).forEach(function (k) { sum[k] = out[k].length; show[k] = out[k].slice(0, 25); });
  return { 검사한줄: rows.length, 품목수: Object.keys(byP).length, 건수: sum, 예: show };
}

/**
 * ?diag=bomproto — BOM 연동 시안용 실제 데이터 묶음(읽기만).
 * 제품 발주 몇 건 + 그 제품 BOM 전체 줄 + 자재별 발주 + 데이터사양(디자인 파일 링크 · 진행색) + 부자재 발주 1건(역추적)
 */
function bomProtoDiag_(want) {
  requireAdmin_();
  var n = function (s) { return String(s == null ? '' : s).trim().toUpperCase(); };
  var cfg = (metaFast_('po') || {}).cfg || readConfig_();
  var orders = readOrderRows_(cfg).map(function (r) {
    return { id: r.id, code: n(r.code), name: r.name, batch: r.batch, state: r.state, eta: r.eta, qty: r.qty, inQty: r.inQty, remain: r.remain,
             vendor: r.vendor, price: r.price, orderedAt: r.orderedAt, brand: r.brand, closed: !!r.closed };
  });
  // BOM 탭은 지금 쓰는 양식(BOM3 · 없으면 BOM2)을 열 이름으로 읽는다 — 예전에는 옛 'BOM' 탭 · 열 번호를 박아 둬 양식이 바뀐 뒤 엉뚱한 칸을 읽거나 멈췄다
  var bsh = bomSheet_(), BC = bomCols_(bsh);
  var bLast = bsh.getLastRow();
  var bv = bLast > 2 ? bsh.getRange(3, 1, bLast - 2, BC.lc).getValues() : [];
  var g = function (r, k) { return BC[k] >= 0 ? r[BC[k]] : ''; };
  var bom = bv.filter(function (r) { return n(g(r, 'product')); }).map(function (r) {
    return { brand: g(r, 'brand'), product: n(g(r, 'product')), search: g(r, 'search'), start: String(g(r, 'start')), end: String(g(r, 'end')), code: n(g(r, 'code')), common: g(r, 'common'), type: g(r, 'type'), name: g(r, 'name'),
             vendor: g(r, 'vendor'), buy: g(r, 'buy'), spec: g(r, 'spec'), moq: g(r, 'moq'), qty: g(r, 'qty'), unit: g(r, 'unit'), proc: g(r, 'proc'), ship: g(r, 'ship'), cost: g(r, 'cost'), note: g(r, 'remark'), fx: g(r, 'fx') };
  });
  var byProd = {}; bom.forEach(function (b) { (byProd[b.product] = byProd[b.product] || []).push(b); });
  var byMat = {}; bom.forEach(function (b) { if (b.code && b.code !== b.product) (byMat[b.code] = byMat[b.code] || {})[b.product] = 1; });
  // 고르기: 진행 중 제품 발주 중 BOM 차수가 여럿이거나 지정턴키 자재가 있는 것
  var picks = [];
  var codes = String(want || '').split(',').map(n).filter(String);
  orders.forEach(function (o) {
    var b = byProd[o.code]; if (!b) return;
    var rounds = {}; b.forEach(function (x) { rounds[x.start] = 1; });
    var turnkey = b.some(function (x) { return /턴키/.test(String(x.buy)); });
    var score = (o.closed ? 0 : 10) + Object.keys(rounds).length + (turnkey ? 3 : 0);
    if (codes.length) score = codes.indexOf(o.code) > -1 ? 100 : -1;
    if (score >= 0) picks.push({ o: o, score: score });
  });
  picks.sort(function (a, b) { return b.score - a.score; });
  var seen = {}, chosen = [];
  picks.forEach(function (p) { if (chosen.length < 5 && !seen[p.o.code]) { seen[p.o.code] = 1; chosen.push(p.o); } });
  // 부자재 발주 1건(여러 제품에 쓰이는 자재)
  var matOrder = null, best = 0;
  orders.forEach(function (o) { var k = byMat[o.code] ? Object.keys(byMat[o.code]).length : 0; if (k > best && !o.closed) { best = k; matOrder = o; } });
  // 데이터사양(디자인 파일)
  var dss = SpreadsheetApp.openById(RB_SPEC_SS_ID).getSheetByName('데이터사양');
  var dlr = dss.getLastRow(), dlc = Math.min(dss.getLastColumn(), 24);
  var head = dss.getRange(2, 1, 1, dlc).getDisplayValues()[0].map(function (h) { return String(h).replace(/\s+/g, ' ').trim(); });
  var dv = dss.getRange(3, 1, dlr - 2, dlc).getDisplayValues(), drt = dss.getRange(3, 1, dlr - 2, dlc).getRichTextValues(), dbg = dss.getRange(3, 1, dlr - 2, dlc).getBackgrounds();
  var legend = dss.getRange(1, 1, 1, dlc).getDisplayValues()[0], legendBg = dss.getRange(1, 1, 1, dlc).getBackgrounds()[0];
  var norm = function (s) { return String(s || '').replace(/\s+/g, '').toLowerCase(); };
  var specRows = dv.map(function (r, i) {
    var cells = {};
    for (var j = 4; j < dlc; j++) {
      var link = ''; try { link = drt[i][j] ? (drt[i][j].getLinkUrl() || '') : ''; } catch (e) { link = ''; }
      if (r[j] || link) cells[head[j] || ('열' + (j + 1))] = { t: r[j], link: link, bg: dbg[i][j] };
    }
    return { brand: r[0], name: r[3], key: norm(r[3]), cells: cells };
  });
  var specFor = function (o) {
    var prodRow = (byProd[o.code] || []).filter(function (x) { return x.type === '제품'; })[0];
    var names = [o.name, prodRow && prodRow.name].map(norm).filter(String);
    return specRows.filter(function (s) { return s.key && names.some(function (nm) { return nm.indexOf(s.key) > -1 || s.key.indexOf(nm) > -1; }); })[0] || null;
  };
  var matOrders = function (code) { return orders.filter(function (o) { return o.code === code; }); };
  var pack = function (o) {
    var b = byProd[o.code] || [];
    var mats = {}; b.forEach(function (x) { if (x.code && !mats[x.code]) mats[x.code] = matOrders(x.code); });
    return { order: o, bom: b, matOrders: mats, spec: specFor(o) };
  };
  return {
    만든시각: new Date().toISOString(),
    제품발주: chosen.map(pack),
    부자재발주: matOrder ? { order: matOrder, usedIn: Object.keys(byMat[matOrder.code] || {}).map(function (p) {
      var pr = (byProd[p] || []).filter(function (x) { return x.code === matOrder.code; });
      return { product: p, name: ((byProd[p] || []).filter(function (x) { return x.type === '제품'; })[0] || {}).name || '', rows: pr, orders: orders.filter(function (o) { return o.code === p; }) };
    }) } : null,
    데이터사양범례: legend.map(function (t, i) { return t ? { t: t, bg: legendBg[i] } : null; }).filter(Boolean),
    데이터사양머리글: head
  };
}
