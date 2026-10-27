/**
 * ============================================================
 * AP 생성 — 시트 쪽 "매입예정 / AP 자동화" 스크립트를 옮겨 온 것
 * ------------------------------------------------------------
 *  · 처음에는 make_apgen.py 로 만들었으나 생성기가 남아 있지 않아 이제 이 파일을 직접 수정함(2026-10-13).
 *    그때 실행판이 안 부르는 예전 함수(메뉴 · 트리거 · 발주현황→AP 계산 · 디버그)를 지웠다.
 *  · 한 함수(RB_AP) 안에 넣어 실행판 함수와 이름이 겹치지 않게 했다.
 *  · 활성 스프레드시트 대신 실행판이 여는 구매팀 업무 한판을 쓴다.
 *  · 실행판에서 부르는 곳: helpers(Lines.gs · Diag.gs) · sheetByGid/destGid/write(LinesWrite.gs · Verify.gs) · snapshot(ApRun.gs)
 * ============================================================
 */
var RB_AP = (function () {
  function rbApSS_() { return ss_(); }
  function rbApToast_(ss, msg, title, sec) { try { ss.toast(msg, title, sec); } catch (e) { /* 웹앱 · 트리거에서는 띄울 곳이 없다 */ } }

/**
 * [v9] 발주 실행판 연동
 *  · 발주현황 B열은 [실행판ID](예전 마스터코드), 예전 [현재고] 열은 [진행상태].
 *  · 진행상태가 아래 목록인 행(승인 전 · 취소)은 매입예정 · AP 계산에서 뺀다.
 *  · 발주요청팀 · 요청팀담당자 · 소진완료목표일은 실행판 숨김 탭(_실행판_발주부가정보)을
 *    실행판ID로 먼저 찾고, 없으면 예전처럼 발주계획 탭을 품의번호로 찾는다.
 */
const RB_LINK = {
  EXCLUDE_STATES: ['계획', '상신', '취소'],
  EXTRA_SHEET: '_실행판_발주부가정보'
};

/** 이 행을 계산에서 뺄지(진행상태 열이 없으면 빼지 않는다) */
function rbExcluded_(row, stateIdx) {
  if (stateIdx === undefined || stateIdx === null || stateIdx < 0) return false;
  return RB_LINK.EXCLUDE_STATES.indexOf(String(row[stateIdx] || '').trim()) > -1;
}


/**
 * ============================================================
 * AP 탭 설정 · 도움 함수
 * ------------------------------------------------------------
 * 예전 발주현황 → AP 계산 본체(buildMappedRows_ 등)는 지웠다. 지금 AP 행은 지급 줄로 만든다(Lines.gs apFromLines_).
 * 여기에는 그쪽이 쓰는 도움 함수 · AP 탭 쓰기 · 매입금액 스냅샷만 남아 있다.
 * ============================================================
 */

var MAPPING_CONFIG = {
  DEST_GID: 1929529999, // 대상 시트(AP)
  DEST_HEADER_ROWS: 1,  // 대상 시트 헤더 행 수
  DEST_COL_COUNT: 18    // A~R
};

var PLAN_CONFIG = {
  SHEET_NAME: '발주계획',
  HEADER_ROW: 2,
  ID_HEADER: '품의번호',
  VENDOR_REQUEST_HEADER: '발주요청팀',
  REQUESTER_HEADER: '요청팀담당자',
  REPORT_HEADER: '소진완료목표일'
};

/**
 * 발주계획 시트를 한 번 읽어서 품의번호 -> {vendor, requester, report} 조회표를 만든다.
 * [v7] 시트나 헤더가 없어도 예외를 던지지 않고 빈 조회표를 반환한다.
 *      (P~R열은 부가 정보일 뿐인데 여기서 멈추면 AP 업데이트 전체가 실패했음)
 */
function buildPlanLookup_(ss) {
  var sheet = ss.getSheetByName(PLAN_CONFIG.SHEET_NAME);
  if (!sheet) {
    console.warn('"' + PLAN_CONFIG.SHEET_NAME + '" 시트를 찾지 못해 P~R열을 비웁니다.');
    return {};
  }

  var data = sheet.getDataRange().getValues();
  if (data.length < PLAN_CONFIG.HEADER_ROW) return {};

  var headerRow = data[PLAN_CONFIG.HEADER_ROW - 1];
  var headerIndex = {};
  for (var h = 0; h < headerRow.length; h++) {
    var t = String(headerRow[h]).trim();
    if (t && !(t in headerIndex)) headerIndex[t] = h;
  }

  var idIdx = headerIndex[PLAN_CONFIG.ID_HEADER];
  if (idIdx === undefined) {
    console.warn('"' + PLAN_CONFIG.ID_HEADER + '" 헤더를 "' + PLAN_CONFIG.SHEET_NAME + '" 시트 '
      + PLAN_CONFIG.HEADER_ROW + '행에서 찾지 못해 P~R열을 비웁니다.');
    return {};
  }
  var vendorIdx = headerIndex[PLAN_CONFIG.VENDOR_REQUEST_HEADER];
  var reqIdx = headerIndex[PLAN_CONFIG.REQUESTER_HEADER];
  var reportIdx = headerIndex[PLAN_CONFIG.REPORT_HEADER];

  var map = {};
  for (var r = PLAN_CONFIG.HEADER_ROW; r < data.length; r++) {
    var row = data[r];
    var id = String(row[idIdx] || '').trim();
    if (!id) continue;

    var vendorVal = (vendorIdx !== undefined) ? row[vendorIdx] : '';
    var reqVal = (reqIdx !== undefined) ? row[reqIdx] : '';
    var reportVal = (reportIdx !== undefined) ? row[reportIdx] : '';

    if (!(id in map)) {
      map[id] = { vendor: vendorVal, requester: reqVal, report: reportVal };
    } else {
      // 같은 품의번호가 여러 행에 걸쳐 있으면 공란인 칸만 채움
      var cur = map[id];
      if (isEmptyForMapping_(cur.vendor) && !isEmptyForMapping_(vendorVal)) cur.vendor = vendorVal;
      if (isEmptyForMapping_(cur.requester) && !isEmptyForMapping_(reqVal)) cur.requester = reqVal;
      if (isEmptyForMapping_(cur.report) && !isEmptyForMapping_(reportVal)) cur.report = reportVal;
    }
  }
  return map;
}

/**
 * [v9] 실행판 부가정보 탭: 실행판ID -> {vendor(발주요청팀), requester, report}
 * 탭이 없으면 빈 조회표.
 */
function buildRbExtraLookup_(ss) {
  var sheet = ss.getSheetByName(RB_LINK.EXTRA_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return {};
  var data = sheet.getDataRange().getValues();
  var head = data[0].map(function (h) { return String(h).trim(); });
  var iId = head.indexOf('실행판ID'), iTeam = head.indexOf('발주요청팀'),
      iReq = head.indexOf('요청팀담당자'), iRep = head.indexOf('소진완료목표일');
  if (iId < 0) return {};
  var map = {};
  for (var r = 1; r < data.length; r++) {
    var id = String(data[r][iId] || '').trim();
    if (!id || map[id]) continue;
    map[id] = { vendor: iTeam > -1 ? data[r][iTeam] : '', requester: iReq > -1 ? data[r][iReq] : '',
                report: iRep > -1 ? data[r][iRep] : '' };
  }
  return map;
}

function resolveBrand_(colE) {
  var eText = String(colE);
  if (eText.indexOf('메디') > -1) return 'Meditherapy';
  if (eText.indexOf('히디프') > -1) return 'Hidiff';
  return colE;
}

function writeMappedResultSheet_(destSheet, outputRows, anomalyCount) {
  var startRow = MAPPING_CONFIG.DEST_HEADER_ROWS + 1;
  var maxRowsBefore = destSheet.getMaxRows();

  // 새 값을 먼저 쓰고 그 아래 남은 행만 비운다(예전에는 다 지운 뒤 썼다 — 쓰다 멈추면 AP 가 빈 채로 남았다)
  if (outputRows.length === 0) {
    if (maxRowsBefore >= startRow) {
      var oldRange = destSheet.getRange(startRow, 1, maxRowsBefore - startRow + 1, MAPPING_CONFIG.DEST_COL_COUNT);
      oldRange.clearContent();
      oldRange.setBackground(null);
    }
    return;
  }

  // 행/열 수 확보
  var neededLastRow = startRow - 1 + outputRows.length;
  var maxRows = destSheet.getMaxRows();
  if (neededLastRow > maxRows) {
    destSheet.insertRowsAfter(maxRows, neededLastRow - maxRows);
  }
  if (MAPPING_CONFIG.DEST_COL_COUNT > destSheet.getMaxColumns()) {
    destSheet.insertColumnsAfter(destSheet.getMaxColumns(), MAPPING_CONFIG.DEST_COL_COUNT - destSheet.getMaxColumns());
  }

  var n = outputRows.length;

  // ---- [v7] 값을 쓰기 "전에" 표시 형식을 먼저 지정한다 ----
  // 특히 K열("26-07")과 N열("26-07")은 텍스트여야 한다. 형식을 나중에 지정하면
  // 시트가 값을 날짜로 자동 변환해버려서 스냅샷 집계 키가 깨진다.
  destSheet.getRange(startRow, 11, n, 1).setNumberFormat('@'); // K열: 입고월(yy-mm)
  destSheet.getRange(startRow, 14, n, 1).setNumberFormat('@'); // N열: 지급월(yy-mm)
  destSheet.getRange(startRow, 1, n, 1).setNumberFormat('yyyy-mm-dd');  // A열: 발주일
  destSheet.getRange(startRow, 2, n, 1).setNumberFormat('yyyy-mm-dd');  // B열: 입고일
  destSheet.getRange(startRow, 13, n, 1).setNumberFormat('yyyy-mm-dd'); // M열: 지급일
  destSheet.getRange(startRow, 9, n, 1).setNumberFormat('#,##0');       // I열: 수량
  destSheet.getRange(startRow, 10, n, 1).setNumberFormat('#,##0');      // J열: 단가
  destSheet.getRange(startRow, 12, n, 1).setNumberFormat('#,##0');      // L열: 금액

  destSheet.getRange(startRow, 1, n, MAPPING_CONFIG.DEST_COL_COUNT).setValues(outputRows);

  // 새 값 아래 남은 예전 행은 비운다 · 배경색은 데이터 영역 전체를 지운 뒤 예외 행만 다시 칠한다
  var maxRowsNow = destSheet.getMaxRows();
  if (maxRowsNow >= startRow + n) destSheet.getRange(startRow + n, 1, maxRowsNow - startRow - n + 1, MAPPING_CONFIG.DEST_COL_COUNT).clearContent();
  destSheet.getRange(startRow, 1, maxRowsNow - startRow + 1, MAPPING_CONFIG.DEST_COL_COUNT).setBackground(null);

  // 예외 건들(맨 마지막 anomalyCount개 행)은 빨간색으로 표시
  if (anomalyCount > 0) {
    var anomalyStartRow = startRow + n - anomalyCount;
    var bgGrid = [];
    for (var ai = 0; ai < anomalyCount; ai++) {
      var rowBg = [];
      for (var c = 0; c < MAPPING_CONFIG.DEST_COL_COUNT; c++) rowBg.push('#f4cccc');
      bgGrid.push(rowBg);
    }
    destSheet.getRange(anomalyStartRow, 1, anomalyCount, MAPPING_CONFIG.DEST_COL_COUNT).setBackgrounds(bgGrid);
  }
}

function getSheetByGidForMapping_(ss, gid) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === gid) return sheets[i];
  }
  throw new Error('gid=' + gid + '에 해당하는 시트를 찾을 수 없습니다.');
}

function isEmptyForMapping_(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

/**
 * [v7] 숫자 변환을 엄격하게.
 *  - Date 객체는 NaN (예전엔 날짜 문자열에서 숫자만 긁어 이상한 값이 나왔음)
 *  - 콤마/공백/통화기호/단위 문자는 제거하되, 남은 문자열이 순수한 숫자일 때만 변환
 *    ("5,000" → 5000, "¥12.5" → 12.5, "12.5위안" → 12.5,
 *     "3,000(추가500)" → NaN, "1-2" → NaN)
 */
function toNumberForMapping_(v) {
  if (typeof v === 'number') return v;
  if (Object.prototype.toString.call(v) === '[object Date]') return NaN;
  var s = String(v).trim();
  if (s === '') return NaN;
  var cleaned = s
    .replace(/,/g, '')
    .replace(/\s/g, '')
    .replace(/[₩$¥￥€£]/g, '')
    .replace(/[A-Za-z가-힣元]/g, '');
  return /^-?\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : NaN;
}

/** 구글시트 수식 에러값(#NUM!, #REF! 등)이면 빈 문자열로 바꿔줌 */
function sanitizeErrorValueForMapping_(v) {
  var s = String(v).trim();
  return /^#(NUM|REF|DIV\/0|N\/A|VALUE|NULL|NAME|ERROR)[!?]?$/.test(s) ? '' : v;
}

function toDateSafeForMapping_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return v;
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/** "yyyy-MM-dd" → "yy-MM". 날짜 형식이 아니면 빈 문자열 */
function extractMonthForMapping_(dateStr) {
  var m = /^\d{4}-(\d{2})-\d{2}$/.exec(String(dateStr));
  if (!m) return '';
  var year4 = String(dateStr).substring(0, 4);
  return year4.substring(2) + '-' + m[1];
}

/** 지급월 → 실제 지급일("yyyy-MM-dd"). 한국콜마=15일, 그 외=말일 */
function paymentDateFromYearMonth_(year, month, isKolmarVendor) {
  var day = isKolmarVendor ? 15 : new Date(year, month, 0).getDate();
  return Utilities.formatDate(new Date(year, month - 1, day), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}


/**
 * ============================================================
 * 매입금액 스냅샷 로그
 * ------------------------------------------------------------
 * AP 탭(C:브랜드, D:채널, L:매입금액, N:지급월)을 브랜드×채널×지급월로 합산해서
 * 오늘 날짜와 함께 "매입금액_스냅샷_로그" 시트에 누적한다.
 * 같은 날짜로 다시 실행하면 새 행을 끝에 붙인 뒤 그날 예전 행만 지운다(로그 전체를 다시 쓰지 않는다).
 *
 * [v7] 집계 결과가 0행이면 기존 기록을 건드리지 않고 중단한다.
 *      (AP 시트가 비워진 순간에 실행돼서 그날 기록이 통째로 사라지던 문제 방지)
 * ============================================================
 */

var SNAPSHOT_LOG_SHEET_NAME = '매입금액_스냅샷_로그';

function snapshotApPaymentSummary() {
  var ss = rbApSS_();
  var destSheet = getSheetByGidForMapping_(ss, MAPPING_CONFIG.DEST_GID);

  var startRow = MAPPING_CONFIG.DEST_HEADER_ROWS + 1;
  var lastRow = destSheet.getLastRow();

  var sums = {}; // "브랜드|||채널|||지급월" -> 매입금액 합계
  if (lastRow >= startRow) {
    var data = destSheet.getRange(startRow, 1, lastRow - startRow + 1, MAPPING_CONFIG.DEST_COL_COUNT).getValues();
    data.forEach(function (r) {
      var brand = String(r[2] || '').trim();   // C열: 브랜드
      var channel = String(r[3] || '').trim(); // D열: 채널
      // N열: 지급월(yy-mm) — 혹시 날짜로 변환돼 있어도 yy-MM으로 정규화
      var payRaw = r[13];
      var payMonth = (Object.prototype.toString.call(payRaw) === '[object Date]')
        ? Utilities.formatDate(payRaw, Session.getScriptTimeZone(), 'yy-MM')
        : String(payRaw || '').trim();
      var amt = toNumberForMapping_(r[11]); // L열: 매입금액
      if (!brand || !payMonth || isNaN(amt)) return;
      var key = brand + '|||' + channel + '|||' + payMonth;
      sums[key] = (sums[key] || 0) + amt;
    });
  }

  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var newRows = Object.keys(sums).sort().map(function (key) {
    var parts = key.split('|||');
    return [today, parts[0], parts[1], parts[2], sums[key]];
  });

  // [v7] 집계 결과가 없으면 기존 기록을 지우지 않고 중단
  if (newRows.length === 0) {
    throw new Error('AP 시트에 집계할 데이터가 없어 스냅샷을 건너뜁니다 (기존 기록은 그대로 보존).');
  }

  var logSheet = ss.getSheetByName(SNAPSHOT_LOG_SHEET_NAME);
  var header = ['스냅샷일자', '브랜드', '채널', '지급월', '매입금액합계'];
  var todayRows = [];   // 오늘 날짜로 이미 있던 행 번호(위에서 아래 순)

  if (!logSheet) {
    logSheet = ss.insertSheet(SNAPSHOT_LOG_SHEET_NAME);
    logSheet.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#d9e2f3');
    logSheet.setFrozenRows(1);
  } else {
    // 오늘 날짜로 이미 저장된 행은 먼저 지움 (같은 날 여러 번 실행해도 안 쌓이게)
    var existingLastRow = logSheet.getLastRow();
    if (existingLastRow >= 2) {
      // 예전에는 로그 전체를 읽어 지우고(clearContent) 다시 썼다 — 중간에 실패하면 이력이 통째로 사라질 수 있었다.
      // 이제 날짜(A열)만 읽어 오늘 행 위치만 기억해 둔다. 지우기는 새 행을 붙인 뒤에(아래).
      var dates = logSheet.getRange(2, 1, existingLastRow - 1, 1).getValues();
      dates.forEach(function (r, i) {
        var d = r[0];
        var dStr = (Object.prototype.toString.call(d) === '[object Date]')
          ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd')
          : String(d).trim();
        if (dStr === today) todayRows.push(i + 2);
      });
    }
  }

  // 1) 새 행을 끝에 붙인다(여기서 실패하면 예전 기록은 그대로)
  var appendStartRow = logSheet.getLastRow() + 1;
  if (appendStartRow + newRows.length - 1 > logSheet.getMaxRows()) logSheet.insertRowsAfter(logSheet.getMaxRows(), appendStartRow + newRows.length - 1 - logSheet.getMaxRows());
  logSheet.getRange(appendStartRow, 1, newRows.length, 1).setNumberFormat('yyyy-mm-dd');
  logSheet.getRange(appendStartRow, 4, newRows.length, 1).setNumberFormat('@'); // 지급월은 텍스트
  logSheet.getRange(appendStartRow, 5, newRows.length, 1).setNumberFormat('#,##0');
  logSheet.getRange(appendStartRow, 1, newRows.length, header.length).setValues(newRows);
  SpreadsheetApp.flush();

  // 2) 그다음 오늘 날짜로 먼저 저장돼 있던 행만 지운다(아래에서 위로, 이어진 구간은 한 번에).
  //    남는 순서는 예전과 같다: 다른 날 행(원래 순서) → 오늘 새 행. 여기서 실패해도 오늘 행이 겹칠 뿐 이력은 안 사라진다.
  for (var k = todayRows.length - 1; k >= 0; ) {
    var end = todayRows[k], start = end;
    while (k - 1 >= 0 && todayRows[k - 1] === start - 1) { k--; start--; }
    logSheet.deleteRows(start, end - start + 1);
    k--;
  }

  rbApToast_(ss, '매입금액 스냅샷 저장 완료 (' + today + ', ' + newRows.length + '행)', '스냅샷', 6);
}


  return {
    helpers: { resolveBrand: resolveBrand_, payDate: paymentDateFromYearMonth_, month: extractMonthForMapping_,
               clean: sanitizeErrorValueForMapping_,
               toDateSafe: toDateSafeForMapping_, isEmpty: isEmptyForMapping_, excluded: rbExcluded_,
               planLookup: function (ss) { var p = buildPlanLookup_(ss); p.__byRbId = buildRbExtraLookup_(ss); return p; } },
    destGid: MAPPING_CONFIG.DEST_GID,
    sheetByGid: getSheetByGidForMapping_,
    write: writeMappedResultSheet_,
    snapshot: snapshotApPaymentSummary      // 매입금액 스냅샷(같은 날은 덮어쓴다)
  };
})();
