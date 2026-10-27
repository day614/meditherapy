/**
 * ============================================================
 * 이관 뒤 남은 것 — 이관 원본 읽기(확인용) · BOM 수리 도구(관리자)
 * ------------------------------------------------------------
 *  · 발주현황 → 발주 DB 이관(?diag=dbmigrate) · 새 양식 다시 쓰기(dbreshape) · BOM 시트 옮기기(bommigrate · bomprune)
 *    · BOM 통화 칸 만들기(bomcur) · 점검(dbcheck · dbwritetest)은 끝난 1회성 작업이라 2026-10-13 지웠다.
 *    (지금 다시 돌리면 옛 양식으로 쓰거나 이미 옮긴 탭과 겹쳐 오히려 위험했다.)
 *  · 남긴 것: dbMigratePlan_(이관 원본 읽기 — ?diag=verify 의 발주현황 대비에서 씀), RB_BOM_MOVE_TABS(?diag=bomcmp),
 *    dbBackupDel_ · bomDropPartial_ · bomDropRow_(수리 도구 — 진단 주소에서 미리보기 → 1회용 적용 주소로만 쓴다).
 *  · 원본은 탭 ID(RB.LEGACY_STATUS_GID)로 찾는다(이름이 바뀌었어도).
 * ============================================================
 */

/** 발주 DB 열: [새 머리글, 발주현황에서 찾을 머리글 후보]. 입고수량 바로 뒤에 회차 수량 1~20 이 붙는다. */
var RB_DB = {
  HEAD_A: [['품의번호', ['품의번호']], ['실행판ID', ['실행판ID']], ['구분', ['구분']],
           ['구매담당자', ['이', '담당', '담당자', '구매담당자']], ['발주일', ['발주일']], ['브랜드', ['브랜드']],
           ['채널', ['채널']], ['품목코드', ['품목코드']], ['발주차수', ['발주차수']], ['품목명', ['품목명']],
           ['발주수량', ['발주수량']], ['업체명', ['업체명', '매입처']], ['단가', ['단가']], ['진행상태', ['진행상태']],
           ['입고목표', ['입고목표', '입고목표일']], ['입고일정', ['입고일정']], ['제품입고일', ['제품입고일']],
           ['입고수량', ['입고수량']]],
  HEAD_B: [['발주잔량', ['발주잔량']], ['종결', ['종결']], ['비고', ['비고', '메모']], ['작성일', ['작성일']],
           ['발주요청팀', ['발주요청팀']], ['요청팀담당자', ['요청팀담당자']], ['소진완료목표일', ['소진완료목표일']],
           ['선금지급예정', ['선금지급예정']], ['선금', ['선금']], ['잔금지급예정', ['잔금지급예정']], ['잔금', ['잔금']],
           ['발주요청링크', ['발주요청링크']]]
};

function legacyStatusSheet_() {
  var hit = null;
  ss_().getSheets().forEach(function (s) { if (s.getSheetId() === RB.LEGACY_STATUS_GID) hit = s; });
  return hit;
}

/** 원본(발주현황)을 읽어 옮길 값 · 형식을 만든다. 쓰지 않는다. */
function dbMigratePlan_() {
  var src = legacyStatusSheet_();
  if (!src) throw new Error('발주현황 탭(ID ' + RB.LEGACY_STATUS_GID + ')을 찾을 수 없습니다.');
  var lastRow = src.getLastRow(), lastCol = src.getLastColumn();
  var scan = src.getRange(1, 1, Math.max(1, Math.min(60, lastRow)), lastCol).getValues();
  var hr = statusHeadIn_(scan, false);
  if (hr < 0) throw new Error('발주현황 머리글(품의번호 · 발주일)을 찾지 못했습니다.');
  var head = scan[hr - 1];
  var idx = headerIndex_(head);
  // 오른쪽 요약표에도 같은 머리글이 있을 수 있어 [지급점검] 왼쪽을 먼저 본다. 없으면 머리글 전체에서.
  var payCheck = colIdx_(idx, ['지급점검']);
  var leftIdx = payCheck > 0 ? headerIndex_(head.slice(0, payCheck)) : idx;
  var find = function (names) { var c = colIdx_(leftIdx, names); return c >= 0 ? c : colIdx_(idx, names); };

  var cols = [], missing = [];                     // cols: { h: 새 머리글, src: 원본 열(0부터, 없으면 -1) }
  RB_DB.HEAD_A.forEach(function (d) { cols.push({ h: d[0], src: find(d[1]) }); });
  var cIn = cols[cols.length - 1].src;
  for (var pi = 1; pi <= RB.PARTIAL_MAX; pi++) cols.push({ h: String(pi), src: cIn >= 0 ? cIn + pi : -1, part: true });
  RB_DB.HEAD_B.forEach(function (d) { cols.push({ h: d[0], src: find(d[1]) }); });
  cols.forEach(function (c) { if (c.src < 0) missing.push(c.h); });

  var nData = Math.max(0, lastRow - hr);
  var rg = nData ? src.getRange(hr + 1, 1, nData, lastCol) : null;
  var sv = rg ? rg.getValues() : [], sf = rg ? rg.getNumberFormats() : [];
  var at = function (h) { for (var i = 0; i < cols.length; i++) if (cols[i].h === h) return cols[i].src; return -1; };
  var cName = at('품목명'), cId = at('실행판ID'), cDoc = at('품의번호');
  if (cName < 0) throw new Error('발주현황에서 [품목명] 열을 찾지 못했습니다.');

  var vals = [], fmts = [], srcRows = [];
  sv.forEach(function (r, i) {
    if (!str_(r[cName])) return;
    if (!(cId >= 0 && str_(r[cId])) && !(cDoc >= 0 && str_(r[cDoc]))) return;
    vals.push(cols.map(function (c) { return c.src >= 0 ? r[c.src] : ''; }));
    fmts.push(cols.map(function (c) { var f0 = c.src >= 0 ? sf[i][c.src] : ''; return f0 ? f0 : 'General'; }));
    srcRows.push(hr + 1 + i);
  });

  var ids = {}, dup = [], noId = 0;
  var iId = cols.map(function (c) { return c.h; }).indexOf('실행판ID');
  vals.forEach(function (v, i) {
    var id = str_(v[iId]);
    if (!id) { noId++; return; }
    if (ids[id]) dup.push(id + ' (발주현황 ' + ids[id] + '행 · ' + srcRows[i] + '행)'); else ids[id] = srcRows[i];
  });
  return { src: src, hr: hr, lastRow: lastRow, lastCol: lastCol, head: head, cols: cols, missing: missing,
           vals: vals, fmts: fmts, srcRows: srcRows, dup: dup, noId: noId };
}


/* BOM 시트에서 옮겨 온 탭(옛 이름). ?diag=bomcmp 가 옛 BOM 시트와 견줄 때 쓴다. */
var RB_BOM_MOVE_TABS = ['신규코드채번', 'BOM', 'BOM변경이력'];


/* ?diag=dbbackupdel — 이관이 남긴 임시 백업 탭('_실행판_발주_백업_…') 목록, 적용 주소(1회용 토큰)로 열면 지운다(새 양식으로 옮긴 뒤에만) */
function dbBackupDel_(apply) {
  requireAdmin_();
  RB_COLS_MEMO = null;
  if (colIdx_(sheetCols_(statusSheet_()).idx, ['입고기록']) < 0) throw new Error('발주 DB가 아직 새 양식이 아니라 백업을 지우지 않습니다.');
  var ss = ss_(), list = ss.getSheets().filter(function (sh) { return sh.getName().indexOf(RB.STATUS_TAB + '_백업_') === 0; });
  var names = list.map(function (sh) { return sh.getName(); });
  if (!apply) return { 미리보기: '지우지 않았습니다. 정말 지우려면 아래 [적용주소] 를 여세요(5분 안 · 한 번)', 지울탭: names };
  list.forEach(function (sh) { ss.deleteSheet(sh); });
  return { 지움: names };
}


/*
 * ?diag=bomdrop&code=X — 저장이 중간에 실패해 BOM변경이력 없이 반쯤 들어간 품목의 BOM 줄을 지운다(한 번).
 * 그 품목코드로 '유효'인 BOM변경이력이 하나라도 있으면 지우지 않는다(정상 BOM 보호). apply 없이: 미리 보기.
 */
function bomDropPartial_(code, apply) {
  requireAdmin_();
  code = str_(code).toUpperCase();
  if (!code) throw new Error('code 를 넣어 주세요.');
  var ss = bomSS_(), sh = bomSheet_(), C = bomCols_(sh), lr = sh.getLastRow();
  var v = sh.getRange(3, 1, lr - 2, C.lc).getValues(), rows = [];
  v.forEach(function (r, i) { if (str_(r[C.product]).toUpperCase() === code) rows.push(i + 3); });
  var lg = ss.getSheetByName(RB_BOM_LOG), logs = 0;
  if (lg && lg.getLastRow() > 1) lg.getRange(2, 1, lg.getLastRow() - 1, 14).getValues().forEach(function (r) { if (str_(r[2]).toUpperCase() === code && str_(r[13]) === '유효') logs++; });
  var out = { 품목: code, 줄: rows.map(function (r) { var x = v[r - 3]; return r + '행 ' + str_(x[C.type]) + ' ' + str_(x[C.code]) + ' ' + str_(x[C.start]); }), 유효이력: logs };
  if (logs) { out.상태 = '이력이 있는 정상 BOM이라 지우지 않습니다'; return out; }
  if (!apply || !rows.length) { if (!apply) out.안내 = '미리 보기입니다. 아래 [적용주소] 를 열면 지웁니다(5분 안 · 한 번).'; return out; }
  var lock = LockService.getScriptLock(); waitLock_(lock);
  try { rows.slice().reverse().forEach(function (r) { sh.deleteRow(r); }); SpreadsheetApp.flush(); } finally { lock.releaseLock(); }
  bomDropCache_([code]);
  try { var c = CacheService.getScriptCache(); c.remove('bom4:idx:n'); c.remove('bom4:at'); } catch (e) { /* 넘어간다 */ }
  out.상태 = rows.length + '줄 지웠습니다';
  return out;
}

/* ?diag=bomdroprow&row=N&product=P&code=C — 실패한 저장이 남긴 줄 하나를 지운다(한 번). 그 행의 제품코드 · 자재코드가 맞을 때만. apply 없이: 미리 보기 */
function bomDropRow_(row, product, code, apply) {
  requireAdmin_();
  var sh = bomSheet_(), C = bomCols_(sh), r = Number(row);
  if (!(r >= 3)) throw new Error('row 를 넣어 주세요.');
  var x = sh.getRange(r, 1, 1, C.lc).getValues()[0];
  var out = { 행: r, 제품코드: str_(x[C.product]), 자재코드: str_(x[C.code]), 구분: str_(x[C.type]), 업체: str_(x[C.vendor]), 초도: str_(x[C.start]), 종료: str_(x[C.end]) };
  if (str_(x[C.product]).toUpperCase() !== str_(product).toUpperCase() || str_(x[C.code]).toUpperCase() !== str_(code).toUpperCase()) { out.상태 = '그 행이 말한 줄과 달라 지우지 않습니다'; return out; }
  if (!apply) { out.안내 = '미리 보기입니다. 아래 [적용주소] 를 열면 이 한 줄을 지웁니다(5분 안 · 한 번).'; return out; }
  var lock = LockService.getScriptLock(); waitLock_(lock);
  try { sh.deleteRow(r); SpreadsheetApp.flush(); } finally { lock.releaseLock(); }
  bomDropCache_([str_(product).toUpperCase()]);
  try { var c = CacheService.getScriptCache(); c.remove('bom4:idx:n'); c.remove('bom4:at'); } catch (e) { /* 넘어간다 */ }
  out.상태 = '지웠습니다';
  return out;
}

/* ============================================================
 * BOM 새 양식(2026-10-17) — 옛 탭 '_실행판_BOM' → 새 탭 '_실행판_BOM2'
 * ------------------------------------------------------------
 *  · 줄 순서 · 줄 번호는 그대로(3행부터, 옛 탭 n행 = 새 탭 n행) — BOM변경이력의 줄 번호 · 되돌리기가 그대로 맞는다.
 *  · 새 칸: 줄ID(줄마다 고유번호) · 반제품 구성(이 자재가 든 반제품 코드 — 예전엔 입고지에 ‘업체 (MX… 구성)’로 적었다).
 *  · 입고지는 원래 값으로: [구성 고르기] 이력의 '바뀌기 전' 입고지가 있으면 그 값, 없으면 ‘(MX… 구성)’만 뗀다.
 *  · 예전 방식 묶음(반제품 줄 바로 뒤 · 같은 번호 · 입고지 = 반제품 업체)도 반제품 구성 칸에 적어 둔다(이제 위치로 묶지 않는다).
 *  · 뺀 칸(넘버 · 품목코드 · 기존코드 · 기존 품목명 · 데이터 한판 · 원가 · 품목명 체크)은 옛 탭에 그대로 남는다(보관).
 *  · 소요원가 · 소요량 등 수식은 같은 줄의 칸을 새 위치로 바꿔 그대로 옮긴다(뺀 칸을 보는 수식은 값으로).
 *  · 첫 실행(1분 트리거 · BOM 을 처음 여는 실행) 때 잠금 안에서 한 번. 새 탭이 이미 있으면 아무것도 안 한다.
 * ============================================================ */
var RB_BOM_V2_HEAD = ['줄ID', '브랜드명', '제품코드', '검색', '원가반영', '초도', '종료', '초도 발주일', '자재코드', '공용여부', '구분', '품목명', '업체명',
  '매입정보', '사양', 'MOQ', '입고지', '반제품 구성', '소요량', '내용물/자재', '통화', '평균환율', '임가공', '배송비/기타', '소요원가', '구매발주 특이사항', '변동사항'];
var RB_BOM_V2_NOTE = '실행판 BOM(새 양식 2026-10-17) — 실행판 [BOM 보기]에서 고칩니다. 옛 탭 _실행판_BOM 은 보관용(더 쓰지 않음). 반제품 구성 = 이 자재가 든 반제품 코드.';

function bomMigrateV2_(dry) {
  var ss = ss_();
  if (!dry && ss.getSheetByName(RB_BOM_V2_TAB)) return { 상태: '이미 옮김' };
  var lock = null;
  if (!dry) { lock = LockService.getScriptLock(); if (!lock.tryLock(30000)) throw new Error('BOM 을 새 양식으로 옮기는 중입니다 — 잠시 뒤 다시 해 주세요.'); }
  try {
    if (!dry && ss.getSheetByName(RB_BOM_V2_TAB)) return { 상태: '이미 옮김' };
    var old = ss.getSheetByName(RB_BOM_OLD_TAB);
    if (!old) throw new Error('옛 BOM 탭(' + RB_BOM_OLD_TAB + ')이 없습니다.');
    var lr = old.getLastRow(), lc = old.getLastColumn();
    var oh = old.getRange(2, 1, 1, lc).getDisplayValues()[0].map(function (s) { return String(s).replace(/\s+/g, ' ').trim(); });
    var n = Math.max(0, lr - 2);
    var ov = n ? old.getRange(3, 1, n, lc).getValues() : [], of = n ? old.getRange(3, 1, n, lc).getFormulas() : [];
    var oc = {}; Object.keys(RB_BOM_HEAD).forEach(function (k) { oc[k] = oh.indexOf(RB_BOM_HEAD[k]); });
    // 새 칸 i ← 옛 칸(머리글 이름)
    var src = RB_BOM_V2_HEAD.map(function (h) { return oh.indexOf(h); });
    var letter = function (i) { return colRB_(i + 1); };
    var o2n = {}; src.forEach(function (o, i) { if (o >= 0) o2n[letter(o)] = letter(i); });
    // [구성 고르기] 이력의 바뀌기 전 입고지(처음 값) — 제품|코드|초도
    var firstPlace = {};
    try {
      var lg = ss.getSheetByName(RB_BOM_LOG);
      if (lg && lg.getLastRow() > 1) {
        lg.getRange(2, 1, lg.getLastRow() - 1, RB_BOM_LOG_HEAD.length).getValues().forEach(function (r) {
          if (!/-pl$/.test(str_(r[14]))) return;
          var u = {}; try { u = JSON.parse(str_(r[15]) || '{}'); } catch (eJ) { return; }
          (u.many || []).forEach(function (m) {
            if (!m.prev || m.prev.place === undefined) return;
            var k = str_(m.product).toUpperCase() + '|' + str_(m.code).toUpperCase() + '|' + str_(m.start), pv = str_(m.prev.place);
            if (bomSemiTagOf_(pv) || /반제품 공용/.test(pv)) return;
            var at = r[0] instanceof Date ? r[0].getTime() : 0;
            if (!firstPlace[k] || at < firstPlace[k].at) firstPlace[k] = { at: at, place: pv };
          });
        });
      }
    } catch (eL) { /* 이력이 없으면 떼기만 */ }
    var strip = function (p) { return str_(p).replace(/\s*\((?:[A-Z]X\d{4}[A-Z]{2}\d+ 구성|반제품 공용)\)\s*$/, '').trim(); };
    // 반제품 구성: 입고지 표시 → 그 코드, 없으면 예전 방식(위치) 묶음
    var semi = new Array(n), heads = {}, rep = { 표시: 0, 위치: 0, 공용: 0, 입고지복원: 0, 입고지뗌: 0 };
    ov.forEach(function (r) { if (str_(r[oc.type]) === '반제품') heads[str_(r[oc.product]).toUpperCase() + '|' + str_(r[oc.code]).toUpperCase()] = 1; });
    var norm = function (x) { return str_(x).replace(/\s|\(주\)|주식회사|㈜/g, ''); };
    var numOf = function (c) { var m = /^[A-Z]{1,2}(\d{4})/.exec(str_(c).toUpperCase()); return m ? m[1] : ''; };
    var place = ov.map(function (r) { return oc.place >= 0 ? r[oc.place] : ''; });
    var head = null, prevP = '';
    ov.forEach(function (r, i) {
      var P = str_(r[oc.product]).toUpperCase(), ty = str_(r[oc.type]), pl = str_(place[i]);
      semi[i] = '';
      if (P !== prevP) { head = null; prevP = P; }
      if (ty === '반제품') { head = r; return; }
      if (ty === '제품' || ty === '세트') { head = null; return; }
      var tg = bomSemiTagOf_(pl);
      if (/반제품 공용/.test(pl)) { semi[i] = '*'; rep.공용++; }
      else if (tg && heads[P + '|' + tg]) { semi[i] = tg; rep.표시++; }
      else if (head && numOf(r[oc.code]) && numOf(r[oc.code]) === numOf(head[oc.code]) && norm(pl) && norm(pl) === norm(head[oc.vendor])) { semi[i] = str_(head[oc.code]).toUpperCase(); rep.위치++; }
      else if (!tg) head = null;
      if (tg || /반제품 공용/.test(pl)) {
        var fp = firstPlace[P + '|' + str_(r[oc.code]).toUpperCase() + '|' + str_(r[oc.start])];
        if (fp) { place[i] = fp.place; rep.입고지복원++; } else { place[i] = strip(pl); rep.입고지뗌++; }
      }
    });
    // 새 줄
    var idN = 0, fx = 0, fxVal = 0;
    var vals = ov.map(function (r, i) {
      var hasP = !!str_(r[oc.product]);
      return RB_BOM_V2_HEAD.map(function (h, j) {
        if (h === '줄ID') return hasP ? 'B' + ('00000' + (++idN)).slice(-6) : '';
        if (h === '반제품 구성') return semi[i];
        if (h === '입고지') return place[i];
        return src[j] >= 0 ? r[src[j]] : '';
      });
    });
    // 수식: 같은 줄 칸을 새 위치로(뺀 칸을 보면 값으로 둔다)
    var fml = ov.map(function (r, i) {
      return RB_BOM_V2_HEAD.map(function (h, j) {
        var o = src[j], f = o >= 0 ? str_(of[i][o]) : '';
        if (!f || h === '입고지' || h === '반제품 구성') return '';
        var bad = false;
        var g = f.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)/g, function (all, d1, col, d2, row) {
          if (Number(row) !== i + 3) return all;              // 다른 줄 · 상수는 그대로
          if (!o2n[col]) { bad = true; return all; }
          return d1 + o2n[col] + d2 + row;
        });
        if (bad) { fxVal++; return ''; }
        fx++;
        return g;
      });
    });
    var res = { 상태: dry ? '미리보기' : '옮김', 줄: n, 줄ID: idN, 칸: RB_BOM_V2_HEAD.length + '(옛 ' + lc + ')', 반제품구성: rep, 수식: fx, 수식을값으로: fxVal,
      뺀칸: oh.filter(function (h) { return h && RB_BOM_V2_HEAD.indexOf(h) < 0; }) };
    if (dry) {
      res.보기 = vals.filter(function (v, i) { return semi[i]; }).slice(0, 15).map(function (v) { return v.slice(0, 18).join(' | '); });
      return res;
    }
    // 쓰기: 새 탭(숨김) · 1행 안내 · 2행 머리글 · 3행부터 값, 그다음 수식
    var sh = ss.insertSheet(RB_BOM_V2_TAB, ss.getNumSheets());
    var W = RB_BOM_V2_HEAD.length;
    ensureRows_(sh, n + 2);
    if (sh.getMaxColumns() < W) sh.insertColumnsAfter(sh.getMaxColumns(), W - sh.getMaxColumns());
    else if (sh.getMaxColumns() > W) sh.deleteColumns(W + 1, sh.getMaxColumns() - W);
    sh.getRange(1, 1).setValue(RB_BOM_V2_NOTE);
    sh.getRange(2, 1, 1, W).setValues([RB_BOM_V2_HEAD]).setFontWeight('bold');
    if (n) {
      sh.getRange(3, 1, n, W).setNumberFormat('@');                     // 코드 · 차수는 글자 그대로(숫자로 바뀌지 않게)
      ['MOQ', '소요량', '내용물/자재', '평균환율', '임가공', '배송비/기타', '소요원가'].forEach(function (h) { var j = RB_BOM_V2_HEAD.indexOf(h); sh.getRange(3, j + 1, n, 1).setNumberFormat('#,##0.####'); });
      var dj = RB_BOM_V2_HEAD.indexOf('초도 발주일'); sh.getRange(3, dj + 1, n, 1).setNumberFormat('yyyy-mm-dd');
      sh.getRange(3, 1, n, W).setValues(vals);
      for (var j = 0; j < W; j++) {                                      // 수식은 이어진 줄끼리 한 번에
        var i0 = 0;
        while (i0 < n) {
          if (!fml[i0][j]) { i0++; continue; }
          var i1 = i0; while (i1 + 1 < n && fml[i1 + 1][j]) i1++;
          sh.getRange(i0 + 3, j + 1, i1 - i0 + 1, 1).setFormulas(fml.slice(i0, i1 + 1).map(function (q) { return [q[j]]; }));
          i0 = i1 + 1;
        }
      }
    }
    sh.setFrozenRows(2);
    SpreadsheetApp.flush();
    // 확인: 새 탭을 다시 읽어 옛 탭과 맞춰 본다(소요원가 · 코드 · 차수 · 원가반영)
    var nv = n ? sh.getRange(3, 1, n, W).getValues() : [], bad = [];
    var K = function (h) { return RB_BOM_V2_HEAD.indexOf(h); };
    var numEq = function (a, b) { var x = Number(String(a).replace(/,/g, '')) || 0, y = Number(String(b).replace(/,/g, '')) || 0; return Math.abs(x - y) < 0.01; };
    ov.forEach(function (r, i) {
      var q = nv[i];
      if (str_(q[K('제품코드')]) !== str_(r[oc.product]) || str_(q[K('자재코드')]) !== str_(r[oc.code]) || str_(q[K('초도')]) !== str_(r[oc.start]) ||
          str_(q[K('종료')]) !== str_(r[oc.end]) || str_(q[K('원가반영')]) !== str_(r[oc.costKey]) || !numEq(q[K('소요원가')], r[oc.cost]) || !numEq(q[K('소요량')], r[oc.qty])) {
        if (bad.length < 20) bad.push((i + 3) + '행 ' + str_(r[oc.product]) + ' ' + str_(r[oc.code]) + ' 소요원가 ' + r[oc.cost] + ' → ' + q[K('소요원가')]);
        else bad.push('');
      }
    });
    if (bad.length) {
      ss.deleteSheet(sh);
      throw new Error('새 BOM 탭이 옛 탭과 ' + bad.length + '줄 다릅니다 — 옮기지 않았습니다: ' + bad.filter(String).join(' / '));
    }
    sh.hideSheet();
    try { old.setTabColor('#999999'); old.getRange(1, 1).setValue('보관용(2026-10-17 새 양식 ' + RB_BOM_V2_TAB + ' 으로 옮김 — 더 고치지 마세요)'); } catch (eO) { /* 넘어간다 */ }
    PropertiesService.getScriptProperties().setProperty('rb.bomv2', JSON.stringify({ at: new Date().toISOString(), rows: n, oldHead: oh }));
    try { bomLogWrite_(ss, [[new Date(), '실행판', '', '', '', 'BOM 새 양식', '', '', '', RB_BOM_OLD_TAB + ' (' + lc + '칸)', RB_BOM_V2_TAB + ' (' + W + '칸) ' + n + '줄 · 반제품 구성 ' + (rep.표시 + rep.위치 + rep.공용) + '줄', 'BOM 탭 새 양식으로 옮김', '', '참고', Utilities.getUuid().slice(0, 8) + '-v2', '']]); } catch (eG) { /* 넘어간다 */ }
    try { var cc = CacheService.getScriptCache(); cc.remove('bom4:idx:n'); cc.remove('bom4:at'); costTableMark_(); } catch (eC) { /* 넘어간다 */ }   // 새 탭으로 목록 · 원가표 다시
    res.확인 = '옛 탭과 같음(' + n + '줄)';
    return res;
  } finally {
    if (lock) lock.releaseLock();
  }
}
/** 옛 양식(이관 전) 줄 값 배열 → 새 양식 배열(되돌리기 '지운 줄 되살림'용). 옛 머리글은 옮길 때 스크립트 속성에 남겨 둔다 */
function bomV1RowToV2_(vals) {
  var info = {}; try { info = JSON.parse(PropertiesService.getScriptProperties().getProperty('rb.bomv2') || '{}'); } catch (e) { info = {}; }
  var oh = info.oldHead || [];
  if (!oh.length) return null;
  return RB_BOM_V2_HEAD.map(function (h) {
    var o = oh.indexOf(h);
    if (h === '반제품 구성') { var pl = oh.indexOf('입고지'); return pl >= 0 ? (/반제품 공용/.test(str_(vals[pl])) ? '*' : bomSemiTagOf_(vals[pl])) : ''; }
    if (h === '입고지') return o >= 0 ? str_(vals[o]).replace(/\s*\((?:[A-Z]X\d{4}[A-Z]{2}\d+ 구성|반제품 공용)\)\s*$/, '').trim() : '';
    return o >= 0 && o < vals.length ? vals[o] : '';
  });
}

/* ============================================================
 * BOM 운영 양식(2026-10-20) — '_실행판_BOM2' → '_실행판_BOM3'
 * ------------------------------------------------------------
 *  · 칸 순서를 일하는 순서로: 무엇(제품코드 · 제품명 · 구분 · 자재코드 · 품목명) → 언제 · 원가(초도 · 종료 · 원가반영 · 반제품 구성)
 *    → 업체(업체명 · 매입정보 · 사양 · MOQ) → 금액(소요량 · 단가 · 통화 · 환율 · 임가공 · 배송비/기타 · 소요원가) → 메모(공용 · 입고지 · 특이사항 · 변동사항 · 브랜드 · 줄ID)
 *  · 새 칸 제품명(품목 DB 제품 이름 — 코드만 보고 찾지 않게). 뺀 칸: 검색(제품명으로 대신) · 초도 발주일(발주 기록에 있음 · 실행판이 안 씀)
 *  · 이름만 바뀐 칸: 내용물/자재 → 단가, 평균환율 → 환율
 *  · 줄 순서 · 줄 번호는 그대로(되돌리기 · 이력 줄 번호가 맞게). 수식은 같은 줄 칸을 새 위치로 바꿔 옮긴다.
 *  · 왼쪽 5칸 · 머리글 고정, 필터, 구분 · 매입 · 통화 고르기(경고만), 끝난 줄 회색, 원가반영 줄 표시, 칸 묶음 색.
 *  · 옮긴 뒤 BOM2 와 줄마다 맞춰 보고 하나라도 다르면 새 탭을 지우고 멈춘다(BOM2 그대로). BOM2 는 숨기고 보관.
 * ============================================================ */
var RB_BOM_V3_HEAD = ['제품코드', '제품명', '구분', '자재코드', '품목명', '초도', '종료', '원가반영', '반제품 구성',
  '업체명', '매입정보', '사양', 'MOQ', '소요량', '단가', '통화', '환율', '임가공', '배송비/기타', '소요원가',
  '공용여부', '입고지', '구매발주 특이사항', '변동사항', '브랜드명', '줄ID'];
var RB_BOM_V3_FROM = { '단가': '내용물/자재', '환율': '평균환율' };          // 새 이름 ← BOM2 이름
var RB_BOM_V3_GROUPS = [['무엇 — 제품 · 자재', 1, 5, '#dbeafe'], ['언제 · 원가에 넣나', 6, 9, '#fef3c7'], ['누구에게 사나', 10, 13, '#dcfce7'],
  ['얼마 — 소요원가 = (단가 × 환율 + 임가공 + 배송비) × 소요량', 14, 20, '#fce7f3'], ['메모 · 관리', 21, 26, '#f3f4f6']];

function bomMigrateV3_(dry) {
  var ss = ss_();
  if (!dry && ss.getSheetByName(RB_BOM_TAB)) return { 상태: '이미 옮김' };
  var lock = null;
  if (!dry) { lock = LockService.getScriptLock(); if (!lock.tryLock(30000)) throw new Error('BOM 을 운영 양식으로 옮기는 중입니다 — 잠시 뒤 다시 해 주세요.'); }
  try {
    if (!dry && ss.getSheetByName(RB_BOM_TAB)) return { 상태: '이미 옮김' };
    var old = ss.getSheetByName(RB_BOM_V2_TAB);
    if (!old) throw new Error('BOM 탭(' + RB_BOM_V2_TAB + ')이 없습니다.');
    var lr = old.getLastRow(), lc = old.getLastColumn();
    var oh = old.getRange(2, 1, 1, lc).getDisplayValues()[0].map(function (x) { return String(x).replace(/\s+/g, ' ').trim(); });
    var n = Math.max(0, lr - 2);
    var ov = n ? old.getRange(3, 1, n, lc).getValues() : [], of = n ? old.getRange(3, 1, n, lc).getFormulas() : [];
    var oi = function (h) { return oh.indexOf(h); };
    ['제품코드', '자재코드', '구분', '초도', '종료', '소요원가', '내용물/자재', '줄ID'].forEach(function (h) { if (oi(h) < 0) throw new Error('BOM2 머리글에 ' + h + ' 칸이 없습니다.'); });
    var W = RB_BOM_V3_HEAD.length;
    var src = RB_BOM_V3_HEAD.map(function (h) { return oi(RB_BOM_V3_FROM[h] || h); });
    var letter = function (i) { return colRB_(i + 1); };
    var o2n = {}; src.forEach(function (o, i) { if (o >= 0) o2n[letter(o)] = letter(i); });
    // 제품명: 품목 DB 이름 → 그 품목 BOM 의 제품 · 세트 줄 품목명 → 브랜드 + 검색
    var db = {}; try { readItems_().forEach(function (it) { if (it.name) db[itemCodeKey_(it.code)] = it.name; }); } catch (eD) { db = {}; }
    var cP = oi('제품코드'), cC = oi('자재코드'), cT = oi('구분'), cN = oi('품목명'), cB = oi('브랜드명'), cS = oi('검색');
    var pn = {};
    ov.forEach(function (r) { var P = itemCodeKey_(r[cP]); if (P && !pn[P] && itemCodeKey_(r[cC]) === P && /^(제품|세트)$/.test(str_(r[cT]))) pn[P] = str_(r[cN]); });
    var nameOf = function (r) {
      var P = itemCodeKey_(r[cP]); if (!P) return '';
      return db[P] || pn[P] || [cB >= 0 ? str_(r[cB]) : '', cS >= 0 ? str_(r[cS]) : ''].filter(String).join(' ');
    };
    var vals = ov.map(function (r) {
      var hasP = !!str_(r[cP]);
      return RB_BOM_V3_HEAD.map(function (h, j) {
        if (h === '제품명') return hasP ? asText_(nameOf(r)) : '';
        return src[j] >= 0 ? r[src[j]] : '';
      });
    });
    var fx = 0, fxVal = 0;
    var fml = ov.map(function (r, i) {
      return RB_BOM_V3_HEAD.map(function (h, j) {
        var o = src[j], f = o >= 0 ? str_(of[i][o]) : '';
        if (!f) return '';
        var bad = false;
        var g = f.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)/g, function (all, d1, col, d2, row) {
          if (Number(row) < 3) return all;                    // 머리글 · 안내 줄은 그대로
          if (!o2n[col]) { bad = true; return all; }           // 같은 줄이든 다른 줄이든(예: 배송비 = SUM(임가공 622~630행)*9%) 칸은 새 위치로
          return d1 + o2n[col] + d2 + row;
        });
        if (bad) { fxVal++; return ''; }
        fx++;
        return g;
      });
    });
    var res = { 상태: dry ? '미리보기' : '옮김', 줄: n, 칸: W + '(BOM2 ' + lc + ')', 수식: fx, 수식을값으로: fxVal,
      뺀칸: oh.filter(function (h) { return h && src.indexOf(oi(h)) < 0; }), 제품명없음: vals.filter(function (v) { return v[0] && !v[1]; }).length };
    if (dry) { res.보기 = vals.slice(0, 5).map(function (v) { return v.slice(0, 10).join(' | '); }); return res; }
    var at = 0; try { at = old.getIndex(); } catch (eI) { at = ss.getNumSheets(); }
    var sh = ss.insertSheet(RB_BOM_TAB, at);
    ensureRows_(sh, n + 2);
    if (sh.getMaxColumns() < W) sh.insertColumnsAfter(sh.getMaxColumns(), W - sh.getMaxColumns());
    else if (sh.getMaxColumns() > W) sh.deleteColumns(W + 1, sh.getMaxColumns() - W);
    sh.getRange(2, 1, 1, W).setValues([RB_BOM_V3_HEAD]).setFontWeight('bold');
    var K = function (h) { return RB_BOM_V3_HEAD.indexOf(h); };
    if (n) {
      sh.getRange(3, 1, n, W).setNumberFormat('@');                     // 코드 · 차수는 글자 그대로
      ['MOQ', '소요량', '단가', '환율', '임가공', '배송비/기타', '소요원가'].forEach(function (h) { sh.getRange(3, K(h) + 1, n, 1).setNumberFormat('#,##0.####'); });
      sh.getRange(3, 1, n, W).setValues(vals);
      for (var j = 0; j < W; j++) {
        var i0 = 0;
        while (i0 < n) {
          if (!fml[i0][j]) { i0++; continue; }
          var i1 = i0; while (i1 + 1 < n && fml[i1 + 1][j]) i1++;
          sh.getRange(i0 + 3, j + 1, i1 - i0 + 1, 1).setFormulas(fml.slice(i0, i1 + 1).map(function (q) { return [q[j]]; }));
          i0 = i1 + 1;
        }
      }
    }
    SpreadsheetApp.flush();
    // 확인: BOM2 와 줄마다(코드 · 차수 · 원가반영 · 소요원가 · 소요량 · 단가 · 업체 · 반제품 구성 · 줄ID)
    var nv = n ? sh.getRange(3, 1, n, W).getValues() : [], bad = [];
    var numEq = function (a, b) { var x = Number(String(a).replace(/,/g, '')) || 0, y = Number(String(b).replace(/,/g, '')) || 0; return Math.abs(x - y) < 0.01; };
    var same = [['제품코드'], ['자재코드'], ['초도'], ['종료'], ['원가반영'], ['업체명'], ['반제품 구성'], ['줄ID'], ['구분']];
    ov.forEach(function (r, i) {
      var q = nv[i], why = '';
      same.forEach(function (x) { var o = oi(x[0]); if (!why && o >= 0 && str_(q[K(x[0])]) !== str_(r[o])) why = x[0]; });
      if (!why && !numEq(q[K('소요원가')], r[oi('소요원가')])) why = '소요원가 ' + r[oi('소요원가')] + ' → ' + q[K('소요원가')];
      if (!why && oi('소요량') >= 0 && !numEq(q[K('소요량')], r[oi('소요량')])) why = '소요량';
      if (!why && !numEq(q[K('단가')], r[oi('내용물/자재')])) why = '단가';
      if (why) { if (bad.length < 20) bad.push((i + 3) + '행 ' + str_(r[cP]) + ' ' + str_(r[cC]) + ' ' + why); else bad.push(''); }
    });
    if (bad.length) {
      ss.deleteSheet(sh);
      throw new Error('운영 양식 BOM 탭이 BOM2 와 ' + bad.length + '줄 다릅니다 — 옮기지 않았습니다: ' + bad.filter(String).join(' / '));
    }
    // 꾸밈(실패해도 데이터는 그대로)
    var tryDo = function (f) { try { f(); } catch (eF) { /* 넘어간다 */ } };
    tryDo(function () {
      RB_BOM_V3_GROUPS.forEach(function (g) {
        sh.getRange(1, g[1], 1, g[2] - g[1] + 1).setBackground(g[3]).setFontWeight('bold');
        sh.getRange(1, g[1]).setValue(g[0]);
        sh.getRange(2, g[1], 1, g[2] - g[1] + 1).setBackground(g[3]);
      });
    });
    tryDo(function () { sh.setFrozenRows(2); sh.setFrozenColumns(5); });
    tryDo(function () {
      var wd = { '제품코드': 92, '제품명': 210, '구분': 82, '자재코드': 100, '품목명': 250, '초도': 52, '종료': 52, '원가반영': 86, '반제품 구성': 96, '업체명': 110, '매입정보': 64,
        '사양': 180, 'MOQ': 70, '소요량': 60, '단가': 76, '통화': 52, '환율': 56, '임가공': 64, '배송비/기타': 76, '소요원가': 84, '공용여부': 64, '입고지': 100,
        '구매발주 특이사항': 180, '변동사항': 260, '브랜드명': 76, '줄ID': 72 };
      RB_BOM_V3_HEAD.forEach(function (h, j) { if (wd[h]) sh.setColumnWidth(j + 1, wd[h]); });
    });
    tryDo(function () { if (n) { sh.getRange(3, K('변동사항') + 1, n, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP); sh.getRange(3, K('줄ID') + 1, n, 1).setFontColor('#9ca3af'); } });
    tryDo(function () { if (n) sh.getRange(2, 1, n + 1, W).createFilter(); });
    tryDo(function () {
      if (!n) return;
      var types = {}; ov.forEach(function (r) { var t = str_(r[cT]); if (t) types[t] = 1; });
      var dv = function (h, list) { sh.getRange(3, K(h) + 1, n, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(true).build()); };
      dv('구분', Object.keys(types).sort()); dv('매입정보', ['턴키', '사급']); dv('통화', ['원화', '위안', '달러']);
    });
    tryDo(function () {
      if (!n) return;
      var all = sh.getRange(3, 1, n, W), endL = colRB_(K('종료') + 1), ckL = colRB_(K('원가반영') + 1), cs = colRB_(K('소요원가') + 1);
      var rules = [
        SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + endL + '3<>""').setFontColor('#9ca3af').setRanges([all]).build(),       // 끝난 줄 회색
        SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + ckL + '3<>""').setBackground('#dcfce7').setRanges([sh.getRange(3, K('원가반영') + 1, n, 1), sh.getRange(3, K('소요원가') + 1, n, 1)]).build()  // 원가에 들어가는 줄
      ];
      sh.setConditionalFormatRules(rules);
    });
    tryDo(function () { sh.getRange(1, 1, 2, W).setVerticalAlignment('middle'); sh.setRowHeight(2, 28); sh.setTabColor('#1d4ed8'); });
    tryDo(function () { old.hideSheet(); old.setTabColor('#999999'); old.getRange(1, 1).setValue('보관용(2026-10-20 운영 양식 ' + RB_BOM_TAB + ' 으로 옮김 — 더 고치지 마세요)'); });
    PropertiesService.getScriptProperties().setProperty('rb.bomv3', JSON.stringify({ at: new Date().toISOString(), rows: n, v2Head: oh }));
    try { bomLogWrite_(ss, [[new Date(), '실행판', '', '', '', 'BOM 운영 양식', '', '', '', RB_BOM_V2_TAB + ' (' + lc + '칸)', RB_BOM_TAB + ' (' + W + '칸) ' + n + '줄', 'BOM 탭 운영 양식으로 옮김(칸 순서 · 제품명 칸)', '', '참고', Utilities.getUuid().slice(0, 8) + '-v3', '']]); } catch (eG) { /* 넘어간다 */ }
    try { var cc = CacheService.getScriptCache(); cc.remove('bom4:idx:n'); cc.remove('bom4:at'); costTableMark_(); } catch (eC) { /* 넘어간다 */ }
    res.확인 = 'BOM2 와 같음(' + n + '줄)';
    return res;
  } finally {
    if (lock) lock.releaseLock();
  }
}
/** BOM2 양식 줄 값 배열 → 지금 양식(되돌리기 '지운 줄 되살림'용). 칸은 머리글 이름으로 맞춘다 */
function bomV2RowToV3_(vals, sh, C) {
  var info = {}; try { info = JSON.parse(PropertiesService.getScriptProperties().getProperty('rb.bomv3') || '{}'); } catch (e) { info = {}; }
  var oh = info.v2Head && info.v2Head.length ? info.v2Head : RB_BOM_V2_HEAD;
  var from = { search: '검색', unit: '내용물/자재', fx: '평균환율' };
  var out = []; for (var i = 0; i < C.lc; i++) out.push('');
  Object.keys(RB_BOM_HEAD).forEach(function (k) {
    if (C[k] < 0) return;
    var o = oh.indexOf(from[k] || RB_BOM_HEAD[k]);
    if (o >= 0 && o < vals.length) out[C[k]] = vals[o];
  });
  if (C.search >= 0 && C.product >= 0) {                 // 제품명 칸은 BOM2 의 '검색'(짧은 이름)이 아니라 품목 DB 제품 이름
    var P = itemCodeKey_(out[C.product]), nm = '';
    try { var it = readItems_().filter(function (x) { return itemCodeKey_(x.code) === P; })[0]; nm = it ? str_(it.name) : ''; } catch (eN) { nm = ''; }
    if (nm) out[C.search] = asText_(nm);
  }
  return out;
}

/**
 * 1회 정리(2026-10-17): M0166AA1 — 저장이 실패하던 동안 반제품 구성 없이 남은 공용 자재 줄.
 *  · B000963 용기 MP0169BO1(5차~, MX0171AA1 원래 줄) · B001952 인박스 MP0171IB1 → MX0171AA1 구성
 *  · B001950 · B001953 용기 · B001951 · B001955 용기라벨 · B001954 펌프+캡(반제품 없이 남은 복사 줄) → 줄 삭제
 * 줄ID 로 찾고, 코드 · 반제품 구성이 그때(빈칸) 그대로일 때만 한다(하나라도 다르면 하지 않음). BOM변경이력 '정정'으로 남아 되돌릴 수 있다.
 */
function bomFix1017_() {
  var P = PropertiesService.getScriptProperties();
  if (P.getProperty('rb.fix1017')) return '';
  var want = { B000963: ['MP0169BO1', 'MX0171AA1'], B001952: ['MP0171IB1', 'MX0171AA1'], B001950: ['MP0169BO1', null], B001953: ['MP0169BO1', null], B001951: ['MP0169BL3', null], B001955: ['MP0169BL3', null], B001954: ['MP0169PC1', null] };
  var sh = bomSheet_(), C = bomCols_(sh), lr = sh.getLastRow();
  if (C.id < 0 || lr < 3) { P.setProperty('rb.fix1017', 'skip'); return 'skip'; }
  var v = sh.getRange(3, 1, lr - 2, C.lc).getValues(), items = [], bad = [];
  var seen = {};
  v.forEach(function (r, i) {
    var id = str_(r[C.id]), w = want[id];
    if (!w || str_(r[C.product]).toUpperCase() !== 'M0166AA1') return;
    seen[id] = 1;
    if (str_(r[C.code]).toUpperCase() !== w[0] || str_(r[C.semi])) { bad.push(id); return; }
    items.push(w[1] ? { row: i + 3, code: str_(r[C.code]), start: str_(r[C.start]), fields: { semi: w[1] } } : { row: i + 3, code: str_(r[C.code]), start: str_(r[C.start]), del: true });
  });
  Object.keys(want).forEach(function (id) { if (!seen[id]) bad.push(id + '(없음)'); });
  if (bad.length) { P.setProperty('rb.fix1017', 'skip ' + bad.join(',')); return 'skip ' + bad.join(','); }
  apiBomFixManyCore_('M0166AA1', items, '반제품 구성 정리 — 저장 실패로 반제품 없이 남은 공용 자재 줄(MX0171AA1 용기 · 인박스 넣기, 남은 복사 줄 삭제)', false);
  P.setProperty('rb.fix1017', 'done ' + new Date().toISOString());
  return 'done';
}

/**
 * 1회 정리(2026-10-19, 담당자 확인 「그대로 진행해」) — 줄ID · 제품 · 자재코드가 모두 예상과 같을 때만 고친다(하나라도 다르면 손대지 않음).
 *  · M0019JP1: MP0019MS2(기타) → MX0019JP1 반제품   · H0002AA1: HP0002XX2 → HX0002AA5 반제품(구성 자재 3줄의 반제품 구성도)
 *  · 제품 줄 없던 HP0022MS1 BOM → 세트 H0022AA1(세트 줄 붙임) · 그중 4종 풀 패키지세트 줄(B000762)은 H0001AA1 로
 *  · H0001AA1 첫 줄 구분 쇼핑백 → 제품   · 품목 DB: M0075AA1 · HX0002AA5 등록, MP0129CA3 · MP0019MS2 · HP0002XX2 삭제(삭제보관 탭에 원래 값)
 */
function bomFix1019_() {
  var P = PropertiesService.getScriptProperties();
  if (P.getProperty('rb.fix1019')) return '';
  var NEWX = 'HX0002AA5', H22 = '히디프 트라이얼키트 기프트패키지 세트', H01 = '히디프 4종 풀 패키지세트';
  var want = {
    B001939: { p: 'M0019JP1', c: 'MP0019MS2', f: { code: 'MX0019JP1', type: '반제품', name: '메디테라피 링클핏 니들 일본 반제품' } },
    B000287: { p: 'H0002AA1', c: 'HP0002XX2', f: { code: NEWX } },
    B000288: { p: 'H0002AA1', c: 'HP0002BO0', sm: 'HP0002XX2', f: { semi: NEWX } },
    B000289: { p: 'H0002AA1', c: 'HP0002CP2', sm: 'HP0002XX2', f: { semi: NEWX } },
    B000290: { p: 'H0002AA1', c: 'HP0002LD1', sm: 'HP0002XX2', f: { semi: NEWX } },
    B000352: { p: 'HP0022MS1', c: 'HP0022MS1', f: { product: 'H0022AA1', costKey: 'H0022AA1', search: H22 } },
    B000353: { p: 'HP0022MS1', c: 'HP0022MS2', f: { product: 'H0022AA1', costKey: 'H0022AA1', search: H22 } },
    B000354: { p: 'HP0022MS1', c: 'HP0022MS3', f: { product: 'H0022AA1', costKey: 'H0022AA1', search: H22 } },
    B000355: { p: 'HP0022MS1', c: 'HP0022MS4', f: { product: 'H0022AA1', costKey: 'H0022AA1', search: H22 } },
    B000762: { p: 'HP0022MS1', c: 'HP0022MS1', f: { product: 'H0001AA1', costKey: 'H0001AA1' } },
    B000761: { p: 'H0001AA1', c: 'H0001AA1', t: '쇼핑백', f: { type: '제품' } }
  };
  var sh = bomSheet_(), C = bomCols_(sh), out = '';
  var lock = bomLock_();
  try {
    var lr = sh.getLastRow();
    if (C.id < 0 || C.semi < 0 || lr < 3) { P.setProperty('rb.fix1019', 'skip'); return 'skip'; }
    var v = sh.getRange(3, 1, lr - 2, C.lc).getValues(), bad = [], seen = {}, hit = [], maxId = 0, h22 = false;
    v.forEach(function (r, i) {
      var id = str_(r[C.id]), m = /^B(\d+)$/.exec(id), w = want[id];
      if (m) maxId = Math.max(maxId, Number(m[1]));
      if (itemCodeKey_(r[C.product]) === 'H0022AA1') h22 = true;
      if (itemCodeKey_(r[C.code]) === NEWX) bad.push(NEWX + ' 이미 있음');
      if (!w || seen[id]) return;
      seen[id] = 1;
      if (itemCodeKey_(r[C.product]) !== w.p || itemCodeKey_(r[C.code]) !== w.c || str_(r[C.semi]).toUpperCase() !== (w.sm || '') || (w.t && str_(r[C.type]) !== w.t)) { bad.push(id); return; }
      hit.push({ row: i + 3, r: r, id: id, w: w });
    });
    Object.keys(want).forEach(function (id) { if (!seen[id]) bad.push(id + '(없음)'); });
    if (h22) bad.push('H0022AA1 BOM 이미 있음');
    if (bad.length) { P.setProperty('rb.fix1019', 'skip ' + bad.join(',')); return 'skip ' + bad.join(','); }
    var now = new Date(), who = me_(), logs = [], tag = Utilities.getUuid().slice(0, 8);
    var why = '품목 DB · BOM 정리(담당자 확인 10/19)';
    hit.forEach(function (h) {
      Object.keys(h.w.f).forEach(function (k) {
        if (C[k] < 0) return;
        var before = str_(h.r[C[k]]);
        sh.getRange(h.row, C[k] + 1).setValue(h.w.f[k]);
        logs.push([now, who, h.w.f.product || h.w.p, '', str_(h.r[C.start]), '정정', str_(h.r[C.type]), h.w.c, k === 'code' ? h.w.f.code : h.w.c,
          RB_BOM_HEAD[k] + ': ' + before, RB_BOM_HEAD[k] + ': ' + h.w.f[k], why + ' · 줄 ' + h.id, '', '-', tag + '-1019', '']);
      });
    });
    // 세트 H0022AA1 제품 줄(3차부터) — 패키지 줄(B000352)을 본떠 맨 아래에
    var base = hit.filter(function (h) { return h.id === 'B000352'; })[0].r.slice();
    var row = base.map(function () { return ''; });
    var put = function (k, x) { if (C[k] >= 0) row[C[k]] = x; };
    put('id', 'B' + ('00000' + (maxId + 1)).slice(-6)); put('brand', str_(base[C.brand])); put('product', 'H0022AA1'); put('search', H22); put('costKey', 'H0022AA1');
    put('start', '3차'); put('code', 'H0022AA1'); put('type', '세트'); put('name', H22); put('qty', 1); put('cost', 0);
    var nr = sh.getLastRow() + 1;
    ensureRows_(sh, nr);
    sh.getRange(nr, 1, 1, C.lc).setValues([row]);
    logs.push([now, who, 'H0022AA1', H22, '3차', '추가', '세트', '', 'H0022AA1', '', H22, why + ' · 제품 줄 없던 HP0022MS1 BOM 을 세트 H0022AA1 로', '', '-', tag + '-1019', '']);
    bomLogWrite_(bomSS_(), logs);
    SpreadsheetApp.flush();
    out = 'BOM ' + hit.length + '줄 + 세트 줄';
  } finally { lock.releaseLock(); }
  bomDropCache_(['M0019JP1', 'H0002AA1', 'HP0022MS1', 'H0022AA1', 'H0001AA1']);
  try { appendItems_([{ code: 'M0075AA1', name: '메디테라피 머그워트 슈퍼 카밍 토너 250ml', brand: '메디테라피', vendor: '코스메카' },
    { code: NEWX, name: '히디프 로얄 피니시 크림 10ml', brand: '히디프', vendor: '한국콜마' }], '정리 10/19 · BOM 에 있는데 DB 에 없던 코드'); } catch (eA) { out += ' · 등록 실패 ' + eA.message; }
  ['MP0129CA3', 'MP0019MS2', 'HP0002XX2'].forEach(function (c) {
    try { apiItemDelete(c, true, '정리 10/19 · 쓰지 않는 · 잘못 만든 코드'); out += ' · 삭제 ' + c; } catch (eD) { out += ' · 삭제 못함 ' + c + '(' + eD.message + ')'; }
  });
  try { bomBuildCache_(); } catch (eC) { /* 다음에 다시 읽는다 */ }
  P.setProperty('rb.fix1019', 'done ' + new Date().toISOString() + ' ' + out.slice(0, 300));
  return out;
}

/** 1회 정리(2026-10-19, 담당자 「그 품목은 지워」) — 제품코드 'X' BOM(링클핏 탱글 아이크림 디바이스 교환용 중국) 5줄 삭제. 자재는 다른 제품에도 있어 품목 DB 는 그대로. 원래 값은 삭제보관 탭에 */
function bomFix1019b_() {
  var P = PropertiesService.getScriptProperties();
  if (P.getProperty('rb.fix1019b')) return '';
  var want = { B000214: 'X', B000215: 'MP0090DV1', B000216: 'MP0090CA1', B000217: 'MP0000SL4', B000218: 'MP0090OB1' };
  var sh = bomSheet_(), C = bomCols_(sh), out = '';
  var lock = bomLock_();
  try {
    var lr = sh.getLastRow();
    if (C.id < 0 || lr < 3) { P.setProperty('rb.fix1019b', 'skip'); return 'skip'; }
    var v = sh.getRange(3, 1, lr - 2, C.lc).getValues(), rows = [], bad = [], back = [], now = new Date(), who = me_();
    v.forEach(function (r, i) {
      if (str_(r[C.product]).toUpperCase() !== 'X') return;
      var id = str_(r[C.id]);
      if (want[id] !== itemCodeKey_(r[C.code])) { bad.push(id || ('행' + (i + 3))); return; }
      rows.push(i + 3);
      back.push([now, who, 'X', RB_BOM_TAB, i + 3, itemCodeKey_(r[C.code]), JSON.stringify(r.map(function (x) { return x instanceof Date ? fmtDate_(x) : x; }))]);
    });
    if (rows.length !== Object.keys(want).length) bad.push('줄 수 ' + rows.length);
    if (bad.length) { P.setProperty('rb.fix1019b', 'skip ' + bad.join(',')); return 'skip ' + bad.join(','); }
    var bk = tab_(RB_DEL_TAB, RB_DEL_HEAD), r0 = bk.getLastRow() + 1;
    ensureRows_(bk, r0 + back.length - 1);
    bk.getRange(r0, 1, back.length, RB_DEL_HEAD.length).setValues(back);
    try { if (!bk.isSheetHidden()) bk.hideSheet(); } catch (eH) { /* 넘어간다 */ }
    deleteRowsDesc_(sh, rows);
    bomLogWrite_(bomSS_(), [[now, who, 'X', '메디테라피 링클핏 탱글 아이크림 디바이스 (교환용)', '', '품목 삭제', '', 'X', '', 'BOM ' + rows.length + '줄', '삭제',
      '담당자 확인 10/19 · 제품코드 없는 BOM(X) 삭제 · 원래 값은 ' + RB_DEL_TAB, '', '-', Utilities.getUuid().slice(0, 8) + '-del', '']]);
    SpreadsheetApp.flush();
    out = 'BOM ' + rows.length + '줄 삭제';
  } finally { lock.releaseLock(); }
  bomDropCache_(['X']);
  try { bomBuildCache_(); } catch (eC) { /* 다음에 다시 읽는다 */ }
  P.setProperty('rb.fix1019b', 'done ' + new Date().toISOString() + ' ' + out);
  return out;
}

/** 1회 정리(2026-10-19, 담당자 확인) — 단품과 같은 코드를 쓰는 본품 자재(용기 · 펌프 · 스포이드 · 라벨)는 공용 자재: 이름에서 '미품'을 빼고(품목 DB · BOM) 모든 줄 공용 표시. 미품 인박스 · 아웃박스는 규격이 달라 그대로 */
function bomFix1019c_() {
  var P = PropertiesService.getScriptProperties();
  if (P.getProperty('rb.fix1019c')) return '';
  var codes = ['HP0065BO1', 'HP0065PC1', 'HP0067BO1', 'HP0067SP1', 'HP0068BO1', 'HP0002BO2', 'HP0002SP1', 'MP0181PC1', 'HP0049BL1', 'HP0049PC1'], want = {};
  codes.forEach(function (c) { want[c] = 1; });
  var fixName = { MP0181PC1: '메디테라피 비타민 스킨 부스터 버블세럼 30ml 펌프+캡' };     // 품목 DB 에 없고 BOM 이름이 둘(펌프 / 펌프+캡) — 단품 이름으로
  var clean = function (s, k) { return fixName[k] || str_(s).replace(/\s*미품(?=\s|$)/g, '').replace(/\s+/g, ' ').trim(); };
  var lock = LockService.getScriptLock(), out = '', nB = 0, nI = 0, nC = 0, logs = [], now = new Date(), who = me_();
  waitLock_(lock);
  RB_BOM_HELD = true;
  try {
    var ish = sheet_(RB_ITEM.TAB);
    if (ish && ish.getLastRow() >= 2) {
      var iv = ish.getRange(2, 1, ish.getLastRow() - 1, 2).getValues(), ip = [];
      iv.forEach(function (r, i) { var k = itemCodeKey_(r[0]); if (want[k] && /미품/.test(str_(r[1]))) ip.push([i + 2, clean(r[1])]); });
      if (ip.length) { bomSetColRuns_(ish, 2, ip); nI = ip.length; }
    }
    var sh = bomSheet_(), C = bomCols_(sh), lr = sh.getLastRow();
    if (lr >= 3) {
      var n = lr - 2, cs = sh.getRange(3, C.code + 1, n, 1).getValues(), ns = sh.getRange(3, C.name + 1, n, 1).getValues(), ps = sh.getRange(3, C.product + 1, n, 1).getValues(), put = [], touched = {};
      cs.forEach(function (r, i) {
        var k = itemCodeKey_(r[0]);
        if (!want[k] || clean(ns[i][0], k) === str_(ns[i][0])) return;
        put.push([i + 3, clean(ns[i][0], k)]); touched[str_(ps[i][0]).toUpperCase()] = 1;
      });
      if (put.length) { bomSetColRuns_(sh, C.name + 1, put); nB = put.length; }
      logs.push([now, who, Object.keys(touched).join(', ').slice(0, 200), '', '', '정정', '', codes.join(', '), '', '품목명 … 미품 …', '품목명에서 미품 뺌 ' + nB + '줄(품목 DB ' + nI + '개)',
        '담당자 확인 10/19 · 단품과 같은 본품 자재는 공용 자재 — 이름에서 미품 빼고 공용 표시', '', '-', Utilities.getUuid().slice(0, 8) + '-1019', '']);
      bomLogWrite_(bomSS_(), logs);
    }
    var vd = '';
    if (lr >= 3) sh.getRange(3, 1, lr - 2, C.lc).getValues().some(function (r) { if (itemCodeKey_(r[C.code]) === 'MP0181PC1' && str_(r[C.vendor])) { vd = str_(r[C.vendor]); return true; } return false; });
    nI += appendItems_([{ code: 'MP0181PC1', name: fixName.MP0181PC1, brand: '메디테라피', vendor: vd }], '정리 10/19 · BOM 에 있는데 DB 에 없던 코드');
    nC = bomCommonSetMany_(codes.map(function (c) { return { code: c, on: true }; }));
    SpreadsheetApp.flush();
    out = 'BOM 이름 ' + nB + '줄 · 품목 DB ' + nI + '개 · 공용 ' + nC + '줄';
  } finally {
    RB_BOM_HELD = false;
    lock.releaseLock();
  }
  cacheDrop_(RB_ITEM.CACHE); cacheDrop_(RB_II_CACHE);
  bomDropCache_([]);
  try { bomBuildCache_(); } catch (eC) { /* 다음에 다시 읽는다 */ }
  P.setProperty('rb.fix1019c', 'done ' + new Date().toISOString() + ' ' + out);
  return out;
}

/**
 * 1회 정리(2026-10-19, 담당자 확인) — 스쿠알란 150ml 용기: 1차만 무광코팅(MP0163BO1), 2차부터 히알루론산과 같은 공용 용기(MP0159BO1).
 *  · M0163AA1 2차~ 용기 줄 · M0163JP1 · M0163JP2 용기 줄 → MP0159BO1, 키트(M0193AA1) 스쿠알란 미품 용기 줄 사양도 MP0159BO1 로
 *  · 제품코드가 아웃박스 코드(MP0163OB2)로 들어간 일본 BOM → M0163JP2   · M0163AA1 4차 용기 줄 소요원가 #VALUE!(배송비 칸 공백) 고침
 */
function bomFix1019d_() {
  var P = PropertiesService.getScriptProperties();
  if (P.getProperty('rb.fix1019d')) return '';
  var BO = { code: 'MP0159BO1', name: '메디테라피 히알루론산 스킨 부스터 퍼스트 세럼 150ml 용기', spec: '150ml' }, JP2 = { product: 'M0163JP2', costKey: 'M0163JP2' };
  var mix = function (a, b) { var o = {}; [a, b || {}].forEach(function (x) { Object.keys(x).forEach(function (k) { o[k] = x[k]; }); }); return o; };
  var want = {
    B001067: { p: 'M0163AA1', c: 'MP0163BO1', f: BO },
    B001068: { p: 'M0163AA1', c: 'MP0163BO1', f: mix(BO, { ship: '' }) },
    B001838: { p: 'M0163JP1', c: 'MP0163BO1', f: BO },
    B000934: { p: 'M0193AA1', c: 'MP0159BO1', f: { spec: '150ml' } },
    B001847: { p: 'MP0163OB2', c: 'M0163JP2', f: JP2 },
    B001848: { p: 'MP0163OB2', c: 'MP0163BO1', f: mix(BO, JP2) },
    B001849: { p: 'MP0163OB2', c: 'MP0159PC1', f: JP2 },
    B001850: { p: 'MP0163OB2', c: 'MP0163BL5', f: JP2 },
    B001851: { p: 'MP0163OB2', c: 'MP0163OL1', f: JP2 },
    B001852: { p: 'MP0163OB2', c: 'MP0163CA4', f: JP2 },
    B001853: { p: 'MP0163OB2', c: 'MP0163OB2', f: JP2 }
  };
  var sh = bomSheet_(), C = bomCols_(sh), out = '';
  var lock = bomLock_();
  try {
    var lr = sh.getLastRow();
    if (C.id < 0 || lr < 3) { P.setProperty('rb.fix1019d', 'skip'); return 'skip'; }
    var v = sh.getRange(3, 1, lr - 2, C.lc).getValues(), bad = [], seen = {}, hit = [], jp2 = false;
    v.forEach(function (r, i) {
      var id = str_(r[C.id]), w = want[id];
      if (itemCodeKey_(r[C.product]) === 'M0163JP2') jp2 = true;
      if (!w || seen[id]) return;
      seen[id] = 1;
      if (itemCodeKey_(r[C.product]) !== w.p || itemCodeKey_(r[C.code]) !== w.c) { bad.push(id); return; }
      hit.push({ row: i + 3, r: r, id: id, w: w });
    });
    Object.keys(want).forEach(function (id) { if (!seen[id]) bad.push(id + '(없음)'); });
    if (jp2) bad.push('M0163JP2 BOM 이미 있음');
    if (bad.length) { P.setProperty('rb.fix1019d', 'skip ' + bad.join(',')); return 'skip ' + bad.join(','); }
    var now = new Date(), who = me_(), logs = [], tag = Utilities.getUuid().slice(0, 8), why = '담당자 확인 10/19 · 스쿠알란 150ml 용기는 2차부터 히알루론산 공용 용기(MP0159BO1)';
    hit.forEach(function (h) {
      Object.keys(h.w.f).forEach(function (k) {
        if (!(C[k] >= 0)) return;
        var before = str_(h.r[C[k]]), to = h.w.f[k];
        if (before === to) return;
        sh.getRange(h.row, C[k] + 1).setValue(to);
        logs.push([now, who, h.w.f.product || h.w.p, '', str_(h.r[C.start]), '정정', str_(h.r[C.type]), h.w.c, k === 'code' ? to : h.w.c,
          RB_BOM_HEAD[k] + ': ' + before, RB_BOM_HEAD[k] + ': ' + to, (k === 'product' || k === 'costKey' ? '담당자 확인 10/19 · 제품코드가 아웃박스 코드(MP0163OB2)로 들어가 있던 일본 BOM → M0163JP2' : k === 'ship' ? '소요원가 #VALUE!(배송비 칸 공백) 고침' : why) + ' · 줄 ' + h.id, '', '-', tag + '-1019', '']);
      });
    });
    bomLogWrite_(bomSS_(), logs);
    SpreadsheetApp.flush();
    out = '칸 ' + logs.length + '개';
  } finally { lock.releaseLock(); }
  bomDropCache_(['M0163AA1', 'M0163JP1', 'M0193AA1', 'MP0163OB2', 'M0163JP2']);
  try { bomBuildCache_(); } catch (eC) { /* 다음에 다시 읽는다 */ }
  P.setProperty('rb.fix1019d', 'done ' + new Date().toISOString() + ' ' + out);
  return out;
}

/** 1회 정리 — 소요원가 계산에 쓰는 칸(소요량 · 단가 · 환율 · 임가공 · 배송비)에 공백만 든 칸을 비운다(공백 한 칸이면 소요원가가 #VALUE!) */
function bomFix1019e_() {
  var P = PropertiesService.getScriptProperties();
  if (P.getProperty('rb.fix1019e')) return '';
  var sh = bomSheet_(), C = bomCols_(sh), n = 0, touched = {};
  var lock = bomLock_();
  try {
    var lr = sh.getLastRow();
    if (lr >= 3) {
      var v = sh.getRange(3, 1, lr - 2, C.lc).getValues();
      ['qty', 'unit', 'fx', 'proc', 'ship'].forEach(function (k) {
        if (!(C[k] >= 0)) return;
        var put = [];
        v.forEach(function (r, i) { if (typeof r[C[k]] === 'string' && r[C[k]] !== '' && !r[C[k]].trim()) { put.push([i + 3, '']); touched[str_(r[C.product]).toUpperCase()] = 1; } });
        if (put.length) { bomSetColRuns_(sh, C[k] + 1, put); n += put.length; }
      });
      if (n) bomLogWrite_(bomSS_(), [[new Date(), me_(), Object.keys(touched).join(', ').slice(0, 200), '', '', '정정', '', '', '', '공백 칸 ' + n + '개', '빈칸', '소요원가 #VALUE! 고침(계산 칸의 공백 지움)', '', '-', Utilities.getUuid().slice(0, 8) + '-1019', '']]);
      SpreadsheetApp.flush();
    }
  } finally { lock.releaseLock(); }
  bomDropCache_(Object.keys(touched));
  try { bomBuildCache_(); } catch (eC) { /* 다음에 다시 읽는다 */ }
  P.setProperty('rb.fix1019e', 'done ' + new Date().toISOString() + ' 칸 ' + n);
  return '칸 ' + n;
}

/**
 * 1회 정리(2026-10-19, 담당자 확인) — 일본 6품목(레티날 · 히알루론산 · 스쿠알란 각 덧방 JP1 · 일반 JP2, 모두 1차 한 번)을 M0159JP1 처럼:
 *  · M0082JP1 · M0163JP1: 단품에서 가져온 줄 초도(25 · 26 · 8차 · 빈칸) → 1차, M0163JP1 원가반영 M0082JP1 → M0163JP1
 *  · M0082JP2(레티날 일본)에 들어간 히알루론산 일본 단상자 · POP · 아웃박스 → 레티날 일본 것(MP0082CA7 · OL1 · OB2, M0082JP1 줄 값으로)
 */
function bomFix1019f_() {
  var P = PropertiesService.getScriptProperties();
  if (P.getProperty('rb.fix1019f')) return '';
  var one = { start: '1차' }, ck63 = { costKey: 'M0163JP1' };
  var mix = function (a, b) { var o = {}; [a, b || {}].forEach(function (x) { Object.keys(x).forEach(function (k) { o[k] = x[k]; }); }); return o; };
  var want = {
    B001821: { p: 'M0082JP1', c: 'MP0082BL7', f: one }, B001822: { p: 'M0082JP1', c: 'MP0082BL8', f: one }, B001823: { p: 'M0082JP1', c: 'MP0082OL2', f: one },
    B001824: { p: 'M0082JP1', c: 'MP0082CA6', f: one }, B001825: { p: 'M0082JP1', c: 'MP0082UG2', f: one }, B001829: { p: 'M0082JP1', c: 'MP0082OB1', f: one },
    B001826: { p: 'M0082JP1', c: 'MP0082CA7', f: {} }, B001827: { p: 'M0082JP1', c: 'MP0082OL1', f: {} }, B001828: { p: 'M0082JP1', c: 'MP0082OB2', f: {} },
    B001834: { p: 'M0082JP2', c: 'MP0159CA4', from: 'B001826' }, B001835: { p: 'M0082JP2', c: 'MP0159OL1', from: 'B001827' }, B001836: { p: 'M0082JP2', c: 'MP0159OB3', from: 'B001828' },
    B001837: { p: 'M0163JP1', c: 'M0163JP1', f: ck63 }, B001838: { p: 'M0163JP1', c: 'MP0159BO1', f: ck63 }, B001839: { p: 'M0163JP1', c: 'MP0159PC1', f: ck63 },
    B001840: { p: 'M0163JP1', c: 'MP0163BL4', f: mix(ck63, one) }, B001841: { p: 'M0163JP1', c: 'MP0163OL2', f: ck63 }, B001842: { p: 'M0163JP1', c: 'MP0163OL1', f: ck63 },
    B001843: { p: 'M0163JP1', c: 'MP0163CA3', f: mix(ck63, one) }, B001844: { p: 'M0163JP1', c: 'MP0163CA4', f: ck63 }, B001845: { p: 'M0163JP1', c: 'MP0163OB1', f: mix(ck63, one) },
    B001846: { p: 'M0163JP1', c: 'MP0163OB2', f: ck63 }
  };
  var COPY = ['code', 'name', 'vendor', 'buy', 'spec', 'moq', 'unit', 'cur', 'fx', 'proc', 'ship', 'qty'];
  var sh = bomSheet_(), C = bomCols_(sh), out = '';
  var lock = bomLock_();
  try {
    var lr = sh.getLastRow();
    if (C.id < 0 || lr < 3) { P.setProperty('rb.fix1019f', 'skip'); return 'skip'; }
    var v = sh.getRange(3, 1, lr - 2, C.lc).getValues(), bad = [], seen = {}, hit = [], byId = {};
    v.forEach(function (r, i) {
      var id = str_(r[C.id]), w = want[id];
      if (!w || seen[id]) return;
      seen[id] = 1; byId[id] = r;
      if (itemCodeKey_(r[C.product]) !== w.p || itemCodeKey_(r[C.code]) !== w.c) { bad.push(id); return; }
      hit.push({ row: i + 3, r: r, id: id, w: w });
    });
    Object.keys(want).forEach(function (id) { if (!seen[id]) bad.push(id + '(없음)'); });
    if (bad.length) { P.setProperty('rb.fix1019f', 'skip ' + bad.join(',')); return 'skip ' + bad.join(','); }
    var now = new Date(), who = me_(), logs = [], tag = Utilities.getUuid().slice(0, 8);
    hit.forEach(function (h) {
      var f = h.w.f || {};
      if (h.w.from) { f = {}; COPY.forEach(function (k) { if (C[k] >= 0) f[k] = byId[h.w.from][C[k]]; }); }
      Object.keys(f).forEach(function (k) {
        if (!(C[k] >= 0)) return;
        var before = h.r[C[k]], to = f[k];
        if (String(before) === String(to)) return;
        sh.getRange(h.row, C[k] + 1).setValue(to);
        var why = h.w.from ? '레티날 일본에 히알루론산 일본 자재가 들어가 있던 것 → 레티날 일본 자재(' + h.w.from + ' 값)' : k === 'costKey' ? '원가반영이 레티날 일본(M0082JP1)으로 복사돼 있던 것' : '일본 제품은 1차 한 번 — 단품 차수로 남은 초도';
        logs.push([now, who, h.w.p, '', str_(h.r[C.start]), '정정', str_(h.r[C.type]), h.w.c, k === 'code' ? str_(to) : h.w.c,
          RB_BOM_HEAD[k] + ': ' + str_(before), RB_BOM_HEAD[k] + ': ' + str_(to), '담당자 확인 10/19 · ' + why + ' · 줄 ' + h.id, '', '-', tag + '-1019', '']);
      });
    });
    bomLogWrite_(bomSS_(), logs);
    SpreadsheetApp.flush();
    out = '칸 ' + logs.length + '개';
  } finally { lock.releaseLock(); }
  bomDropCache_(['M0082JP1', 'M0082JP2', 'M0163JP1']);
  try { bomBuildCache_(); } catch (eC) { /* 다음에 다시 읽는다 */ }
  P.setProperty('rb.fix1019f', 'done ' + new Date().toISOString() + ' ' + out);
  return out;
}

/** 1회 정리(2026-10-19, 담당자 확인) — 레티날 덧방(M0082JP1) 용기라벨은 신원(BL8)만: 혁진 BL7 줄 삭제(삭제보관 탭에 원래 값). 스쿠알란 일본 전용 아웃박스 · POP(MP0163OB2 · OL1) 이름에 '일본' */
function bomFix1019g_() {
  var P = PropertiesService.getScriptProperties();
  if (P.getProperty('rb.fix1019g')) return '';
  var ren = { MP0163OB2: '메디테라피 스쿠알란 스킨 부스터 모이스처라이저 150ml 일본 아웃박스', MP0163OL1: '메디테라피 스쿠알란 스킨 부스터 모이스처라이저 150ml 일본 POP라벨' };
  var sh = bomSheet_(), C = bomCols_(sh), out = '';
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  RB_BOM_HELD = true;
  try {
    var lr = sh.getLastRow();
    var v = sh.getRange(3, 1, lr - 2, C.lc).getValues(), del = -1, delV = null, put = [];
    v.forEach(function (r, i) {
      var k = itemCodeKey_(r[C.code]);
      if (str_(r[C.id]) === 'B001821' && itemCodeKey_(r[C.product]) === 'M0082JP1' && k === 'MP0082BL7') { del = i + 3; delV = r; }
      if (ren[k] && str_(r[C.name]) !== ren[k]) put.push([i + 3, ren[k]]);
    });
    if (del < 0) { P.setProperty('rb.fix1019g', 'skip B001821'); return 'skip B001821'; }
    var now = new Date(), who = me_();
    if (put.length) bomSetColRuns_(sh, C.name + 1, put);
    var ish = sheet_(RB_ITEM.TAB), nI = 0;
    if (ish && ish.getLastRow() >= 2) {
      var ip = [];
      ish.getRange(2, 1, ish.getLastRow() - 1, 2).getValues().forEach(function (r, i) { var k = itemCodeKey_(r[0]); if (ren[k] && str_(r[1]) !== ren[k]) ip.push([i + 2, ren[k]]); });
      if (ip.length) { bomSetColRuns_(ish, 2, ip); nI = ip.length; }
    }
    var bk = tab_(RB_DEL_TAB, RB_DEL_HEAD), r0 = bk.getLastRow() + 1;
    ensureRows_(bk, r0);
    bk.getRange(r0, 1, 1, RB_DEL_HEAD.length).setValues([[now, who, 'M0082JP1', RB_BOM_TAB, del, 'MP0082BL7', JSON.stringify(delV.map(function (x) { return x instanceof Date ? fmtDate_(x) : x; }))]]);
    sh.deleteRow(del);
    bomLogWrite_(bomSS_(), [
      [now, who, 'M0082JP1', '', '1차', '삭제', '용기라벨', 'MP0082BL7', '', 'MP0082BL7 혁진디엔피 용기라벨', '삭제', '담당자 확인 10/19 · 레티날 덧방 용기라벨은 신원(MP0082BL8) — 원래 값은 ' + RB_DEL_TAB, '', '-', Utilities.getUuid().slice(0, 8) + '-1019', ''],
      [now, who, 'M0163JP1, M0163JP2', '', '', '정정', '', 'MP0163OB2, MP0163OL1', '', '품목명(일본 없음)', '품목명에 일본 — BOM ' + put.length + '줄 · 품목 DB ' + nI + '개', '담당자 확인 10/19 · 일본 전용 문안', '', '-', Utilities.getUuid().slice(0, 8) + '-1019', '']]);
    SpreadsheetApp.flush();
    out = 'BL7 줄 삭제 · 이름 BOM ' + put.length + '줄 · DB ' + nI;
  } finally {
    RB_BOM_HELD = false;
    lock.releaseLock();
  }
  cacheDrop_(RB_ITEM.CACHE); cacheDrop_(RB_II_CACHE);
  bomDropCache_(['M0082JP1', 'M0163JP1', 'M0163JP2']);
  try { bomBuildCache_(); } catch (eC) { /* 다음에 다시 읽는다 */ }
  P.setProperty('rb.fix1019g', 'done ' + new Date().toISOString() + ' ' + out);
  return out;
}

/** 1회 정리(2026-10-19, 담당자 확인) — 일본용이 아닌 자재는 업체 이원화라 둘 다 있어야 한다: 레티날 덧방 혁진 용기라벨(BL7) 줄을 삭제보관 값으로 되살리고 원가반영만 비움(원가는 신원 BL8 하나) */
function bomFix1019h_() {
  var P = PropertiesService.getScriptProperties();
  if (P.getProperty('rb.fix1019h')) return '';
  var sh = bomSheet_(), C = bomCols_(sh), out = '';
  var lock = bomLock_();
  try {
    var lr = sh.getLastRow();
    var ids = sh.getRange(3, C.id + 1, lr - 2, 1).getValues();
    if (ids.some(function (r) { return str_(r[0]) === 'B001821'; })) { P.setProperty('rb.fix1019h', 'skip 줄 있음'); return 'skip 줄 있음'; }
    var bk = sheet_(RB_DEL_TAB), val = null;
    if (bk && bk.getLastRow() >= 2) bk.getRange(2, 1, bk.getLastRow() - 1, RB_DEL_HEAD.length).getValues().forEach(function (r) {
      if (str_(r[2]) === 'M0082JP1' && str_(r[5]) === 'MP0082BL7') { try { var x = JSON.parse(r[6]); if (str_(x[C.id]) === 'B001821') val = x; } catch (e) { /* 넘어간다 */ } }
    });
    if (!val || val.length !== C.lc) { P.setProperty('rb.fix1019h', 'skip 보관 값 없음'); return 'skip 보관 값 없음'; }
    val[C.costKey] = '';
    var nr = sh.getLastRow() + 1;
    ensureRows_(sh, nr);
    sh.getRange(nr, 1, 1, C.lc).setValues([val]);
    bomLogWrite_(bomSS_(), [[new Date(), me_(), 'M0082JP1', '', '1차', '추가', '용기라벨', '', 'MP0082BL7', '', 'MP0082BL7 혁진디엔피 용기라벨(원가반영 없음)',
      '담당자 확인 10/19 · 일본용 아닌 자재는 업체 이원화로 둘 다 — 원가는 신원(BL8) 하나만', '', '-', Utilities.getUuid().slice(0, 8) + '-1019', '']]);
    SpreadsheetApp.flush();
    out = 'BL7 줄 되살림(원가반영 없음)';
  } finally { lock.releaseLock(); }
  bomDropCache_(['M0082JP1']);
  try { bomBuildCache_(); } catch (eC) { /* 다음에 다시 읽는다 */ }
  P.setProperty('rb.fix1019h', 'done ' + new Date().toISOString() + ' ' + out);
  return out;
}

/** 1회 정리(2026-10-19, 담당자 확인 「덧방은 일본용 — 신원만」) — 되살렸던 레티날 덧방 혁진 용기라벨(BL7) 줄을 다시 삭제(삭제보관 탭에 원래 값) */
function bomFix1019i_() {
  var P = PropertiesService.getScriptProperties();
  if (P.getProperty('rb.fix1019i')) return '';
  var sh = bomSheet_(), C = bomCols_(sh), out = '';
  var lock = bomLock_();
  try {
    var lr = sh.getLastRow(), v = sh.getRange(3, 1, lr - 2, C.lc).getValues(), rows = [], back = [], now = new Date(), who = me_();
    v.forEach(function (r, i) {
      if (itemCodeKey_(r[C.product]) !== 'M0082JP1' || itemCodeKey_(r[C.code]) !== 'MP0082BL7') return;
      rows.push(i + 3);
      back.push([now, who, 'M0082JP1', RB_BOM_TAB, i + 3, 'MP0082BL7', JSON.stringify(r.map(function (x) { return x instanceof Date ? fmtDate_(x) : x; }))]);
    });
    if (!rows.length) { P.setProperty('rb.fix1019i', 'skip 줄 없음'); return 'skip 줄 없음'; }
    var bk = tab_(RB_DEL_TAB, RB_DEL_HEAD), r0 = bk.getLastRow() + 1;
    ensureRows_(bk, r0 + back.length - 1);
    bk.getRange(r0, 1, back.length, RB_DEL_HEAD.length).setValues(back);
    deleteRowsDesc_(sh, rows);
    bomLogWrite_(bomSS_(), [[now, who, 'M0082JP1', '', '1차', '삭제', '용기라벨', 'MP0082BL7', '', 'MP0082BL7 혁진디엔피 용기라벨', '삭제', '담당자 확인 10/19 · 덧방은 일본용 — 용기라벨은 신원(BL8)만 · 원래 값은 ' + RB_DEL_TAB, '', '-', Utilities.getUuid().slice(0, 8) + '-1019', '']]);
    SpreadsheetApp.flush();
    out = 'BL7 ' + rows.length + '줄 삭제';
  } finally { lock.releaseLock(); }
  bomDropCache_(['M0082JP1']);
  try { bomBuildCache_(); } catch (eC) { /* 다음에 다시 읽는다 */ }
  P.setProperty('rb.fix1019i', 'done ' + new Date().toISOString() + ' ' + out);
  return out;
}

/**
 * 담당자와 확인한 BOM 정리 묶음(2026-10-19~) — 묶음마다 한 번만(스크립트 속성 key). 1분 작업(journalDrain)이 안 한 묶음을 하나씩 처리.
 *  ops: { id: 줄ID, p: 제품코드, c: 자재코드, set: { 칸키: 값 } } 또는 { id, p, c, del: true }(삭제보관 탭에 원래 값)
 *  add: { 칸키: 값 } 을 더하면 그 줄을 본떠 새 줄을 맨 아래에(종료 · 초도 발주일 비움, 소요원가는 수식) — 새 자재코드는 품목 DB 에 등록
 *  줄ID · 제품 · 자재코드가 하나라도 예상과 다르면 그 묶음은 손대지 않는다.
 */
var RB_FIX_BATCHES = [
  { key: 'rb.fix1019j', why: '담당자 확인 10/19 · 제품 줄 두 개가 다 원가에 들어감(원가 이중)', ops: [
    { id: 'B001097', p: 'M0174AA1', c: 'M0174AA1', set: { end: '2차' } },
    { id: 'B001196', p: 'M0171AA1', c: 'M0171AA1', set: { end: '2차' } },
    { id: 'B000256', p: 'M0144AA1', c: 'M0144AA1', del: true }
  ] },
  { key: 'rb.fix1019k', why: '담당자 확인 10/19 · 종료가 초도보다 앞(어느 차수에도 안 들어감) — 종료 비움', ops: [
    { id: 'B000552', p: 'M0077AA1', c: 'MP0077OB2', set: { end: '' } },
    { id: 'B000837', p: 'M0161AA1', c: 'MP0161BO1', set: { end: '' } }
  ] },
  { key: 'rb.fix1018a', why: '담당자 확인 10/18 · 세트는 구성품 · 포장 · 다원 포장비 전부 합친 원가 — 원가에서 빠져 있던 줄 원가반영', ops: [
    { id: 'B001879', p: 'M0231AA1', c: 'MP0082PC3', set: { costKey: 'M0231AA1' } },
    { id: 'B001880', p: 'M0231AA1', c: 'MP0082BL6', set: { costKey: 'M0231AA1' } },
    { id: 'B001881', p: 'M0231AA1', c: 'MP0082CA6', set: { costKey: 'M0231AA1' } },
    { id: 'B001882', p: 'M0231AA1', c: 'MP0082UG2', set: { costKey: 'M0231AA1' } },
    { id: 'B001883', p: 'M0231AA1', c: 'M0220AA1', set: { costKey: 'M0231AA1' } },
    { id: 'B001884', p: 'M0231AA1', c: 'MP0220BO1', set: { costKey: 'M0231AA1' } },
    { id: 'B001885', p: 'M0231AA1', c: 'MP0220MS1', set: { costKey: 'M0231AA1' } },
    { id: 'B001886', p: 'M0231AA1', c: 'MP0220CP1', set: { costKey: 'M0231AA1' } },
    { id: 'B001887', p: 'M0231AA1', c: 'MP0220CA1', set: { costKey: 'M0231AA1' } },
    { id: 'B001888', p: 'M0231AA1', c: 'MP0219UG1', set: { costKey: 'M0231AA1' } },
    { id: 'B001889', p: 'M0231AA1', c: 'M0218AA1', set: { costKey: 'M0231AA1' } },
    { id: 'B001890', p: 'M0231AA1', c: 'MP0218BO1', set: { costKey: 'M0231AA1' } },
    { id: 'B001891', p: 'M0231AA1', c: 'MP0218LD1', set: { costKey: 'M0231AA1' } },
    { id: 'B001892', p: 'M0231AA1', c: 'MP0218ST1', set: { costKey: 'M0231AA1' } },
    { id: 'B001893', p: 'M0231AA1', c: 'MP0218CP1', set: { costKey: 'M0231AA1' } },
    { id: 'B001894', p: 'M0231AA1', c: 'MP0218CA1', set: { costKey: 'M0231AA1' } },
    { id: 'B001895', p: 'M0231AA1', c: 'MP0218UG1', set: { costKey: 'M0231AA1' } },
    { id: 'B001896', p: 'M0231AA1', c: 'MP0231CA1', set: { costKey: 'M0231AA1' } },
    { id: 'B001897', p: 'M0231AA1', c: 'MP0231SL1', set: { costKey: 'M0231AA1' } },
    { id: 'B001898', p: 'M0231AA1', c: 'MP0231OB1', set: { costKey: 'M0231AA1' } }
  ] },
  { key: 'rb.fix1018b', why: '담당자 확인 10/18 · 토너(H0014AA1) 자재가 다른 제품코드에 잘못 들어가 있던 것 — 품목명대로 토너로 옮김(차수 미정이라 원가는 지금 쓰는 톨리코리아 하나만)', ops: [
    { id: 'B000576', p: 'M0218AA1', c: 'HP0014BO3', set: { product: 'H0014AA1', costKey: '' } },
    { id: 'B000577', p: 'H0055AA1', c: 'HP0014PC3', set: { product: 'H0014AA1', costKey: '' } }
  ] },
  { key: 'rb.fix1018c', why: '10/18 BOM 점검 · 지금 쓰는 줄(옛 버전은 닫힘 · 같은 구분 다른 줄 없음)인데 원가 체크만 빠져 원가 합계에서 빠지던 것', ops: [
    { id: 'B000837', p: 'M0161AA1', c: 'MP0161BO1', set: { costKey: 'M0161AA1' } },
    { id: 'B001915', p: 'M0230AA1', c: 'M0230AA1', set: { costKey: 'M0230AA1' } },
    { id: 'B001916', p: 'M0230AA1', c: 'MP0230PH1', set: { costKey: 'M0230AA1' } },
    { id: 'B001917', p: 'M0230AA1', c: 'MP0230CA1', set: { costKey: 'M0230AA1' } },
    { id: 'B001918', p: 'M0230AA1', c: 'MP0230OB1', set: { costKey: 'M0230AA1' } },
    { id: 'B001919', p: 'M0228JP1', c: 'M0228JP1', set: { costKey: 'M0228JP1' } },
    { id: 'B001920', p: 'M0234AA2', c: 'M0234AA2', set: { costKey: 'M0234AA2' } }
  ] },
  { key: 'rb.fix1018d', why: '10/18 BOM 점검 · 새 버전이 들어온 차수 앞에서 옛 버전 줄 닫기(종료 칸 오타 \'2치\' 포함)', ops: [
    { id: 'B000374', p: 'H0007AA1', c: 'HP0068IB1', set: { end: '2차' } },
    { id: 'B000375', p: 'H0007AA1', c: 'HP0007OB2', set: { end: '2차' } },
    { id: 'B000563', p: 'H0020AA1', c: 'HP0020CA1', set: { end: '3차' } },
    { id: 'B000598', p: 'M0088AA1', c: 'MP0088OB1', set: { end: '4차' } },
    { id: 'B000825', p: 'M0159AA1', c: 'MP0159BL2', set: { end: '3차' } }
  ] },
  { key: 'rb.fix1018e', why: '10/18 BOM 점검 · 페이셜 타월 40매입 — 소요원가 칸에 숫자 13 이 잘못 들어가 제품 단가가 원가에서 빠짐(계산 수식으로) · 0차 옛 아웃박스 줄(새 줄과 겹침) 삭제 · 초도 · 브랜드 빈 칸', ops: [
    { id: 'B001871', p: 'H0079AA1', c: 'H0079AA1', set: { start: '1차', brand: '히디프' }, costCalc: true },
    { id: 'B001872', p: 'H0079AA1', c: '', set: { start: '1차', brand: '히디프' }, costCalc: true },
    { id: 'B001873', p: 'H0079AA1', c: 'HP0079PH1', set: { start: '1차', brand: '히디프' }, costCalc: true },
    { id: 'B001874', p: 'H0079AA1', c: 'HP0079OB1', del: true },
    { id: 'B001875', p: 'H0079AA1', c: 'HP0079OB1', set: { brand: '히디프' }, costCalc: true }
  ] },
  { key: 'rb.fix1018f', why: '담당자 확인 10/18 · 블러 크림 단상자 — 종이 · 업체가 바뀔 때마다, 제품 버전이 올라갈 때마다 이전 번호 +1 (AA1 CA1~CA3 → RB CA4 → RNL CA5) · 아웃박스는 업체 바뀐 두보산업부터 OB2(제품끼리 같이 씀)', itemFrom: ['MP0136CA1', 'MP0136CA2', 'MP0136CA3', 'MP0136OB1'], ops: [
    { id: 'B000038', p: 'M0136AA1', c: 'MP0136CA1', set: { code: 'MP0136CA2' } },
    { id: 'B000039', p: 'M0136AA1', c: 'MP0136CA1', set: { code: 'MP0136CA3' } },
    { id: 'B001012', p: 'M0136AA2', c: 'MP0136CA2', set: { code: 'MP0136CA4' } },
    { id: 'B001017', p: 'M0136AA3', c: 'MP0136CA3', set: { code: 'MP0136CA5' } },
    { id: 'B000042', p: 'M0136AA1', c: 'MP0136OB1', set: { code: 'MP0136OB2' } },
    { id: 'B001013', p: 'M0136AA2', c: 'MP0136OB1', set: { code: 'MP0136OB2' } },
    { id: 'B001014', p: 'M0136AA2', c: 'MP0136OB1', set: { code: 'MP0136OB2' } },
    { id: 'B001018', p: 'M0136AA3', c: 'MP0136OB1', set: { code: 'MP0136OB2' } }
  ] },
  { key: 'rb.fix1018g', why: '담당자 확인 10/18 · 멜팅 스크럽 세럼 — 원재료(코드 X) 줄을 없애고 원재료 단가 · 임가공을 제품 줄로', ops: [
    { id: 'B000049', p: 'M0134AA1', c: 'M0134AA1', set: { unit: 1745, proc: 30 }, costCalc: true },
    { id: 'B000050', p: 'M0134AA1', c: 'X', del: true }
  ] },
  { key: 'rb.fix1018h', why: '담당자 확인 10/18 · 엑소좀 스피큘 세럼 — 원재료(코드 X) 줄 삭제(제품 줄에 같은 단가 1180)', ops: [
    { id: 'B000058', p: 'M0079AA1', c: 'X', del: true }
  ] },
  { key: 'rb.fix1018i', why: '담당자 확인 10/18 · 소프트 클린 키트 — 문안 변경은 같은 코드, 업체 변경 · 제품 버전업은 번호 +1 (단상자 AA1 CA1 → 7차 승명 CA2 → AA2 CA3 → AA3 CA4, 아웃박스 헌스 OB1 → 두보 OB2)', itemFrom: ['HP0008CA1', 'HP0008CA2', 'HP0008CA3', 'HP0008OB1'], ops: [
    { id: 'B000123', p: 'H0008AA1', c: 'HP0008CA1', set: { code: 'HP0008CA2' } },
    { id: 'B000131', p: 'H0008AA2', c: 'HP0008CA2', set: { code: 'HP0008CA3' } },
    { id: 'B000132', p: 'H0008AA2', c: 'HP0008CA2', set: { code: 'HP0008CA3' } },
    { id: 'B000138', p: 'H0008AA3', c: 'HP0008CA3', set: { code: 'HP0008CA4' } },
    { id: 'B000126', p: 'H0008AA1', c: 'HP0008OB1', set: { code: 'HP0008OB2' } },
    { id: 'B000134', p: 'H0008AA2', c: 'HP0008OB1', set: { code: 'HP0008OB2' } },
    { id: 'B000140', p: 'H0008AA3', c: 'HP0008OB1', set: { code: 'HP0008OB2' } }
  ] },
  { key: 'rb.fix1018j', why: '10/18 BOM 점검 · 텐션 업 마스크 1매입 — 10/19 에 지운 옛 제품 줄(800원)의 남은 자재 3줄이 지금 줄과 같이 원가에 들어가 파우치 · 아웃박스 원가가 두 번 — 남은 줄 삭제', ops: [
    { id: 'B000257', p: 'M0144AA1', c: 'X', del: true },
    { id: 'B000258', p: 'M0144AA1', c: 'MP0084PH1', del: true },
    { id: 'B000259', p: 'M0144AA1', c: 'MP0084OB1', del: true }
  ] },
  { key: 'rb.fix1018k', why: '담당자 확인 10/18 · 판테놀 카밍 세럼 — 4차 펌프+캡 · 5~7차 단상자가 빠져 있던 것(PC2 를 4차까지, 승명실업 CA2 를 7차까지)', ops: [
    { id: 'B000559', p: 'H0020AA1', c: 'HP0020PC2', set: { end: '4차' } },
    { id: 'B000564', p: 'H0020AA1', c: 'HP0020CA2', set: { end: '7차' } }
  ] },
  { key: 'rb.fix1018l', why: '담당자 확인 10/19 · 인모톡스 크림 6차는 디자인팩 단상자 · 헌스 아웃박스(1번) — 1번 줄을 6차까지', ops: [
    { id: 'B000473', p: 'M0150AA1', c: 'MP0150CA1', set: { end: '6차' } },
    { id: 'B000475', p: 'M0150AA1', c: 'MP0150OB1', set: { end: '6차' } }
  ] },
  { key: 'rb.fix1019a', why: '담당자 확인 10/19 · 히알루론산 세럼 5차 단상자는 4차와 같은 135원 — 4차 줄을 5차까지', ops: [
    { id: 'B000829', p: 'M0159AA1', c: 'MP0159CA2', set: { end: '5차' } }
  ] },
  { key: 'rb.bomfix1019b', why: '10/19 BOM 점검 · 블루센텔라 카밍 크림 4차부터는 RB(M0077AA2) — 옛 코드(M0077AA1)에 남은 4차~ 아웃박스 줄은 AA2 줄과 같은 것이라 지움', ops: [
    { id: 'B000552', p: 'M0077AA1', c: 'MP0077OB2', del: true }
  ] },
  { key: 'rb.bomfix1019c', why: '10/19 BOM 점검 · 비비 쿠션 아웃박스 같은 코드 · 같은 단가 줄이 두 번 원가에 들어감 — 앞 줄을 다음 줄 앞 차수에서 닫음', ops: [
    { id: 'B001235', p: 'H0036AA1', c: 'HP0035OB1', set: { end: '3차' } },
    { id: 'B001249', p: 'H0035AA1', c: 'HP0035OB1', set: { end: '2차' } }
  ] },
  { key: 'rb.bomfix1019d', why: '담당자 확인 10/19 · 디자인팩 단상자 거래 종료 — 포쎄라 비피다 세럼 RB 는 10차부터 성진인쇄(MP0078CA2) 하나. 같은 코드로 남은 디자인팩 줄 지움', ops: [
    { id: 'B001023', p: 'M0078AA2', c: 'MP0078CA2', del: true }
  ] },
  { key: 'rb.bomfix1019e', why: '담당자 확인 10/19 · 디자인팩 단상자 거래 종료 → 전부 성진인쇄. 바뀐 차수 기록이 없어 마지막 발주 차수(없으면 BOM 마지막 차수)까지 디자인팩, 다음 차수부터 성진(업체 바뀜 = 코드 +1, 단가는 다음 발주 때)', ops: [
    { id: 'B000076', p: 'M0079AA3', c: 'MP0079CA3', del: true, add: { code: 'MP0079CA4', vendor: '성진인쇄', start: '12차', unit: '' } },
    { id: 'B000151', p: 'M0027AA1', c: 'MP0027CA2', set: { end: '22차' }, add: { code: 'MP0027CA3', vendor: '성진인쇄', start: '23차', unit: '' } },
    { id: 'B000158', p: 'M0018AA1', c: 'MP0018CA1', set: { end: '1차' }, add: { code: 'MP0018CA2', vendor: '성진인쇄', start: '2차', unit: '' } },
    { id: 'B000167', p: 'M0022AA1', c: 'MP0018CA1', set: { end: '1차' }, add: { code: 'MP0018CA2', vendor: '성진인쇄', start: '2차', unit: '' } },
    { id: 'B000454', p: 'M0148AA1', c: 'MP0148CA1', set: { end: '6차' }, add: { code: 'MP0148CA2', vendor: '성진인쇄', start: '7차', unit: '' } },
    { id: 'B000464', p: 'M0149AA1', c: 'MP0149CA1', set: { end: '6차' }, add: { code: 'MP0149CA2', vendor: '성진인쇄', start: '7차', unit: '' } },
    { id: 'B000544', p: 'M0131AA1', c: 'MP0131CA1', set: { end: '9차' }, add: { code: 'MP0131CA2', vendor: '성진인쇄', start: '10차', unit: '' } },
    { id: 'B000545', p: 'M0131AA1', c: 'MP0131MS1', set: { end: '9차' }, add: { code: 'MP0131MS2', vendor: '성진인쇄', start: '10차', unit: '' } }
  ] },
  { key: 'rb.bomfix1019f', why: '담당자 확인 10/19 · 로얄 피니시 크림 50ml 단상자는 처음부터 성진인쇄(업체 칸만 잘못 적힘 — 코드 그대로)', itemFrom: ['HP0027CA1'], ops: [
    { id: 'B000605', p: 'H0027AA1', c: 'HP0027CA1', set: { vendor: '성진인쇄' } }
  ] },
  { key: 'rb.bomfix1019g', why: '담당자 확인 10/19 · 아하 바하 아웃박스 단가 2차부터 바뀜(1차 700원 · 2차부터 770원)', ops: [
    { id: 'B001303', p: 'M0183AA1', c: 'MP0183OB1', set: { end: '1차' } },
    { id: 'B001304', p: 'M0183AA1', c: 'MP0183OB1', set: { start: '2차' } }
  ] },
  { key: 'rb.bomfix1019h', why: '담당자 확인 10/19 · 성진인쇄 단상자(디자인팩에서 바뀐 것) 단가는 품목마다 달라 일단 0원 — 다음 발주 때 넣음', ops: [
    { id: 'B001960', p: 'M0079AA3', c: 'MP0079CA4', set: { unit: 0 }, costCalc: true },
    { id: 'B001961', p: 'M0027AA1', c: 'MP0027CA3', set: { unit: 0 }, costCalc: true },
    { id: 'B001962', p: 'M0018AA1', c: 'MP0018CA2', set: { unit: 0 }, costCalc: true },
    { id: 'B001963', p: 'M0022AA1', c: 'MP0018CA2', set: { unit: 0 }, costCalc: true },
    { id: 'B001964', p: 'M0148AA1', c: 'MP0148CA2', set: { unit: 0 }, costCalc: true },
    { id: 'B001965', p: 'M0149AA1', c: 'MP0149CA2', set: { unit: 0 }, costCalc: true },
    { id: 'B001966', p: 'M0131AA1', c: 'MP0131CA2', set: { unit: 0 }, costCalc: true },
    { id: 'B001967', p: 'M0131AA1', c: 'MP0131MS2', set: { unit: 0 }, costCalc: true }
  ] },
  { key: 'rb.bomfix1019i', why: '10/19 BOM 점검 · 포쎄라 블러 세럼 튜브+캡 TB2 는 TB1 과 업체 · 사양 · 단가가 같은 중복 줄(10/07 자재 추가) — 발주는 전부 TB1. 원가 두 번 들어가던 것', itemDel: ['MP0178TB2'], ops: [
    { id: 'B001356', p: 'M0178AA1', c: 'MP0178TB2', del: true }
  ] },
  { key: 'rb.bomfix1019j', why: '10/19 BOM 점검 · 스킨 프렙 듀오 — 클렌저(MX0185) · 토너(MX0184) 반제품 두 개의 자재에 반제품 구성 표시(같은 구분이 두 번 원가로 보이던 것) · 토너 인박스 · 아웃박스 이름이 클렌저로 적혀 있던 것 · 두 반제품이 같이 쓰는 용기 공용', itemFrom: ['MP0184IB1', 'MP0184OB2'], ops: [
    { id: 'B001381', p: 'M0190AA1', c: 'MP0169BO1', set: { semi: 'MX0185AA1', common: '공용' } },
    { id: 'B001382', p: 'M0190AA1', c: 'MP0169BO1', set: { semi: 'MX0185AA1', common: '공용' } },
    { id: 'B001383', p: 'M0190AA1', c: 'MP0185PU1', set: { semi: 'MX0185AA1' } },
    { id: 'B001384', p: 'M0190AA1', c: 'MP0185PU1', set: { semi: 'MX0185AA1' } },
    { id: 'B001385', p: 'M0190AA1', c: 'MP0185BL1', set: { semi: 'MX0185AA1' } },
    { id: 'B001386', p: 'M0190AA1', c: 'MP0185IB1', set: { semi: 'MX0185AA1' } },
    { id: 'B001387', p: 'M0190AA1', c: 'MP0185OB2', set: { semi: 'MX0185AA1' } },
    { id: 'B001389', p: 'M0190AA1', c: 'MP0169BO1', set: { semi: 'MX0184AA1', common: '공용' } },
    { id: 'B001390', p: 'M0190AA1', c: 'MP0169BO1', set: { semi: 'MX0184AA1', common: '공용' } },
    { id: 'B001391', p: 'M0190AA1', c: 'MP0169PC1', set: { semi: 'MX0184AA1' } },
    { id: 'B001392', p: 'M0190AA1', c: 'MP0169PC1', set: { semi: 'MX0184AA1' } },
    { id: 'B001393', p: 'M0190AA1', c: 'MP0184BL1', set: { semi: 'MX0184AA1' } },
    { id: 'B001394', p: 'M0190AA1', c: 'MP0184IB1', set: { semi: 'MX0184AA1', name: '메디테라피 바하 파하 루틴 토너 20ml 미품 인박스' } },
    { id: 'B001395', p: 'M0190AA1', c: 'MP0184OB2', set: { semi: 'MX0184AA1', name: '메디테라피 바하 파하 루틴 토너 20ml 미품 아웃박스' } }
  ] },
  { key: 'rb.bomfix1019k', why: '10/19 BOM 점검 · 아하 바하 클렌저 150ml(M0087AA3) — 1차 전 옛 단가 줄(용기 ‘기존’ · 아웃박스 770원 차수 없음)이 1차 줄과 같이 원가에 들던 것 지움 / 히알루론산 미스트(M0206AA1) 라벨 줄 구분이 펌프+캡으로 적힌 것 → 용기라벨', ops: [
    { id: 'B001537', p: 'M0087AA3', c: 'MP0087BO1', del: true },
    { id: 'B001542', p: 'M0087AA3', c: 'MP0087OB2', del: true },
    { id: 'B001747', p: 'M0206AA1', c: 'MP0088BL2', set: { type: '용기라벨' } }
  ] },
  { key: 'rb.bomfix1019l', why: '담당자 확인 10/19(제이든) · 카카오톡 선물하기 패키지 S · M 은 쇼핑백 S 와 따로인 품목 — 쇼핑백 S(H0012AA2) BOM 에 섞여 쇼핑백 원가가 4,915원으로 잡히던 것. 패키지 S(H0060AA1) · M(H0061AA1) 품목을 만들고 단상자 · 편지지 · 봉투를 옮김(편지지 · 봉투는 S · M 공용)', ops: [
    { id: 'B001740', p: 'H0012AA2', c: 'HP0060CA1', set: { product: 'H0060AA1', costKey: 'H0060AA1', search: '히디프 카카오톡 선물하기 패키지 S' }, add: { code: 'H0060AA1', type: '세트', name: '히디프 카카오톡 선물하기 패키지 S', product: 'H0060AA1', costKey: 'H0060AA1', search: '히디프 카카오톡 선물하기 패키지 S', common: '', unit: 0, start: '1차', remark: '', change: '선물하기 패키지 — 쇼핑백 S BOM 에서 분리(10/19)' } },
    { id: 'B001741', p: 'H0012AA2', c: 'HP0061CA1', set: { product: 'H0061AA1', costKey: 'H0061AA1', search: '히디프 카카오톡 선물하기 패키지 M' }, add: { code: 'H0061AA1', type: '세트', name: '히디프 카카오톡 선물하기 패키지 M', product: 'H0061AA1', costKey: 'H0061AA1', search: '히디프 카카오톡 선물하기 패키지 M', common: '', unit: 0, start: '1차', remark: '', change: '선물하기 패키지 — 쇼핑백 S BOM 에서 분리(10/19)' } },
    { id: 'B001742', p: 'H0012AA2', c: 'HP0060MS1', set: { product: 'H0060AA1', costKey: 'H0060AA1', search: '히디프 카카오톡 선물하기 패키지 S' }, add: { product: 'H0061AA1', costKey: 'H0061AA1', search: '히디프 카카오톡 선물하기 패키지 M', start: '1차' } },
    { id: 'B001743', p: 'H0012AA2', c: 'HP0060MS2', set: { product: 'H0060AA1', costKey: 'H0060AA1', search: '히디프 카카오톡 선물하기 패키지 S' }, add: { product: 'H0061AA1', costKey: 'H0061AA1', search: '히디프 카카오톡 선물하기 패키지 M', start: '1차' } }
  ] },
  { key: 'rb.bomfix1019m', why: '담당자 확인 10/19 · 히디프 미니 단품 단상자는 MOQ 구간별 단가(5,000개 · 10,000개) 두 줄 — 실제 발주가 10,000개라 10,000개 줄만 원가, 5,000개 줄은 견적 참고로 남기고 원가 체크만 뺌', ops: [
    { id: 'B001762', p: 'H0068AA1', c: 'HP0068CA1', set: { costKey: '' } },
    { id: 'B001768', p: 'H0067AA2', c: 'HP0067CA1', set: { costKey: '' } },
    { id: 'B001773', p: 'H0066AA2', c: 'HP0066CA1', set: { costKey: '' } },
    { id: 'B001779', p: 'H0065AA2', c: 'HP0065CA1', set: { costKey: '' } },
    { id: 'B001780', p: 'H0065AA2', c: 'HP0065CA1', set: { costKey: 'H0065AA2' } }
  ] },
  { key: 'rb.bomfix1019n', why: '10/19 BOM 점검 · H0012AA2 3차 초도 발주일 2613-10-17 은 오타 — 발주 DB 3차 발주일(2026-07-10)로', ops: [
    { id: 'B001739', p: 'H0012AA2', c: 'H0012AA2', set: { firstAt: '2026-07-10' } }
  ] },
  { key: 'rb.bomfix1019o', why: '10/19 BOM 재검사 · 초도가 빈 줄(처음 BOM)을 1차로', ops: [
    { id: 'B000356', p: 'H0023AA1', c: 'H0023AA1', set: {'start': '1차'} },
    { id: 'B000357', p: 'H0023AA1', c: 'HX0065AA1', set: {'start': '1차'} },
    { id: 'B000358', p: 'H0023AA1', c: 'HP0065BO1', set: {'start': '1차'} },
    { id: 'B000359', p: 'H0023AA1', c: 'HP0065PC1', set: {'start': '1차'} },
    { id: 'B000360', p: 'H0023AA1', c: 'HX0002AA3', set: {'start': '1차'} },
    { id: 'B000361', p: 'H0023AA1', c: 'HP0002BO2', set: {'start': '1차'} },
    { id: 'B000362', p: 'H0023AA1', c: 'HP0002SP1', set: {'start': '1차'} },
    { id: 'B000363', p: 'H0023AA1', c: 'HP0002MS1', set: {'start': '1차'} },
    { id: 'B000364', p: 'H0023AA1', c: 'HP0021MS1', set: {'start': '1차'} },
    { id: 'B000365', p: 'H0023AA1', c: 'HP0023OP1', set: {'start': '1차'} },
    { id: 'B000366', p: 'H0023AA1', c: 'HP0023OB1', set: {'start': '1차'} },
    { id: 'B000785', p: 'M0162AA2', c: 'M0162AA2', set: {'start': '1차'} },
    { id: 'B000786', p: 'M0162AA2', c: 'MP0162BO1', set: {'start': '1차'} },
    { id: 'B000787', p: 'M0162AA2', c: 'MP0162CP2', set: {'start': '1차'} },
    { id: 'B000788', p: 'M0162AA2', c: 'MP0162MS1', set: {'start': '1차'} },
    { id: 'B000789', p: 'M0162AA2', c: 'MP0162BL2', set: {'start': '1차'} },
    { id: 'B000790', p: 'M0162AA2', c: 'MP0162CA3', set: {'start': '1차'} },
    { id: 'B000791', p: 'M0162AA2', c: 'MP0162OB1', set: {'start': '1차'} },
    { id: 'B000922', p: 'M0182AA1', c: 'M0182AA1', set: {'start': '1차'} },
    { id: 'B000923', p: 'M0182AA1', c: 'M0159AA1', set: {'start': '1차'} },
    { id: 'B000924', p: 'M0182AA1', c: 'M0163AA1', set: {'start': '1차'} },
    { id: 'B000925', p: 'M0182AA1', c: 'M0082AA4', set: {'start': '1차'} },
    { id: 'B000926', p: 'M0182AA1', c: 'MP0182CA1', set: {'start': '1차'} },
    { id: 'B000927', p: 'M0193AA1', c: 'M0193AA1', set: {'start': '1차'} },
    { id: 'B000928', p: 'M0193AA1', c: 'MX0159AA1', set: {'start': '1차'} },
    { id: 'B000929', p: 'M0193AA1', c: 'MP0159BO1', set: {'start': '1차'} },
    { id: 'B000930', p: 'M0193AA1', c: 'MP0159PC1', set: {'start': '1차'} },
    { id: 'B000931', p: 'M0193AA1', c: 'MP0159BL3', set: {'start': '1차'} },
    { id: 'B000932', p: 'M0193AA1', c: 'MP0159OB2', set: {'start': '1차'} },
    { id: 'B000933', p: 'M0193AA1', c: 'MX0163AA1', set: {'start': '1차'} },
    { id: 'B000934', p: 'M0193AA1', c: 'MP0159BO1', set: {'start': '1차'} },
    { id: 'B000936', p: 'M0193AA1', c: 'MP0163BL4', set: {'start': '1차'} },
    { id: 'B000937', p: 'M0193AA1', c: 'MP0193IB1', set: {'start': '1차'} },
    { id: 'B000938', p: 'M0193AA1', c: 'MP0193OB2', set: {'start': '1차'} },
    { id: 'B000939', p: 'M0193AA1', c: 'MX0082AA5', set: {'start': '1차'} },
    { id: 'B000940', p: 'M0193AA1', c: 'MP0082BO3', set: {'start': '1차'} },
    { id: 'B000941', p: 'M0193AA1', c: 'MP0082PC3', set: {'start': '1차'} },
    { id: 'B000942', p: 'M0193AA1', c: 'MP0082BL8', set: {'start': '1차'} },
    { id: 'B000943', p: 'M0193AA1', c: 'MP0193CA1', set: {'start': '1차'} },
    { id: 'B000944', p: 'M0193AA1', c: 'MP0193OB1', set: {'start': '1차'} },
    { id: 'B001015', p: 'M0136AA3', c: 'M0136AA3', set: {'start': '1차'} },
    { id: 'B001016', p: 'M0136AA3', c: 'MP0136TB3', set: {'start': '1차'} },
    { id: 'B001017', p: 'M0136AA3', c: 'MP0136CA5', set: {'start': '1차'} },
    { id: 'B001018', p: 'M0136AA3', c: 'MP0136OB2', set: {'start': '1차'} },
    { id: 'B001088', p: 'H0003AA1', c: 'H0003AA1', set: {'start': '1차'} },
    { id: 'B001089', p: 'H0016AA1', c: 'H0016AA1', set: {'start': '1차'} },
    { id: 'B001090', p: 'H0028AA1', c: 'H0028AA1', set: {'start': '1차'} },
    { id: 'B001091', p: 'H0028AA1', c: 'HP0028OP1', set: {'start': '1차'} },
    { id: 'B001092', p: 'H0028AA1', c: 'HP0028PH1', set: {'start': '1차'} },
    { id: 'B001093', p: 'H0028AA1', c: 'HP0028OP2', set: {'start': '1차'} },
    { id: 'B001094', p: 'H0029AA1', c: 'H0029AA1', set: {'start': '1차'} },
    { id: 'B001095', p: 'H0029AA1', c: 'HP0029OP1', set: {'start': '1차'} },
    { id: 'B001096', p: 'H0029AA1', c: 'HP0029OL1', set: {'start': '1차'} },
    { id: 'B001099', p: 'M0174AA1', c: 'M0174AA1', set: {'start': '1차'} },
    { id: 'B001124', p: 'M0073AA2', c: 'MP0073MS1', set: {'start': '1차'} },
    { id: 'B001183', p: 'M0169AA2', c: 'M0169AA2', set: {'start': '1차'} },
    { id: 'B001184', p: 'M0169AA2', c: 'MP0169BO1', set: {'start': '1차'} },
    { id: 'B001185', p: 'M0169AA2', c: 'MP0169PC1', set: {'start': '1차'} },
    { id: 'B001186', p: 'M0169AA2', c: 'MP0169BL4', set: {'start': '1차'} },
    { id: 'B001187', p: 'M0169AA2', c: 'MP0169CA2', set: {'start': '1차'} },
    { id: 'B001188', p: 'M0169AA2', c: 'MP0169OB1', set: {'start': '1차'} },
    { id: 'B001189', p: 'M0159AA2', c: 'M0159AA2', set: {'start': '1차'} },
    { id: 'B001190', p: 'M0159AA2', c: 'MP0159BO1', set: {'start': '1차'} },
    { id: 'B001191', p: 'M0159AA2', c: 'MP0159PC1', set: {'start': '1차'} },
    { id: 'B001192', p: 'M0159AA2', c: 'MP0159BL4', set: {'start': '1차'} },
    { id: 'B001193', p: 'M0159AA2', c: 'MP0159BL5', set: {'start': '1차'} },
    { id: 'B001194', p: 'M0159AA2', c: 'MP0159CA3', set: {'start': '1차'} },
    { id: 'B001195', p: 'M0159AA2', c: 'MP0159OB1', set: {'start': '1차'} },
    { id: 'B001323', p: 'H0033AA1', c: 'HP0033BO1', set: {'start': '1차'} },
    { id: 'B001326', p: 'H0033AA1', c: 'HP0032SL2', set: {'start': '1차'} },
    { id: 'B001472', p: 'M0202AA2', c: 'M0202AA2', set: {'start': '1차'} },
    { id: 'B001473', p: 'M0202AA2', c: 'MP0202TB2', set: {'start': '1차'} },
    { id: 'B001474', p: 'M0202AA2', c: 'MP0202CA2', set: {'start': '1차'} },
    { id: 'B001475', p: 'M0202AA2', c: 'MP0202OB1', set: {'start': '1차'} },
    { id: 'B001524', p: 'M0191AA2', c: 'M0191AA2', set: {'start': '1차'} },
    { id: 'B001525', p: 'M0191AA2', c: 'M0191AA2', set: {'start': '1차'} },
    { id: 'B001526', p: 'M0191AA2', c: 'MP0191TB2', set: {'start': '1차'} },
    { id: 'B001527', p: 'M0191AA2', c: 'MP0191CA2', set: {'start': '1차'} },
    { id: 'B001528', p: 'M0191AA2', c: 'MP0191CA2', set: {'start': '1차'} },
    { id: 'B001529', p: 'M0191AA2', c: 'MP0191OB1', set: {'start': '1차'} },
    { id: 'B001625', p: 'M0208AA1', c: 'M0082AA5', set: {'start': '1차'} },
    { id: 'B001659', p: 'M0218AA1', c: 'M0218AA1', set: {'start': '1차'} },
    { id: 'B001660', p: 'M0218AA1', c: 'MP0218BO1', set: {'start': '1차'} },
    { id: 'B001661', p: 'M0218AA1', c: 'MP0218LD1', set: {'start': '1차'} },
    { id: 'B001662', p: 'M0218AA1', c: 'MP0218ST1', set: {'start': '1차'} },
    { id: 'B001663', p: 'M0218AA1', c: 'MP0218CP1', set: {'start': '1차'} },
    { id: 'B001664', p: 'M0218AA1', c: 'MP0218CA1', set: {'start': '1차'} },
    { id: 'B001665', p: 'M0218AA1', c: 'MP0218UG1', set: {'start': '1차'} },
    { id: 'B001666', p: 'M0218AA1', c: 'MP0218OB1', set: {'start': '1차'} },
    { id: 'B001667', p: 'M0219AA1', c: 'M0219AA1', set: {'start': '1차'} },
    { id: 'B001668', p: 'M0219AA1', c: 'MP0219BO1', set: {'start': '1차'} },
    { id: 'B001669', p: 'M0219AA1', c: 'MP0219MS1', set: {'start': '1차'} },
    { id: 'B001670', p: 'M0219AA1', c: 'MP0219CA1', set: {'start': '1차'} },
    { id: 'B001671', p: 'M0219AA1', c: 'MP0219UG1', set: {'start': '1차'} },
    { id: 'B001672', p: 'M0219AA1', c: 'MP0219OB1', set: {'start': '1차'} },
    { id: 'B001673', p: 'M0220AA1', c: 'M0220AA1', set: {'start': '1차'} },
    { id: 'B001674', p: 'M0220AA1', c: 'MP0220BO1', set: {'start': '1차'} },
    { id: 'B001675', p: 'M0220AA1', c: 'MP0220MS1', set: {'start': '1차'} },
    { id: 'B001676', p: 'M0220AA1', c: 'MP0220CP1', set: {'start': '1차'} },
    { id: 'B001677', p: 'M0220AA1', c: 'MP0220CA1', set: {'start': '1차'} },
    { id: 'B001678', p: 'M0220AA1', c: 'MP0219UG1', set: {'start': '1차'} },
    { id: 'B001679', p: 'M0220AA1', c: 'MP0220OB1', set: {'start': '1차'} },
    { id: 'B001680', p: 'M0221AA1', c: 'M0221AA1', set: {'start': '1차'} },
    { id: 'B001681', p: 'M0221AA1', c: 'MP0221BO1', set: {'start': '1차'} },
    { id: 'B001682', p: 'M0221AA1', c: 'MP0221AP1', set: {'start': '1차'} },
    { id: 'B001683', p: 'M0221AA1', c: 'MP0221CP1', set: {'start': '1차'} },
    { id: 'B001684', p: 'M0221AA1', c: 'MP0221IS1', set: {'start': '1차'} },
    { id: 'B001685', p: 'M0221AA1', c: 'MP0221CA1', set: {'start': '1차'} },
    { id: 'B001686', p: 'M0221AA1', c: 'MP0221OB1', set: {'start': '1차'} },
    { id: 'B001687', p: 'M0222AA1', c: 'M0222AA1', set: {'start': '1차'} },
    { id: 'B001688', p: 'M0222AA1', c: 'MP0222BO1', set: {'start': '1차'} },
    { id: 'B001689', p: 'M0222AA1', c: 'MP0222MS1', set: {'start': '1차'} },
    { id: 'B001690', p: 'M0222AA1', c: 'MP0222CP1', set: {'start': '1차'} },
    { id: 'B001691', p: 'M0222AA1', c: 'MP0222CA1', set: {'start': '1차'} },
    { id: 'B001692', p: 'M0222AA1', c: 'MP0222UG1', set: {'start': '1차'} },
    { id: 'B001693', p: 'M0222AA1', c: 'MP0222OB1', set: {'start': '1차'} },
    { id: 'B001694', p: 'M0216AA1', c: 'M0216AA1', set: {'start': '1차'} },
    { id: 'B001695', p: 'M0216AA1', c: 'MP0216BO1', set: {'start': '1차'} },
    { id: 'B001696', p: 'M0216AA1', c: 'MP0216LD1', set: {'start': '1차'} },
    { id: 'B001697', p: 'M0216AA1', c: 'MP0216CP1', set: {'start': '1차'} },
    { id: 'B001698', p: 'M0216AA1', c: 'MP0216ST1', set: {'start': '1차'} },
    { id: 'B001699', p: 'M0216AA1', c: 'MP0216BL1', set: {'start': '1차'} },
    { id: 'B001700', p: 'M0216AA1', c: 'MP0216CA1', set: {'start': '1차'} },
    { id: 'B001701', p: 'M0216AA1', c: 'MP0216OB1', set: {'start': '1차'} },
    { id: 'B001702', p: 'M0217AA1', c: 'M0217AA1', set: {'start': '1차'} },
    { id: 'B001703', p: 'M0217AA1', c: 'MP0217BO1', set: {'start': '1차'} },
    { id: 'B001704', p: 'M0217AA1', c: 'MP0216LD1', set: {'start': '1차'} },
    { id: 'B001705', p: 'M0217AA1', c: 'MP0217CP1', set: {'start': '1차'} },
    { id: 'B001706', p: 'M0217AA1', c: 'MP0216ST1', set: {'start': '1차'} },
    { id: 'B001707', p: 'M0217AA1', c: 'MP0217BL1', set: {'start': '1차'} },
    { id: 'B001708', p: 'M0217AA1', c: 'MP0217CA1', set: {'start': '1차'} },
    { id: 'B001709', p: 'M0217AA1', c: 'MP0217OB1', set: {'start': '1차'} },
    { id: 'B001710', p: 'H0072AA1', c: 'H0072AA1', set: {'start': '1차'} },
    { id: 'B001711', p: 'H0072AA1', c: 'HP0072BO1', set: {'start': '1차'} },
    { id: 'B001712', p: 'H0072AA1', c: 'HP0072PU1', set: {'start': '1차'} },
    { id: 'B001713', p: 'H0072AA1', c: 'HP0072CP1', set: {'start': '1차'} },
    { id: 'B001714', p: 'H0072AA1', c: 'HP0072CA1', set: {'start': '1차'} },
    { id: 'B001715', p: 'H0072AA1', c: 'HP0072OB1', set: {'start': '1차'} },
    { id: 'B001716', p: 'H0056AA1', c: 'H0056AA1', set: {'start': '1차'} },
    { id: 'B001717', p: 'H0056AA1', c: 'HP0056TB1', set: {'start': '1차'} },
    { id: 'B001718', p: 'H0056AA1', c: 'HP0056CA1', set: {'start': '1차'} },
    { id: 'B001719', p: 'H0056AA1', c: 'HP0056OB1', set: {'start': '1차'} },
    { id: 'B001720', p: 'H0057AA1', c: 'H0057AA1', set: {'start': '1차'} },
    { id: 'B001721', p: 'H0057AA1', c: 'HP0057TB1', set: {'start': '1차'} },
    { id: 'B001722', p: 'H0057AA1', c: 'HP0057CA1', set: {'start': '1차'} },
    { id: 'B001723', p: 'H0057AA1', c: 'HP0057IB1', set: {'start': '1차'} },
    { id: 'B001724', p: 'H0057AA1', c: 'HP0057OB1', set: {'start': '1차'} },
    { id: 'B001725', p: 'H0058AA1', c: 'H0058AA1', set: {'start': '1차'} },
    { id: 'B001726', p: 'H0058AA1', c: 'HP0058TB1', set: {'start': '1차'} },
    { id: 'B001727', p: 'H0058AA1', c: 'HP0058CA1', set: {'start': '1차'} },
    { id: 'B001728', p: 'H0058AA1', c: 'HP0058OB1', set: {'start': '1차'} },
    { id: 'B001729', p: 'H0059AA1', c: 'H0059AA1', set: {'start': '1차'} },
    { id: 'B001730', p: 'H0059AA1', c: 'HP0059TB1', set: {'start': '1차'} },
    { id: 'B001731', p: 'H0059AA1', c: 'HP0059CA1', set: {'start': '1차'} },
    { id: 'B001732', p: 'H0059AA1', c: 'HP0059IB1', set: {'start': '1차'} },
    { id: 'B001733', p: 'H0059AA1', c: 'HP0059OB1', set: {'start': '1차'} },
    { id: 'B001735', p: 'M0215AA1', c: 'MP0215MS1', set: {'start': '1차'} },
    { id: 'B001736', p: 'M0215AA1', c: 'MP0215MS2', set: {'start': '1차'} },
    { id: 'B001737', p: 'M0215AA1', c: 'MP0215OP1', set: {'start': '1차'} },
    { id: 'B001738', p: 'M0215AA1', c: 'MP0215OL1', set: {'start': '1차'} },
    { id: 'B001744', p: 'M0206AA1', c: 'M0206AA1', set: {'start': '1차'} },
    { id: 'B001748', p: 'M0206AA1', c: 'MP0206CA1', set: {'start': '1차'} },
    { id: 'B001749', p: 'M0206AA1', c: 'MP0206OB1', set: {'start': '1차'} },
    { id: 'B001750', p: 'H0062AA1', c: 'H0062AA1', set: {'start': '1차'} },
    { id: 'B001751', p: 'H0062AA1', c: 'HP0062MS1', set: {'start': '1차'} },
    { id: 'B001752', p: 'H0062AA1', c: 'HP0062MS2', set: {'start': '1차'} },
    { id: 'B001753', p: 'H0062AA1', c: 'HP0062OL3', set: {'start': '1차'} },
    { id: 'B001754', p: 'H0069AA1', c: 'H0069AA1', set: {'start': '1차'} },
    { id: 'B001755', p: 'H0069AA1', c: 'HP0069TB1', set: {'start': '1차'} },
    { id: 'B001756', p: 'H0069AA1', c: 'HP0069CA1', set: {'start': '1차'} },
    { id: 'B001757', p: 'H0069AA1', c: 'HP0069CA1', set: {'start': '1차'} },
    { id: 'B001758', p: 'H0069AA1', c: 'HP0069OB2', set: {'start': '1차'} },
    { id: 'B001765', p: 'H0067AA2', c: 'H0067AA2', set: {'start': '1차'} },
    { id: 'B001766', p: 'H0067AA2', c: 'HP0067BO1', set: {'start': '1차'} },
    { id: 'B001767', p: 'H0067AA2', c: 'HP0067SP1', set: {'start': '1차'} },
    { id: 'B001768', p: 'H0067AA2', c: 'HP0067CA1', set: {'start': '1차'} },
    { id: 'B001769', p: 'H0067AA2', c: 'HP0067CA1', set: {'start': '1차'} },
    { id: 'B001770', p: 'H0067AA2', c: 'HP0067OB1', set: {'start': '1차'} },
    { id: 'B001771', p: 'H0066AA2', c: 'H0066AA2', set: {'start': '1차'} },
    { id: 'B001772', p: 'H0066AA2', c: 'HP0066TB1', set: {'start': '1차'} },
    { id: 'B001773', p: 'H0066AA2', c: 'HP0066CA1', set: {'start': '1차'} },
    { id: 'B001774', p: 'H0066AA2', c: 'HP0066CA1', set: {'start': '1차'} },
    { id: 'B001775', p: 'H0066AA2', c: 'HP0066OB2', set: {'start': '1차'} },
    { id: 'B001776', p: 'H0065AA2', c: 'H0065AA2', set: {'start': '1차'} },
    { id: 'B001777', p: 'H0065AA2', c: 'HP0065BO1', set: {'start': '1차'} },
    { id: 'B001778', p: 'H0065AA2', c: 'HP0065PC1', set: {'start': '1차'} },
    { id: 'B001779', p: 'H0065AA2', c: 'HP0065CA1', set: {'start': '1차'} },
    { id: 'B001780', p: 'H0065AA2', c: 'HP0065CA1', set: {'start': '1차'} },
    { id: 'B001781', p: 'H0065AA2', c: 'HP0065OB2', set: {'start': '1차'} }
  ] },
  { key: 'rb.bomfix1019p', reg: ['MP0175PC1'], why: '10/19 BOM 재검사 · 펌프+캡 코드(PC) 줄 구분을 펌프+캡으로(MP0175PC1 품목 DB 등록) · 매입정보 빈 줄은 같은 코드의 다른 품목 값(턴키)으로 · M0153AA1 1차 반제품 X 줄 원가 빼기(제품 줄과 원가 두 번) · 업체명 표기 통일(IPS→아이피에스 · 아람피앤아이→아람피엔아이 · 다안프린팅→다인프린팅)', ops: [
    { id: 'B000935', p: 'M0193AA1', c: 'MP0159PC1', set: {'start': '1차', 'type': '펌프+캡'} },
    { id: 'B001745', p: 'M0206AA1', c: 'MP0088BO1', set: {'start': '1차', 'buy': '턴키'} },
    { id: 'B001746', p: 'M0206AA1', c: 'MP0088PC1', set: {'start': '1차', 'buy': '턴키'} },
    { id: 'B001747', p: 'M0206AA1', c: 'MP0088BL1', set: {'start': '1차', 'buy': '턴키'} },
    { id: 'B000882', p: 'M0175AA1', c: 'MP0175PC1', set: {'type': '펌프+캡'} },
    { id: 'B000883', p: 'M0175AA1', c: 'MP0175PC1', set: {'type': '펌프+캡'} },
    { id: 'B000894', p: 'M0175AA2', c: 'MP0175PC1', set: {'type': '펌프+캡'} },
    { id: 'B000895', p: 'M0175AA2', c: 'MP0175PC1', set: {'type': '펌프+캡'} },
    { id: 'B000903', p: 'M0175JP1', c: 'MP0175PC1', set: {'type': '펌프+캡'} },
    { id: 'B000953', p: 'M0166AA1', c: 'MP0169PC1', set: {'type': '펌프+캡', 'buy': '턴키'} },
    { id: 'B000964', p: 'M0166AA1', c: 'MP0169PC1', set: {'type': '펌프+캡', 'buy': '턴키'} },
    { id: 'B000975', p: 'M0166AA1', c: 'MP0173PC1', set: {'type': '펌프+캡', 'buy': '턴키'} },
    { id: 'B000992', p: 'M0187AA1', c: 'MP0169PC1', set: {'type': '펌프+캡', 'buy': '턴키'} },
    { id: 'B000993', p: 'M0187AA1', c: 'MP0169PC1', set: {'type': '펌프+캡', 'buy': '턴키'} },
    { id: 'B000999', p: 'M0187AA1', c: 'MP0169PC1', set: {'type': '펌프+캡', 'buy': '턴키'} },
    { id: 'B001000', p: 'M0187AA1', c: 'MP0169PC1', set: {'type': '펌프+캡', 'buy': '턴키'} },
    { id: 'B001005', p: 'M0187AA1', c: 'MP0181PC1', set: {'type': '펌프+캡', 'buy': '턴키'} },
    { id: 'B001069', p: 'M0163AA1', c: 'MP0159PC1', set: {'type': '펌프+캡'} },
    { id: 'B001070', p: 'M0163AA1', c: 'MP0159PC1', set: {'type': '펌프+캡'} },
    { id: 'B001217', p: 'M0184AA1', c: 'MP0169PC1', set: {'type': '펌프+캡'} },
    { id: 'B001218', p: 'M0184AA1', c: 'MP0169PC1', set: {'type': '펌프+캡'} },
    { id: 'B001391', p: 'M0190AA1', c: 'MP0169PC1', set: {'type': '펌프+캡'} },
    { id: 'B001392', p: 'M0190AA1', c: 'MP0169PC1', set: {'type': '펌프+캡'} },
    { id: 'B001839', p: 'M0163JP1', c: 'MP0159PC1', set: {'type': '펌프+캡'} },
    { id: 'B001849', p: 'M0163JP2', c: 'MP0159PC1', set: {'type': '펌프+캡'} },
    { id: 'B000950', p: 'M0166AA1', c: 'MP0169BO1', set: {'buy': '턴키'} },
    { id: 'B000951', p: 'M0166AA1', c: 'MP0169BO1', set: {'buy': '턴키'} },
    { id: 'B000955', p: 'M0166AA1', c: 'MP0169BL1', set: {'buy': '턴키'} },
    { id: 'B000958', p: 'M0166AA1', c: 'MP0166OB1', set: {'buy': '턴키'} },
    { id: 'B000961', p: 'M0166AA1', c: 'MP0169BO1', set: {'buy': '턴키'} },
    { id: 'B000962', p: 'M0166AA1', c: 'MP0169BO1', set: {'buy': '턴키'} },
    { id: 'B000963', p: 'M0166AA1', c: 'MP0169BO1', set: {'buy': '턴키'} },
    { id: 'B000965', p: 'M0166AA1', c: 'MP0169PC1', set: {'buy': '턴키'} },
    { id: 'B000967', p: 'M0166AA1', c: 'MP0171BL2', set: {'buy': '턴키'} },
    { id: 'B000968', p: 'M0166AA1', c: 'MP0171BL3', set: {'buy': '턴키'} },
    { id: 'B000969', p: 'M0166AA1', c: 'MP0171IB1', set: {'buy': '턴키'} },
    { id: 'B000970', p: 'M0166AA1', c: 'MP0171OB2', set: {'buy': '턴키'} },
    { id: 'B000972', p: 'M0166AA1', c: 'MP0173BO1', set: {'buy': '턴키'} },
    { id: 'B000973', p: 'M0166AA1', c: 'MP0173BO1', set: {'buy': '턴키'} },
    { id: 'B000974', p: 'M0166AA1', c: 'MP0173BO1', set: {'buy': '턴키'} },
    { id: 'B000976', p: 'M0166AA1', c: 'MP0173PC1', set: {'buy': '턴키'} },
    { id: 'B000977', p: 'M0166AA1', c: 'MP0173BL1', set: {'buy': '턴키'} },
    { id: 'B000978', p: 'M0166AA1', c: 'MP0173BL2', set: {'buy': '턴키'} },
    { id: 'B000980', p: 'M0166AA1', c: 'MP0166OB2', set: {'buy': '턴키'} },
    { id: 'B001950', p: 'M0166AA1', c: 'MP0169BO1', set: {'buy': '턴키'} },
    { id: 'B001954', p: 'M0166AA1', c: 'MP0169PC1', set: {'buy': '턴키'} },
    { id: 'B001956', p: 'M0166AA1', c: 'MP0171OB2', set: {'buy': '턴키'} },
    { id: 'B001957', p: 'M0166AA1', c: 'MP0171OB2', set: {'buy': '턴키'} },
    { id: 'B000990', p: 'M0187AA1', c: 'MP0169BO1', set: {'buy': '턴키'} },
    { id: 'B000991', p: 'M0187AA1', c: 'MP0169BO1', set: {'buy': '턴키'} },
    { id: 'B000994', p: 'M0187AA1', c: 'MP0169BL3', set: {'buy': '턴키'} },
    { id: 'B000997', p: 'M0187AA1', c: 'MP0169BO1', set: {'buy': '턴키'} },
    { id: 'B000998', p: 'M0187AA1', c: 'MP0169BO1', set: {'buy': '턴키'} },
    { id: 'B001004', p: 'M0187AA1', c: 'MP0181BO1', set: {'buy': '턴키'} },
    { id: 'B001006', p: 'M0187AA1', c: 'MP0181BL1', set: {'buy': '턴키'} },
    { id: 'B000670', p: 'M0153AA1', c: 'X', set: {'costKey': ''} },
    { id: 'B001513', p: 'M0203AA1', c: 'MP0088BO1', set: {'vendor': '아이피에스'} },
    { id: 'B001514', p: 'M0203AA1', c: 'MP0088PC1', set: {'vendor': '아이피에스'} },
    { id: 'B000280', p: 'M0144AA4', c: 'MP0084PH3', set: {'vendor': '아람피엔아이'} },
    { id: 'B000040', p: 'M0136AA1', c: 'MP0000SL4', set: {'vendor': '다인프린팅'} }
  ] },
  { key: 'rb.bomfix1019q', why: '담당자 확인 10/19 · 옛 기록 정리 — 같은 코드인데 업체 · 사양이 바뀐 줄에 새 번호(+1). 발주 기록이 있는 쪽 · 먼저 쓴 쪽이 원래 코드를 갖는다. 문안만 바뀐 것은 같은 코드', itemFrom: ['HP0002OB1', 'HP0019CA1', 'HP0031OB1', 'HP0035OB1', 'HP0053TB1', 'HP0065BO1', 'HP0065PC1', 'MP0000SL4', 'MP0046CA1', 'MP0078OB1', 'MP0079OB1', 'MP0086CA1', 'MP0087CA1', 'MP0129OB1', 'MP0136TB1', 'MP0153PA1', 'MP0153PA2', 'MP0153SL1', 'MP0160UG2', 'MP0161BL2', 'MP0162BL1', 'MP0166OB1', 'MP0166OB2', 'MP0171BL2', 'MP0171IB1'], ops: [
    { id: 'B000005', p: 'M0055AA1', c: 'MP0000SL4', renum: 'SL4-KJI' },
    { id: 'B000011', p: 'M0001AA1', c: 'MP0000SL4', renum: 'SL4-KJI' },
    { id: 'B000012', p: 'M0001AA1', c: 'MP0000SL4', renum: 'SL4-KJI-은' },
    { id: 'B000145', p: 'M0056AA1', c: 'MP0000SL4', renum: 'SL4-어바웃' },
    { id: 'B000152', p: 'M0027AA1', c: 'MP0000SL4', renum: 'SL4-우주' },
    { id: 'B000159', p: 'M0018AA1', c: 'MP0000SL4', renum: 'SL4-우주' },
    { id: 'B000168', p: 'M0022AA1', c: 'MP0000SL4', renum: 'SL4-우주' },
    { id: 'B000174', p: 'M0029AA1', c: 'MP0000SL4', renum: 'SL4-우주' },
    { id: 'B000413', p: 'M0046AA1', c: 'MP0000SL4', renum: 'SL4-우주' },
    { id: 'B000201', p: 'M0054AA1', c: 'MP0000SL4', renum: 'SL4-동명사' },
    { id: 'B000539', p: 'M0032AA2', c: 'MP0000SL4', renum: 'SL4-동명사' },
    { id: 'B001430', p: 'M0111AA1', c: 'MP0000SL4', renum: 'SL4-동명사' },
    { id: 'B000424', p: 'M0046JP1', c: 'MP0000SL4', renum: 'SL4-삼영' },
    { id: 'B000483', p: 'M0150JP1', c: 'MP0000SL4', renum: 'SL4-삼영' },
    { id: 'B000498', p: 'M0195JP1', c: 'MP0000SL4', renum: 'SL4-삼영' },
    { id: 'B000518', p: 'M0044AA1', c: 'MP0000SL4', renum: 'SL4-중국' },
    { id: 'B001062', p: 'M0167AA1', c: 'MP0000SL4', renum: 'SL4-다인20' },
    { id: 'B000036', p: 'M0136AA1', c: 'MP0136TB1', renum: 'TB1-HERO' },
    { id: 'B001057', p: 'M0167AA1', c: 'MP0136TB1', renum: 'TB1-HERO' },
    { id: 'B001025', p: 'M0078AA2', c: 'MP0078OB1', renum: '78OB-두보' },
    { id: 'B000071', p: 'M0079AA2', c: 'MP0079OB1', renum: '79OB-두보' },
    { id: 'B000077', p: 'M0079AA3', c: 'MP0079OB1', renum: '79OB-두보' },
    { id: 'B000234', p: 'M0129AA2', c: 'MP0129OB1', renum: '129OB-두보' },
    { id: 'B001932', p: 'M0129AA3', c: 'MP0129OB1', renum: '129OB-두보' },
    { id: 'B000326', p: 'H0002TW1', c: 'HP0065BO1', renum: '65BO-럭스' },
    { id: 'B000327', p: 'H0002TW1', c: 'HP0065PC1', renum: '65PC-럭스' },
    { id: 'B000301', p: 'H0002AA1', c: 'HP0002OB1', renum: '2OB-KC36' },
    { id: 'B000335', p: 'H0002TW1', c: 'HP0002OB1', renum: '2OB-DB36' },
    { id: 'B000347', p: 'H0002AA3', c: 'HP0002OB1', renum: '2OB-DB36' },
    { id: 'B000680', p: 'M0153AA1', c: 'MP0153SL1', renum: '153SL-삼영' },
    { id: 'B000721', p: 'M0154AA2', c: 'MP0153SL1', renum: '153SL-삼영' },
    { id: 'B000869', p: 'M0160AA1', c: 'MP0153SL1', renum: '153SL-삼영' },
    { id: 'B000914', p: 'M0196JP1', c: 'MP0153SL1', renum: '153SL-삼영' },
    { id: 'B001404', p: 'M0160JP1', c: 'MP0153SL1', renum: '153SL-삼영' },
    { id: 'B001439', p: 'M0197JP1', c: 'MP0153SL1', renum: '153SL-삼영' },
    { id: 'B000780', p: 'M0162AA1', c: 'MP0162BL1', renum: '162BL-혁진' },
    { id: 'B000862', p: 'M0160AA1', c: 'MP0161BL2', renum: '161BL-삼영' },
    { id: 'B000875', p: 'M0160AA1', c: 'MP0160UG2', renum: '160UG-세종' },
    { id: 'B001408', p: 'M0160JP1', c: 'MP0160UG2', renum: '160UG-세종' },
    { id: 'B000958', p: 'M0166AA1', c: 'MP0166OB1', renum: '166OB1-코스메카' },
    { id: 'B000967', p: 'M0166AA1', c: 'MP0171BL2', renum: '171BL-삼영' },
    { id: 'B000986', p: 'M0166AA1', c: 'MP0171IB1', renum: '171IB-두보' },
    { id: 'B001952', p: 'M0166AA1', c: 'MP0171IB1', renum: '171IB-두보' },
    { id: 'B000995', p: 'M0187AA1', c: 'MP0166OB2', renum: '166OB2-코스메카' },
    { id: 'B001620', p: 'H0053AA1', c: 'HP0053TB1', renum: '53TB-하나인' },
    { id: 'B000411', p: 'M0046AA1', c: 'MP0046CA1', renum: '46CA-지네발' },
    { id: 'B000676', p: 'M0153AA1', c: 'MP0153PA1', renum: '153PA1-2차' },
    { id: 'B000678', p: 'M0153AA1', c: 'MP0153PA2', renum: '153PA2-2차' },
    { id: 'B000735', p: 'M0086AA1', c: 'MP0086CA1', renum: '86CA-2차' },
    { id: 'B000769', p: 'M0087AA1', c: 'MP0087CA1', renum: '87CA-2차' },
    { id: 'B001235', p: 'H0036AA1', c: 'HP0035OB1', renum: '35OB-425' },
    { id: 'B001236', p: 'H0036AA1', c: 'HP0035OB1', renum: '35OB-425' },
    { id: 'B001249', p: 'H0035AA1', c: 'HP0035OB1', renum: '35OB-425' },
    { id: 'B001250', p: 'H0035AA1', c: 'HP0035OB1', renum: '35OB-425' },
    { id: 'B001264', p: 'H0037AA1', c: 'HP0035OB1', renum: '35OB-425' },
    { id: 'B001364', p: 'H0031AA1', c: 'HP0031OB1', renum: '31OB-140' },
    { id: 'B000613', p: 'H0019AA1', c: 'HP0019CA1', renum: '19SL', base: 'HP0019SL', set: {'type': '봉합라벨'} }
  ] },
  { key: 'rb.bomfix1019r', why: '담당자 확인 10/19 · 소요원가 손입력이 맞는 값 — 단가(튜브캡은 환율 190)를 그 값에 맞추고 소요원가는 계산 수식으로 · 일본 아웃박스 MP0159OB3 은 실제 발주 단가 540원(9/11 발주)',ops: [
    { id: 'B000573', p: 'H0014AA1', c: 'HP0014BO2', set: {"unit": 620}, costCalc: true },
    { id: 'B000575', p: 'H0014AA1', c: 'HP0014PC2', set: {"unit": 570}, costCalc: true },
    { id: 'B000902', p: 'M0175JP1', c: 'MP0175BO1', set: {"unit": 300}, costCalc: true },
    { id: 'B001016', p: 'M0136AA3', c: 'MP0136TB3', set: {"fx": 190}, costCalc: true },
    { id: 'B001120', p: 'M0181AA1', c: 'MP0181BL1', set: {"unit": 48}, costCalc: true },
    { id: 'B001339', p: 'H0032AA1', c: 'HP0032BO2', set: {"unit": 1260}, costCalc: true },
    { id: 'B001360', p: 'H0031AA1', c: 'HP0031MS1', set: {"unit": 50}, costCalc: true },
    { id: 'B001750', p: 'H0062AA1', c: 'H0062AA1', set: {"unit": 9900}, costCalc: true },
    { id: 'B001863', p: 'M0159JP1', c: 'MP0159OB3', set: {"unit": 540}, costCalc: true },
    { id: 'B001870', p: 'M0159JP2', c: 'MP0159OB3', set: {"unit": 540}, costCalc: true }
  ] },
  { key: 'rb.bomfix1019s', anyCode: true, why: '담당자 확인 10/19 · 매입정보 빈 줄 — 업체가 중국이면 사급, 나머지 턴키, 그 품목 제품(제조사)이 다원 · 부업왕 · 제이원이면 사급', ops: [
    { id: 'B000542', p: 'M0131AA1', c: 'MP0131BO1', set: { buy: '턴키' } },
    { id: 'B000543', p: 'M0131AA1', c: 'MP0131CP1', set: { buy: '턴키' } },
    { id: 'B000544', p: 'M0131AA1', c: 'MP0131CA1', set: { buy: '턴키' } },
    { id: 'B000545', p: 'M0131AA1', c: 'MP0131MS1', set: { buy: '턴키' } },
    { id: 'B000546', p: 'M0131AA1', c: 'MP0000SL4', set: { buy: '턴키' } },
    { id: 'B000547', p: 'M0131AA1', c: 'MP0131OB1', set: { buy: '턴키' } },
    { id: 'B001966', p: 'M0131AA1', c: 'MP0131CA2', set: { buy: '턴키' } },
    { id: 'B001967', p: 'M0131AA1', c: 'MP0131MS2', set: { buy: '턴키' } },
    { id: 'B000926', p: 'M0182AA1', c: 'MP0182CA1', set: { buy: '턴키' } },
    { id: 'B000950', p: 'M0166AA1', c: 'MP0169BO1', set: { buy: '사급' } },
    { id: 'B000951', p: 'M0166AA1', c: 'MP0169BO1', set: { buy: '사급' } },
    { id: 'B000953', p: 'M0166AA1', c: 'MP0169PC1', set: { buy: '사급' } },
    { id: 'B000955', p: 'M0166AA1', c: 'MP0169BL1', set: { buy: '사급' } },
    { id: 'B000956', p: 'M0166AA1', c: 'MP0169BL2', set: { buy: '사급' } },
    { id: 'B000958', p: 'M0166AA1', c: 'MP0166OB3', set: { buy: '사급' } },
    { id: 'B000961', p: 'M0166AA1', c: 'MP0169BO1', set: { buy: '사급' } },
    { id: 'B000962', p: 'M0166AA1', c: 'MP0169BO1', set: { buy: '사급' } },
    { id: 'B000963', p: 'M0166AA1', c: 'MP0169BO1', set: { buy: '사급' } },
    { id: 'B000964', p: 'M0166AA1', c: 'MP0169PC1', set: { buy: '사급' } },
    { id: 'B000965', p: 'M0166AA1', c: 'MP0169PC1', set: { buy: '사급' } },
    { id: 'B000966', p: 'M0166AA1', c: 'MP0171BL1', set: { buy: '사급' } },
    { id: 'B000967', p: 'M0166AA1', c: 'MP0171BL5', set: { buy: '사급' } },
    { id: 'B000968', p: 'M0166AA1', c: 'MP0171BL3', set: { buy: '사급' } },
    { id: 'B000969', p: 'M0166AA1', c: 'MP0171IB1', set: { buy: '사급' } },
    { id: 'B000970', p: 'M0166AA1', c: 'MP0171OB2', set: { buy: '사급' } },
    { id: 'B000972', p: 'M0166AA1', c: 'MP0173BO1', set: { buy: '사급' } },
    { id: 'B000973', p: 'M0166AA1', c: 'MP0173BO1', set: { buy: '사급' } },
    { id: 'B000974', p: 'M0166AA1', c: 'MP0173BO1', set: { buy: '사급' } },
    { id: 'B000975', p: 'M0166AA1', c: 'MP0173PC1', set: { buy: '사급' } },
    { id: 'B000976', p: 'M0166AA1', c: 'MP0173PC1', set: { buy: '사급' } },
    { id: 'B000977', p: 'M0166AA1', c: 'MP0173BL1', set: { buy: '사급' } },
    { id: 'B000978', p: 'M0166AA1', c: 'MP0173BL2', set: { buy: '사급' } },
    { id: 'B000979', p: 'M0166AA1', c: 'MP0173BL3', set: { buy: '사급' } },
    { id: 'B000980', p: 'M0166AA1', c: 'MP0166OB2', set: { buy: '사급' } },
    { id: 'B000981', p: 'M0166AA1', c: 'MP0166CA1', set: { buy: '사급' } },
    { id: 'B000982', p: 'M0166AA1', c: 'MP0166CA2', set: { buy: '사급' } },
    { id: 'B000983', p: 'M0166AA1', c: 'MP0166CA3', set: { buy: '사급' } },
    { id: 'B001950', p: 'M0166AA1', c: 'MP0169BO1', set: { buy: '사급' } },
    { id: 'B001954', p: 'M0166AA1', c: 'MP0169PC1', set: { buy: '사급' } },
    { id: 'B001956', p: 'M0166AA1', c: 'MP0171OB2', set: { buy: '사급' } },
    { id: 'B001957', p: 'M0166AA1', c: 'MP0171OB2', set: { buy: '사급' } },
    { id: 'B000990', p: 'M0187AA1', c: 'MP0169BO1', set: { buy: '사급' } },
    { id: 'B000991', p: 'M0187AA1', c: 'MP0169BO1', set: { buy: '사급' } },
    { id: 'B000992', p: 'M0187AA1', c: 'MP0169PC1', set: { buy: '사급' } },
    { id: 'B000993', p: 'M0187AA1', c: 'MP0169PC1', set: { buy: '사급' } },
    { id: 'B000994', p: 'M0187AA1', c: 'MP0169BL3', set: { buy: '사급' } },
    { id: 'B000997', p: 'M0187AA1', c: 'MP0169BO1', set: { buy: '사급' } },
    { id: 'B000998', p: 'M0187AA1', c: 'MP0169BO1', set: { buy: '사급' } },
    { id: 'B000999', p: 'M0187AA1', c: 'MP0169PC1', set: { buy: '사급' } },
    { id: 'B001000', p: 'M0187AA1', c: 'MP0169PC1', set: { buy: '사급' } },
    { id: 'B001001', p: 'M0187AA1', c: 'MP0211BL1', set: { buy: '사급' } },
    { id: 'B001004', p: 'M0187AA1', c: 'MP0181BO1', set: { buy: '사급' } },
    { id: 'B001005', p: 'M0187AA1', c: 'MP0181PC1', set: { buy: '사급' } },
    { id: 'B001006', p: 'M0187AA1', c: 'MP0181BL1', set: { buy: '사급' } },
    { id: 'B001695', p: 'M0216AA1', c: 'MP0216BO1', set: { buy: '사급' } },
    { id: 'B001696', p: 'M0216AA1', c: 'MP0216LD1', set: { buy: '사급' } },
    { id: 'B001697', p: 'M0216AA1', c: 'MP0216CP1', set: { buy: '사급' } },
    { id: 'B001698', p: 'M0216AA1', c: 'MP0216ST1', set: { buy: '사급' } },
    { id: 'B001699', p: 'M0216AA1', c: 'MP0216BL1', set: { buy: '턴키' } },
    { id: 'B001700', p: 'M0216AA1', c: 'MP0216CA1', set: { buy: '턴키' } },
    { id: 'B001701', p: 'M0216AA1', c: 'MP0216OB1', set: { buy: '턴키' } },
    { id: 'B001703', p: 'M0217AA1', c: 'MP0217BO1', set: { buy: '사급' } },
    { id: 'B001704', p: 'M0217AA1', c: 'MP0216LD1', set: { buy: '사급' } },
    { id: 'B001705', p: 'M0217AA1', c: 'MP0217CP1', set: { buy: '사급' } },
    { id: 'B001706', p: 'M0217AA1', c: 'MP0216ST1', set: { buy: '사급' } },
    { id: 'B001707', p: 'M0217AA1', c: 'MP0217BL1', set: { buy: '턴키' } },
    { id: 'B001708', p: 'M0217AA1', c: 'MP0217CA1', set: { buy: '턴키' } },
    { id: 'B001709', p: 'M0217AA1', c: 'MP0217OB1', set: { buy: '턴키' } },
    { id: 'B001717', p: 'H0056AA1', c: 'HP0056TB1', set: { buy: '사급' } },
    { id: 'B001718', p: 'H0056AA1', c: 'HP0056CA1', set: { buy: '턴키' } },
    { id: 'B001719', p: 'H0056AA1', c: 'HP0056OB1', set: { buy: '턴키' } },
    { id: 'B001721', p: 'H0057AA1', c: 'HP0057TB1', set: { buy: '사급' } },
    { id: 'B001722', p: 'H0057AA1', c: 'HP0057CA1', set: { buy: '턴키' } },
    { id: 'B001723', p: 'H0057AA1', c: 'HP0057IB1', set: { buy: '턴키' } },
    { id: 'B001724', p: 'H0057AA1', c: 'HP0057OB1', set: { buy: '턴키' } },
    { id: 'B001726', p: 'H0058AA1', c: 'HP0058TB1', set: { buy: '턴키' } },
    { id: 'B001727', p: 'H0058AA1', c: 'HP0058CA1', set: { buy: '턴키' } },
    { id: 'B001728', p: 'H0058AA1', c: 'HP0058OB1', set: { buy: '턴키' } },
    { id: 'B001730', p: 'H0059AA1', c: 'HP0059TB1', set: { buy: '사급' } },
    { id: 'B001731', p: 'H0059AA1', c: 'HP0059CA1', set: { buy: '턴키' } },
    { id: 'B001732', p: 'H0059AA1', c: 'HP0059IB1', set: { buy: '턴키' } },
    { id: 'B001733', p: 'H0059AA1', c: 'HP0059OB1', set: { buy: '턴키' } },
    { id: 'B001740', p: 'H0060AA1', c: 'HP0060CA1', set: { buy: '턴키' } },
    { id: 'B001742', p: 'H0060AA1', c: 'HP0060MS1', set: { buy: '턴키' } },
    { id: 'B001743', p: 'H0060AA1', c: 'HP0060MS2', set: { buy: '턴키' } },
    { id: 'B001741', p: 'H0061AA1', c: 'HP0061CA1', set: { buy: '턴키' } },
    { id: 'B001970', p: 'H0061AA1', c: 'HP0060MS1', set: { buy: '턴키' } },
    { id: 'B001971', p: 'H0061AA1', c: 'HP0060MS2', set: { buy: '턴키' } },
    { id: 'B001748', p: 'M0206AA1', c: 'MP0206CA1', set: { buy: '턴키' } },
    { id: 'B001749', p: 'M0206AA1', c: 'MP0206OB1', set: { buy: '턴키' } },
    { id: 'B001823', p: 'M0082JP1', c: 'MP0082OL2', set: { buy: '사급' } }
  ] },
  { key: 'rb.keep1019b', why: '담당자 확인 10/19 · 그대로 둠', keep: [
    { product: /^H0014AA1$/, kind: '초도 빈 줄', why: '럭스팩 용기 · 펌프+캡(BO3 · PC3)은 비딩용 줄' }
  ] },
  { key: 'rb.bomfix1019t', why: '담당자 확인 10/19 · 아웃박스 — 단가는 비싼 쪽(시트 단가와 소요원가 칸에서 거꾸로 낸 단가 중) 기준 · 입수(소요량)는 그대로 · 소요원가는 계산 수식으로',ops: [
    { id: 'B001195', p: 'M0159AA2', c: 'MP0159OB1', set: {}, costCalc: true },
    { id: 'B001859', p: 'M0159JP1', c: 'MP0159OB1', set: {"unit": 600}, costCalc: true },
    { id: 'B001511', p: 'M0189AA2', c: 'MP0189OB2', set: {"unit": 780}, costCalc: true },
    { id: 'B001517', p: 'M0203AA1', c: 'MP0203OB1', set: {"unit": 468}, costCalc: true },
    { id: 'B001615', p: 'H0047AA1', c: 'HP0049OB1', set: {"unit": 1079}, costCalc: true },
    { id: 'B001651', p: 'M0212AA1', c: 'MP0212OB1', set: {"unit": 779}, costCalc: true }
  ] },
  { key: 'rb.bomfix1019u', why: '담당자 확인 10/19 · 클렌징 밀크 250ml ver.2 MOQ 10,000개 참고 줄(원가 체크 없음) — 실제 단가를 몰라 소요원가는 계산 수식으로', ops: [
    { id: 'B000633', p: 'H0017AA2', c: 'H0017AA2', costCalc: true }
  ] },
  { key: 'rb.bomfix1019v', why: '담당자 확인 10/19 · 초도 빈 줄을 1차로 채우며 겹친 것 바로잡기 — H0033AA1 용기 BO1 · 봉합라벨 SL2 는 1차~1차 옛 줄 다음이라 2차부터 · M0174AA1 원가 체크 없는 제품 참고 줄(2,010원)은 초도 다시 비움', ops: [
    { id: 'B001323', p: 'H0033AA1', c: 'HP0033BO1', set: { start: '2차' } },
    { id: 'B001326', p: 'H0033AA1', c: 'HP0032SL2', set: { start: '2차' } },
    { id: 'B001099', p: 'M0174AA1', c: 'M0174AA1', set: { start: '' } }
  ] },
  { key: 'rb.keep1019c', why: '담당자 확인 10/19 · 그대로 둠', keep: [
    { product: /^M0174AA1$/, kind: '초도 빈 줄', why: '원가 체크 없는 제품 참고 줄(2,010원)' }
  ] },
  { key: 'rb.bomfix1019w', why: '담당자 확인 10/19 · 포쎄라 블러 크림 올영 키트 20ml 튜브 MP0165TB2 — 초도 "대기"를 2차로(앞 튜브 TB1 이 1차~1차)', ops: [
    { id: 'B001060', p: 'M0167AA1', c: 'MP0165TB2', set: { start: '2차' } }
  ] },
  { key: 'rb.keep1019a', why: '10/19 BOM 재검사 · 그대로 둠', keep: [
    { product: /^(M0166AA1|M0177AA1)$/, kind: '옛 버전 줄이 안 닫힘', why: '담당자 확인 10/18 — M0166 한국콜마 OB2 는 다른 자재 · M0177 튜브 5차 업체 소싱 중' },
    { product: /./, kind: '자재코드 형식 아님', why: '코드 X 참고 줄(원재료 · 임가공) — 품목 DB 에 넣을 자재가 아님' },
    { product: /^(H0002AA1|H0002AA2|H0023AA1)$/, kind: '자재코드 분류가 구분과 다름', text: /HP0021MS1/, why: '트라이얼 키트 파우치 HP0021MS1 은 품목 DB · 발주에 이 코드로 쓰여 그대로' },
    { product: /./, kind: '같은 코드인데 사양이 바뀜', text: /HP0032SL1|MP0159PC1/, why: '문안 인쇄 추가 · 사양 표기만 다름 — 같은 코드(문안 변경은 같은 코드)' },
    { product: /^M0082/, kind: '같은 코드인데 사양이 바뀜', why: '레티날은 그대로(담당자 확인)' },
    { product: /^$/, kind: '같은 자재코드에 업체가 여럿', text: /^MP0082/, why: '레티날은 그대로(담당자 확인)' },
    { product: /^$/, kind: '같은 자재코드에 업체가 여럿', text: /^M0166AA1/, why: '제품 줄(임가공처) — 제품 코드는 업체로 번호를 올리지 않음' }
  ] },
  { key: 'rb.fix1020a', why: '담당자 확인 10/20 · 스파츌라 파우치는 MS(기타 — 파우치 PH 아님) · 칼라민 스팟 용기 단가 290원 · 레티날 일본 덧방라벨 환율 빈칸', ops: [
    { id: 'B001817', p: 'H0077AA1', c: 'HP0077PH1', set: { code: 'HP0077MS1', type: '기타' } },
    { id: 'B001358', p: 'H0031AA1', c: 'HP0031BO1', set: { unit: 290 }, costCalc: true },
    { id: 'B001823', p: 'M0082JP1', c: 'MP0082OL2', set: { fx: 1 }, costCalc: true }
  ] },
  { key: 'rb.keep1018a', why: '담당자 확인 10/18 · 그대로 둠', keep: [
    { product: /^M0082/, why: '레티날은 그대로(옛 버전 안에서 바뀐 자재 코드 · 빈 칸)' },
    { product: /^M0177AA1$/, kind: '옛 버전 줄이 안 닫힘', why: '튜브 5차 업체 소싱 중' },
    { product: /^M0166AA1$/, kind: '옛 버전 줄이 안 닫힘', why: '한국콜마 OB2 는 투명 BOPP(다른 자재) — 옛 버전 아님' }
  ] }
];
function bomFixBatchNext_() {
  var P = PropertiesService.getScriptProperties();
  for (var i = 0; i < RB_FIX_BATCHES.length; i++) {
    var b = RB_FIX_BATCHES[i];
    if (P.getProperty(b.key)) continue;
    var r;
    try { r = bomFixBatch_(b); } catch (e) { r = 'fail ' + String(e && e.message).slice(0, 200); }
    // 잠금 · 시간 초과처럼 잠깐 막힌 실패는 다음 분에 다시(최대 5번) — 예전엔 한 번 실패하면 그 묶음을 영영 건너뛰었다
    if (/^fail /.test(r) && /잠금|lock|시간|timed? ?out|Service|서비스/i.test(r)) {
      var tk = b.key + ':try', tn = Number(P.getProperty(tk) || 0) + 1;
      if (tn < 5) { P.setProperty(tk, String(tn)); try { console.log('BOM 정리 묶음 ' + b.key + ' 다시 시도 ' + tn + ' — ' + r); } catch (eL0) { /* 넘어간다 */ } return b.key; }
    }
    P.setProperty(b.key, r + ' ' + new Date().toISOString());
    try { console.log('BOM 정리 묶음 ' + b.key + ' ' + r); } catch (eL) { /* 넘어간다 */ }
    return b.key;
  }
  return '';
}
/** 담당자가 '그대로 두기'로 정한 검사 항목 — 지금 검사 결과에서 찾아 BOM변경이력에 '검사 그대로' 줄(검사 화면 [그대로 두기]와 같음) */
function bomKeepBatch_(b) {
  var skip = bomReviewSkips_(), rows = [], now = new Date(), who = me_();
  bomAuditItems_().forEach(function (it) {
    if (skip[it.id + '#' + it.sig]) return;
    var k = b.keep.filter(function (x) { return x.product.test(it.product || '') && (!x.kind || x.kind === it.kind) && (!x.text || x.text.test(String(it.text || ''))); })[0];
    if (!k) return;
    rows.push([now, who, it.product || '', it.pname || '', '', '검사 그대로', it.kind, '', '', String(it.text || '').slice(0, 300), '그대로 둠', b.why + ' · ' + k.why, '', '그대로', it.id, it.sig]);
  });
  if (rows.length) { var lk = bomLock_(); try { bomLogWrite_(bomSS_(), rows); } finally { lk.releaseLock(); } }      // 이력 쓰기는 잠금 안에서(다른 저장과 겹쳐 줄이 섞이지 않게)
  return 'done 그대로 ' + rows.length;
}
function bomFixBatch_(b) {
  if (b.keep) return bomKeepBatch_(b);
  var sh = bomSheet_(), C = bomCols_(sh), touched = {}, out = '';
  var lock = bomLock_();
  try {
    var lr = sh.getLastRow(), v = sh.getRange(3, 1, lr - 2, C.lc).getValues(), want = {}, seen = {}, hit = [], bad = [];
    b.ops.forEach(function (o) { want[o.id] = o; });
    v.forEach(function (r, i) {
      var id = str_(r[C.id]), o = want[id];
      if (!o || seen[id]) return;
      seen[id] = 1;
      if (itemCodeKey_(r[C.product]) !== o.p || (!b.anyCode && itemCodeKey_(r[C.code]) !== o.c)) { bad.push(id); return; }      // anyCode: 앞 묶음에서 번호가 바뀌었을 수 있는 줄 — 줄ID · 품목으로만
      hit.push({ row: i + 3, r: r, o: o });
    });
    b.ops.forEach(function (o) { if (!seen[o.id]) bad.push(o.id + '(없음)'); });
    if (bad.length) return 'skip ' + bad.join(',');
    var now = new Date(), who = me_(), logs = [], back = [], dels = [], adds = [], tag = Utilities.getUuid().slice(0, 8);
    // renum: 같은 renum 이름 줄은 하나의 새 코드(그 자재 번호 다음 버전 — 돌릴 때 품목 DB · 신규코드채번 · 지운 코드까지 보고 정한다)
    var known = null, alloc = {}, rmap = [];
    var nextFor = function (base) {
      if (!known) { known = bomKnownCodes_(); v.forEach(function (r) { var k = itemCodeKey_(r[C.code]); if (k) known[k] = 1; }); }
      var mx = 0;
      Object.keys(known).forEach(function (c) { if (c.indexOf(base) === 0) { var m = /^(\d+)$/.exec(c.slice(base.length)); if (m) mx = Math.max(mx, Number(m[1])); } });
      var nc = base + (mx + 1); known[nc] = 1; return nc;
    };
    hit.forEach(function (h) {
      var o = h.o;
      if (!o.renum) return;
      if (!alloc[o.renum]) { alloc[o.renum] = nextFor(o.base || String(o.c).replace(/\d+$/, '')); rmap.push(o.c + '→' + alloc[o.renum]); }
      o.set = Object.assign({}, o.set || {}, { code: alloc[o.renum] });
    });
    hit.forEach(function (h) {
      var o = h.o, r = h.r;
      touched[o.p] = 1;
      if (o.add) adds.push({ r: r.slice(), o: o });           // 이 줄을 본떠 새 줄(업체 바뀜 등) — 맨 아래에
      if (o.del) {
        dels.push(h.row);
        back.push([now, who, o.p, RB_BOM_TAB, h.row, o.c, JSON.stringify(r.map(function (x) { return x instanceof Date ? fmtDate_(x) : x; }))]);
        logs.push([now, who, o.p, '', str_(r[C.start]), '삭제', str_(r[C.type]), o.c, '', o.c + ' ' + str_(r[C.vendor]) + ' ' + str_(r[C.cost]), '삭제', b.why + ' · 줄 ' + o.id + ' · 원래 값은 ' + RB_DEL_TAB, '', '-', tag + '-fx', '']);
        return;
      }
      Object.keys(o.set || {}).forEach(function (k) {
        if (!(C[k] >= 0)) return;
        var before = r[C[k]], to = o.set[k];
        if (String(before) === String(to)) return;
        sh.getRange(h.row, C[k] + 1).setValue(to);
        if (k === 'product' || k === 'costKey') touched[String(to)] = 1;
        logs.push([now, who, o.p, '', str_(r[C.start]), '정정', str_(r[C.type]), o.c, k === 'code' ? String(to) : o.c, RB_BOM_HEAD[k] + ': ' + str_(before), RB_BOM_HEAD[k] + ': ' + str_(to), b.why + ' · 줄 ' + o.id, '', '-', tag + '-fx', '']);
      });
      if (o.costCalc && C.cost >= 0 && C.unit >= 0 && C.qty >= 0) {          // 소요원가를 계산 수식으로(손으로 넣은 숫자 대신)
        var rr = h.row, T = colRB_(C.unit + 1), Z = C.fx >= 0 ? colRB_(C.fx + 1) : '', W = C.proc >= 0 ? colRB_(C.proc + 1) : '', X = C.ship >= 0 ? colRB_(C.ship + 1) : '', S = colRB_(C.qty + 1);
        sh.getRange(rr, C.cost + 1).setFormula('=((' + T + rr + (Z ? '*' + Z + rr : '') + ')' + (W ? '+' + W + rr : '') + (X ? '+' + X + rr : '') + ')*' + S + rr);
        logs.push([now, who, o.p, '', str_(r[C.start]), '정정', str_(r[C.type]), o.c, o.c, RB_BOM_HEAD.cost + ': ' + str_(r[C.cost]), RB_BOM_HEAD.cost + ': 계산 수식', b.why + ' · 줄 ' + o.id, '', '-', tag + '-fx', '']);
      }
    });
    if (adds.length) {
      var maxId = 0;
      v.forEach(function (r) { var m = /^B(\d+)$/.exec(str_(r[C.id])); if (m) maxId = Math.max(maxId, Number(m[1])); });
      adds.forEach(function (a) {
        var row = a.r, nr = sh.getLastRow() + 1;
        row[C.id] = 'B' + ('00000' + (++maxId)).slice(-6);
        if (C.firstAt >= 0) row[C.firstAt] = '';
        if (C.end >= 0) row[C.end] = '';
        if (C.cost >= 0) row[C.cost] = '';
        Object.keys(a.o.add).forEach(function (k) { if (C[k] >= 0) row[C[k]] = a.o.add[k]; });
        row = row.map(function (x) { return x instanceof Date ? fmtDate_(x) : x; });
        ensureRows_(sh, nr);
        sh.getRange(nr, 1, 1, C.lc).setValues([row]);
        if (C.cost >= 0 && C.unit >= 0 && C.qty >= 0) {
          var T = colRB_(C.unit + 1), Z = C.fx >= 0 ? colRB_(C.fx + 1) : '', W = C.proc >= 0 ? colRB_(C.proc + 1) : '', X = C.ship >= 0 ? colRB_(C.ship + 1) : '', S = colRB_(C.qty + 1);
          sh.getRange(nr, C.cost + 1).setFormula('=((' + T + nr + (Z ? '*' + Z + nr : '') + ')' + (W ? '+' + W + nr : '') + (X ? '+' + X + nr : '') + ')*' + S + nr);
        }
        var nc0 = a.o.add.code || a.o.c;
        logs.push([now, who, a.o.p, '', str_(row[C.start]), '추가', str_(row[C.type]), '', nc0, '', nc0 + ' ' + str_(row[C.vendor]), b.why + ' · 줄 ' + a.o.id + ' 을 본떠 ' + row[C.id], '', '-', tag + '-fx', '']);
      });
    }
    if (back.length) {
      var bk = tab_(RB_DEL_TAB, RB_DEL_HEAD), r0 = bk.getLastRow() + 1;
      ensureRows_(bk, r0 + back.length - 1);
      bk.getRange(r0, 1, back.length, RB_DEL_HEAD.length).setValues(back);
      deleteRowsDesc_(sh, dels);
    }
    bomLogWrite_(bomSS_(), logs);
    SpreadsheetApp.flush();
    out = 'done 칸 ' + (logs.length - dels.length - adds.length) + ' · 삭제 ' + dels.length + (adds.length ? ' · 추가 ' + adds.length : '') + (rmap.length ? ' · 새 코드 ' + rmap.join(', ') : '');
  } finally { lock.releaseLock(); }
  if (b.itemDel && /^done/.test(out)) b.itemDel.forEach(function (c) { try { apiItemDelete(c, true, b.why); out += ' · 품목 DB 삭제 ' + c; } catch (eD) { out += ' · 품목 DB 삭제 못함 ' + c + '(' + eD.message + ')'; } });
  var nc = (b.reg || []).slice(); b.ops.forEach(function (o) { if (o.set && o.set.code) nc.push(o.set.code); if (o.add && o.add.code) nc.push(o.add.code); });
  if (b.itemFrom && /^done/.test(out)) {             // 번호가 옮겨 간 코드 — 품목 DB 이름 · 업체 · 사양을 지금 그 코드를 쓰는 BOM 줄(지금 쓰는 줄 · 늦은 초도 먼저)대로
    try {
      var lr2 = sh.getLastRow(), v2 = sh.getRange(3, 1, lr2 - 2, C.lc).getValues(), best = {};
      v2.forEach(function (r) {
        var c = itemCodeKey_(r[C.code]); if (b.itemFrom.indexOf(c) < 0) return;
        var live = str_(r[C.end]) === '' ? 1 : 0, st = bomRnum_(r[C.start]) || 0, x = best[c];
        if (!x || live > x.live || (live === x.live && st >= x.st)) best[c] = { live: live, st: st, f: { name: str_(r[C.name]), vendor: str_(r[C.vendor]), spec: C.spec >= 0 ? str_(r[C.spec]) : '' } };
      });
      Object.keys(best).forEach(function (c) { try { apiItemDbSave(0, c, best[c].f); } catch (eI) { /* 품목 DB 에 없는 코드 */ } });
      out += ' · 품목 DB 고침 ' + Object.keys(best).join(',');
    } catch (eF) { /* 넘어간다 */ }
  }
  if (nc.length && /^done/.test(out)) { try { var rg = bomRegFromRows_(nc, '담당자 확인 BOM 정리 · 새 코드'); if (rg.length) out += ' · 품목 DB 등록 ' + rg.join(','); } catch (eR) { /* BOM 검사에서 다시 */ } }
  bomDropCache_(Object.keys(touched));
  try { bomBuildCache_(); } catch (eC) { /* 다음에 다시 읽는다 */ }
  return out;
}

/**
 * 한 번만(10/19): 품의서 엑셀이 깨져 올리지 못했는데 [품의서 만들기]가 품의번호 · 상신을 먼저 넣어 버린 건을 계획으로 되돌린다.
 * 링클핏 니들 일본 18차(실행판ID RB261019-12BC93) — 품의번호 MTB2B-20261231-02 지움 · 진행상태 계획 · 상신 체크 · 상신일 지움.
 */
function undoDoc1019_() {
  var ID = 'RB261019-12BC93', DOC = 'MTB2B-20261231-02', out = [];
  var sh = statusSheet_(), C = sheetCols_(sh);
  var cDoc = colIdx_(C.idx, ['품의번호']);
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var meta = {};
  try {
    var ix = statusIdIndex_(sh, C), kc = ix.kc, rows = ix.map[ID] || [];
    if (rows.length !== 1) return '행 ' + rows.length + '개 — 건너뜀';
    var row = rows[0], audits = [];
    var docNow = cDoc >= 0 ? str_(sh.getRange(row, cDoc + 1).getValue()) : '';
    if (docNow === DOC) { sh.getRange(row, cDoc + 1).setValue(''); audits.push({ tab: RB.STATUS_TAB, row: row, col: cDoc + 1, what: '품의번호', before: DOC, after: '', item: '링클핏 니들 일본 18차 — 품의서 엑셀이 깨져 못 올림(되돌림)' }); out.push('품의번호 지움'); }
    if (kc.state >= 0 && str_(sh.getRange(row, kc.state + 1).getValue()) === '상신') { sh.getRange(row, kc.state + 1).setValue('계획'); audits.push({ tab: RB.STATUS_TAB, row: row, col: kc.state + 1, what: '진행상태', before: '상신', after: '계획', item: '링클핏 니들 일본 18차 — 품의서 못 올림(되돌림)' }); out.push('진행상태 계획'); }
    if (audits.length) writeAudits_(audits);
    var q = docQueueRead_(); if (q['id:' + ID] || q[norm_(DOC)]) { delete q['id:' + ID]; delete q[norm_(DOC)]; docQueueWrite_(q); }
    meta = { doc: '', name: '메디테라피 링클핏 니들 일본', batch: '18차', code: 'M0019JP1' };
  } finally { lock.releaseLock(); }
  cacheDrop_(rowsCacheKey_('po'));
  try {
    var M = metaFast_('po'), slots = dateSlots_(M.steps, M.cfg, 'po');
    bulkEditProgress_([{ id: ID, meta: meta }], 'po', function (st) {
      var ch = false;
      if (st.dates.submitted) { delete st.dates.submitted; ch = true; }
      if (st.dates.__docAuto) { delete st.dates.__docAuto; ch = true; }
      if (checkByDate_(st.checks, slots, 'submitted', false).length) ch = true;
      return ch ? undefined : false;
    });
    out.push('상신 체크 · 상신일 지움');
  } catch (eP) { out.push('진행 기록 못 고침(' + eP.message + ')'); }
  try { bumpVer_('r'); } catch (eV) { /* 넘어간다 */ }
  return out.join(' · ') || '바꿀 것 없음';
}

/**
 * 한 번만(10/19): 링클핏 니들 일본 18차 — 실제로 아마란스에 올림(결재문서번호 2026-2441). 비어 있는 품의번호 MTB2B-20261231-02 를 다시 넣는다(상신 그대로).
 * 그리고 '발주품의서 작성 · 승인' 단계 안내를 새 흐름([상신 대기] → 상신 완료)으로 바꾼다(옛 엑셀 매크로 [상신확정 반영] 안내).
 */
function redoDoc1019_() {
  var ID = 'RB261019-12BC93', DOC = 'MTB2B-20261231-02', out = [];
  var sh = statusSheet_(), C = sheetCols_(sh), cDoc = colIdx_(C.idx, ['품의번호']);
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  try {
    var ix = statusIdIndex_(sh, C), rows = ix.map[ID] || [];
    if (rows.length === 1 && cDoc >= 0 && !str_(sh.getRange(rows[0], cDoc + 1).getValue())) {
      sh.getRange(rows[0], cDoc + 1).setNumberFormat('@').setValue(DOC);
      writeAudits_([{ tab: RB.STATUS_TAB, row: rows[0], col: cDoc + 1, what: '품의번호', before: '', after: DOC, item: '링클핏 니들 일본 18차 — 올린 품의서 번호 다시 넣음' }]);
      out.push('품의번호 다시 넣음');
    }
    var ps = tab_(procTabName_('po'), RB.PROCESS_HEAD), v = ps.getLastRow() > 1 ? ps.getRange(2, 1, ps.getLastRow() - 1, RB.PROCESS_HEAD.length).getValues() : [];
    v.forEach(function (r, i) {
      var cell = -1;
      r.forEach(function (c, j) { if (String(c).indexOf('상신확정 반영') > -1) cell = j; });
      if (cell < 0) return;
      var items; try { items = JSON.parse(String(r[cell])); } catch (eJ) { return; }
      items.forEach(function (it) {
        if (/작성/.test(String(it.t || '')) && /상신확정/.test(String(it.h || ''))) it.h = '[품의서 생성]으로 엑셀을 받고 아마란스에 올린 뒤, 위쪽 [상신 대기]에서 결재문서번호를 넣고 [상신 완료] — 품의번호 · 상신 · 상신일이 같이 들어갑니다.';
        if (/승인/.test(String(it.t || '')) && !String(it.h || '')) it.h = '승인되면 목록에서 건을 골라 [일괄 승인…]으로 승인일을 넣습니다.';
      });
      ps.getRange(i + 2, cell + 1).setValue(JSON.stringify(items));
      out.push('단계 안내 바꿈');
    });
  } finally { lock.releaseLock(); }
  cacheDrop_(rowsCacheKey_('po')); cacheDrop_(metaKey_('po'));
  try { bumpVer_('r'); } catch (eV) { /* 넘어간다 */ }
  return out.join(' · ') || '바꿀 것 없음';
}
