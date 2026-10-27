/**
 * ============================================================
 * 진단 주소(관리자만) — ?time=1 · ?diag=<이름>
 * ------------------------------------------------------------
 * doGet 이 관리자 확인을 한 뒤 여기로 넘긴다. 처리했으면 글 응답을, 모르는 이름이면 null 을 돌려준다(그러면 화면을 띄운다).
 * 예전에는 doGet 안에 if 가 50개 남짓 이어져 있었다(2026-10-07 그대로 옮김 — 동작은 같다).
 * 새 진단은 여기 아래에 붙인다. 데이터를 바꾸는 진단은 diagApplyRoute_ 로 감싼다:
 *   apply 없이 열면 미리보기 + 1회용 적용 주소(&apply=1&tok=…, 5분 · 연 사람 · 같은 파라미터에만 맞음)를 돌려준다.
 *   &apply=1 은 그 토큰이 맞을 때만 실제로 쓰고, 토큰은 바로 지운다. 토큰이 없거나 틀리면 미리보기만.
 *   (다른 사이트가 관리자 브라우저로 '…&apply=1' 링크를 열게 해도 토큰을 모르므로 아무것도 바뀌지 않는다.)
 * 2026-10-13: 끝난 1회성 이관 진단(dbmigrate · dbreshape · bommigrate · bomprune · bomcur · dbcheck · dbwritetest)은 함수와 함께 지웠다.
 * ============================================================
 */
// ?diag=stockscan 기본값(재고시트 · 탭). &ss= &gid= 로 바꿀 수 있다.
var RB_STOCKSCAN_SS_ID = '1dD0MHMVBxFN0efhT-MLe7oeww_n8NqJCARH3PLMnm-A';
var RB_STOCKSCAN_GID = 1047430116;
var RB_DIAG_TOK_SEC = 300;   // 적용 토큰 유효 시간(초)

function diagText_(o) { return ContentService.createTextOutput(JSON.stringify(o, null, 1)).setMimeType(ContentService.MimeType.TEXT); }

/** 토큰을 묶을 내용: 진단 이름 + apply · tok 을 뺀 파라미터(이름순) */
function diagSig_(e, name) {
  var p = (e && e.parameter) || {};
  return name + '?' + Object.keys(p).filter(function (k) { return k !== 'apply' && k !== 'tok'; }).sort()
    .map(function (k) { return k + '=' + p[k]; }).join('&');
}

/** &apply=1&tok= 이 맞는지. 맞든 틀리든 그 토큰은 바로 지운다(한 번만). */
function diagApplyOk_(e, name) {
  var p = (e && e.parameter) || {};
  if (p.apply !== '1') return false;
  var tok = String(p.tok || ''), who = String(me_() || '').toLowerCase();
  if (!tok || !who) return false;
  var c = CacheService.getScriptCache(), k = 'dtok:' + tok, v = c.get(k);
  if (!v) return false;
  c.remove(k);
  return v === who + '|' + diagSig_(e, name);
}

/** 미리보기 뒤 1회용 적용 주소를 만든다(5분). */
function diagApplyUrl_(e, name) {
  var who = String(me_() || '').toLowerCase();
  if (!who) return '';
  var tok = Utilities.getUuid();
  CacheService.getScriptCache().put('dtok:' + tok, who + '|' + diagSig_(e, name), RB_DIAG_TOK_SEC);
  var p = (e && e.parameter) || {};
  var q = Object.keys(p).filter(function (k) { return k !== 'apply' && k !== 'tok'; }).sort()
    .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(p[k]); });
  return ScriptApp.getService().getUrl() + '?' + q.concat(['apply=1', 'tok=' + tok]).join('&');
}

/** 데이터를 바꾸는 진단 공통: run(apply) 를 부르고, 미리보기면 적용 주소를 붙인다. */
function diagApplyRoute_(e, name, run) {
  var res, ok = false, tried = !!(e && e.parameter && e.parameter.apply === '1');
  try {
    requireAdmin_();
    ok = diagApplyOk_(e, name);
    res = run(ok);
  } catch (err) { res = { 오류: err.message }; }
  if (ok) return diagText_(res);
  var o = (res && typeof res === 'object' && !Array.isArray(res)) ? res : { 결과: res };
  if (tried) o.적용안됨 = '적용 토큰이 없거나 맞지 않습니다(5분 지남 · 이미 씀 · 다른 사람 · 파라미터 바뀜). 아무것도 바꾸지 않고 미리보기만 보여 줍니다.';
  if (!o.오류) {
    try {
      var url = diagApplyUrl_(e, name);
      if (url) { o.적용주소 = url; o.적용안내 = '적용하려면 이 주소를 여세요: ' + url + ' (5분 안 · 한 번만)'; }
    } catch (err2) { o.적용안내 = '적용 주소를 만들지 못했습니다: ' + err2.message; }
  }
  return diagText_(o);
}

function diagRoute_(e) {
  // ?time=1 — 느릴 때 어느 단계가 오래 걸리는지 확인하는 용도
  if (e && e.parameter && e.parameter.time === '1') {
    var b = apiBootstrap(Number(e.parameter.force) || 0, e.parameter.mode);
    return ContentService
      .createTextOutput(JSON.stringify({
        timing: b.timing,
        rows: b.rows.length,
        steps: b.steps.map(function (s, i) { return (i + 1) + '. ' + s.title; })
      }, null, 1))
      .setMimeType(ContentService.MimeType.TEXT);
  }
  // 진단(관리자만): verify = 발주 DB · 지급 줄 · AP 교차 확인
  if (e && e.parameter && e.parameter.diag === 'etanolines') {
    var enl; try { enl = diagEtaNoLines_(); } catch (err) { enl = { 오류: err.message }; }
    return ContentService.createTextOutput(JSON.stringify(enl, null, 1)).setMimeType(ContentService.MimeType.TEXT);
  }
  if (e && e.parameter && e.parameter.diag === 'owner') {
    var odg; try { odg = diagOwner_(str_(e.parameter.name) || '노바', str_(e.parameter.since) || '2026-10-09'); } catch (err) { odg = { 오류: err.message }; }
    return ContentService.createTextOutput(JSON.stringify(odg, null, 1)).setMimeType(ContentService.MimeType.TEXT);
  }
  if (e && e.parameter && e.parameter.diag === 'sample') {
    var sdg; try { sdg = diagSample_(str_(e.parameter.q)); } catch (err) { sdg = { 오류: err.message }; }
    return ContentService.createTextOutput(JSON.stringify(sdg, null, 1)).setMimeType(ContentService.MimeType.TEXT);
  }
  if (e && e.parameter && e.parameter.diag === 'prog') {
    return ContentService.createTextOutput(JSON.stringify(diagProg_(e.parameter.id || ''), null, 1)).setMimeType(ContentService.MimeType.TEXT);
  }
  if (e && e.parameter && e.parameter.diag === 'hist') {
    return ContentService.createTextOutput(JSON.stringify(diagHist_(e.parameter.q || ''), null, 1)).setMimeType(ContentService.MimeType.TEXT);
  }
  if (e && e.parameter && e.parameter.diag === 'stockrows') {
    // 읽기만: 재고시트에서 서버가 읽는 C열(품목코드) · G열(구분) — 병합 칸이 비어 읽히는지
    var srw; try {
      requireAdmin_(); var src = RB_STOCK_SRC[Number(e.parameter.which || 1)];
      var shR = SpreadsheetApp.openById(src.ss).getSheets().filter(function (x) { return x.getSheetId() === src.gid; })[0];
      var n = Math.min(shR.getLastRow(), 60), cv = shR.getRange(1, src.codeCol, n, 1).getValues(), kv = shR.getRange(1, src.kindCol, n, 1).getDisplayValues();
      srw = { 탭: shR.getName(), 줄: cv.map(function (r, i) { return (i + 1) + ' ' + (str_(r[0]) || '(빈칸)') + ' | ' + kv[i][0]; }) };
    } catch (err) { srw = { 오류: err.message }; }
    return ContentService.createTextOutput(JSON.stringify(srw, null, 1)).setMimeType(ContentService.MimeType.TEXT);
  }
  if (e && e.parameter && e.parameter.diag === 'stockplan') {
    var spn; try { requireAdmin_(); var t0s = Date.now(); spn = apiStockPlan(true); var withV = Object.keys(spn.plan).filter(function (c) { return Object.keys(spn.plan[c]).length && (!e.parameter.pre || c.indexOf(e.parameter.pre) === 0); }); spn = { ms: Date.now() - t0s, 품목: Object.keys(spn.plan).length, H품목: Object.keys(spn.plan).filter(function (c) { return /^H/.test(c); }).length, 예정있는품목: withV.length, 예: withV.slice(0, 30).map(function (c) { return c + ' ' + JSON.stringify(spn.plan[c]); }), notes: spn.notes, today: spn.today, year: spn.year }; } catch (err) { spn = { 오류: err.message }; }
    return ContentService.createTextOutput(JSON.stringify(spn, null, 1)).setMimeType(ContentService.MimeType.TEXT);
  }
  if (e && e.parameter && e.parameter.diag === 'stockscan') {
    // 읽기만: 재고시트 구조 보기(탭 목록 · 지정 탭 위쪽 칸 · 품목 블록 모양)
    var sk; try {
      requireAdmin_();
      var ssS = SpreadsheetApp.openById(str_(e.parameter.ss) || RB_STOCKSCAN_SS_ID);
      var gid = Number(e.parameter.gid || RB_STOCKSCAN_GID), shS = ssS.getSheets().filter(function (x) { return x.getSheetId() === gid; })[0];
      sk = { 제목: ssS.getName(), 탭: ssS.getSheets().map(function (x) { return x.getName() + '(' + x.getSheetId() + ') ' + x.getLastRow() + '×' + x.getLastColumn(); }) };
      if (shS) {
        var nr = Math.min(shS.getLastRow(), Number(e.parameter.rows || 40)), nc = Math.min(shS.getLastColumn(), Number(e.parameter.cols || 16));
        var dv = shS.getRange(1, 1, nr, nc).getDisplayValues(), vv = shS.getRange(1, 1, 3, Math.min(shS.getLastColumn(), 400)).getValues();
        sk.이탭 = shS.getName(); sk.크기 = shS.getLastRow() + '×' + shS.getLastColumn(); sk.고정행 = shS.getFrozenRows(); sk.고정열 = shS.getFrozenColumns();
        sk.위쪽 = dv.map(function (r, i) { return (i + 1) + ': ' + r.map(function (x) { return String(x).replace(/\s+/g, ' ').slice(0, 28); }).join(' | '); });
        sk.날짜행 = vv.map(function (r, i) { var d = r.map(function (x, j) { return x instanceof Date ? colRB_(j + 1) + '=' + fmtDate_(x) : ''; }).filter(String); return (i + 1) + '행 날짜칸 ' + d.length + ' 처음 ' + d.slice(0, 3).join(', ') + ' 끝 ' + d.slice(-3).join(', '); });
        var gcol = shS.getRange(1, 7, shS.getLastRow(), 1).getDisplayValues(), kinds = {};
        gcol.forEach(function (r) { var k = String(r[0]).trim(); if (k) kinds[k] = (kinds[k] || 0) + 1; });
        sk.G열값 = kinds;
      }
    } catch (err) { sk = { 오류: err.message }; }
    return ContentService.createTextOutput(JSON.stringify(sk, null, 1)).setMimeType(ContentService.MimeType.TEXT);
  }
  if (e && e.parameter && e.parameter.diag === 'perfreads') {
    var prr; try { prr = perfReads_(); } catch (err) { prr = { 오류: err.message }; }
    return ContentService.createTextOutput(JSON.stringify(prr, null, 1)).setMimeType(ContentService.MimeType.TEXT);
  }
  if (e && e.parameter && e.parameter.diag === 'perfwrites') {
    var pwr; try { pwr = perfWrites_(); } catch (err) { pwr = { 오류: err.message }; }
    return ContentService.createTextOutput(JSON.stringify(pwr, null, 1)).setMimeType(ContentService.MimeType.TEXT);
  }
  if (e && e.parameter && e.parameter.diag === 'perflog') {
    var pl; try { pl = perfLog_(); delete pl._all; } catch (err) { pl = { 오류: err.message }; }
    return ContentService.createTextOutput(JSON.stringify(pl, null, 1)).setMimeType(ContentService.MimeType.TEXT);
  }
  if (e && e.parameter && e.parameter.diag === 'perf') {
    var pres;
    try { pres = perfDiag_(); } catch (err) { pres = { 오류: err.message }; }
    return ContentService.createTextOutput(JSON.stringify(pres, null, 1)).setMimeType(ContentService.MimeType.TEXT);
  }
  if (e && e.parameter && e.parameter.diag === 'perfw') {
    var pw;
    try { pw = perfWriteDiag_(); } catch (err) { pw = { 오류: err.message }; }
    return ContentService.createTextOutput(JSON.stringify(pw, null, 1)).setMimeType(ContentService.MimeType.TEXT);
  }
  if (e && e.parameter && e.parameter.diag === 'perfsave') {
    var ps;
    try { ps = perfSaveDiag_(); } catch (err) { ps = { 오류: err.message }; }
    return ContentService.createTextOutput(JSON.stringify(ps, null, 1)).setMimeType(ContentService.MimeType.TEXT);
  }
  if (e && e.parameter && e.parameter.diag === 'perfj') {
    var pj;
    try { pj = perfJournalDiag_(); } catch (err) { pj = { 오류: err.message }; }
    return ContentService.createTextOutput(JSON.stringify(pj, null, 1)).setMimeType(ContentService.MimeType.TEXT);
  }
  if (e && e.parameter && e.parameter.diag === 'perfboot') {
    var pb;
    try { pb = perfBootDiag_(); } catch (err) { pb = { 오류: err.message }; }
    return ContentService.createTextOutput(JSON.stringify(pb, null, 1)).setMimeType(ContentService.MimeType.TEXT);
  }
  if (e && e.parameter && e.parameter.diag === 'bomrows') {
    // 읽기만: 품목들의 BOM 줄(원가반영 · 입고지 포함) — 발주 단가 계산 기준 점검용
    var br;
    try {
      requireAdmin_();
      var want = String(e.parameter.codes || '').toUpperCase().split(',');
      var bsh = bomSheet_(), BC = bomCols_(bsh), bv = bsh.getRange(3, 1, bsh.getLastRow() - 2, BC.lc).getValues();
      br = bv.map(function (r, i) { return { r: r, i: i }; }).filter(function (x) { return want.indexOf(String(x.r[BC.product]).toUpperCase()) > -1; }).map(function (x) {
        var r = x.r; return [x.i + 3, r[BC.product], 'F=' + r[BC.costKey], r[BC.start] + '~' + r[BC.end], r[BC.type], r[BC.code], r[BC.vendor], r[BC.buy], r[BC.place], r[BC.qty], r[BC.unit], r[BC.proc], r[BC.cost]].join(' | ');
      });
    } catch (err) { br = { 오류: err.message }; }
    return ContentService.createTextOutput(JSON.stringify(br, null, 1)).setMimeType(ContentService.MimeType.TEXT);
  }
  if (e && e.parameter && e.parameter.diag === 'bomtabs') {
    // 읽기만: BOM 시트 탭 목록 · 다른 탭을 가리키는 수식(옮길 때 깨지지 않게)
    var bt;
    try {
      requireAdmin_();
      var bss0 = SpreadsheetApp.openById(RB.BOM_SS_ID);
      bt = bss0.getSheets().map(function (sh0) {
        var lr0 = sh0.getLastRow(), lc0 = sh0.getLastColumn(), o0 = { 탭: sh0.getName(), 숨김: sh0.isSheetHidden(), 행: lr0, 열: lc0 };
        if (lr0 && lc0 && lr0 * lc0 < RB_DIAG_MAX_CELLS) {
          var ff = sh0.getRange(1, 1, lr0, lc0).getFormulas(), n0 = 0, x0 = {}, ex = [];
          ff.forEach(function (r0, i0) { r0.forEach(function (f0, j0) { if (!f0) return; n0++; var m0 = f0.match(/'?([^'!(),=+\-*\/&\s]+)'?!/g); if (m0) m0.forEach(function (t0) { x0[t0] = (x0[t0] || 0) + 1; }); if (/IMPORTRANGE|IMPORTDATA|QUERY/i.test(f0) && ex.length < 3) ex.push((i0 + 1) + '행: ' + f0.slice(0, 120)); }); });
          o0.수식 = n0; o0.다른탭참조 = x0; o0.외부 = ex;
        }
        return o0;
      });
    } catch (err) { bt = { 오류: err.message }; }
    return ContentService.createTextOutput(JSON.stringify(bt, null, 1)).setMimeType(ContentService.MimeType.TEXT);
  }
  if (e && e.parameter && e.parameter.diag === 'bomget') {
    // 읽기만: 품목 BOM(apiBomGet 그대로, 캐시 아닌 시트에서)
    var bg; try { requireAdmin_(); var cc0 = str_(e.parameter.code).toUpperCase(); try { CacheService.getScriptCache().remove('bom4:p:' + cc0); } catch (x0) { /* 넘어간다 */ } bg = apiBomGet(cc0); } catch (err) { bg = { 오류: err.message }; }
    return ContentService.createTextOutput(JSON.stringify(bg)).setMimeType(ContentService.MimeType.TEXT);
  }
  if (e && e.parameter && e.parameter.diag === 'bomdiff') {
    // 읽기만: 두 품목 BOM 비교(a, b)
    var bd2; try { requireAdmin_(); bd2 = apiBomCompare(e.parameter.a, e.parameter.b); bd2.rows = bd2.rows.filter(function (p) { return p.diff || p.why; }).map(function (p) { return (p.a ? p.a.type + ' ' + p.a.code + ' ' + (p.a.ck ? p.a.cost : '(체크없음 ' + p.a.cost + ')') : '-') + '  |  ' + (p.b ? p.b.type + ' ' + p.b.code + ' ' + (p.b.ck ? p.b.cost : '(체크없음 ' + p.b.cost + ')') : '-') + '  | 차이 ' + p.diff + ' | ' + p.why; }); } catch (err) { bd2 = { 오류: err.message }; }
    return ContentService.createTextOutput(JSON.stringify(bd2, null, 1)).setMimeType(ContentService.MimeType.TEXT);
  }
  if (e && e.parameter && e.parameter.diag === 'trigs') {
    // 읽기만: 프로젝트 트리거 목록
    var tg; try { requireAdmin_(); tg = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction() + ' · ' + t.getEventType(); }); } catch (err) { tg = { 오류: err.message }; }
    return ContentService.createTextOutput(JSON.stringify(tg, null, 1)).setMimeType(ContentService.MimeType.TEXT);
  }
  if (e && e.parameter && e.parameter.diag === 'dvscan') {
    // 읽기만: 탭마다 데이터 확인(드롭다운) 규칙 중 없는 탭을 가리키는 것 · 목록 밖 값을 거부하는 것 세기(열 단위)
    var dvs; try {
      requireAdmin_();
      var ssd = ss_(), names = {}; ssd.getSheets().forEach(function (x) { names[x.getName()] = 1; });
      dvs = {};
      ['_실행판_BOM3', '_실행판_BOM2', '_실행판_BOM', '_실행판_신규코드채번', '_실행판_발주', '_실행판_BOM변경이력'].forEach(function (tn) {
        var shd = ssd.getSheetByName(tn); if (!shd) return;
        var lr = Math.min(shd.getLastRow(), 3000), lc = shd.getLastColumn(); if (lr < 1) return;
        var dv = shd.getRange(1, 1, lr, lc).getDataValidations(), byCol = {};
        dv.forEach(function (row, i) { row.forEach(function (r, j) {
          if (!r) return;
          var crit = '', args = '';
          try { crit = String(r.getCriteriaType()); args = r.getCriteriaValues().map(function (x) { return x && x.getA1Notation ? (x.getSheet().getName() + '!' + x.getA1Notation()) : String(x); }).join(' '); }
          catch (eR) { args = '[깨진 규칙 — 없는 탭/범위]'; }
          var miss = (args.match(/'?([^'!]+)'?!/) || [])[1];
          var k = colRB_(j + 1) + ' ' + crit + ' ' + args.slice(0, 60) + (miss && !names[miss] ? ' [없는 탭]' : '') + (r.getAllowInvalid() ? ' (경고만)' : ' (거부)');
          byCol[k] = (byCol[k] || 0) + 1;
        }); });
        dvs[tn] = byCol;
      });
    } catch (err) { dvs = { 오류: err.message }; }
    return ContentService.createTextOutput(JSON.stringify(dvs, null, 1)).setMimeType(ContentService.MimeType.TEXT);
  }
  if (e && e.parameter && e.parameter.diag === 'bomdroprow') {
    // BOM 한 줄 지우기(Migrate.gs) — 미리보기 → 1회용 적용 주소
    return diagApplyRoute_(e, 'bomdroprow', function (apply) { return bomDropRow_(e.parameter.row, e.parameter.product, e.parameter.mat, apply); });
  }
  if (e && e.parameter && e.parameter.diag === 'bomdrop') {
    // 반쯤 들어간 품목 BOM 줄 지우기(Migrate.gs) — 미리보기 → 1회용 적용 주소
    return diagApplyRoute_(e, 'bomdrop', function (apply) { return bomDropPartial_(e.parameter.code, apply); });
  }
  if (e && e.parameter && e.parameter.diag === 'bomckfill') {
    return diagApplyRoute_(e, 'bomckfill', function (apply) { return bomCkFill_(apply); });
  }
  if (e && e.parameter && e.parameter.diag === 'bomfxsync') {
    return diagApplyRoute_(e, 'bomfxsync', function (apply) { return bomFxSync_(apply); });
  }
  if (e && e.parameter && e.parameter.diag === 'bomfx') {
    // 읽기만: BOM 탭 평균환율 칸이 어떻게 쓰이는지(값 · 수식 · 업체 예) — 통화 칸 설계용
    var bf; try {
      requireAdmin_();
      var bsh = bomSheet_(), bC = bomCols_(bsh), blr = bsh.getLastRow(), bn = blr - 2;
      var bv = bsh.getRange(3, 1, bn, bC.lc).getValues(), bfm = bC.fx >= 0 ? bsh.getRange(3, bC.fx + 1, bn, 1).getFormulas() : [];
      var head = bsh.getRange(1, 1, 2, bC.lc).getDisplayValues();
      var g = {};
      bv.forEach(function (r, i) {
        if (!str_(r[bC.product])) return;
        var fxv = bC.fx >= 0 ? r[bC.fx] : '(칸 없음)', k = String(fxv) + (bfm[i] && bfm[i][0] ? ' 수식 ' + bfm[i][0].replace(/\d+/g, '#') : '');
        var x = g[k] || (g[k] = { 줄: 0, 업체: {}, 단가예: [], 끝난줄: 0 });
        x.줄++; if (str_(r[bC.end])) x.끝난줄++;
        var vd = str_(r[bC.vendor]); x.업체[vd] = (x.업체[vd] || 0) + 1;
        if (x.단가예.length < 4) x.단가예.push((i + 3) + '행 ' + vd + ' 단가 ' + r[bC.unit] + ' 원가 ' + r[bC.cost]);
      });
      Object.keys(g).forEach(function (k) { var u = g[k].업체; g[k].업체 = Object.keys(u).sort(function (a, b) { return u[b] - u[a]; }).slice(0, 12).map(function (v) { return v + ' ' + u[v]; }); });
      var cn = {};
      bv.forEach(function (r) { var vd = str_(r[bC.vendor]); if (/중국|china|CN/i.test(vd)) { var f = bC.fx >= 0 ? String(r[bC.fx]) : ''; cn[f] = (cn[f] || 0) + 1; } });
      bf = { 머리글1: head[0], 머리글2: head[1], 평균환율칸: bC.fx >= 0 ? colRB_(bC.fx + 1) : '없음', 값별: g, 중국업체줄의환율: cn };
    } catch (err) { bf = { 오류: err.message }; }
    return ContentService.createTextOutput(JSON.stringify(bf, null, 1)).setMimeType(ContentService.MimeType.TEXT);
  }
  if (e && e.parameter && e.parameter.diag === 'bomaudit') {
    var ba;
    try { ba = bomAuditDiag_(); } catch (err) { ba = { 오류: err.message, 위치: err.stack }; }
    return ContentService.createTextOutput(JSON.stringify(ba, null, 1)).setMimeType(ContentService.MimeType.TEXT);
  }
  if (e && e.parameter && e.parameter.diag === 'bomscan') {
    var bs;
    try { bs = bomScanDiag_(); } catch (err) { bs = { 오류: err.message }; }
    return ContentService.createTextOutput(JSON.stringify(bs, null, 1)).setMimeType(ContentService.MimeType.TEXT);
  }
  if (e && e.parameter && e.parameter.diag === 'bomproto') {
    var bp;
    try { bp = bomProtoDiag_(e.parameter.codes || ''); } catch (err) { bp = { 오류: err.message, 위치: err.stack }; }
    return ContentService.createTextOutput(JSON.stringify(bp)).setMimeType(ContentService.MimeType.TEXT);
  }
  if (e && e.parameter && e.parameter.diag === 'itemspec') {
    // 품목 DB 사양(M열) 빈 칸을 BOM 사양으로(ItemFill.gs). 미리보기 → 1회용 적용 주소
    return diagApplyRoute_(e, 'itemspec', function (apply) { return itemSpecFill_(apply); });
  }
  if (e && e.parameter && e.parameter.diag === 'regmigrate') {
    // 신규코드채번 → 품목 DB(실행판이 만든 코드만, ItemMaster.gs). 미리보기 → 1회용 적용 주소
    return diagApplyRoute_(e, 'regmigrate', function (apply) { return regMigrate_(apply); });
  }
  if (e && e.parameter && e.parameter.diag === 'itemunmerge') {
    // 품목 DB + 신규코드채번 합치기 되돌리기(ItemMaster.gs). 미리보기 → 1회용 적용 주소
    return diagApplyRoute_(e, 'itemunmerge', function (apply) { return itemUnmerge_(apply); });
  }
  if (e && e.parameter && e.parameter.diag === 'itemrename') {
    // 지정한 코드만 품목 마스터 품목명을 품목 DB 이름으로(ItemMaster.gs). &codes=A,B · 미리보기 → 1회용 적용 주소
    return diagApplyRoute_(e, 'itemrename', function (apply) { return itemRename_(e.parameter.codes, apply); });
  }
  if (e && e.parameter && e.parameter.diag === 'verify') {
    return ContentService.createTextOutput(JSON.stringify(verifyAll_(), null, 1)).setMimeType(ContentService.MimeType.TEXT);
  }
  if (e && e.parameter && e.parameter.diag === 'bomcmp') {
    // 읽기만: 옛 BOM 시트 탭과 옮긴 숨김 탭을 칸마다 견준다(열별 다른 칸 수 · 예)
    var bcm;
    try {
      requireAdmin_();
      var s1 = SpreadsheetApp.openById(RB.BOM_SS_ID), s2 = SpreadsheetApp.openById(RB.SS_ID);
      bcm = RB_BOM_MOVE_TABS.filter(function (n) { return s1.getSheetByName(n) && s2.getSheetByName('_실행판_' + n); }).map(function (n) {
        var x = s1.getSheetByName(n), y = s2.getSheetByName('_실행판_' + n), lr = Math.max(x.getLastRow(), y.getLastRow()), lc = Math.max(x.getLastColumn(), y.getLastColumn());
        if (lr * lc >= RB_DIAG_MAX_CELLS) return { 탭: n, 크기: lr + 'x' + lc, 건너뜀: RB_DIAG_MAX_CELLS + '칸 넘어 견주지 않음' };
        var a1 = x.getRange(1, 1, lr, lc).getDisplayValues(), b1 = y.getRange(1, 1, lr, lc).getDisplayValues(), byCol = {}, ex = [], err1 = 0, err2 = 0;
        for (var i = 0; i < lr; i++) for (var j = 0; j < lc; j++) {
          if (/^#/.test(a1[i][j])) err1++; if (/^#/.test(b1[i][j])) err2++;
          if (a1[i][j] !== b1[i][j]) { var k = colRB_(j + 1); byCol[k] = (byCol[k] || 0) + 1; if (ex.length < 6) ex.push((i + 1) + '행 ' + k + ': ' + a1[i][j].slice(0, 30) + ' ≠ ' + b1[i][j].slice(0, 30)); }
        }
        return { 탭: n, 크기: lr + 'x' + lc, 다른칸: byCol, 예: ex, 오류칸_원본: err1, 오류칸_옮긴것: err2 };
      });
    } catch (err) { bcm = { 오류: err.message }; }
    return ContentService.createTextOutput(JSON.stringify(bcm, null, 1)).setMimeType(ContentService.MimeType.TEXT);
  }
  if (e && e.parameter && e.parameter.diag === 'aptime') {
    // 읽기만: AP 행 만들기(저장 뒤 자동 갱신이 잠금 안에서 하는 일) 단계별 시간
    var at0; try {
      requireAdmin_(); var tt = Date.now(), T0 = {}, mk = function (k) { var n = Date.now(); T0[k] = n - tt; tt = n; };
      var ss0 = ss_(); mk('시트열기');
      var ls = readLinesAll_().rows.map(rowToLine_); mk('지급줄읽기(' + ls.length + ')');
      var H0 = RB_AP.helpers; var pl = H0.planLookup(ss0); mk('발주계획 · 부가정보 조회표');
      var at = orderAttrsForAp_(ss0); mk('발주DB 건정보(' + Object.keys(at).length + ')');
      var rows0 = apFromLines_(ls, at); mk('AP행(' + rows0.length + ')');
      at0 = T0;
    } catch (err) { at0 = { 오류: err.message }; }
    return ContentService.createTextOutput(JSON.stringify(at0, null, 1)).setMimeType(ContentService.MimeType.TEXT);
  }
  if (e && e.parameter && e.parameter.diag === 'apstatus') {
    var as0; try { as0 = apApStatus(); as0.시트탭 = ss_().getSheets().map(function (s) { return s.getName() + '(' + s.getSheetId() + ')'; }); } catch (err) { as0 = { 오류: err.message }; }
    return ContentService.createTextOutput(JSON.stringify(as0, null, 1)).setMimeType(ContentService.MimeType.TEXT);
  }
  if (e && e.parameter && e.parameter.diag === 'dbbackupdel') {
    // 백업 탭 영구 삭제(Migrate.gs) — 미리보기(지울 탭 목록) → 1회용 적용 주소
    return diagApplyRoute_(e, 'dbbackupdel', function (apply) { return dbBackupDel_(apply); });
  }
  if (e && e.parameter && e.parameter.diag === 'tabprofile') {
    // 읽기만: 탭의 머리글 · 칸마다 값 있는 행 수 · 수식 수 · 예시(양식 점검용)
    var tp;
    try {
      requireAdmin_();
      var tsh = SpreadsheetApp.openById(RB.SS_ID).getSheetByName(String(e.parameter.tab || ''));
      var tlr = tsh.getLastRow(), tlc = tsh.getLastColumn(), hr0 = Number(e.parameter.hr || 0);
      var tv = tsh.getRange(1, 1, tlr, tlc).getDisplayValues(), tf = tsh.getRange(1, 1, tlr, tlc).getFormulas();
      if (!hr0) { for (var hi = 0; hi < Math.min(6, tlr); hi++) { if (tv[hi].filter(String).length >= tlc * 0.5) { hr0 = hi + 1; break; } } }
      var head = tv[hr0 - 1] || [];
      tp = { 탭: tsh.getName(), 행: tlr, 열: tlc, 머리글행: hr0, 숨김: tsh.isSheetHidden(), 보호: tsh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length,
        칸: head.map(function (h, j) { var n = 0, nf = 0, ex = ''; for (var i = hr0; i < tlr; i++) { if (tv[i][j] !== '') { n++; if (!ex) ex = tv[i][j].slice(0, 30); } if (tf[i][j]) nf++; }
          return colRB_(j + 1) + ' ' + (h || '(빈 머리글)').split(String.fromCharCode(10)).join(' ') + ' | 값 ' + n + (nf ? ' · 수식 ' + nf : '') + (ex ? ' | 예 ' + ex : ''); }) };
    } catch (err) { tp = { 오류: err.message }; }
    return ContentService.createTextOutput(JSON.stringify(tp, null, 1)).setMimeType(ContentService.MimeType.TEXT);
  }
  if (e && e.parameter && e.parameter.diag === 'refscan') {
    // 읽기만: 구매팀 시트의 모든 탭 수식에서 어떤 탭 이름을 가리키는 칸을 찾는다(탭 지우기 전 확인)
    var rs;
    try {
      requireAdmin_();
      var nm = String(e.parameter.name || ''), ss0 = SpreadsheetApp.openById(RB.SS_ID), hits = [];
      // 시트 내장 찾기(수식 글자에서) — 탭을 하나씩 읽는 것보다 훨씬 빠르다
      var tf = e.parameter.tab ? ss0.getSheetByName(String(e.parameter.tab)).createTextFinder(String(e.parameter.rx || nm)).useRegularExpression(!!e.parameter.rx) : ss0.createTextFinder(nm);
      var found = tf.matchFormulaText(true).findAll(), by = {};
      found.forEach(function (rg) { var sn = rg.getSheet().getName(); if (sn === nm) return; var f0 = rg.getFormula(); if (!f0) return; (by[sn] = by[sn] || []).push(rg.getA1Notation() + ': ' + f0.slice(0, 120)); });
      // 예전: 칸마다 getRange 를 세 번(값 · 줄 머리 · 위 칸) — 탭마다 보여 줄 칸(40개)을 감싸는 범위를 한 번만 읽어 배열에서 꺼낸다
      Object.keys(by).forEach(function (sn) {
        var shx = ss0.getSheetByName(sn), list = by[sn].slice(0, 40).map(function (t) {
          var a1 = t.split(':')[0], m = a1.match(/^([A-Z]+)(\d+)$/), c = 0;
          if (!m) { var rg = shx.getRange(a1); return { t: t, r: rg.getRow(), c: rg.getColumn() }; }
          for (var q = 0; q < m[1].length; q++) c = c * 26 + (m[1].charCodeAt(q) - 64);
          return { t: t, r: Number(m[2]), c: c };
        });
        var r0 = Math.max(1, Math.min.apply(null, list.map(function (x) { return x.r - 1; }))), r1 = Math.max.apply(null, list.map(function (x) { return x.r; }));
        var c1 = Math.max.apply(null, list.map(function (x) { return x.c; })), big = (r1 - r0 + 1) * c1 > 50000;
        var dv = list.length && !big ? shx.getRange(r0, 1, r1 - r0 + 1, c1).getDisplayValues() : [], one = {};
        // 칸들이 멀리 흩어져 감싸는 범위가 크면 칸마다 (위 칸 ~ 그 칸, 1열 ~ 그 열) 한 번씩만 읽는다
        if (big) list.forEach(function (x) { var rr = Math.max(1, x.r - 1); one[x.t] = { r: rr, v: shx.getRange(rr, 1, x.r - rr + 1, x.c).getDisplayValues() }; });
        var cur = null;
        var at = function (r, c) {
          if (cur) { var w = cur.v[r - cur.r]; return w ? w[c - 1] : ''; }
          var row = dv[r - r0]; return row ? row[c - 1] : '';
        };
        hits.push({ 탭: sn, 칸수: by[sn].length, 칸: list.map(function (x) {
          cur = big ? one[x.t] : null;
          var lab = []; for (var j = 1; j <= Math.min(3, x.c); j++) lab.push(at(x.r, j));
          return x.t + ' | 값 ' + at(x.r, x.c) + ' | 줄 머리 ' + lab.join(' / ') + ' | 위칸 ' + at(Math.max(1, x.r - 1), x.c); }) });
      });
      var named = ss0.getNamedRanges().filter(function (r) { try { return r.getRange().getSheet().getName() === nm; } catch (e1) { return false; } }).map(function (r) { return r.getName(); });
      rs = { 탭: nm, 있음: !!ss0.getSheetByName(nm), 수식참조: hits, 이름범위: named };
    } catch (err) { rs = { 오류: err.message }; }
    return ContentService.createTextOutput(JSON.stringify(rs, null, 1)).setMimeType(ContentService.MimeType.TEXT);
  }
  // 지급 줄 저장 속도 재기(관리자). 그 건의 줄을 바꾸지 않고 다시 저장해 예전 방식 · 지금 방식 단계별 시간을 비교한다.
  if (e && e.parameter && e.parameter.diag === 'savebench') {
    // 그 건의 지급 줄을 바꾸지 않고 다시 저장한다(운영 시트에 씀) — 미리보기 → 1회용 적용 주소
    return diagApplyRoute_(e, 'savebench', function (apply) {
      if (!apply) return { 미리보기: (e.parameter.id || '(&id= 없음)') + ' 건의 지급 줄을 그대로 세 번 다시 저장해 시간을 잽니다(시트에 씀).' };
      return saveBench_(e.parameter.id || '');
    });
  }
  return null;
}

/**
 * ?diag=sample(&q=품목명 일부) — 읽기만. _실행판_샘플 시트 · 실행판 캐시 · 진행 기록(완료/숨김)을 나란히 보여 준다.
 * 시트에 있는데 실행판 샘플 탭에 안 보일 때 어디서 빠지는지 찾는 용도.
 */
function diagSample_(q) {
  var sh = sheet_(RB.SAMPLE_TAB);
  if (!sh) return { 오류: '_실행판_샘플 탭 없음' };
  var C = sampleCols_(sh, false), K = C.K, lr = sh.getLastRow(), lcAll = sh.getLastColumn();
  var out = { 탭: sh.getName() + ' (gid ' + sh.getSheetId() + ')', 마지막행: lr, 마지막열: lcAll, 머리글행: C.hr, 읽는열수: C.lc,
    머리글: C.head.map(function (h, i) { return colRB_(i + 1) + '=' + str_(h); }).filter(function (x) { return !/=$/.test(x); }),
    열위치: Object.keys(K).map(function (k) { return k + ':' + (K[k] >= 0 ? colRB_(K[k] + 1) : '없음'); }).join(' ') };
  var fresh = readSampleRows_(readConfig_());
  var cached = cacheGet_(rowsCacheKey_('sample'));
  var prog = readProgress_('sample');
  var keyOf = {}; fresh.forEach(function (r) { r.vendors.forEach(function (g) { g.reqs.forEach(function (x) { keyOf[x.row] = r.id; }); }); });
  var cachedRows = {}; (cached || []).forEach(function (r) { (r.vendors || []).forEach(function (g) { (g.reqs || []).forEach(function (x) { cachedRows[x.row] = r.id; }); }); });
  out.실행판건수_새로읽음 = fresh.length;
  out.실행판건수_캐시 = cached ? cached.length : '캐시 없음';
  var n = Math.min(Math.max(0, lr - C.hr), 400), start = lr - n + 1;
  var dv = n ? sh.getRange(start, 1, n, Math.max(C.lc, lcAll > 30 ? 30 : lcAll)).getDisplayValues() : [];
  var toks = q ? q.toLowerCase().split(/\s+/).filter(String) : [];
  var lines = [];
  dv.forEach(function (r, i) {
    var row = start + i, nm = K.name >= 0 ? r[K.name] : '';
    var txt = r.join(' ').toLowerCase();
    if (toks.length && !toks.every(function (t) { return txt.indexOf(t) > -1; })) return;
    var id = keyOf[row], pr = id && prog.map[id];
    var why = !String(nm).trim() ? '품목명 칸 비어 실행판이 건너뜀' : (!id ? '실행판이 못 읽음' : '');
    var flags = [];
    if (id && !cachedRows[row]) flags.push('캐시에 없음(새로 읽으면 보임)');
    if (pr && pr.checks && pr.checks._done) flags.push('완료 처리됨 ' + pr.checks._done + ' — 기본 목록(진행 중)에서 빠짐');
    if (pr && pr.checks && pr.checks._hidden) flags.push('숨김 처리됨');
    lines.push(row + '행 | ' + [K.reqAt, K.code, K.name, K.vendor, K.planAt, K.doneAt, K.status].map(function (c) { return c >= 0 ? String(r[c]).slice(0, 30) : '-'; }).join(' | ') +
      ' => ' + (why || id) + (flags.length ? ' [' + flags.join(' · ') + ']' : ''));
  });
  out.줄 = toks.length ? lines : lines.slice(-25);
  // 정리할 곳: 중간 빈 줄 · 날짜로 못 읽는 날짜 칸(숫자가 있는데) · 상태 빈칸
  var all = lr > C.hr ? sh.getRange(C.hr + 1, 1, lr - C.hr, C.lc).getValues() : [];
  var gaps = [], badDate = [], noState = 0;
  var lastFilled = 0; all.forEach(function (r, i) { if (str_(r[K.name])) lastFilled = i; });
  all.forEach(function (r, i) {
    var row = C.hr + 1 + i;
    if (!str_(r[K.name])) { if (i < lastFilled) gaps.push(row); return; }
    [['reqAt', '요청일'], ['planAt', '전달예정일'], ['doneAt', '전달일'], ['quoteAt', '견적수신일']].forEach(function (f) {
      var c = K[f[0]]; if (c < 0) return;
      var v = r[c]; if (v instanceof Date || str_(v) === '' || /^https?:/i.test(str_(v))) return;
      if (/[0-9]/.test(str_(v)) && !toDate_(v)) badDate.push(row + '행 ' + f[1] + ' "' + str_(v).slice(0, 20) + '"');
    });
    if (K.status >= 0 && !str_(r[K.status])) noState++;
  });
  out.정리할곳 = { 중간빈줄: gaps.length ? gaps[0] + '~' + gaps[gaps.length - 1] + '행 중 ' + gaps.length + '줄' : '없음', 날짜로못읽는칸: badDate.slice(0, 40), 상태빈칸줄수: noState + '줄(빈칸이면 전달일 있으면 수신 · 없으면 진행중으로 봄)' };
  return out;
}

/**
 * ?diag=owner&name=노바&since=2026-10-09 — 읽기만. 그 담당자 발주건이 지금 화면 기준으로 몇 건인지, 빠진 건은 왜 빠졌는지(마감 · 취소 · 숨김),
 * since 이후 변경이력에서 그 담당자 건 · 담당 바뀜 기록을 보여 준다. 발주 DB 행 수도 같이.
 */
function diagOwner_(name, since) {
  var cfg = readConfig_();
  var rows = readOrderRows_(cfg);
  var prog = readProgress_('po');
  try { journalOverlay_(prog.map, 'po'); } catch (e) { /* 넘어간다 */ }
  var sh = statusSheet_();
  var mine = [], ids = {};
  rows.forEach(function (r) {
    var rec = findProg_(prog, r.id);
    var sheetOwner = r.owner, owner = (rec && rec.ownerSet && rec.ownerSet !== '미지정') ? rec.ownerSet : r.owner;
    if (owner !== name && sheetOwner !== name) return;
    ids[r.id] = 1;
    var cancelled = r.cancelled || r.state === '취소';
    var closed = !!r.statusRow && (Number(r.qty) || 0) > 0 && (Number(r.remain) || 0) <= 0;
    var hidden = !!(rec && rec.checks && rec.checks._hidden);
    var why = cancelled ? '취소' : (closed ? '마감(잔량 0)' : (hidden ? '숨김' : (owner !== name ? '담당이 ' + owner + '(으)로 지정됨' : '')));
    mine.push({ 보임: !why, 왜빠짐: why, 행: r.statusRow, 품의: r.doc, 품목: r.name, 차수: r.batch, 상태: r.state, 발주: r.qty, 입고: r.inQty, 잔량: r.remain, 발주일: r.orderedAt });
  });
  var out = { 담당자: name, 발주DB행수: Math.max(0, sh.getLastRow() - 1), 전체건: rows.length,
    이담당자건: mine.length, 화면에보이는건: mine.filter(function (x) { return x.보임; }).length,
    빠진이유별: mine.reduce(function (a, x) { if (x.왜빠짐) a[x.왜빠짐.replace(/\(.*$/, '')] = (a[x.왜빠짐.replace(/\(.*$/, '')] || 0) + 1; return a; }, {}) };
  out.빠진건 = mine.filter(function (x) { return !x.보임; }).map(function (x) { return x.행 + '행 ' + x.품목 + ' ' + (x.차수 || '') + ' | ' + x.왜빠짐 + ' | 상태 ' + (x.상태 || '-') + ' · 발주 ' + x.발주 + ' · 입고 ' + x.입고 + ' · 잔량 ' + x.잔량; });
  out.보이는건 = mine.filter(function (x) { return x.보임; }).map(function (x) { return x.행 + '행 ' + x.품목 + ' ' + (x.차수 || '') + ' | ' + (x.상태 || '-'); });
  // 변경이력: since 이후 이 담당자 건 · 담당 · 숨김 · 삭제 관련
  var hs = sheet_(RB.T_AUDIT), hist = [];
  if (hs && hs.getLastRow() > 1) {
    var n = Math.min(hs.getLastRow() - 1, 4000);
    var v = hs.getRange(hs.getLastRow() - n + 1, 1, n, RB.HIST_HEAD.length).getValues();
    var t0 = toDate_(since) || new Date(2026, 9, 9);
    v.forEach(function (r) {
      var at = r[0] instanceof Date ? r[0] : toDate_(r[0]);
      if (!at || at < t0) return;
      var txt = r.map(str_).join(' ');
      var hit = ids[str_(r[4])] || txt.indexOf(name) > -1 || /삭제|지움|취소|숨김|담당/.test(str_(r[3]) + ' ' + str_(r[8]));
      if (!hit) return;
      hist.push(Utilities.formatDate(at, Session.getScriptTimeZone(), 'MM-dd HH:mm') + ' ' + str_(r[1]).split('@')[0] + ' | ' + str_(r[3]) + ' | ' + str_(r[7]).slice(0, 30) + ' | ' + str_(r[8]) + ': ' + str_(r[9]).slice(0, 30) + ' → ' + str_(r[10]).slice(0, 30));
    });
  }
  out.변경이력수 = hist.length;
  out.변경이력 = hist.slice(-150);
  return out;
}

/** ?diag=etanolines — 읽기만. 목록엔 입고예정(발주 DB 입고일정)이 있는데 예정 · 입고 지급 줄이 없어 AP 에 안 잡히는 건 */
function diagEtaNoLines_() {
  var rows = readOrderRows_(readConfig_()), lm = linesMapCached_(true) || {};
  var out = [];
  rows.forEach(function (r) {
    if (!str_(r.eta) || r.state === '취소' || r.state === '종결') return;
    if ((Number(r.qty) || 0) > 0 && (Number(r.remain) || 0) <= 0 && (Number(r.inQty) || 0) > 0) return;
    var L = lm[r.id] || [];
    if (L.some(function (x) { return x.kind === '예정' || x.kind === '입고'; })) return;
    out.push(r.statusRow + '행 ' + r.name + ' ' + (r.batch || '') + ' | 담당 ' + (r.owner || '-') + ' | 입고예정 ' + r.eta + ' | 지급 줄 ' + L.length + '개(' + L.map(function (x) { return x.kind; }).join(',') + ')');
  });
  return { 건수: out.length, 안내: '이 건들은 AP 에 입고 예정 금액이 안 잡힙니다. 건을 열어 [AP 업데이트]를 보면 입고예정으로 예정 줄이 채워져 있으니 확인 후 [표 저장].', 목록: out };
}
