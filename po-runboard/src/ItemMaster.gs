/**
 * ============================================================
 * 품목 마스터 — 신규코드채번(_실행판_신규코드채번) 탭 정리용 진단(?diag=…)
 * ------------------------------------------------------------
 * 2026-10-08 사용자 결정: 품목 DB(_실행판_품목)가 기준(마스터). 신규코드채번은 코드 발급 대장일 뿐 — 두 탭을 합치지 않는다.
 *  · 예전 '합친 탭을 품목 목록으로 쓰기'(items:merged) 경로는 지웠다(늘 꺼져 있었다).
 *  · 남은 것: itemunmerge(예전에 합친 흔적 걷어내기) · itemrename(채번 탭 품목명 정정) · regmigrate(채번 탭 → 품목 DB 옮기기).
 * ============================================================
 */

var RB_IM = {
  FLAG: 'items:merged',
  CACHE: 'items:v2',
  // 예전 합치기 때 신규코드채번 탭 2행 머리글 오른쪽에 붙였던 칸(이름으로 찾는다 — 되돌리기 · 품목명 정정에서 쓴다)
  EXTRA: { channel: '채널', vendor: '업체', price: '단가', barcode: '바코드', old1: '구코드1', old2: '구코드2', who: '등록자', src: '출처' }
};

/** 신규코드채번 탭 칸 위치: 채번 칸 + 예전에 붙인 품목 칸(0부터, 없으면 -1) */
function imCols_(sh) {
  var lc = Math.min(sh.getLastColumn(), 40);
  var head = sh.getRange(2, 1, 1, lc).getDisplayValues()[0].map(function (s) { return String(s).replace(/\s+/g, ' ').trim(); });
  var C = bomRegCols_(sh);
  C.lc = lc; C.head = head;
  Object.keys(RB_IM.EXTRA).forEach(function (k) { C[k] = head.indexOf(RB_IM.EXTRA[k]); });
  C.note = head.indexOf('비고'); C.seq = head.indexOf('넘버');
  return C;
}

/**
 * 블록 쓰기 — 쓰기 전에 그 칸들의 데이터 확인(드롭다운) 규칙을 '경고만'으로 바꾸고(지운 탭을 가리키는 규칙은 뗀다) 쓴다.
 * 구글 시트는 '목록 밖 값 거부' 오류를 쓰는 순간이 아니라 반영(flush) 때 내서, 쓰기를 try 로 감싸도 못 잡았다(2026-10-08 E1202 모제품명).
 */
function imRelaxRange_(rg) {
  try {
    var names = {};
    try { rg.getSheet().getParent().getSheets().forEach(function (x) { names[x.getName()] = 1; }); } catch (e0) { names = null; }
    var dv = rg.getDataValidations(), ch = false;
    var out = dv.map(function (row) {
      return row.map(function (r) {
        if (!r) return r;
        try {
          var bad = r.getCriteriaValues().some(function (x) {
            if (x && typeof x.getSheet === 'function') return false;
            var m = String(x == null ? '' : x).match(/'?([^'!=(),]+)'?!/);
            return !!(m && names && !names[m[1].trim()]);
          });
          if (bad) { ch = true; return null; }
        } catch (e1) { ch = true; return null; }
        if (r.getAllowInvalid()) return r;
        ch = true;
        try { return r.copy().setAllowInvalid(true).build(); } catch (e2) { return null; }
      });
    });
    if (ch) { try { rg.setDataValidations(out); } catch (e3) { rg.clearDataValidations(); } }
  } catch (e) { try { rg.clearDataValidations(); } catch (e4) { /* 넘어간다 */ } }
}

/**
 * ?diag=itemrename&codes=A,B — 지정한 코드만 신규코드채번(품목 마스터) 품목명을 품목 DB 이름으로 바꾼다(코드가 서로 바뀌어 적힌 경우 등).
 * 기본은 미리보기, &apply=1 이면 쓴다. 원래 채번 이름은 비고에 '채번 이름: …' 으로, 변경이력에 '품목명(품목 DB 기준)' 으로 남긴다.
 */
function itemRename_(codesTxt, apply) {
  requireAdmin_();
  var want = String(codesTxt || '').split(/[,\s]+/).map(itemCodeKey_).filter(String);
  if (!want.length) throw new Error('&codes=코드1,코드2 를 넣어 주세요.');
  var ss = bomSS_(), reg = ss.getSheetByName(RB_BOM_REG), old = ss.getSheetByName(RB_ITEM.TAB);
  if (!reg || !old) throw new Error('신규코드채번 · 품목 DB 탭이 있어야 합니다.');
  var oldName = {};
  if (old.getLastRow() >= 2) old.getRange(2, 1, old.getLastRow() - 1, 2).getValues().forEach(function (r) { var k = itemCodeKey_(r[0]); if (k && !oldName[k]) oldName[k] = str_(r[1]); });
  var C = imCols_(reg), n = Math.max(0, reg.getLastRow() - 2);
  var v = n ? reg.getRange(3, 1, n, C.lc).getValues() : [];
  var plan = [];
  want.forEach(function (code) {
    var i = -1; for (var k = 0; k < v.length; k++) if (itemCodeKey_(v[k][C.code]) === code) { i = k; break; }
    if (i < 0) { plan.push({ 코드: code, 결과: '신규코드채번에 없음' }); return; }
    if (!oldName[code]) { plan.push({ 코드: code, 결과: '품목 DB에 없음' }); return; }
    var was = str_(v[i][C.name]);
    plan.push({ 코드: code, 행: i + 3, 지금: was, 바꿀이름: oldName[code], 결과: was === oldName[code] ? '이미 같음' : (apply ? '바꿈' : '바꿀 예정') , _i: i });
  });
  if (apply) {
    var lock = LockService.getScriptLock();
    waitLock_(lock);
    var outer = deferVer_();
    try {
      var hist = [];
      plan.forEach(function (p) {
        if (p._i === undefined || p.지금 === p.바꿀이름) return;
        var row = p._i + 3;
        imRelaxRange_(reg.getRange(row, 1, 1, C.lc));
        reg.getRange(row, C.name + 1).setValue(p.바꿀이름);
        if (C.note >= 0) { var nt = str_(v[p._i][C.note]); reg.getRange(row, C.note + 1).setValue((nt ? nt + ' / ' : '') + '채번 이름: ' + p.지금 + ' (품목 DB 기준으로 고침 ' + ymd_(new Date()) + ')'); }
        hist.push({ kind: '품목 마스터', code: p.코드, name: p.바꿀이름, item: '품목명(품목 DB 기준)', before: p.지금, after: p.바꿀이름, reason: '코드와 품목명이 서로 바뀌어 적힘', where: RB_BOM_REG + ' ' + row + '행' });
      });
      if (hist.length) appendHist_(hist);
      SpreadsheetApp.flush();
    } finally {
      try { endVer_(outer); } catch (e) { /* 넘어간다 */ }
      lock.releaseLock();
    }
    cacheDrop_(RB_IM.CACHE); cacheDrop_(RB_ITEM.CACHE); cacheDrop_(RB_II_CACHE);
  }
  plan.forEach(function (p) { delete p._i; });
  return { 미리보기: !apply, 바꿀것: plan, 안내: apply ? '' : '맞으면 아래 [적용주소] 를 5분 안에 여세요' };
}

/**
 * ?diag=itemunmerge — 합치기 되돌리기: 신규코드채번 탭을 코드 발급 대장으로 원상복구한다(품목 DB 가 기준).
 *  · 합치기로 붙인 칸(채널 · 업체 · 단가 · 바코드 · 구코드1 · 구코드2 · 등록자 · 출처)을 지운다
 *  · 합치기로 더한 줄(비고 '품목 DB에서 합침')을 지운다
 *  · 비고에 덧붙인 '품목 DB 이름: …' 을 걷어낸다(품목명 정정의 '채번 이름: …' 은 그대로)
 * 기본은 미리보기, &apply=1 이면 쓴다.
 */
function itemUnmerge_(apply) {
  requireAdmin_();
  var reg = bomSS_().getSheetByName(RB_BOM_REG);
  if (!reg) throw new Error('신규코드채번 탭이 없습니다.');
  var lc = reg.getLastColumn(), head = reg.getRange(2, 1, 1, lc).getDisplayValues()[0].map(function (x) { return String(x).replace(/\s+/g, ' ').trim(); });
  var extraNames = Object.keys(RB_IM.EXTRA).map(function (k) { return RB_IM.EXTRA[k]; });
  var cols = [];
  head.forEach(function (h, i) { if (i >= 14 && extraNames.indexOf(h) > -1) cols.push(i + 1); });
  var noteC = head.indexOf('비고');
  var n = Math.max(0, reg.getLastRow() - 2);
  var notes = n && noteC >= 0 ? reg.getRange(3, noteC + 1, n, 1).getValues() : [];
  var rowsDel = [], noteFix = [];
  notes.forEach(function (r, i) {
    var t = str_(r[0]);
    if (/품목 DB에서 합침/.test(t)) rowsDel.push(i + 3);
    else if (/품목 DB 이름: /.test(t)) noteFix.push({ row: i + 3, was: t, now: t.replace(/( \/ )?품목 DB 이름: [^/]*/g, '').replace(/^ \/ /, '').trim() });
  });
  var plan = { 지울칸: cols.map(function (c) { return colRB_(c) + ' ' + head[c - 1]; }), 지울줄: rowsDel.length, 비고정리: noteFix.length,
    안내: apply ? '' : '미리보기입니다(시트는 그대로). 맞으면 아래 [적용주소] 를 5분 안에 여세요' };
  if (!apply) return plan;
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  try {
    noteFix.forEach(function (x) { reg.getRange(x.row, noteC + 1).setValue(x.now); });
    rowsDel.slice().sort(function (a, b) { return b - a; }).forEach(function (r) { reg.deleteRow(r); });
    cols.slice().sort(function (a, b) { return b - a; }).forEach(function (c) { reg.deleteColumn(c); });
    PropertiesService.getScriptProperties().setProperty(RB_IM.FLAG, '0');
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  cacheDrop_(RB_IM.CACHE); cacheDrop_(RB_ITEM.CACHE); cacheDrop_(RB_II_CACHE);
  try { CacheService.getScriptCache().remove('bom4:idx:n'); } catch (e) { /* 넘어간다 */ }
  plan.결과 = '되돌렸습니다 — 신규코드채번은 코드 발급 대장, 품목 목록은 품목 DB(_실행판_품목)';
  return plan;
}

/**
 * ?diag=regmigrate — 신규코드채번 탭에서 품목 DB 에 없는 코드 중 '실행판이 만든 코드'만 품목 DB 로 옮긴다(탭을 지우기 전에).
 *  실행판이 만든 코드 = BOM 변경이력 자재코드(후) · 신제품 BOM 제품코드, 또는 채번 탭 비고에 '실행판'.
 *  되돌린 코드는 출처에 '미사용'을 붙여 옮긴다(품목 검색에서 빠지고 번호는 다시 쓰지 않음).
 *  나머지(실행판 밖에서 채번한 코드)는 옮기지 않는다 — BOM 에 쓰였으면 BOM 보기에 '품목코드 생성 필요'로 떠서 하나씩 확인 후 등록.
 *  중복은 거른다: 채번 탭 안에서 같은 코드가 또 나오면 처음 줄만, 품목 DB 에 이미 있으면(미사용 포함) 건너뜀.
 * 기본은 미리보기, &apply=1 이면 쓴다.
 */
function regMigrate_(apply) {
  requireAdmin_();
  var ss = bomSS_(), reg = ss.getSheetByName(RB_BOM_REG);
  if (!reg) return { 결과: '신규코드채번 탭이 없습니다 — 옮길 것 없음' };
  var RC = bomRegCols_(reg);
  if (RC.code < 0) throw new Error('신규코드채번 탭에서 신규코드 칸을 못 찾았습니다.');
  var lc = reg.getLastColumn(), n = Math.max(0, reg.getLastRow() - 2);
  var head = reg.getRange(2, 1, 1, lc).getDisplayValues()[0].map(function (x) { return String(x).replace(/\s+/g, ' ').trim(); });
  var noteC = head.indexOf('비고');
  var v = n ? reg.getRange(3, 1, n, lc).getValues() : [];
  var inDb = {};
  itemDbAllCodes_().forEach(function (c) { inDb[c] = 1; });
  // 실행판이 만든 코드(BOM 변경이력)
  var made = {}, undone = {};
  var lg = ss.getSheetByName(RB_BOM_LOG);
  if (lg && lg.getLastRow() > 1) lg.getRange(2, 1, lg.getLastRow() - 1, 14).getValues().forEach(function (r) {
    var cs = [itemCodeKey_(r[8])];
    if (str_(r[5]) === '신제품 BOM') cs.push(itemCodeKey_(r[2]));
    var back = /되돌/.test(str_(r[13]));
    cs.forEach(function (c) { if (c) (back ? undone : made)[c] = 1; });
  });
  // BOM 탭 이름(채번 탭에 품목명이 비었을 때) · BOM 에 쓰였는지
  var bomName = {};
  try {
    var bs = bomSheet_(), C = bomCols_(bs), lr = bs.getLastRow();
    if (lr > 2) bs.getRange(3, 1, lr - 2, C.lc).getValues().forEach(function (r) { var c = itemCodeKey_(r[C.code]); if (c && !bomName[c]) bomName[c] = str_(r[C.name]) || c; });
  } catch (eB) { /* 이름은 채번 탭 것만 */ }
  var seen = {}, dup = [], already = 0, move = [], gone = [], keep = [];
  v.forEach(function (r, i) {
    var c = itemCodeKey_(r[RC.code]);
    if (!c) return;
    if (seen[c]) { dup.push(c + ' (' + (i + 3) + '행 = ' + seen[c] + '행과 같은 코드)'); return; }
    seen[c] = i + 3;
    if (inDb[c]) { already++; return; }
    var note = noteC >= 0 ? str_(r[noteC]) : '';
    var it = { code: c, name: (RC.name >= 0 ? str_(r[RC.name]) : '') || bomName[c] || c, brand: RC.brand >= 0 ? str_(r[RC.brand]) : '', row: i + 3 };
    if (made[c] || /실행판/.test(note) && !/되돌림/.test(note)) move.push(it);
    else if (undone[c] || /실행판 되돌림/.test(note)) gone.push(it);
    else keep.push(it);
  });
  var line = function (x) { return x.code + ' · ' + x.name + ' (' + x.row + '행)' + (bomName[x.code] ? ' · BOM 사용' : ''); };
  var plan = {
    옮김_실행판이만든코드: move.length, 옮김_되돌린코드_미사용: gone.length,
    옮기지않음_실행판밖채번: keep.length, 옮기지않음중_BOM에쓰임: keep.filter(function (x) { return bomName[x.code]; }).length,
    이미품목DB에있음: already, 채번탭안중복_거름: dup.length,
    안내: apply ? '' : '미리보기입니다(시트는 그대로). 맞으면 아래 [적용주소] 를 5분 안에 여세요 · 옮기지 않은 코드 중 BOM 에 쓰인 것은 BOM 보기에 \u2018품목코드 생성 필요\u2019로 뜹니다.',
    옮길목록: move.map(line).slice(0, 300), 미사용으로옮길목록: gone.map(line).slice(0, 200),
    옮기지않을목록: keep.map(line).slice(0, 300), 중복목록: dup.slice(0, 100)
  };
  if (!apply) return plan;
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var put = 0;
  try {
    put += appendItems_(move, '신규코드채번에서 옮김(실행판 생성)');
    put += appendItems_(gone, '신규코드채번에서 옮김(실행판 생성) · 실행판 되돌림 · 미사용');
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  plan.결과 = '품목 DB 에 ' + put + '개 넣었습니다(중복은 거름). 이제 신규코드채번 탭을 지워도 실행판은 품목 DB 만 봅니다.';
  return plan;
}
