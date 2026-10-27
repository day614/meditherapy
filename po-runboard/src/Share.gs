/**
 * ============================================================
 * 배포용 BOM · 원가표(2026-10-20) — 다른 팀이 보는 기존 BOM 파일(RB.BOM_SS_ID)에 값만 적는다.
 * 실행판 시트(구매팀 업무 한판)는 공유하지 않는다. 그 파일의 다른 옛 탭(차수별BOM 등)은 건드리지 않는다.
 *  · '원가검색_자동' 탭: 품목코드가 같은 행의 원가 VAT- · VAT+ 를 실행판 원가표 값으로(등급 · 비고 등 다른 칸은 그대로) · 없는 품목은 맨 아래에 붙인다
 *  · '실행판 최종 BOM' 탭: 품목마다 최종 차수에 쓰는 줄(원가표 · BOM 보기와 같은 규칙 — bomVerEnds_)
 * 원가표를 다시 쓸 때(costTableRefresh_ · BOM 저장 뒤 1분 작업) 같이 다시 쓴다. 처음 한 번은 표시가 없어도 쓴다(스크립트 속성 rb.shareBom).
 * 수식 없이 값만 — 받는 사람이 고쳐도 실행판에는 영향이 없고, 다음 갱신 때 다시 덮인다.
 * ============================================================
 */
var RB_SHARE_PROP = 'rb.shareBom4';   // 바꾸면 한 번 다시 쓴다(4: 원가반영 칸 뺌 · 원가는 원가검색_자동 탭에)
var RB_SHARE_OLD_COST_TAB = '실행판 원가표', RB_SHARE_COST_TAB = '원가검색_자동', RB_SHARE_BOM_TAB = '실행판 최종 BOM';
var RB_SHARE_BOM_HEAD = ['브랜드', '제품코드', '제품명', '최종 차수', '구분', '자재코드', '품목명', '업체명', '매입정보', '사양', 'MOQ', '소요량',
  '단가', '통화', '환율', '임가공', '배송비/기타', '소요원가', '반제품 구성'];

/** 배포용 = 기존 BOM 파일 */
function shareSS_() { return SpreadsheetApp.openById(RB.BOM_SS_ID); }
function shareTab_(ss, name, head, at) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name, at || 0);          // 맨 앞에 — 받는 사람이 열면 바로 보이게
    try { sh.protect().setDescription(name + ' — 구매팀 실행판이 자동으로 씁니다').setWarningOnly(true); } catch (eP) { /* 넘어간다 */ }
  } else {
    try { if (sh.getFilter()) sh.getFilter().remove(); } catch (eF) { /* 넘어간다 */ }
    sh.clear();                                   // 칸 구성이 바뀌어도 옛 칸 · 색이 남지 않게(이 탭은 실행판이 통째로 쓴다)
  }
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#d9e1f2');
  sh.setFrozenRows(1);
  return sh;
}
function shareWrite_(sh, rows, W) {
  var lr = sh.getLastRow();
  if (rows.length) { ensureRows_(sh, rows.length + 1); sh.getRange(2, 1, rows.length, W).setValues(rows); }
  if (lr > rows.length + 1) sh.getRange(rows.length + 2, 1, lr - rows.length - 1, W).clearContent();
}

/** 품목마다 최종 차수 구성 줄 — bomIdxDone_ 과 같은 규칙(종료 빈 옛 버전 줄은 다음 버전 앞 차수까지 · 단종 줄 제외) */
function shareFinalRows_() {
  var sh = bomSheet_(), C = bomCols_(sh), lr = sh.getLastRow();
  if (lr < 3) return {};
  var by = {};
  sh.getRange(3, 1, lr - 2, C.lc).getValues().forEach(function (r, i) {
    var o = bomRowObj_(r, C, i + 3);
    if (!o.product) return;
    (by[o.product] = by[o.product] || []).push({ o: o, s: bomRnum_(o.start), e: bomRnum_(o.end), done: str_(o.end) === '단종',
      code: o.code, t: str_(o.type), sm: bomSemiKey_(o.semi) });
  });
  var out = {};
  Object.keys(by).forEach(function (p) {
    var rs = by[p], max = 0;
    rs.forEach(function (x) { if (x.s > max) max = x.s; if (x.e && x.e > max) max = x.e; });
    bomVerEnds_(rs);
    var pos = function (o) { var n = Number(o.ord); return n > 0 ? n : 1e6 + o.row; };          // 실행판 화면 [순서 바꾸기] 순서(BOM 탭 순서 칸)
    var on = rs.filter(function (x) { return !x.done && (!max || ((x.s || 1) <= max && x.e2 >= max)); }).map(function (x) { return x.o; }).sort(function (a, b) { return pos(a) - pos(b) || a.row - b.row; });
    out[p] = { round: max, rows: shareOrder_(on) };
  });
  return out;
}

/** 보는 사람이 읽기 쉬운 순서 — 세트 줄 → 제품 · 구성제품 줄 → 그 밖 자재 → 반제품 줄(바로 아래 그 반제품 구성 자재) */
function shareOrder_(rows) {
  var top = /^(제품|세트|구성제품)$/, used = {}, out = [];
  var put = function (o) { if (!used[o.row]) { used[o.row] = 1; out.push(o); } };
  var semis = rows.filter(function (o) { return str_(o.type) === '반제품'; });
  var semiOf = function (o) { return str_(o.semi).toUpperCase(); };
  rows.forEach(function (o) { if (str_(o.type) === '세트') put(o); });
  rows.forEach(function (o) { if (top.test(str_(o.type))) put(o); });
  rows.forEach(function (o) { if (str_(o.type) !== '반제품' && !semiOf(o)) put(o); });
  semis.forEach(function (h) {
    put(h);
    var hc = str_(h.code).toUpperCase(), stem = hc.replace(/\d+$/, '');
    rows.forEach(function (o) { var g = semiOf(o); if (str_(o.type) !== '반제품' && g && (g === hc || g === '*' || g.replace(/\d+$/, '') === stem)) put(o); });
  });
  rows.forEach(put);
  return out;
}

/** 배포용 파일 다시 쓰기 — list: bomIndex_() (원가표와 같은 품목 · 순서) */
function shareBomRefresh_(list, costRows) {
  var ss = shareSS_(), fin = shareFinalRows_(), stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  shareCostSearch_(ss, costRows, stamp);
  try { shareCostSearchOld_(ss, costRows, stamp); } catch (eOld) { try { console.log('원가검색 탭 맞추기 실패: ' + eOld.message); } catch (eOld2) { /* 넘어간다 */ } }
  var old = ss.getSheetByName(RB_SHARE_OLD_COST_TAB); if (old) { try { ss.deleteSheet(old); } catch (eD) { /* 넘어간다 */ } }   // 잠깐 쓰던 탭 — 원가는 원가검색_자동 으로

  var byCode = {}; (list || []).forEach(function (it) { byCode[it.code] = it; });
  var n = function (v) { var x = Number(String(v == null ? '' : v).replace(/,/g, '')); return String(v == null ? '' : v).trim() === '' || isNaN(x) ? (v == null ? '' : v) : x; };
  var rows = [], noCost = [];
  costRows.forEach(function (cr) {
    var code = cr[1], f = fin[code], it = byCode[code] || {};
    if (!f) return;
    f.rows.forEach(function (o) {
      rows.push([cr[0], code, it.name || str_(o.search), f.round ? f.round + '차' : '', str_(o.type), o.code, str_(o.name), str_(o.vendor), str_(o.buy), str_(o.spec),
        n(o.moq), n(o.qty), n(o.unit), str_(o.cur), n(o.fx), n(o.proc), n(o.ship), n(o.cost), str_(o.semi)]);
      noCost.push(!str_(o.costKey));
    });
  });
  var W = RB_SHARE_BOM_HEAD.length, shB = shareTab_(ss, RB_SHARE_BOM_TAB, RB_SHARE_BOM_HEAD, 0);
  rows.forEach(function (r) { if (r[18] && r[4] !== '반제품' && !/^(제품|세트|구성제품)$/.test(r[4])) r[4] = '└ ' + r[4]; });     // 반제품 구성 자재는 구분 앞에 └
  shareWrite_(shB, rows, W);
  shareColor_(shB, rows, W, noCost);
  if (rows.length) { shB.getRange(2, 11, rows.length, 8).setNumberFormat('#,##0.##'); }
  shB.getRange(1, W + 2).setValue('품목마다 최종 차수에 쓰는 BOM 줄 · 초록 줄 = 세트 · 파란 줄 = 제품 · 연한 파란 줄 = 구성제품 · 노란 줄 = 반제품(아래 └ 줄이 그 구성) · 회색 글자 = 원가에 안 들어가는 참고 줄 · 원가는 원가검색_자동 탭 · 구매팀 실행판에서 자동 · 갱신 ' + stamp);
  try { if (shB.getFilter()) shB.getFilter().remove(); if (rows.length) shB.getRange(1, 1, rows.length + 1, W).createFilter(); } catch (eF) { /* 필터는 없어도 된다 */ }
  PropertiesService.getScriptProperties().setProperty(RB_SHARE_PROP, stamp);
  return rows.length;
}

/** 원가검색_자동 탭 — 품목코드가 같은 행의 원가 VAT- · VAT+ 만 바꾼다(등급 · 비고 · 손으로 넣은 다른 칸은 그대로). 없는 품목은 맨 아래에.
 *  머리글 이름(품목코드 · 원가 VAT- · 원가 VAT+ · 브랜드 · 품목명)으로 칸을 찾는다 — 없으면 쓰지 않는다 */
function shareCostSearch_(ss, costRows, stamp) {
  var sh = ss.getSheetByName(RB_SHARE_COST_TAB);
  if (!sh) { sh = ss.insertSheet(RB_SHARE_COST_TAB, 1); sh.getRange(1, 1, 1, 7).setValues([['등급', '브랜드', '품목코드', '품목명', '원가 VAT-', '원가 VAT+', '비고']]).setFontWeight('bold'); sh.setFrozenRows(1); }
  var lc0 = Math.max(sh.getLastColumn(), 7), head = sh.getRange(1, 1, 1, lc0).getValues()[0].map(function (x) { return str_(x); });
  var noteAt = -1, lc = 0;                       // 안내 칸(실행판이 쓰는 글)은 머리글로 세지 않는다 — 돌 때마다 오른쪽으로 밀리지 않게
  head.forEach(function (h, i) { if (h.indexOf('구매팀 실행판') > -1) noteAt = i; else if (h) lc = i + 1; });
  lc = Math.max(lc, 7);
  var col = function (nm) { return head.indexOf(nm); };
  var cCode = col('품목코드'), cM = col('원가 VAT-'), cP = col('원가 VAT+'), cB = col('브랜드'), cN = col('품목명');
  if (cCode < 0 || cM < 0 || cP < 0) throw new Error(RB_SHARE_COST_TAB + ' 탭 머리글에 품목코드 · 원가 VAT- · 원가 VAT+ 가 없어 원가를 쓰지 않았습니다.');
  var lr = sh.getLastRow(), n = Math.max(lr - 1, 0);
  var codes = n ? sh.getRange(2, cCode + 1, n, 1).getValues() : [], at = {};
  codes.forEach(function (r, i) { var k = str_(r[0]).toUpperCase(); if (k) (at[k] = at[k] || []).push(i); });      // 같은 품목코드 행이 여럿이면 모두
  var vm = n ? sh.getRange(2, cM + 1, n, 1).getValues() : [], vp = n ? sh.getRange(2, cP + 1, n, 1).getValues() : [], add = [];
  costRows.forEach(function (cr) {
    var ii = at[String(cr[1]).toUpperCase()];
    if (!ii) { var row = []; for (var k = 0; k < lc; k++) row.push(''); if (cB >= 0) row[cB] = cr[0]; row[cCode] = cr[1]; if (cN >= 0) row[cN] = cr[2]; row[cM] = cr[4]; row[cP] = cr[5]; add.push(row); return; }
    ii.forEach(function (i) { vm[i][0] = cr[4]; vp[i][0] = cr[5]; });
  });
  if (n) { sh.getRange(2, cM + 1, n, 1).setValues(vm); sh.getRange(2, cP + 1, n, 1).setValues(vp); }
  if (add.length) { ensureRows_(sh, lr + add.length); sh.getRange(lr + 1, 1, add.length, lc).setValues(add); }
  var all = sh.getLastRow() - 1;
  if (all > 0) { sh.getRange(2, cM + 1, all, 1).setNumberFormat('#,##0'); sh.getRange(2, cP + 1, all, 1).setNumberFormat('#,##0'); }
  sh.getRange(1, (noteAt >= 0 ? noteAt : lc + 1) + 1).setValue('원가 VAT- · VAT+ = 구매팀 실행판 BOM 최종 차수 원가(원가반영 줄 합계 · VAT+ = ×1.1) · 자동 · 갱신 ' + stamp);
}

/** 줄 색 — 품목이 바뀌는 곳(제품 · 세트 줄)이 한눈에 보이게 */
function shareColor_(sh, rows, W, noCostOf) {
  var lr = Math.max(sh.getLastRow(), rows.length + 1);
  if (lr > 1) sh.getRange(2, 1, lr - 1, W).setBackground(null).setFontWeight('normal').setFontColor(null).setBorder(false, false, false, false, false, false);
  if (!rows.length) return;
  var bg = [], fw = [], fc = [], fill = function (v) { var a = []; for (var k = 0; k < W; k++) a.push(v); return a; };
  rows.forEach(function (r) {
    var t = String(r[4]).replace(/^└ /, ''), isTop = /^(제품|세트|구성제품)$/.test(t), isSemi = t === '반제품', noCost = !!(noCostOf && noCostOf[bg.length]);
    var SC = { '세트': '#d9ead3', '제품': '#cfe2f3', '구성제품': '#e8f0fb', '반제품': '#fff2cc' };     // 세트 초록 · 제품 파랑 · 구성제품 연한 파랑 · 반제품 노랑
    bg.push(fill(SC[t] || null));
    fw.push(fill(isTop || isSemi ? 'bold' : 'normal'));
    fc.push(fill(noCost && !isTop ? '#999999' : null));
  });
  sh.getRange(2, 1, rows.length, W).setBackgrounds(bg).setFontWeights(fw).setFontColors(fc);
  // 품목이 바뀌는 줄 위에 굵은 선
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][1] !== rows[i - 1][1]) sh.getRange(i + 2, 1, 1, W).setBorder(true, null, null, null, null, null, '#6d9eeb', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  }
}

/** 배포용 탭 주소(아직 안 썼으면 한 번 채운다) — 열 수 있는지는 BOM 파일 공유 설정이 정한다 */
function apiShareBomUrl() {
  requireEditor_();
  if (!PropertiesService.getScriptProperties().getProperty(RB_SHARE_PROP)) costTableRefresh_(true);
  var ss = shareSS_(), sh = ss.getSheetByName(RB_SHARE_BOM_TAB);
  return ss.getUrl() + (sh ? '#gid=' + sh.getSheetId() : '');
}

/**
 * 예전 '원가검색' 탭(손으로 쓰던 표 · 품목코드 칸에 바코드 · 옛 코드가 섞임)도 실행판 원가로 맞춘다(2026-10-21 담당자 요청 — 연동 안 돼 옛 원가가 남아 있었다).
 * 품목코드 칸 값 → 품목 DB(품목코드 · 바코드 · 구코드1 · 구코드2)로 실행판 품목코드를 찾고, 그 품목 원가가 있으면 원가 VAT- 칸만 바꾼다.
 * VAT+ 칸은 그대로(=E*1.1 수식) · 등급 · 비고 · 찾지 못한 줄은 손대지 않는다. 바뀐 칸 수를 돌려준다.
 */
function shareCostSearchOld_(ss, costRows, stamp) {
  var sh = ss.getSheetByName('원가검색');
  if (!sh || sh.getLastRow() < 3) return 0;
  var lc = sh.getLastColumn(), top = sh.getRange(1, 1, Math.min(3, sh.getLastRow()), lc).getValues(), hr = -1, head = null;
  top.forEach(function (r, i) { if (hr < 0 && r.map(function (x) { return str_(x); }).indexOf('원가 VAT-') > -1) { hr = i + 1; head = r.map(function (x) { return str_(x); }); } });
  if (hr < 0) return 0;
  var cCode = head.indexOf('품목코드'), cM = head.indexOf('원가 VAT-'), cP = head.indexOf('원가 VAT+');
  if (cCode < 0 || cM < 0) return 0;
  var key = function (v) { var t = str_(v).toUpperCase(); return /^\d+\.0$/.test(t) ? t.slice(0, -2) : t; };
  var cost = {}; costRows.forEach(function (cr) { cost[key(cr[1])] = cr[4]; });
  // 바코드 · 옛 코드 → 실행판 품목코드(품목 DB)
  var alias = {};
  try {
    var it = sheet_(RB_ITEM.TAB), iv = it ? it.getDataRange().getValues() : [], ih = (iv[0] || []).map(function (x) { return str_(x); });
    var ic = ih.indexOf('품목코드'), cols = ['바코드', '구코드1', '구코드2'].map(function (h) { return ih.indexOf(h); }).filter(function (c) { return c >= 0; });
    if (ic >= 0) iv.slice(1).forEach(function (r) { var code = key(r[ic]); if (!code) return; cols.forEach(function (c) { var k = key(r[c]); if (k && !alias[k]) alias[k] = code; }); });
  } catch (eA) { /* 품목코드 그대로만 */ }
  var n = sh.getLastRow() - hr, codes = sh.getRange(hr + 1, cCode + 1, n, 1).getValues(), vm = sh.getRange(hr + 1, cM + 1, n, 1).getValues();
  var fp = cP >= 0 ? sh.getRange(hr + 1, cP + 1, n, 1).getFormulas() : null, cells = {}, pcells = {}, ch = 0;
  codes.forEach(function (r, i) {
    var k = key(r[0]); if (!k) return;
    var code = cost[k] !== undefined ? k : alias[k];
    if (!code || cost[code] === undefined) return;
    var want = Number(cost[code]) || 0;
    if (!(want > 0)) return;                                // BOM 원가 0(원가 체크 줄 없음)은 손으로 넣은 원가를 지우지 않게 건너뛴다
    if (Math.round(Number(vm[i][0]) || 0) !== Math.round(want) || str_(vm[i][0]) === '') { cells[hr + 1 + i] = want; ch++; }
    if (fp && !fp[i][0]) pcells[hr + 1 + i] = '=' + colLetterRB_(cM + 1) + (hr + 1 + i) + '*1.1';          // VAT+ 가 값으로 적힌 줄은 수식으로
  });
  if (ch) setColCells_(sh, cM + 1, cells);
  if (fp && Object.keys(pcells).length) setColCells_(sh, cP + 1, pcells);
  var noteAt = -1, last = 0; head.forEach(function (h, i) { if (h.indexOf('구매팀 실행판') > -1) noteAt = i; else if (h) last = i + 1; });        // 안내 칸은 한 곳(돌 때마다 오른쪽으로 밀리지 않게)
  try { sh.getRange(hr, (noteAt >= 0 ? noteAt : Math.max(last, 8)) + 1).setValue('원가 VAT- = 구매팀 실행판 BOM 최종 차수 원가(품목코드 · 바코드로 찾은 줄만 · 등급 · 비고는 그대로) · 자동 · 갱신 ' + stamp); } catch (eN) { /* 넘어간다 */ }
  return ch;
}
