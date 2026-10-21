/**
 * ============================================================
 * 발주 실행판 (웹앱) — Google Apps Script
 * ------------------------------------------------------------
 * 무엇을 하는가
 *  · 발주계획 탭의 발주건을 읽어와 건별로 단계 진행을 관리한다.
 *  · 앞 단계를 끝내야(또는 건너뛰어야) 다음 단계가 열린다.
 *  · 담당자별 · 품목별 진행 현황을 한 화면에서 본다.
 *  · 관리자(배포자)만 단계를 추가 / 삭제 / 이름 변경할 수 있다.
 *
 * 데이터는 발주계획 스프레드시트 안에 숨김 탭 3개로 저장된다.
 *   _실행판_프로세스 : 단계 정의
 *   _실행판_진행     : 건별 체크 상태
 *   _실행판_설정     : 링크 주소 · 관리자 · 조회 기간
 *
 * 설치 순서는 같은 폴더의 [설치방법.md] 참고.
 * ============================================================
 */

var RB = {
  SS_ID: '1pmCAw1qqxUOlQGtYJhq672ieg1w0cGJMC-KiDB66fzs',
  BOM_SS_ID: '1krXu_Vf7WahKKgIW6oVK4cDVbpcRX04lTo885-yrZpA',       // BOM 시트(BOM 보기 · 차수 생성)
  PLAN_TAB: '발주계획',
  PLAN_HEADER_ROW: 2,
  // 발주 DB — 실행판 전용 숨김 탭(머리글 1행, 데이터 2행부터, 값만). 2026-10-04 발주현황에서 옮겨 왔다(Migrate.js).
  STATUS_TAB: '_실행판_발주',
  // 예전 발주 DB(발주현황). 이제 읽지도 쓰지도 않는다 — 이관 원본 · 이관 확인(?diag=verify)에서만 탭 ID 로 찾는다.
  LEGACY_STATUS_GID: 312572094,
  LEGACY_STATUS_NAME: '발주현황',
  STATUS_SCAN_ROWS: 1200,
  STATUS_COLS: 80,
  T_AUDIT: '_실행판_변경이력',
  // 예전 이력 탭(지금은 _실행판_변경이력 하나에 쌓는다). 탭 이름만 남긴다 — 성능 측정 정리(PerfRun)가 쓴다.
  T_STEPLOG: '_실행판_단계이력',
  T_CHGLOG: '_실행판_변경내역',
  AUDIT_HEAD: ['시각', '바꾼사람', '탭', '행', '열', '항목', '이전값', '새값', '품목'],   // 예전 형식(합치기 전)
  // 이력은 _실행판_변경이력 하나에 이 형식으로 쌓는다(칸 변경 · 단계 · 변경 여부 · 입고일정 · 수량단가 · 발주정보)
  HIST_HEAD: ['시각', '바꾼사람', '구분', '종류', '실행판ID', '품의번호', '품목코드', '품목명', '항목', '이전값', '새값', '사유', '위치', '비고'],
  PLAN_SCAN_ROWS: 1200,
  PLAN_COLS: 32,

  T_PROCESS: '_실행판_프로세스',
  T_PROGRESS: '_실행판_진행',
  SAMPLE_TAB: '_실행판_샘플',
  SAMPLE_TAB_OLD: '샘플진행상황',          // 2026-10-16 이름 통일 — 이 이름이 남아 있으면 처음 찾을 때 _실행판_샘플 로 바꾼다
  T_SPROCESS: '_실행판_샘플프로세스',
  T_SPROGRESS: '_실행판_샘플진행',
  SAMPLE_SCAN_ROWS: 800,
  PARTIAL_MAX: 20,
  CHINA_KEYWORD: '중국',
  CHINA_MULTIPLIER: 200,
  SAMPLE_COLS: 22,
  T_CONFIG: '_실행판_설정',

  PROCESS_HEAD: ['순서', '단계ID', '단계명', '담당', '목표', '통과조건', '건너뛰기허용', '링크키', '체크항목', '입고일정변경시초기화'],
  PROGRESS_HEAD: ['건ID', '품의번호', '품목명', '발주차수', '브랜드', '담당자', '진행JSON', '메모JSON', '최종수정', '최종수정자', '날짜JSON'],
  CONFIG_HEAD: ['키', '값', '설명'],
  // 예전 이력 탭 이름(위와 같이 PerfRun 정리용)
  T_ETALOG: '_실행판_입고일정변경',
  T_INFOLOG: '_실행판_발주정보변경',
  T_QPLOG: '_실행판_수량단가변경'
};

/* ============================================================
 * 웹앱 진입점
 * ============================================================ */

function doGet(e) {
  // 진단용 주소(?time · ?diag)는 관리자만 볼 수 있다. 시트 내용 · 수식이 그대로 나가기 때문.
  if (e && e.parameter && (e.parameter.time || e.parameter.diag)) {
    var cfgG = readConfig_();
    if (!isAdmin_(cfgG)) {
      return ContentService.createTextOutput('관리자만 볼 수 있습니다.').setMimeType(ContentService.MimeType.TEXT);
    }
    // 진단 처리는 Diag.js. 모르는 진단 이름이면 화면을 띄운다.
    var dOut = diagRoute_(e);
    if (dOut) return dOut;
  }
  // 첫 화면 데이터를 HTML 에 같이 담는다. 캐시에 다 있을 때만(시트를 여는 느린 길은 여기서 하지 않는다).
  // 예전에는 HTML 을 받은 뒤 apiBootstrap 을 한 번 더 불러서, 서버 왕복이 두 번이라 표가 뜨기까지 1초 이상 더 걸렸다.
  try { journalTriggerEnsure_(); } catch (err) { /* 1분 트리거(장부 옮기기) · 10분 트리거(캐시 채우기) — 못 만들어도 화면은 띄운다 */ }
  // 화면 HTML 은 PageHtml.html(배포할 때 Page.js 에서 만든다) — 서버 호출마다 화면 코드를 읽지 않게 스크립트 파일에서 뺐다
  var page = HtmlService.createHtmlOutputFromFile('PageHtml').getContent();
  buildMark_();
  // 이 화면의 판 번호 · 실행판 주소. 새 버전을 배포하면 열어 둔 화면이 apiVer 로 알아채고 [새로고침] 안내를 띄운다.
  var execUrl = '';
  try { execUrl = ScriptApp.getService().getUrl() || ''; } catch (err) { execUrl = ''; }
  // 판 번호 · 첫 화면 데이터는 </head> 앞에 넣는다 — HTML 파일로 뺀 뒤(10/16) HtmlService 가 주석(<!--BOOT-->)을 지워 그동안 안 들어갔다(새 버전 안내 · 빠른 첫 화면이 안 됨)
  var updId = '';
  try { updId = UPD_LATEST_ID_(); } catch (err) { updId = ''; }   // 첫 화면 '새로 바뀐 점' 팝업이 최신 소식 id 를 알도록
  var inj = '<script>window.__BUILD=' + JSON.stringify(RB_BUILD) + ';window.__EXEC=' + JSON.stringify(execUrl) + ';window.__UPD=' + JSON.stringify(updId) + ';</script>';
  try {
    var pre = cachedBoot_('po', true);
    if (pre) {
      var js = JSON.stringify(pre).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
      inj += '<script>window.__BOOT=' + js + ';</script>';
    }
  } catch (err) { /* 못 담으면 예전처럼 화면이 따로 불러온다 */ }
  page = page.indexOf('</head>') > -1 ? page.replace('</head>', inj + '</head>') : inj + page;
  var out = HtmlService.createHtmlOutput(page)
    .setTitle('발주 실행판')
    // 휴대폰도 PC 화면 그대로(폭 1280) — 처음엔 화면에 맞게 축소되고, 손가락으로 확대 · 축소 · 가로 스크롤
    .addMetaTag('viewport', 'width=1280, viewport-fit=cover');
  // 다른 사이트 iframe 에 넣어 쓰지 않으므로 ALLOWALL 을 두지 않는다(기본값 = 다른 사이트 임베드 막음)
  try { out.setFaviconUrl(RB_FAVICON); } catch (eF) { /* 아이콘을 못 붙여도 화면은 뜬다 */ }   // 브라우저 탭 아이콘(기본 Apps Script 아이콘 대신)
  return out;
}

/* ============================================================
 * 시트 준비
 * ============================================================ */

/* 한 번 실행되는 동안 스프레드시트와 시트 목록을 캐시한다.
   openById / getSheetByName 을 매번 부르면 그게 그대로 로딩 시간이 된다. */
var RB_SS = null;
var RB_SHEETS = null;

function ss_() {
  if (!RB_SS) RB_SS = SpreadsheetApp.openById(RB.SS_ID);
  return RB_SS;
}

function sheet_(name) {
  // 필요한 탭만 이름으로 찾는다. 예전에는 처음 한 번 탭 26개를 다 훑어(탭마다 이름 묻기) 저장마다 0.2초가 더 들었다.
  if (!RB_SHEETS) RB_SHEETS = {};
  if (!(name in RB_SHEETS)) RB_SHEETS[name] = ss_().getSheetByName(name) || sampleTabRename_(name);
  return RB_SHEETS[name] || null;
}

/** 샘플 원본 탭 이름 통일(2026-10-16): 샘플진행상황 → _실행판_샘플. 줄 · 값 · 탭 ID(gid)는 그대로, 이름만 바꾼다(보이는 탭 그대로) */
function sampleTabRename_(name) {
  if (name !== RB.SAMPLE_TAB) return null;
  var ss = ss_(), old = ss.getSheetByName(RB.SAMPLE_TAB_OLD);
  if (!old) return null;
  // 잠금을 잡지 않는다 — sheet_() 는 다른 잠금 안에서도 불려, 여기서 잡았다 놓으면 바깥 잠금까지 풀린다.
  // 둘이 동시에 바꾸면 한쪽 setName 이 실패할 뿐이라 새 이름으로 다시 찾는다.
  try { old.setName(RB.SAMPLE_TAB); SpreadsheetApp.flush(); }
  catch (eN) { return ss.getSheetByName(RB.SAMPLE_TAB); }
  try { appendHist_([{ kind: '설정', item: '샘플 탭 이름', before: RB.SAMPLE_TAB_OLD, after: RB.SAMPLE_TAB, where: RB.SAMPLE_TAB }]); } catch (e) { /* 넘어간다 */ }
  return old;
}

/**
 * 발주 DB 탭(_실행판_발주). 없으면 멈춘다 — 빈 탭을 만들거나 발주현황으로 돌아가지 않는다.
 * (예전에 발주현황 이름을 '_실행판_발주' 로 바꿔 숨긴 적이 있어, 그 탭이면 이관 전으로 본다)
 */
function statusSheet_() {
  var sh = sheet_(RB.STATUS_TAB);
  if (!sh || sh.getSheetId() === RB.LEGACY_STATUS_GID) {
    throw new Error('발주 DB 탭(' + RB.STATUS_TAB + ')이 없습니다 — 관리자 이관이 필요합니다.');
  }
  return sh;
}

function tab_(name, head) {
  var sh = sheet_(name);
  if (!sh) {
    sh = ss_().insertSheet(name);
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.hideSheet();
    RB_SHEETS[name] = sh;
  }
  return sh;
}

function procTabName_(mode) { return mode === 'sample' ? RB.T_SPROCESS : RB.T_PROCESS; }
function progTabName_(mode) { return mode === 'sample' ? RB.T_SPROGRESS : RB.T_PROGRESS; }

/** 샘플 기본 단계. 관리자가 화면에서 바꿀 수 있다. */
function defaultSampleSteps_() {
  return [
    {
      id: 'sm1', title: '샘플 요청 접수', owner: '개발 · 영업 → 구매',
      goal: '요청 내용을 _실행판_샘플 시트에 받아 적는다.',
      gate: '요청 내용과 수량이 정해져야 업체에 의뢰할 수 있습니다.',
      skippable: false, links: [],
      items: [
        { t: '요청일 · 담당자 · 브랜드 기재' },
        { t: '품목명 · 구성 · 사양 · 구분 기재', h: '용기/튜브/단상자/Gwp, 인쇄·색사출, 소싱샘플·디자인샘플·촬영용 등' },
        { t: '필요 수량 확인' }
      ]
    },
    {
      id: 'sm2', title: '업체 의뢰', owner: '구매팀',
      goal: '업체를 정하고 사양을 전달해 샘플 제작을 의뢰한다.',
      gate: '업체가 정해지고 의뢰가 나가야 다음으로 넘어갑니다.',
      skippable: false, links: [],
      items: [
        { t: '업체 선정 · 시트에 업체명 기재' },
        { t: '사양 · 수량 전달' },
        { t: '견적 확인', o: true }
      ]
    },
    {
      id: 'sm3', title: '전달예정일 확정', owner: '구매팀',
      goal: '업체에서 받은 일정을 전달예정일로 확정해 기재한다.',
      gate: '전달예정일이 시트에 들어가야 합니다.',
      skippable: false, links: [],
      items: [
        { t: '업체 일정 확인' },
        { t: '전달예정일 시트 기재' },
        { t: '요청자에게 일정 공유', o: true }
      ]
    },
    {
      id: 'sm4', title: '샘플 입고', owner: '구매팀',
      goal: '샘플을 받아 전달일을 기재한다.',
      gate: '전달일이 들어가야 검토로 넘어갑니다.',
      skippable: false, links: [],
      items: [
        { t: '샘플 수령 · 수량 확인' },
        { t: '전달일 시트 기재' },
        { t: '요청자에게 전달' }
      ]
    },
    {
      id: 'sm5', title: '검토 · 피드백', owner: '개발 · 디자인',
      goal: '샘플을 검토하고 결과를 비고/피드백에 남긴다.',
      gate: '피드백이 기재되어야 마감할 수 있습니다. 재요청이면 1단계로 새 건을 만드세요.',
      skippable: false, links: [],
      items: [
        { t: '샘플 검토' },
        { t: '비고/피드백 시트 기재', h: '재질·두께·제작방식 등 문제점과 다음 요청사항' },
        { t: '재요청 필요 여부 판단' }
      ]
    },
    {
      id: 'sm6', title: '마감', owner: '구매팀',
      goal: '채택 또는 보류로 건을 마감한다.',
      gate: '마감되면 샘플 건이 종료됩니다.',
      skippable: false, links: [],
      items: [
        { t: '채택 · 보류 결정' },
        { t: '결과를 비고에 기록' }
      ]
    }
  ];
}

/** 시트를 준비하고, 비어 있으면 기본값을 넣는다. */
function setup_() {
  // 탭이 이미 제대로 만들어져 있으면 매번 확인하지 않는다(확인 자체가 왕복이다).
  try {
    if (CacheService.getScriptCache().get('setupdone:v3')) return null;
    // 탭은 한 번 만들면 그대로다 — 캐시(최대 6시간)가 지나도 스크립트 속성에 표시가 있으면 탭 5개 확인(1~2초)을 건너뛴다
    if (PropertiesService.getScriptProperties().getProperty('rb.setupdone') === 'v3') { CacheService.getScriptCache().put('setupdone:v3', '1', 21600); return null; }
  } catch (e) { /* 무시 */ }
  var proc = tab_(RB.T_PROCESS, RB.PROCESS_HEAD);
  if (proc.getLastColumn() < RB.PROCESS_HEAD.length) {
    proc.getRange(1, 1, 1, RB.PROCESS_HEAD.length).setValues([RB.PROCESS_HEAD]).setFontWeight('bold');
  }
  if (proc.getLastRow() < 2) writeSteps_(defaultSteps_());

  var prog = tab_(RB.T_PROGRESS, RB.PROGRESS_HEAD);
  // 예전 버전에는 날짜 칸이 없었다. 없으면 헤더를 채워 넣는다.
  if (prog.getLastColumn() < RB.PROGRESS_HEAD.length) {
    prog.getRange(1, 1, 1, RB.PROGRESS_HEAD.length).setValues([RB.PROGRESS_HEAD]).setFontWeight('bold');
  }

  var sproc = tab_(RB.T_SPROCESS, RB.PROCESS_HEAD);
  if (sproc.getLastRow() < 2) writeSteps_(defaultSampleSteps_(), 'sample');
  tab_(RB.T_SPROGRESS, RB.PROGRESS_HEAD);

  var cfg = tab_(RB.T_CONFIG, RB.CONFIG_HEAD);
  if (cfg.getLastRow() < 2) {
    cfg.getRange(2, 1, defaultConfig_().length, 3).setValues(defaultConfig_());
  }
  try { CacheService.getScriptCache().put('setupdone:v3', '1', 21600); PropertiesService.getScriptProperties().setProperty('rb.setupdone', 'v3'); } catch (e) { /* 무시 */ }
  return { proc: proc, prog: prog, cfg: cfg };
}

function defaultConfig_() {
  return [
    ['admin.emails', '', '관리자 이메일(쉼표로 구분). 비워두면 이 스크립트를 배포한 사람만 관리자입니다.'],
    ['edit.stepId', '', '발주현황 수정칸을 띄울 단계 ID. 비우면 마지막 단계에 붙습니다.'],
    ['dates.stepId', '', '상신일·승인일 칸을 띄울 단계 ID.'],
    ['order.stepId', '', '발주일 칸을 띄울 단계 ID. 비우면 단계명에 [발주서] 나 [발송]이 든 단계.'],
    ['edit.stepTitle', '입고', '발주현황 직접 수정칸(입고일정·제품입고일·입고수량·지급월)을 띄울 단계.'],
    ['dates.stepTitle', '상신', '상신일·승인일 입력칸을 띄울 단계. 단계명에 이 글자가 들어간 단계에 나옵니다.'],
    ['link.bom', '', 'BOM 보기 — 실행판 안(BOM 원본은 실행판 시트 숨김 탭 _실행판_BOM)'],
    ['link.itemcode', '', '품목코드 생성 — 실행판 안(신규코드채번은 숨김 탭 _실행판_신규코드채번)'],
    ['link.form', '', '발주품의서 양식 v3.5 (드라이브 링크)'],
    ['link.amaranth', 'https://erp.meditherapy.co.kr/#/', '아마란스 ERP'],
    ['link.status', 'https://docs.google.com/spreadsheets/d/1pmCAw1qqxUOlQGtYJhq672ieg1w0cGJMC-KiDB66fzs/edit?gid=312572094#gid=312572094', '발주현황 탭'],
    ['link.design', 'https://docs.google.com/spreadsheets/d/1uGgQLfEXf67VOMylz9LpuSckIn6C0_1GHZRA0hhpB5w/edit?gid=290116474#gid=290116474', '디자인 검토 시트'],
    ['link.podir', '', '발주서 폴더'],
    ['link.hanpan', '', '업무한판(최종데이터 한판) 시트'],
    ['link.stock', '', '재고 시트']
  ];
}

/** 기본 7단계. 관리자가 화면에서 언제든 바꿀 수 있다. */
function defaultSteps_() {
  return [
    {
      id: 's1', title: '발주 요청 취합', owner: '영업 · 개발 → 구매',
      goal: '영업·개발이 요청한 발주건을 구매팀이 발주계획 탭에 취합한다.',
      gate: '발주계획 행이 빈칸 없이 채워져야 품의 양식에 붙여넣을 수 있습니다.',
      skippable: false, links: ['plan'],
      items: [
        { t: '영업 · 개발 요청건을 발주계획 탭에 취합', h: '작성일 ~ 소진완료목표일 구간의 열을 한 행으로 채웁니다.' },
        { t: '브랜드 · 채널 · 품목코드 · 차수 · 상품명 입력' },
        { t: '발주수량 · 매입처 · 단가 입력', h: '중국 자재는 위안 단가로 입력합니다.' },
        { t: '발주요청팀 · 요청팀담당자 · 소진완료목표일 입력' },
        { t: '선금지급예정 · 잔금지급예정 입력', h: '날짜가 원칙. 해석이 안 되는 텍스트는 품의 양식에서 오류로 잡힙니다.' },
        { t: '입고목표일 입력' }
      ]
    },
    {
      id: 's2', title: '신제품 BOM · 품목코드', owner: '개발 · 구매',
      goal: '신제품이면 BOM을 먼저 잡고, 그에 따라 품목코드를 생성한다.',
      gate: '품목코드가 나와야 품의를 올릴 수 있습니다. 기존 품목이면 [해당 없음]으로 건너뛰세요.',
      skippable: true, links: ['bom', 'itemcode'],
      items: [
        { t: 'BOM 설정 시트에 구성 등록', h: '부자재 · 사급자재 · 임가공 구분까지 정리합니다.' },
        { t: 'BOM에 따라 품목코드 생성' },
        { t: '생성한 품목코드를 발주계획 행에 반영' }
      ]
    },
    {
      id: 's3', title: '발주품의 상신', owner: '구매팀',
      goal: '발주품의서_양식_v3.5.xlsm으로 품의 건을 만들어 아마란스에 상신하고, 결재문서번호로 회차를 고정한다.',
      gate: '입력검증 오류 0 + 모든 품의건 결재문서번호 확정.',
      skippable: false, links: ['form', 'plan', 'amaranth', 'podir'],
      items: [
        { t: '파일을 열고 [콘텐츠 사용]으로 매크로 허용', h: '매크로가 꺼져 있으면 상신확정이 자동 반영되지 않습니다.' },
        { t: '01_발주리스트 A3 선택 → 발주계획에서 복사 → 값만 붙여넣기', h: 'Ctrl+Shift+V. [작성일 ~ 소진완료목표일] 전체 열.' },
        { t: '00_사용방법의 [입력검증 오류 행] = 0 확인' },
        { t: '04_품의건목록에서 브랜드 · 지급유형 · 최종지급일 · 금액 확인', h: '행 1개 = 기안 1건.' },
        { t: '05_발주품의서 C2에서 품의키 선택 → A2:L 복사 → 아마란스 기안 본문에 붙여넣기' },
        { t: '상신 후 04_품의건목록에 결재문서번호 입력' },
        { t: '[확정처리] 열에 ※미반영이 없는지 확인', h: '아마란스에 올린 뒤 위쪽 [상신 대기]에서 결재문서번호를 넣고 [상신 완료]를 누릅니다.' },
        { t: '발주서 발행 · 업체 송부 후 발주서 폴더 저장', h: '파일명: YYMMDD_업체명_품목 차수.pdf' }
      ]
    },
    {
      id: 's4', title: '디자인 검토 시트 작성', owner: '구매 → 디자인',
      goal: '승인이 완료된 건을 디자인 검토 시트에 올려 검토를 받는다.',
      gate: '디자인 검토가 필요 없는 건은 [해당 없음]으로 건너뛰세요.',
      skippable: true, links: ['design', 'amaranth'],
      items: [
        { t: '아마란스에서 품의 승인 완료 확인' },
        { t: '승인 건을 디자인 검토 시트에 작성', h: '품목 · 차수 · 수량 · 업체 · 입고일정' },
        { t: '데이터 변경 건 표시', h: '단가 변경, 수량 증량, 아웃박스·단상자·라벨 변경, 사양 변경.' },
        { t: '디자인팀 회신(승인 또는 보완) 확인' },
        { t: '변경 반영해 발주서 재발행 · 재송부', o: true, h: '금액이 바뀌면 품의를 재상신합니다.' }
      ]
    },
    {
      id: 's5', title: '발주현황 · 업무한판 업데이트', owner: '구매팀',
      goal: '품의가 완료된 건을 발주현황 탭으로 넘겨 지급일정과 입고일정을 관리할 수 있게 만든다.',
      gate: '완료 품의건이 모두 발주현황에 올라가고 자동화가 오류 없이 돌아야 합니다.',
      skippable: false, links: ['status', 'plan', 'hanpan'],
      items: [
        { t: '품의 완료건을 발주현황 탭에 반영', h: '품의번호 · 마스터코드 · 발주일 · 발주차수' },
        { t: '입고목표 · 입고일정 열 채우기', h: '비어 있으면 자동화가 대체 날짜로 갈음해 집계가 흔들립니다.' },
        { t: '업무한판 시트의 진행 상태 갱신' }
      ]
    },
    {
      id: 's6', title: '지급일정 업데이트', owner: '구매팀',
      goal: '선금·잔금이 지급월에 정확히 떨어지는지 맞춘다.',
      gate: '지급월 금액 대사와 스냅샷 저장까지 끝나야 합니다.',
      skippable: false, links: ['status', 'form'],
      items: [
        { t: '03_지급스케줄에서 선금 · 잔금 2줄 전개 확인' },
        { t: '지급유형별 최종지급일 확인', h: '15일 · 말일 · 지정일 · 선금잔금' },
        { t: '[지급점검] 오른쪽 월 컬럼에 금액 반영 확인', h: "월 라벨은 7월 또는 26'7월 형식이어야 인식됩니다." },
        { t: '매입금액 스냅샷 저장 확인' },
        { t: '재무팀에 지급일정 공유', o: true }
      ]
    },
    {
      id: 's7', title: '재고 입고일정 일치화', owner: '구매팀',
      goal: '발주현황의 입고일정과 재고시트의 입고예정을 같은 날짜로 맞추고 건을 마감한다.',
      gate: '양쪽 입고일정이 모두 일치하면 이 발주건은 마감됩니다.',
      skippable: false, resetOnEta: true, links: ['stock', 'status'],
      items: [
        { t: '발주현황 [입고일정]과 업체 확정 입고예정일 비교' },
        { t: '재고시트의 입고예정 일자 · 수량과 대조' },
        { t: '차이 나는 건 업체에 확인', o: true, h: '지연 건은 사유와 변경 예정일을 받습니다.' },
        { t: '확인된 일자로 양쪽 시트 모두 수정', h: '한쪽만 고치면 다음 갱신에서 다시 어긋납니다.' },
        { t: '입고일정 빈 건이 없는지 최종 확인' }
      ]
    }
  ];
}

/* ============================================================
 * 단계 정의 읽기 / 쓰기
 * ============================================================ */

function readSteps_(mode) {
  var sh = tab_(procTabName_(mode), RB.PROCESS_HEAD);
  if (sh.getLastRow() < 2) return [];
  return stepsFromRows_(sh.getRange(2, 1, sh.getLastRow() - 1, RB.PROCESS_HEAD.length).getValues());
}

/** 프로세스 탭의 행들 → 단계 목록 (읽을 때와 저장 직후에 같은 모양을 쓴다) */
function stepsFromRows_(v) {
  var out = [];
  v.forEach(function (r) {
    if (!r[1]) return;
    var items = [];
    try { items = JSON.parse(r[8] || '[]'); } catch (e) { items = []; }
    // 체크는 항목의 k 로 저장한다. k 가 없는 예전 항목은 순번을 k 로 삼아 기존 체크를 그대로 잇는다.
    items.forEach(function (it, j) { if (it && (it.k === undefined || it.k === '')) it.k = String(j); });
    var links = [];
    try { links = JSON.parse(r[7] || '[]'); } catch (e) { links = String(r[7] || '').split(',').filter(String); }
    out.push({
      order: Number(r[0]) || 0,
      id: String(r[1]),
      title: String(r[2] || ''),
      owner: String(r[3] || ''),
      goal: String(r[4] || ''),
      gate: String(r[5] || ''),
      skippable: r[6] === true || String(r[6]).toUpperCase() === 'TRUE' || String(r[6]) === 'Y',
      resetOnEta: r[9] === true || String(r[9]).toUpperCase() === 'TRUE' || String(r[9]) === 'Y',
      links: links,
      items: items
    });
  });
  out.sort(function (a, b) { return a.order - b.order; });
  return out;
}

function writeSteps_(steps, mode) {
  var sh = tab_(procTabName_(mode), RB.PROCESS_HEAD);
  var rows = stepRows_(steps);
  var oldN = Math.max(sh.getLastRow() - 1, 0);
  // 새 내용을 먼저 덮어쓰고, 줄어든 만큼만 지운다(통째로 지웠다 다시 쓰면 두 번 쓴다)
  if (rows.length) sh.getRange(2, 1, rows.length, RB.PROCESS_HEAD.length).setValues(rows);
  if (oldN > rows.length) sh.getRange(2 + rows.length, 1, oldN - rows.length, RB.PROCESS_HEAD.length).clearContent();
  return rows;
}

function stepRows_(steps) {
  return steps.map(function (s, i) {
    return [
      i + 1,
      s.id,
      s.title || '',
      s.owner || '',
      s.goal || '',
      s.gate || '',
      s.skippable ? 'Y' : 'N',
      JSON.stringify(s.links || []),
      JSON.stringify(s.items || []),
      s.resetOnEta ? 'Y' : 'N'
    ];
  });
}

/* ============================================================
 * 설정
 * ============================================================ */

function readConfig_() {
  var sh = tab_(RB.T_CONFIG, RB.CONFIG_HEAD);
  var map = {};
  if (sh.getLastRow() < 2) return map;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
    if (r[0]) map[String(r[0])] = String(r[1] == null ? '' : r[1]);
  });
  return map;
}

/** 설정 쓰기(잠금을 잡고). 잠금을 이미 쥔 곳(apiSaveConfig 등)은 writeConfigNoLock_ 를 부른다. */
function writeConfig_(patch) {
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  try { writeConfigNoLock_(patch); } finally { lock.releaseLock(); }
}

/** 설정 쓰기 — 있는 열쇠는 값 칸만(붙은 줄끼리 한 번에), 없는 열쇠는 맨 아래에 한 번에 붙인다. 부르는 쪽이 잠금을 쥔다. */
function writeConfigNoLock_(patch) {
  var sh = tab_(RB.T_CONFIG, RB.CONFIG_HEAD);
  var last = Math.max(sh.getLastRow(), 1);
  var keys = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
  var upd = {}, adds = [], addAt = {};
  Object.keys(patch).forEach(function (k) {
    var i = keys.indexOf(k);
    if (i >= 0) upd[i + 2] = patch[k];
    else if (addAt[k] !== undefined) adds[addAt[k]][1] = patch[k];
    else { addAt[k] = adds.length; adds.push([k, patch[k], '']); }
  });
  setColCells_(sh, 2, upd);
  if (adds.length) sh.getRange(sh.getLastRow() + 1, 1, adds.length, 3).setValues(adds);
  // 화면이 쓰는 설정 캐시도 버린다(안 그러면 드롭다운 목록 · 지급 줄 전환 같은 값이 캐시가 끝날 때까지 옛 값)
  cacheDrop_(metaKey_('po'));
  cacheDrop_(metaKey_('sample'));
}

/** 한 열의 여러 칸(cells = { 행: 값 }) — 붙은 행끼리 묶어 한 번에 쓴다(칸마다 setValue 하면 왕복이 칸 수만큼). */
function setColCells_(sh, col, cells) {
  var rs = Object.keys(cells || {}).map(Number).sort(function (a, b) { return a - b; });
  for (var i = 0; i < rs.length;) {
    var j = i;
    while (j + 1 < rs.length && rs[j + 1] === rs[j] + 1) j++;
    var vals = [];
    for (var k = i; k <= j; k++) vals.push([cells[rs[k]]]);
    sh.getRange(rs[i], col, vals.length, 1).setValues(vals);
    i = j + 1;
  }
}

/** 한 행의 여러 칸(cells = { 열(1부터): 값 }) — 붙은 열끼리 묶어 한 번에 쓴다. 사이에 낀 칸(수식 등)은 건드리지 않는다. */
function setRowCells_(sh, row, cells) {
  var cs = Object.keys(cells || {}).map(Number).sort(function (a, b) { return a - b; });
  for (var i = 0; i < cs.length;) {
    var j = i;
    while (j + 1 < cs.length && cs[j + 1] === cs[j] + 1) j++;
    var vals = [];
    for (var k = i; k <= j; k++) vals.push(cells[cs[k]]);
    sh.getRange(row, cs[i], 1, vals.length).setValues([vals]);
    i = j + 1;
  }
}

function linksFromConfig_(cfg) {
  var out = {};
  readLinkDefs_(cfg).forEach(function (d) { out[d.key] = d.url || ''; });
  return out;
}

var RB_LEGACY_LABELS = {
  bom: 'BOM 설정', itemcode: '품목코드 생성', form: '발주품의서 양식',
  amaranth: '아마란스 ERP', status: '발주현황 탭', design: '디자인 검토 시트',
  podir: '발주서 폴더', hanpan: '업무한판 시트', stock: '재고 시트'
};

/**
 * 링크 목록. 관리자가 화면에서 추가 / 이름변경 / 삭제할 수 있다.
 * 설정 탭의 links.json 한 줄에 [{key,label,url}] 로 들어간다.
 * 예전 형식(link.<키> 여러 줄)만 있으면 그걸로 만들어 준다.
 */
function readLinkDefs_(cfg) {
  var raw = cfg['links.json'];
  if (raw) {
    try {
      var a = JSON.parse(raw);
      if (a && a.length) {
        return a.filter(function (d) { return d && d.key; }).map(function (d) {
          return { key: String(d.key), label: String(d.label || d.key), url: String(d.url || '') };
        });
      }
    } catch (e) { /* 아래에서 예전 형식으로 만든다 */ }
  }
  var out = [];
  Object.keys(RB_LEGACY_LABELS).forEach(function (k) {
    out.push({ key: k, label: RB_LEGACY_LABELS[k], url: cfg['link.' + k] || '' });
  });
  return out;
}

/** 관리자: 링크 목록 전체를 저장한다. */
function apiSaveLinks(defs) {
  requireAdmin_();
  if (!defs || !defs.length) throw new Error('링크가 하나도 없습니다.');
  var seen = {};
  var clean = defs.map(function (d) {
    var key = String(d.key || '').trim() || ('lk' + Utilities.getUuid().slice(0, 8));
    key = key.replace(/[^A-Za-z0-9_-]/g, '');
    if (!key) key = 'lk' + Utilities.getUuid().slice(0, 8);
    if (seen[key]) throw new Error('링크 키가 중복됩니다: ' + key);
    seen[key] = 1;
    var label = String(d.label || '').trim();
    if (!label) throw new Error('링크 이름이 비어 있습니다.');
    return { key: key, label: label, url: String(d.url || '').trim() };
  });
  writeConfig_({ 'links.json': JSON.stringify(clean) });     // 잠금은 writeConfig_ 가 잡는다
  cacheDrop_(metaKey_('po'));
  cacheDrop_(metaKey_('sample'));
  return clean;
}

/* ============================================================
 * 권한
 * ============================================================ */

function me_() {
  var e = '';
  try { e = Session.getActiveUser().getEmail() || ''; } catch (err) { e = ''; }
  return e;
}

function owner_() {
  try { return Session.getEffectiveUser().getEmail() || ''; } catch (e) { return ''; }
}

/** 캐시에 담아둔 값만으로 관리자 여부를 판단한다(시트를 열지 않는다). */
function isAdminFast_(adminEmails, ownerEmail) {
  var me = (me_() || '').toLowerCase();
  if (!me) return false;
  if (me === String(ownerEmail || '').toLowerCase()) return true;
  var list = String(adminEmails || '')
    .split(/[,;\s]+/).map(function (s) { return s.trim().toLowerCase(); }).filter(String);
  return list.indexOf(me) > -1;
}

function isAdmin_(cfg) {
  return isAdminFast_((cfg || {})['admin.emails'], owner_());   // 판단은 한 곳(isAdminFast_) — 배포자는 지금 값으로
}

function requireAdmin_() {
  var cfg = readConfig_();
  if (!isAdmin_(cfg)) throw new Error('관리자만 변경할 수 있습니다.');
  return cfg;
}

/**
 * 저장 권한 — 설정 [edit.emails] 에 적힌 사람(쉼표로 구분)과 관리자만 저장할 수 있다.
 * 비워 두면 예전처럼 웹앱에 들어올 수 있는 사람 모두 저장할 수 있다.
 * 웹앱은 배포자 권한으로 시트를 쓰므로, 시트 공유 권한과 상관없이 여기서 막아야 한다.
 */
var RB_EDITOR_OK = false;
function requireEditor_() {
  if (!canEdit_()) throw new Error('저장 권한이 없습니다. 관리자에게 [edit.emails] 등록을 요청해 주세요.');
}

/** [edit.emails] 목록(소문자). 비어 있으면 누구나 저장할 수 있다. */
function editList_(cfg) {
  return String((cfg || {})['edit.emails'] || '')
    .split(/[,;\s]+/).map(function (s) { return s.trim().toLowerCase(); }).filter(String);
}

/** 저장 권한이 있는지(던지지 않는다). 판단은 requireEditor_ 와 같다. 한 번 실행되는 동안 통과하면 다시 보지 않는다. */
function canEdit_() {
  if (RB_EDITOR_OK) return true;
  var mc = cacheGet_(metaKey_('po'));
  var cfg = (mc && mc.cfg) ? mc.cfg : readConfig_();
  if (!editorOk_(cfg, (mc && mc.ownerEmail) || '')) return false;
  RB_EDITOR_OK = true;
  return true;
}

/** 설정 값만으로 저장 권한 판단(시트를 열지 않는다). ownerEmail 이 비면 배포자를 묻는다. */
function editorOk_(cfg, ownerEmail) {
  var list = editList_(cfg);
  if (!list.length) return true;
  var me = (me_() || '').toLowerCase();
  return !!me && (list.indexOf(me) > -1 || isAdminFast_(cfg['admin.emails'], ownerEmail || owner_()));
}

/**
 * 트리거로 불렸는지 확인한다. 이름이 _ 로 끝나지 않는 함수는 브라우저에서 google.script.run 으로도 부를 수 있어,
 * 트리거 함수(AP 다시 쓰기 등)를 아무나 반복 호출하면 잠금을 잡고 남의 저장을 막았다. 트리거가 아니면 관리자만.
 */
function requireTriggerOrAdmin_(e, handler) {
  var uid = (e && e.triggerUid) ? String(e.triggerUid) : '';
  if (uid && ScriptApp.getProjectTriggers().some(function (t) {
    return String(t.getUniqueId()) === uid && t.getHandlerFunction() === handler;
  })) return;
  requireAdmin_();
}

/* ============================================================
 * 발주계획 읽기
 * ============================================================ */

function norm_(s) {
  return String(s == null ? '' : s).replace(/\s+/g, '').replace(/[()]/g, '').toLowerCase();
}

/** 체크박스 칸은 true/false로 읽히므로 빈 값으로 취급한다. */
function str_(v) {
  if (v === true || v === false) return '';
  return String(v == null ? '' : v).trim();
}

/**
 * 발주현황 머리글 행인지 — [품의번호] 와 [발주일] 이 같은 줄에 있으면.
 * withPay 면 [지급점검] 이 있는 줄도 머리글로 본다(지급월 열 머리글).
 * 머리글 찾는 곳이 다섯 군데였는데 조건을 한 곳에서 정한다.
 */
function isStatusHead_(cells, withPay) {
  var j = cells.join('|');
  return (!!withPay && j.indexOf('지급점검') > -1) || (j.indexOf('품의번호') > -1 && j.indexOf('발주일') > -1);
}

/** 위에서부터 읽어 둔 줄들(scan)에서 발주현황 머리글 행 번호(1부터). 없으면 -1 */
function statusHeadIn_(scan, withPay) {
  for (var i = 0; i < scan.length; i++) if (isStatusHead_(scan[i], withPay)) return i + 1;
  return -1;
}

function headerIndex_(headerRow) {
  var idx = {};
  headerRow.forEach(function (h, i) {
    var k = norm_(h);
    if (k && !(k in idx)) idx[k] = i;
  });
  return idx;
}

/** 숫자 칸을 숫자로. 비어 있거나 숫자가 아니면 0. */
function num_(v) {
  if (v === '' || v == null || v === true || v === false) return 0;
  var n = Number(String(v).replace(/[, ]/g, ''));
  return isNaN(n) ? 0 : n;
}


/**
 * 품목명 변형들. 발주계획은 '민감성 7일 체감키트 아웃박스',
 * 발주현황은 '히디프 민감성 7일 체감키트 아웃박스' 처럼 브랜드 접두어가 달라서
 * 붙인 이름 · 뗀 이름을 모두 만들어 양쪽에서 찾는다.
 */
var RB_BRANDS = ['메디테라피', '히디프', '메디', '슈마지', '포쎄라', '링클핏', '멜라쥬란'];

function nameVariants_(name, brand) {
  var n = norm_(name);
  if (!n) return [];
  var out = [n];
  var bs = RB_BRANDS.slice();
  var nb = norm_(brand);
  if (nb && bs.indexOf(nb) < 0) bs.push(nb);
  bs.forEach(function (b) {
    if (!b) return;
    if (n.length > b.length && n.indexOf(b) === 0) out.push(n.slice(b.length));
    out.push(b + n);
  });
  return out.filter(function (x, i, a) { return x && a.indexOf(x) === i; });
}

/** 열 이름 후보 중 처음 찾은 열의 위치. 없으면 -1. */
function colIdx_(idx, names) {
  for (var i = 0; i < names.length; i++) {
    var k = norm_(names[i]);
    if (k in idx) return idx[k];
  }
  return -1;
}

/**
 * 시트 칸을 날짜로.
 * 같은 열인데도 행마다 모양이 제각각이다 — 진짜 날짜, '26. 08. 18', '2026-8-18',
 * '2026년 8월 18일', 서식만 날짜인 일련번호까지 섞여 있다.
 * 하나라도 놓치면 그 행만 칸이 비어 버리므로 넓게 받는다.
 */
function toDate_(v) {
  if (v instanceof Date && !isNaN(v)) return v;
  if (v === '' || v == null) return null;

  // 서식만 날짜인 일련번호 (1899-12-30 기준)
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
  }

  var raw = String(v).trim();
  if (/^\d{4}\.?\s+\d{1,2}\.?\s+\d{1,2}\.?$/.test(raw)) raw = raw.replace(/\.?\s+/g, '.');      // '2026. 10 6' 처럼 띄어 쓴 날짜(손으로 친 값)
  var s = raw.replace(/\s+/g, '').replace(/[년월]/g, '.').replace(/일$/, '');
  if (!s) return null;

  var m = s.match(/^(\d{4}|\d{2})[.\-\/](\d{1,2})[.\-\/](\d{1,2})\.?$/);
  if (!m) return null;

  var y = Number(m[1]);
  if (y < 100) y += 2000;
  var mo = Number(m[2]), dd = Number(m[3]);
  if (mo < 1 || mo > 12 || dd < 1 || dd > 31) return null;

  var d = new Date(y, mo - 1, dd);
  return isNaN(d) ? null : d;
}

/** 날짜로 못 읽으면 시트에 적힌 글자를 그대로 보여준다. 말없이 비우지 않는다. */
function dateOrRaw_(v) {
  var d = toDate_(v);
  if (d) return fmtDate_(d);
  var s = str_(v);
  // 숫자가 하나도 없으면 날짜로 볼 수 없다. 브랜드명 같은 게 날짜 칸에 찍히는 걸 막는다.
  return (s && /[0-9]/.test(s)) ? s.slice(0, 14) : '';
}

/**
 * 발주일처럼 꼭 날짜여야 하는 칸. 날짜로 못 읽으면 빈칸으로 숨기지 않고 '⚠ 적힌글자' 로 보여준다.
 * 발주계획을 붙여넣다 열이 한 칸 밀려 브랜드명('메디')이 발주일에 들어간 행을 화면에서 바로 알아보게.
 */
function dateOrWarn_(v) {
  var d = toDate_(v);
  if (d) {
    // 발주일이 한 달 넘게 미래면 입력 실수다(26 을 28 로 치는 등). 날짜는 보여 주되 경고를 붙인다.
    var limit = new Date();
    limit.setDate(limit.getDate() + 31);
    return (d > limit ? '⚠ ' : '') + fmtDate_(d);
  }
  var s = str_(v);
  if (!s) return '';
  // '9/23' 처럼 연도 없는 날짜 글자는 날짜로 본다
  if (/^\d{1,2}[.\/\-]\d{1,2}$/.test(s)) return s;
  return '⚠ ' + s.slice(0, 14);
}

/* Utilities.formatDate는 호출당 수 ms라 수백 번 부르면 몇 초가 된다. 직접 만든다. */
function pad2_(n) { return n < 10 ? '0' + n : String(n); }

function fmtDate_(d) {
  if (!d) return '';
  return String(d.getFullYear()).slice(-2) + '/' + pad2_(d.getMonth() + 1) + '/' + pad2_(d.getDate());
}

/**
 * 건ID. 예전에는 MD5를 썼는데 Utilities.computeDigest가 건당 10ms대라
 * 231건에 3초가 넘게 걸렸다. 해시 없이 값을 이어 붙여 쓴다.
 */
/**
 * 제품입고일 칸을 회차 단위로 쪼갠다.
 * 괄호로 묶인 날짜들은 그 회차 수량 하나의 내역이라 통째로 한 칸이다.
 *   '(6/17,6/19,6/30),7/2,7/3' -> ['(6/17,6/19,6/30)', '7/2', '7/3']
 */
function splitArrived_(text) {
  var s = String(text == null ? '' : text).trim();
  if (!s) return [];
  var out = [], buf = '', depth = 0;
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { out.push(buf.trim()); buf = ''; continue; }
    buf += ch;
  }
  out.push(buf.trim());
  return out.filter(function (x) { return x !== ''; });
}

/* ============================================================
 * 샘플 = 품목 하나가 프로젝트 하나.
 * 한 프로젝트에 업체를 여럿 두고 소싱한다. 업체마다 샘플·견적이 따로 오간다.
 *   프로젝트 ─ 업체 ─ 회차(시트 한 줄)
 * 추가 요청은 줄을 새로 붙이고, 같은 업체의 직전 회차만 닫는다.
 * ============================================================ */

/** 샘플 시트의 머리글 위치와 열 번호. 없는 열은 만들어 붙인다. */
function sampleCols_(sh, makeCols) {
  var lastRow = sh.getLastRow();
  var lc = Math.max(1, sh.getLastColumn());          // 머리글은 시트 끝 열까지(예전엔 22열까지만 봐서 그 뒤에 붙은 샘플ID · 상태 열을 못 찾고 또 붙였다)
  var scanN = Math.min(20, Math.max(1, lastRow));
  var scan = sh.getRange(1, 1, scanN, lc).getValues();

  var hr = -1;
  for (var i = 0; i < scan.length; i++) {
    var j = scan[i].join('|');
    if (j.indexOf('품목명') > -1 && j.indexOf('담당자') > -1) { hr = i + 1; break; }
  }
  if (hr < 0) hr = 1;

  var head = scan[hr - 1];
  var idx = headerIndex_(head);

  var last = 0;
  for (var c = 0; c < head.length; c++) if (str_(head[c])) last = c;

  var ensure = function (names, label) {
    var k = colIdx_(idx, names);
    if (k >= 0 || !makeCols) return k;
    last += 1;
    sh.getRange(hr, last + 1).setValue(label);
    idx[norm_(label)] = last;
    lc = Math.max(lc, last + 1);
    return last;
  };

  var cQuote = ensure(['견적수신일', '견적수신', '견적일'], '견적수신일');
  var cStatus = ensure(['상태', '진행상태'], '상태');
  var cLink = ensure(['링크', '관련링크', '관련 링크'], '링크');
  var cSid = ensure(['샘플ID'], '샘플ID');
  var cPid = ensure(['프로젝트ID'], '프로젝트ID');  // 프로젝트 고유 ID — 이름 · 품목코드를 고쳐도 같은 프로젝트(진행 기록 건ID = 'p:' + 이것)         // 회차(줄)마다 고유 ID — 정렬 · 줄 삭제 뒤에도 그 회차를 찾는다(발주의 실행판ID 처럼)

  return {
    hr: hr, lc: lc, head: head, idx: idx,
    K: {
      owner: colIdx_(idx, ['담당자']),
      reqAt: colIdx_(idx, ['요청일']),
      brand: colIdx_(idx, ['브랜드']),
      code: colIdx_(idx, ['품목코드']),
      name: colIdx_(idx, ['품목명']),
      make: colIdx_(idx, ['구성']),
      spec: colIdx_(idx, ['사양']),
      kind: colIdx_(idx, ['구분']),
      vendor: colIdx_(idx, ['업체명']),
      qty: colIdx_(idx, ['수량']),
      planAt: colIdx_(idx, ['전달예정일']),
      doneAt: colIdx_(idx, ['전달일']),
      quoteAt: cQuote,
      note: colIdx_(idx, ['비고/피드백', '비고']),
      status: cStatus,
      link: cLink,
      sid: cSid,
      pid: cPid
    }
  };
}

/** 시트 한 줄의 프로젝트 열쇠: 프로젝트ID 가 있으면 그것(이름 · 코드가 바뀌어도 그대로), 없으면 예전처럼 코드/이름 */
function sampleRowKey_(r, K) {
  var p = K.pid >= 0 ? str_(r[K.pid]) : '';
  return p || sampleKey_(K.code >= 0 ? str_(r[K.code]) : '', str_(r[K.name]));
}
/** 예전 열쇠(프로젝트ID 가 없던 때) — 같은 품목끼리 묶는다. 품목코드가 있으면 그걸, 없으면 품목명으로. */
function sampleKey_(code, name) {
  var c = norm_(code);
  return c ? c : ('n:' + norm_(name));
}

/** 칸들에서 링크(http/https 주소)를 뽑는다 — 링크 칸 말고도 비고 · 견적수신일 칸에 슬랙 주소를 붙여 둔 줄이 있다 */
function sampleLinks_(cells) {
  var out = [];
  cells.forEach(function (v) {
    (String(v == null ? '' : v).match(/https?:\/\/[^\s,]+/g) || []).forEach(function (u) { if (out.indexOf(u) < 0) out.push(u); });
  });
  return out.slice(0, 12);
}

/** 회차 상태. 시트에 적힌 게 없으면 샘플을 받았는지로 본다. */
function sampleStatus_(raw, doneAt) {
  var s = str_(raw);
  if (s) return s;
  return doneAt ? '수신' : '진행중';
}

var RB_SAMPLE_STATUS = ['진행중', '수신', '채택', '탈락', '드롭'];

/** 새 샘플ID(S + 8자리) */
function newSampleId_(seen) {
  var s;
  do { s = 'S' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase(); } while (seen && seen[s]);
  if (seen) seen[s] = 1;
  return s;
}
function newSampleProjId_(seen) {
  var s;
  do { s = 'P' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase(); } while (seen && seen[s]);
  if (seen) seen[s] = 1;
  return s;
}
/**
 * 샘플ID(회차) · 프로젝트ID 를 채운다. 읽을 때마다 몇 열만 보고, 고칠 게 있을 때만 잠금을 잡는다(못 잡으면 다음에).
 *  · 샘플ID: 없거나 겹친 줄(복사해 붙인 줄)에 새로.
 *  · 프로젝트ID: 없는 줄은 같은 품목코드/이름의 프로젝트ID 를 이어받고, 그런 프로젝트가 없으면 새로 만든다.
 *    새로 만든 프로젝트의 진행 기록(예전 건ID 'p:코드' · 'p:n:이름')은 'p:프로젝트ID' 로 옮긴다 — 메모 · 드롭 기록이 그대로 이어진다.
 */
function sampleIdsEnsure_(sh) {
  var C = sampleCols_(sh, false), K = C.K, last = sh.getLastRow();
  if (last <= C.hr || K.name < 0) return;
  var n = last - C.hr, i;
  var col = function (c) { return c >= 0 ? sh.getRange(C.hr + 1, c + 1, n, 1).getValues() : null; };
  var gapCk = 'sgap:v1:' + last, gap = false;
  if (K.sid >= 0 && K.pid >= 0) {
    var nm0 = col(K.name), sd0 = col(K.sid), pd0 = col(K.pid), seen0 = {}, need = false, lastNamed = -1;
    for (i = 0; i < n; i++) if (str_(nm0[i][0])) lastNamed = i;
    for (i = 0; i <= lastNamed; i++) {
      if (!str_(nm0[i][0])) { gap = true; continue; }          // 중간 빈 줄(품목명 없음)
      var s0 = str_(sd0[i][0]);
      if (!s0 || seen0[s0] || !str_(pd0[i][0])) need = true; else seen0[s0] = 1;
    }
    if (gap) { try { if (CacheService.getScriptCache().get(gapCk)) gap = false; } catch (eG) { /* 넘어간다 */ } }   // 이미 정리해 봤는데 남은 줄(빈 줄이 아님)
    if (!need && !gap) return;
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return;
  var moved = 0;
  try {
    C = sampleCols_(sh, true); K = C.K; last = sh.getLastRow(); n = last - C.hr;
    if (n < 1) return;
    var names = col(K.name), codes = col(K.code), sids = col(K.sid), pids = col(K.pid);
    // 샘플ID
    var seen = {}, outS = [], chS = 0;
    for (i = 0; i < n; i++) {
      var s = str_(sids[i][0]);
      if (str_(names[i][0]) && (!s || seen[s])) { s = newSampleId_(seen); chS++; }
      else if (s) seen[s] = 1;
      outS.push([s]);
    }
    // 프로젝트ID — 예전 열쇠(코드/이름)별로 이미 쓰인 ID 를 모은다
    var oldKey = function (k) { return sampleKey_(codes ? str_(codes[k][0]) : '', str_(names[k][0])); };
    var byOld = {}, pseen = {};
    for (i = 0; i < n; i++) {
      var p0 = str_(pids[i][0]);
      if (!p0) continue;
      pseen[p0] = 1;
      if (str_(names[i][0]) && !byOld[oldKey(i)]) byOld[oldKey(i)] = p0;
    }
    var outP = [], chP = 0, fresh = {};            // fresh: 새로 만든 프로젝트ID → 예전 열쇠(진행 기록 옮기기)
    for (i = 0; i < n; i++) {
      var p = str_(pids[i][0]);
      if (str_(names[i][0]) && !p) {
        var ok = oldKey(i);
        p = byOld[ok];
        if (!p) { p = newSampleProjId_(pseen); byOld[ok] = p; fresh[p] = ok; }
        chP++;
      }
      outP.push([p]);
    }
    if (chS) { var rs = sh.getRange(C.hr + 1, K.sid + 1, n, 1); rs.setNumberFormat('@'); rs.setValues(outS); }
    if (chP) { var rp = sh.getRange(C.hr + 1, K.pid + 1, n, 1); rp.setNumberFormat('@'); rp.setValues(outP); }
    // 진행 기록 건ID 옮기기(예전 'p:' + 코드/이름 → 'p:' + 프로젝트ID)
    var fk = Object.keys(fresh);
    if (fk.length) {
      try { drainJournal_(); } catch (eJ) { /* 다음에 */ }
      var pr = readProgress_('sample'), want = {}, changed = {};
      fk.forEach(function (pid) { want['p:' + fresh[pid]] = 'p:' + pid; });
      Object.keys(pr.map).forEach(function (id) {
        if (!want[id] || pr.map[want[id]]) return;    // 이미 새 ID 기록이 있으면 건드리지 않는다
        var rec = pr.map[id], raw = pr.raw[rec.row - 2].slice();
        raw[0] = want[id];
        changed[rec.row] = raw;
        moved++;
      });
      if (moved) writeProgRows_(pr, changed);
    }
    if (chS || chP) SpreadsheetApp.flush();
    // 중간에 완전히 빈 줄(내용만 지운 줄 · 시트에서 비워 둔 줄)은 지워 위로 붙인다 — 새 줄을 붙일 때만 하던 정리를 읽을 때도
    var gone = 0;
    try { gone = sampleCompact_(sh, C, sh.getLastRow() + 1); } catch (eC) { gone = 0; }
    if (gone) dropSampleCache_();
    try { CacheService.getScriptCache().put('sgap:v1:' + sh.getLastRow(), '1', 21600); } catch (eP) { /* 넘어간다 */ }
  } finally {
    lock.releaseLock();
  }
  if (moved) { cacheDrop_('prog:v2:sample'); cacheDrop_(progHintKey_('sample')); try { bumpVer_('p'); } catch (eV) { /* 넘어간다 */ } }
}

function readSampleRows_(cfg) {
  var sh = sheet_(RB.SAMPLE_TAB);
  if (!sh) throw new Error('"' + RB.SAMPLE_TAB + '" 탭을 찾을 수 없습니다.');
  try { sampleIdsEnsure_(sh); } catch (eId) { /* ID 는 다음에 — 화면은 띄운다 */ }
  try { sampleProgMergeSplits_(); } catch (eMg) { /* 다음에 */ }

  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  var C = sampleCols_(sh, false);
  var K = C.K;
  var lc = C.lc;
  [K.quoteAt, K.status, K.link, K.sid, K.pid].forEach(function (c) { if (c >= 0) lc = Math.max(lc, c + 1); });

  var startRow = Math.max(C.hr + 1, lastRow - RB.SAMPLE_SCAN_ROWS + 1);
  var n = lastRow - startRow + 1;
  if (n < 1) return [];
  var v = sh.getRange(startRow, 1, n, lc).getValues();

  var byKey = {}, order = [];
  for (var i = 0; i < n; i++) {
    var r = v[i];
    var name = str_(r[K.name]);
    if (!name) continue;

    var key = sampleRowKey_(r, K);
    if (!byKey[key]) { byKey[key] = []; order.push(key); }

    var req = toDate_(r[K.reqAt]);
    var doneAt = K.doneAt >= 0 ? dateOrRaw_(r[K.doneAt]) : '';
    byKey[key].push({
      row: startRow + i,
      sid: K.sid >= 0 ? str_(r[K.sid]) : '',
      vendor: str_(r[K.vendor]) || '업체 미정',
      reqAt: req ? fmtDate_(req) : str_(r[K.reqAt]).slice(0, 12),
      reqMs: req ? req.getTime() : 0,
      planAt: K.planAt >= 0 ? dateOrRaw_(r[K.planAt]) : '',
      doneAt: doneAt,
      quoteAt: K.quoteAt >= 0 ? dateOrRaw_(r[K.quoteAt]) : '',
      qty: str_(r[K.qty]),
      make: str_(r[K.make]),
      spec: str_(r[K.spec]),
      kind: str_(r[K.kind]),
      owner: str_(r[K.owner]),
      note: str_(r[K.note]),                         // 자르지 않는다 — 고치기 창이 잘린 값으로 시트를 덮으면 뒤가 사라졌다
      status: sampleStatus_(K.status >= 0 ? r[K.status] : '', doneAt),
      link: K.link >= 0 ? str_(r[K.link]) : '',
      links: sampleLinks_([K.link, K.note, K.quoteAt, K.planAt, K.doneAt, K.spec, K.make].map(function (c) { return c >= 0 ? r[c] : ''; })),
      name: name,
      code: str_(r[K.code]),
      brand: str_(r[K.brand])
    });
  }

  var rows = [];
  order.forEach(function (key) {
    var all = byKey[key];

    var newest = 0, lastReq = all[0];
    all.forEach(function (q) { if (q.reqMs >= newest) { newest = q.reqMs; lastReq = q; } });

    // 업체별로 묶는다. 시트 순서를 지켜 회차가 된다.
    var vmap = {}, vorder = [];
    all.forEach(function (q) {
      var vk = norm_(q.vendor);
      if (!vmap[vk]) { vmap[vk] = { name: q.vendor, reqs: [] }; vorder.push(vk); }
      vmap[vk].reqs.push(q);
    });

    var vendors = vorder.map(function (vk) {
      var g = vmap[vk];
      var lastQ = g.reqs[g.reqs.length - 1];
      return {
        name: g.name,
        owner: lastQ.owner || '',            // 업체마다 담당자가 다를 수 있다(그 업체 마지막 회차 줄의 담당자)
        reqs: g.reqs,
        n: g.reqs.length,
        lastRow: lastQ.row,
        status: sampleVendorStatus_(g.reqs),
        reqAt: lastQ.reqAt,
        planAt: lastQ.planAt,
        doneAt: lastQ.doneAt,
        quoteAt: lastQ.quoteAt,
        qty: lastQ.qty
      };
    });

    var live = vendors.filter(function (x) { return x.status !== '드롭' && x.status !== '탈락'; });
    var picked = vendors.filter(function (x) { return x.status === '채택'; })[0];
    // 프로젝트 담당자 = 진행 중인 업체 담당자들(없으면 모든 업체 담당자). 한 프로젝트에 여럿일 수 있다
    var owners = [];
    (live.length ? live : vendors).forEach(function (x) { if (x.owner && owners.indexOf(x.owner) < 0) owners.push(x.owner); });

    var plinks = [];
    all.forEach(function (q) { q.links.forEach(function (u) { if (plinks.indexOf(u) < 0) plinks.push(u); }); });
    rows.push({
      id: 'p:' + key,
      links: plinks,
      projKey: key,
      row: lastReq.row,
      statusRow: lastReq.row,
      name: lastReq.name,
      code: lastReq.code,
      brand: lastReq.brand,
      owner: owners[0] || lastReq.owner || '미지정',
      owners: owners.length ? owners : ['미지정'],
      vendor: picked ? picked.name : (vendors.length > 1 ? vendors.length + '개 업체' : lastReq.vendor),
      kind: lastReq.kind,
      make: lastReq.make,
      spec: lastReq.spec,
      qty: lastReq.qty,
      batch: vendors.length > 1 ? vendors.length + '사' : '',
      doc: '', channel: '',
      reqAt: lastReq.reqAt,
      planAt: lastReq.planAt,
      doneAt: lastReq.doneAt,
      quoteAt: lastReq.quoteAt,
      note: lastReq.note,
      madeAt: lastReq.reqAt,
      vendors: vendors,
      vendorN: vendors.length,
      reqN: all.length,
      liveN: live.length,
      picked: picked ? picked.name : '',
      status: picked ? '채택 ' + picked.name : (live.length ? '진행중' : '종료'),
      closed: !live.length
    });
  });

  rows.sort(function (a, b) {
    var x = 0, y = 0;
    a.vendors.forEach(function (g) { g.reqs.forEach(function (q) { if (q.reqMs > x) x = q.reqMs; }); });
    b.vendors.forEach(function (g) { g.reqs.forEach(function (q) { if (q.reqMs > y) y = q.reqMs; }); });
    return y - x;
  });
  return rows.slice(0, 400);
}

/** 회차 상태를 바꾼다. */
/**
 * 화면: 샘플 업체 카드에 진행상황 한 줄 쌓기(시간순 타임라인). 진행 기록(_실행판_진행 샘플)의 notes['tl:업체'] 에 JSON 배열로.
 * entry: { text, due(기한 yyyy-mm-dd), st(상태를 바꿨으면) } · del: 지울 번호(그 업체 기록 안의 순서)
 */
/** 화면: 샘플 프로젝트 완료 · 완료 취소 — 진행 기록 checks._done(날짜). 완료한 건은 목록 기본(진행 중)에서 빠진다 */
function apiSampleDone(id, meta, on, kind) {
  var res = editProgress_(id, meta, 'sample', function (st) {
    if (on) st.checks._done = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    else delete st.checks._done;
    if (on && kind === 'drop') st.checks._drop = 1; else delete st.checks._drop;      // 프로젝트 드롭 = 완료 + 드롭 표시
  });
  return { checks: res.state.checks };
}
function apiSampleLog(id, meta, vkey, entry, del, sheetRow, projKey, editIdx, editOrig, rowSid) {
  var k = 'tl:' + str_(vkey).slice(0, 60);
  if (k === 'tl:') throw new Error('업체가 비었습니다.');
  var e = entry ? { at: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'), text: str_(entry.text).slice(0, 500),
    due: /^\d{4}-\d{2}-\d{2}$/.test(str_(entry.due)) ? str_(entry.due) : '', st: str_(entry.st).slice(0, 10), who: me_().split('@')[0] } : null;
  if (e && str_(entry.rk)) e.rk = str_(entry.rk).slice(0, 60);          // 어느 회차 메모인지(구성#차수)
  if (e && !e.text && !e.st && !e.due) throw new Error('적을 내용이 없습니다.');
  var dueSync = '';
  var res = editProgress_(id, meta, 'sample', function (st) {
    st.notes = st.notes || {};
    var list = [];
    try { list = JSON.parse(st.notes[k] || '[]'); } catch (x) { list = []; }
    if (e && editIdx != null) {                                  // 고치기: 적은 날 · 적은 사람은 두고 내용 · 기한 · 상태만
      // 번호만 믿지 않는다 — 그사이 누가 지웠으면 번호가 밀려 다른 기록을 고쳤다. 적은 날 + 원래 내용으로 다시 찾는다
      var ix = Number(editIdx), o = list[ix];
      var same = function (x) { return x && (editOrig == null || (String(x.at) === String(editOrig.at) && String(x.text || '') === String(editOrig.text || ''))); };
      if (!same(o)) { o = null; for (var q = 0; q < list.length; q++) if (same(list[q])) { o = list[q]; break; } }
      if (!o) throw new Error('그 기록이 바뀌었거나 지워졌습니다. 새로고침 후 다시 해 주세요.');
      o.text = e.text; o.due = e.due; o.st = e.st; o.edited = e.at + ' ' + e.who;
      var lastDue = null; list.forEach(function (x) { if (x.due && String(x.rk || '') === String(o.rk || '')) lastDue = x; });   // 같은 회차 메모 중 마지막 기한
      dueSync = lastDue === o ? o.due : '';                        // 고친 기록이 마지막 기한일 때만 시트 전달예정일도
    } else if (e) { list.push(e); dueSync = e.due; }
    else if (del != null) {                                       // 지우기: 번호 + (주면) 적은 날 · 내용으로 확인 — 그사이 밀렸으면 내용으로 다시 찾는다
      var di = Number(del), dOk = function (x) { return x && (editOrig == null || (String(x.at) === String(editOrig.at) && String(x.text || '') === String(editOrig.text || ''))); };
      if (!dOk(list[di])) { di = -1; for (var q2 = 0; q2 < list.length; q2++) if (dOk(list[q2])) { di = q2; break; } }
      if (di > -1) {
        // 지운 기록이 그 회차의 마지막 기한이었으면 시트 전달예정일을 남은 기록 중 마지막 기한으로 되돌린다(남은 기한이 없으면 시트는 그대로)
        var dx = list[di], dLast = null, dRk = String(dx.rk || '');
        list.forEach(function (x) { if (x.due && String(x.rk || '') === dRk) dLast = x; });
        list.splice(di, 1);
        if (dx.due && dLast === dx) { var dPrev = null; list.forEach(function (x) { if (x.due && String(x.rk || '') === dRk) dPrev = x; }); dueSync = dPrev ? dPrev.due : ''; }
      }
    }
    if (list.length) st.notes[k] = JSON.stringify(list.slice(-200)); else delete st.notes[k];
  });
  // 진행 메모는 _실행판_샘플 시트 그 업체 마지막 회차 [비고/피드백]에도 덧붙인다(지우기는 시트에서 직접)
  var sheetErr = e && sheetRow && editIdx == null ? sampleNoteToSheet_(sheetRow, projKey, e, { v: vkey, sid: rowSid }) : '';
  // 기한을 적으면(새 기록 · 마지막 기한 고침) 그 업체 마지막 회차 [전달예정일]도 그 날짜로 — 예전 기한 대신 마지막 기한이 보이게
  if (dueSync && sheetRow) { var dErr = sampleDueToSheet_(sheetRow, projKey, dueSync, { v: vkey, sid: rowSid }); if (dErr) sheetErr = (sheetErr ? sheetErr + ' · ' : '') + dErr; }
  return { notes: res.state.notes, sheetErr: sheetErr };
}
function apiSampleStatus(sheetRow, status, projKey, exp) {
  requireEditor_();
  var row = Number(sheetRow) || 0;
  if (row < 2) throw new Error('시트 행을 찾을 수 없습니다.');
  var st = String(status || '').trim();
  if (RB_SAMPLE_STATUS.indexOf(st) < 0) throw new Error('알 수 없는 상태입니다: ' + st);

  var sh = sheet_(RB.SAMPLE_TAB);
  if (!sh) throw new Error('_실행판_샘플 탭을 찾을 수 없습니다.');

  var lock = LockService.getScriptLock();
  waitLock_(lock);
  try {
    var C = sampleCols_(sh, true);             // 없는 열 머리글을 쓸 수 있어 잠금 안에서(동시에 두 번 붙이지 않게)
    row = checkSampleRow_(sh, C.K, row, projKey, exp);
    var cell = sh.getRange(row, C.K.status + 1);
    var before = cell.getValue();
    // 화면이 본 상태(exp.oldSt)와 지금 시트 상태가 다르면 그사이 다른 사람이 바꾼 것 — 덮지 않고 알린다(빈칸 = 예전 줄은 넘어간다)
    if (exp && exp.oldSt != null && str_(before) && str_(before) !== str_(exp.oldSt) && str_(before) !== st) {
      throw new Error('그사이 다른 사람이 상태를 [' + str_(before) + '](으)로 바꿨습니다. 덮어쓰지 않았습니다 — 새로고침 후 다시 해 주세요.');
    }
    cell.setValue(st);
    writeAudit_(RB.SAMPLE_TAB, row, C.K.status + 1, '샘플 상태', before, st);
  } finally {
    lock.releaseLock();
  }

  dropSampleCache_();
  return { ok: true, row: row, status: st };
}

/**
 * 요청 추가 — 시트에 줄을 새로 붙인다.
 * closeRow 가 있으면 그 줄만 닫는다(같은 업체의 직전 회차).
 * 다른 업체를 새로 붙일 때는 closeRow 를 비워 두면 기존 업체는 그대로 굴러간다.
 */
function apiSampleAdd(srcRow, closeRow, patch) {
  requireEditor_();
  var sr = Number(srcRow) || 0;
  var cr = Number(closeRow) || 0;
  var p = patch || {};
  if (!str_(p.planAt)) throw new Error('전달예정일을 넣어 주세요(필수).');
  sampleListCheck_(p);

  var sh = sheet_(RB.SAMPLE_TAB);
  if (!sh) throw new Error('_실행판_샘플 탭을 찾을 수 없습니다.');

  // 날짜는 글자가 아니라 날짜 값으로 넣는다. 'YY/MM/DD' 글자는 시트가 제멋대로 해석한다.
  // '2026/10/28' · '20261028' 도 날짜로(예전엔 yyyy-mm-dd 만 받아 전달예정일이 빈칸으로 들어갔다)
  var stamp = function (v, dflt) {
    var t = String(v || '').trim();
    if (/^\d{8}$/.test(t)) t = t.slice(0, 4) + '-' + t.slice(4, 6) + '-' + t.slice(6);
    var m = t.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return dflt === undefined ? '' : dflt;
  };
  var today = new Date();
  today = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var out, reMeta = null;
  try {
    var C = sampleCols_(sh, true);             // 없는 열 머리글을 쓸 수 있어 잠금 안에서
    var K = C.K;
    var width = C.lc;
    [K.quoteAt, K.status, K.link].forEach(function (c) { if (c >= 0) width = Math.max(width, c + 1); });
    // 줄이 밀렸으면 옮겨 간 행으로 — 확인만 하고 원래 행을 쓰면 다른 프로젝트 줄의 품목 · 프로젝트ID 를 이어받거나 엉뚱한 회차를 닫았다
    if (sr >= 2) sr = checkSampleRow_(sh, K, sr, p.projKey, p.srcExp);
    if (cr >= 2) cr = checkSampleRow_(sh, K, cr, p.projKey, p.closeExp);
    var src = (sr >= 2) ? sh.getRange(sr, 1, 1, width).getValues()[0] : [];
    var line = [];
    for (var i = 0; i < width; i++) line.push('');

    // 이어받는 글자(품목코드 '02035' 같은)는 글자 그대로 — 숫자로 바뀌면 프로젝트 열쇠가 달라져 따로 갈라진다
    var carry = function (c) { if (c >= 0 && src.length) line[c] = (typeof src[c] === 'string') ? asText_(src[c]) : src[c]; };
    var put = function (c, v) { if (c >= 0) line[c] = v; };

    // 프로젝트 정보는 그대로 이어받는다
    carry(K.brand); carry(K.code); carry(K.name); carry(K.kind); carry(K.pid);      // 프로젝트ID 도 이어받는다(같은 프로젝트)
    if (str_(p.kind)) put(K.kind, asText_(str_(p.kind)));     // 구분(제안용 · 디자인샘플 · CT용 …)은 화면에서 고른 값이 먼저

    put(K.owner, asText_(str_(p.owner) || (src.length && K.owner >= 0 ? str_(src[K.owner]) : '')));
    put(K.vendor, asText_(str_(p.vendor) || (src.length && K.vendor >= 0 ? str_(src[K.vendor]) : '')));
    // 적어 넣는 글은 시트가 날짜 · 숫자로 바꾸지 않게 글자 그대로 넣는다('9/30 재요청' 같은 메모)
    put(K.make, asText_(str_(p.make)));
    put(K.spec, asText_(str_(p.spec)));
    put(K.qty, cellValue_(p.qty));
    put(K.reqAt, stamp(p.reqAt, today));
    put(K.planAt, stamp(p.planAt));
    if (K.planAt >= 0 && !line[K.planAt]) throw new Error('전달예정일 "' + str_(p.planAt) + '" 을(를) 날짜로 읽지 못했습니다(예: 2026-10-28).');
    put(K.doneAt, '');
    put(K.quoteAt, '');
    put(K.note, asText_(String(p.note || '').slice(0, 45000)));          // 새 샘플 · 줄 고치기와 같은 한도(예전엔 300자에서 잘렸다)
    put(K.status, '진행중');
    if (str_(p.link)) put(K.link, asText_(str_(p.link).slice(0, 1000)));
    put(K.sid, newSampleId_());

    var newRow = sh.getLastRow() + 1;
    ensureRows_(sh, newRow);
    sh.getRange(newRow, 1, 1, width).setValues([line]);
    writeAudit_(RB.SAMPLE_TAB, newRow, 1, '샘플 요청 추가',
      '', str_(line[K.name]) + ' / ' + str_(line[K.vendor]) + ' / ' + showVal_(line[K.reqAt]));

    var closed = '';
    if (cr >= 2 && K.status >= 0) {
      var pc = sh.getRange(cr, K.status + 1);
      var was = str_(pc.getValue());
      if (was !== '드롭' && was !== '탈락' && was !== '채택') {
        pc.setValue('수신');
        closed = '수신';
        writeAudit_(RB.SAMPLE_TAB, cr, K.status + 1, '샘플 상태(추가 요청으로 닫음)', was, '수신');
      }
    }
    newRow -= sampleCompact_(sh, C, newRow);         // 중간에 비어 있는 줄은 없애 위로 붙인다
    out = { ok: true, row: newRow, closeRow: cr, closedStatus: closed };
    out.projKey = sampleRowKey_(line, K);
    reMeta = { id: 'p:' + out.projKey, name: str_(line[K.name]), brand: K.brand >= 0 ? str_(line[K.brand]) : '', code: K.code >= 0 ? str_(line[K.code]) : '', owner: str_(line[K.owner]) };
  } finally {
    lock.releaseLock();
  }
  // 완료 · 드롭한 프로젝트에 회차를 붙이면 그 프로젝트를 다시 연다(새 샘플 등록과 같게) — 안 그러면 새 회차가 진행 중 목록 · 기한 알림에서 빠졌다
  try {
    var rid = sampleProgIdFix_(reMeta.id, 'sample'), pr = readProgressOne_('sample', rid), rec = findProg_(pr, rid);
    if (rec && rec.checks && rec.checks._done) {
      editProgress_(reMeta.id, Object.assign({}, reMeta, p.meta || {}, { id: reMeta.id }), 'sample', function (st) {
        st.checks = st.checks || {};
        if (st.checks._done) { out.reopened = st.checks._drop ? '드롭' : '완료'; delete st.checks._done; delete st.checks._drop; }
      });
    }
  } catch (eR) { /* 넘어간다 */ }

  dropSampleCache_();
  return out;
}

/** 프로젝트명(품목명)을 그 프로젝트의 모든 줄에 한꺼번에 바꾼다. */
function apiSampleRename(projKey, name) {
  requireEditor_();
  var nm = String(name || '').trim();
  if (!nm) throw new Error('바꿀 이름을 넣어주세요.');

  var sh = sheet_(RB.SAMPLE_TAB);
  if (!sh) throw new Error('_실행판_샘플 탭을 찾을 수 없습니다.');
  var C = sampleCols_(sh, false);
  var K = C.K;

  var lastRow = sh.getLastRow();
  var n = lastRow - C.hr;
  if (n < 1) return { n: 0 };

  // 품목코드가 없는 프로젝트는 이름이 곧 열쇠다. 이름을 바꾸면 열쇠도 바뀐다.
  var newKey = String(projKey || '').indexOf('n:') === 0 ? sampleKey_('', nm) : projKey;

  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var hits = [];
  try {
    n = sh.getLastRow() - C.hr;                                  // 잠금 안에서 다시 — 그사이 붙은 회차 줄도 같이 바꾼다
    var vals = sh.getRange(C.hr + 1, 1, n, C.lc).getValues();
    for (var i = 0; i < n; i++) {
      var nm0 = str_(vals[i][K.name]);
      if (!nm0) continue;
      var key0 = sampleRowKey_(vals[i], K);
      if (key0 === projKey) hits.push(C.hr + 1 + i);
      else if (newKey !== projKey && key0 === newKey) {
        throw new Error('[' + nm + '] 이름의 프로젝트가 이미 있습니다. 합치려면 시트에서 직접 정리해 주세요.');
      }
    }
    if (!hits.length) return { n: 0 };

    // 칸마다 쓰기 · 이력(이력마다 반영 · 변경 번호)을 하지 않고, 쓰기는 한 번(RangeList) · 이력도 한 번에
    var colL = colLetterRB_(K.name + 1);
    sh.getRangeList(hits.map(function (r) { return colL + r; })).setValue(asText_(nm));
    writeAudits_(hits.map(function (r) {
      return { tab: RB.SAMPLE_TAB, row: r, col: K.name + 1, what: '프로젝트명', before: vals[r - C.hr - 1][K.name], after: nm };
    }));

    // 진행 기록(체크 · 메모)의 건ID 도 새 열쇠로 옮긴다. 안 옮기면 이름을 바꾸는 순간 기록이 끊겼다.
    // 열쇠가 그대로(프로젝트ID 있는 건)여도 진행 기록의 품목명은 새 이름으로 — 주간 보고가 메모를 이어 붙인다
    try { drainJournal_(); } catch (eJ) { /* 다음에 */ }
    var p = readProgress_('sample');
    var changed = {};
    Object.keys(p.map).forEach(function (id) {
      var rec = p.map[id];
      if (id !== 'p:' + projKey) return;
      var raw = p.raw[rec.row - 2].slice();
      if (newKey === projKey && str_(raw[2]) === nm) return;
      raw[0] = 'p:' + newKey;
      raw[2] = nm;
      changed[rec.row] = raw;
    });
    if (Object.keys(changed).length) writeProgRows_(p, changed);
  } finally {
    lock.releaseLock();
  }

  dropSampleCache_();
  cacheDrop_('prog:v2:sample');
  return { n: hits.length, name: nm, projKey: newKey, id: 'p:' + newKey };
}

/**
 * 샘플 시트 행이 화면이 보고 있는 프로젝트의 행인지 확인한다(잠금 안에서 부른다).
 * 화면이 기억한 행 번호는 누가 시트를 정렬하거나 행을 넣으면 다른 샘플을 가리킨다.
 * projKey 를 보내지 않는 예전 화면은 확인 없이 둔다.
 */
/**
 * 화면이 보낸 행 번호가 아직 그 줄인지 확인한다. 같은 프로젝트에 업체 · 회차 줄이 여럿이라 프로젝트만 보면
 * 정렬 · 줄 삭제 뒤 옆 회차에 써 버린다 — exp(화면이 본 { v: 업체, d: 요청일 })가 오면 그것까지 맞춰 본다.
 */
function checkSampleRow_(sh, K, row, projKey, exp) {
  // 그 회차 줄을 찾아 행 번호를 돌려준다(정렬 · 줄 삭제 · 줄 추가로 행이 밀렸어도 따라간다). 멈추는 건 그 줄이 시트에서 정말 지워진 때뿐.
  //  1) 샘플ID  2) 화면이 기억한 행이 그 줄인지(프로젝트 · 업체 · 요청일)  3) 시트 전체에서 같은 프로젝트 · 업체 · 요청일 줄(여럿이면 기억한 행에 가장 가까운 줄)
  var last = sh.getLastRow(), hr = 1;
  try { hr = sampleCols_(sh, false).hr; } catch (eH) { hr = 1; }
  if (exp && str_(exp.sid) && K.sid >= 0) {
    if (row > hr && row <= last && str_(sh.getRange(row, K.sid + 1).getValue()) === str_(exp.sid)) return row;
    if (last > hr) {
      var col = sh.getRange(hr + 1, K.sid + 1, last - hr, 1).getValues();
      for (var i = 0; i < col.length; i++) if (str_(col[i][0]) === str_(exp.sid)) return hr + 1 + i;
    }
    // 샘플ID 를 받았는데 시트에 없으면 그 회차 줄이 지워졌거나 바뀐 것 — 같은 프로젝트 · 업체 · 요청일의 옆 회차에 쓰지 않는다
    throw new Error('그 회차 줄(' + str_(exp.v) + (str_(exp.d) ? ' · 요청일 ' + str_(exp.d) : '') + ')은 그사이 지워졌거나 바뀐 회차입니다 — 새로고침 후 다시 해 주세요.');
  }
  if (!projKey || K.name < 0) return row;
  var w = Math.max(K.code, K.name, K.vendor == null ? -1 : K.vendor, K.reqAt == null ? -1 : K.reqAt, K.pid == null ? -1 : K.pid) + 1;
  var same = function (v) {
    // 프로젝트ID 열쇠 또는 예전 열쇠(코드/이름 — 프로젝트ID 를 붙이기 전에 연 화면)면 같은 프로젝트
    if (!str_(v[K.name])) return false;
    if (sampleRowKey_(v, K) !== String(projKey) && sampleKey_(K.code >= 0 ? str_(v[K.code]) : '', str_(v[K.name])) !== String(projKey)) return false;
    if (exp && exp.v != null && K.vendor >= 0 && norm_(str_(v[K.vendor]) || '업체 미정').slice(0, 60) !== norm_(str_(exp.v) || '업체 미정').slice(0, 60)) return false;
    if (exp && str_(exp.d) && K.reqAt >= 0) { var a = toDate_(v[K.reqAt]), b = toDate_(str_(exp.d)); if (a && b && fmtDate_(a) !== fmtDate_(b)) return false; }
    return true;
  };
  if (row > hr && row <= last && same(sh.getRange(row, 1, 1, w).getValues()[0])) return row;
  var best = -1;
  if (last > hr) {
    sh.getRange(hr + 1, 1, last - hr, w).getValues().forEach(function (v, i) {
      var r = hr + 1 + i;
      if (same(v) && (best < 0 || Math.abs(r - row) < Math.abs(best - row))) best = r;
    });
  }
  if (best > 0) return best;
  throw new Error('그 회차 줄(' + str_((exp || {}).v) + (str_((exp || {}).d) ? ' · 요청일 ' + str_(exp.d) : '') + ')이 시트에서 지워져 처리하지 않았습니다.');
}

function dropSampleCache_() {
  cacheDrop_(rowsCacheKey_('sample'));
}
/* ============================================================
 * 발주현황을 기준으로 건 목록을 만든다.
 * 발주계획에만 있는 신규 건은 뒤에 얹는다.
 * 같은 건인지는 [품의번호 + 품목코드] 로 판단한다.
 * 품의번호가 없는 발주계획 행은 과거 데이터라 건너뛴다.
 * ============================================================ */

function keyDocCode_(doc, code, name) {
  var d = norm_(doc);
  if (!d) return '';
  var c = norm_(code);
  return d + '|' + (c ? c : 'n:' + norm_(name));
}

/** 발주현황 한 행을 실행판 행으로 */
function statusRowToItem_(r, S, rowNum) {
  var etaD = toDate_(r[S.eta]);
  var arrD = toDate_(r[S.arrived]);
  var name = str_(r[S.name]);
  var doc = str_(r[S.doc]);
  var code = str_(r[S.code]);

  var item = {
    id: keyDocCode_(doc, code, name),
    src: '현황',
    statusRow: rowNum,
    doc: doc,
    code: code,
    name: name,
    batch: str_(r[S.batch]),
    brand: str_(r[S.brand]),
    channel: str_(r[S.channel]),
    vendor: str_(r[S.vendor]),
    owner: str_(r[S.owner]) || '미지정',
    sheetOwner: S.owner >= 0 ? str_(r[S.owner]) : '',
    reqOwner: '',
    team: '',
    madeAt: '',
    orderedAt: dateOrWarn_(r[S.ordered]),
    due: dateOrRaw_(r[S.due]),
    eta: etaD ? fmtDate_(etaD) : str_(r[S.eta]).slice(0, 200),
    arrivedAt: arrD ? fmtDate_(arrD) : str_(r[S.arrived]).slice(0, 200),
    approvedAt: '',
    preAt: '', pre: 0, balAt: '', bal: 0,
    closed: S.closed >= 0 ? (str_(r[S.closed]) !== '') : false,
    price: num_(r[S.price]),
    qty: num_(r[S.qty]),
    inQty: num_(r[S.inQty]),
    remain: num_(r[S.remain]),
    memo: S.memo >= 0 ? str_(r[S.memo]).slice(0, 500) : '',
    cat: (S.cat !== undefined && S.cat >= 0) ? str_(r[S.cat]) : '',
    payMul: (String(r[S.vendor] == null ? '' : r[S.vendor]).indexOf(RB.CHINA_KEYWORD) > -1)
      ? RB.CHINA_MULTIPLIER : 1,
    parts: []
  };
  // 발주 DB 하나로 모은 열: 작성일 · 요청팀 · 요청 담당자 · 소진완료목표일 · 선금/잔금 · 링크
  var dT = function (v) { return v instanceof Date ? fmtDate_(v) : str_(v); };
  if (S.madeAt !== undefined && S.madeAt >= 0) item.madeAt = fmtDate_(toDate_(r[S.madeAt])) || str_(r[S.madeAt]);
  if (S.team !== undefined && S.team >= 0) item.team = str_(r[S.team]);
  if (S.reqOwner !== undefined && S.reqOwner >= 0) item.reqOwner = str_(r[S.reqOwner]);
  if (S.useBy !== undefined && S.useBy >= 0) item.useBy = fmtDate_(toDate_(r[S.useBy])) || str_(r[S.useBy]);
  if (S.preAt !== undefined && S.preAt >= 0) item.preAt = dT(r[S.preAt]);
  if (S.pre !== undefined && S.pre >= 0) item.pre = num_(r[S.pre]);
  if (S.balAt !== undefined && S.balAt >= 0) item.balAt = dT(r[S.balAt]);
  if (S.bal !== undefined && S.bal >= 0) item.bal = num_(r[S.bal]);
  if (S.link !== undefined && S.link >= 0) item.link = str_(r[S.link]);
  if (S.appr !== undefined && S.appr >= 0) item.approvalNo = str_(r[S.appr]);

  // 발주잔량 칸이 비어 있으면(수식이 아직 안 걸린 행 등) 0 으로 읽혀 '마감'으로 쓸려 들어갔다.
  // 비어 있을 때는 발주수량 - 입고수량으로 갈음한다.
  var remRaw = S.remain >= 0 ? r[S.remain] : '';
  if (remRaw === '' || remRaw == null) item.remain = Math.max(0, item.qty - item.inQty);

  // 새 양식: 입고기록 한 칸('날짜 수량 · 날짜 수량'). 예전 양식: 제품입고일(쉼표) + 1~20 열 = 파셜 회차
  if (S.rec >= 0) {
    item.parts = dbRecParse_(r[S.rec]);
    item.arrivedAt = item.parts.map(function (p) { return p.d; }).filter(String).join(', ');
  } else {
    var dateTxt = item.arrivedAt;
    var ds = splitArrived_(dateTxt);
    var qs = [];
    for (var pi = 1; pi <= RB.PARTIAL_MAX && S.hasParts; pi++) {
      var cell = r[S.inQty + pi];
      qs.push(cell === '' || cell == null ? '' : num_(cell));
    }
    var n = Math.max(ds.length, qs.filter(function (x) { return x !== '' && x !== 0; }).length);
    for (var k = 0; k < n; k++) {
      item.parts.push({ d: (ds[k] || '').trim(), q: (qs[k] === '' ? '' : qs[k]) });
    }
  }
  if (S.cur >= 0 && str_(r[S.cur])) item.curDb = str_(r[S.cur]).toUpperCase();

  return item;
}

/** 발주 DB 전체를 읽어 기준 목록을 만든다. */
/**
 * 발주 DB 실행판ID 채우기(읽을 때마다 두 열만 보고, 고칠 게 있을 때만 잠금):
 *  · 품목명은 있는데 ID 가 빈 줄(시트에 직접 적은 줄 · ID 칸을 지운 줄) → 새 ID. 예전 열쇠로 쌓인 진행 기록은 adoptOrphans_ 가 품의번호|품목명으로 옮긴다.
 *  · 같은 ID 가 여러 줄(1차 줄을 복사해 2차를 만든 경우) → 진행 기록에 적힌 차수 · 품목명과 맞는 줄이 ID 를 지키고(없으면 맨 위 줄), 나머지는 새 ID.
 *    그래야 복사한 줄이 원래 건의 진행 · 지급 줄 · AP 를 나눠 쓰지 않는다.
 */
function statusIdsEnsure_(sh) {
  var C = sheetCols_(sh), hr = C.hr, kc = statusKeyCols_(sh, hr), cName = colIdx_(C.idx, ['품목명']), cBatch = colIdx_(C.idx, ['발주차수']);
  var last = sh.getLastRow(), n = last - hr;
  if (kc.id < 0 || cName < 0 || n < 1) return 0;
  var read = function () {
    return { ids: sh.getRange(hr + 1, kc.id + 1, n, 1).getValues(), names: sh.getRange(hr + 1, cName + 1, n, 1).getValues(),
      batches: cBatch >= 0 ? sh.getRange(hr + 1, cBatch + 1, n, 1).getValues() : null };
  };
  var need = function (R) {
    var seen = {};
    for (var i = 0; i < n; i++) {
      if (!str_(R.names[i][0])) continue;
      var id = str_(R.ids[i][0]);
      if (!id || seen[id]) return true;
      seen[id] = 1;
    }
    return false;
  };
  var R = read();
  if (!need(R)) return 0;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return 0;
  var fixed = [];
  try {
    last = sh.getLastRow(); n = last - hr;
    R = read();
    var byId = {};
    for (var i = 0; i < n; i++) {
      if (!str_(R.names[i][0])) continue;
      var id = str_(R.ids[i][0]);
      if (id) (byId[id] = byId[id] || []).push(i);
    }
    var prog = null;
    var give = function (i, why) {
      var nid = newOrderId_();
      sh.getRange(hr + 1 + i, kc.id + 1).setValue(nid);
      fixed.push({ row: hr + 1 + i, id: nid, why: why, name: str_(R.names[i][0]) });
    };
    Object.keys(byId).forEach(function (id) {
      var at = byId[id];
      if (at.length < 2) return;
      if (!prog) { try { prog = readProgress_('po'); } catch (eP) { prog = { map: {}, raw: [] }; } }
      var rec = prog.map[id], raw = rec ? prog.raw[rec.row - 2] : null, keep = at[0];
      if (raw) {
        // 맞는 줄이 여럿(차수 · 품목명까지 그대로 복사)이면 맨 위(원래) 줄이 ID 를 지킨다 — 예전에는 마지막 줄이 가져가 원래 줄이 새 ID 를 받았다
        var hit = at.filter(function (k) {
          return norm_(R.names[k][0]) === norm_(raw[2]) && (!R.batches || norm_(R.batches[k][0]) === norm_(raw[3]));
        });
        if (hit.length) keep = hit[0];
      }
      at.forEach(function (k) { if (k !== keep) give(k, '같은 실행판ID(' + id + ')가 여러 줄 — 복사한 줄'); });
    });
    for (var j = 0; j < n; j++) {
      if (str_(R.names[j][0]) && !str_(R.ids[j][0])) give(j, '실행판ID 빈 줄');
    }
    if (fixed.length) SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  if (fixed.length) {
    try { appendHist_(fixed.map(function (f) { return { kind: '발주정보', id: f.id, name: f.name, item: '실행판ID 붙임', after: f.id, reason: f.why, where: RB.STATUS_TAB + ' ' + f.row + '행' }; })); } catch (eH) { /* 넘어간다 */ }
    cacheDrop_(rowsCacheKey_('po'));
  }
  return fixed.length;
}

function readStatusBase_(cfg) {
  var sh = statusSheet_();
  try { statusIdsEnsure_(sh); } catch (eId) { /* 다음에 — 목록은 띄운다 */ }

  var lastRow = sh.getLastRow();
  var lc = Math.min(sh.getLastColumn(), RB.STATUS_COLS);
  if (lastRow < 2 || lc < 1) return { rows: [], byKey: {} };

  var C0 = sheetCols_(sh);
  var hr = C0.hr;
  var idx = C0.idx;

  var S = {
    doc: colIdx_(idx, ['품의번호']),
    code: colIdx_(idx, ['품목코드']),
    name: colIdx_(idx, ['품목명']),
    batch: colIdx_(idx, ['발주차수']),
    brand: colIdx_(idx, ['브랜드']),
    channel: colIdx_(idx, ['채널']),
    vendor: colIdx_(idx, ['업체명', '매입처']),
    owner: colIdx_(idx, ['이', '담당', '담당자', '구매담당자']),
    ordered: colIdx_(idx, ['발주일']),
    due: colIdx_(idx, ['입고목표', '입고목표일']),
    eta: colIdx_(idx, ['입고일정']),
    arrived: colIdx_(idx, ['제품입고일']),
    closed: colIdx_(idx, ['종결']),
    price: colIdx_(idx, ['단가']),
    qty: colIdx_(idx, ['발주수량']),
    inQty: colIdx_(idx, ['입고수량']),
    remain: colIdx_(idx, ['발주잔량']),
    memo: colIdx_(idx, ['비고', '메모']),
    cat: colIdx_(idx, ['구분']),
    // 발주 DB 하나로 모은 뒤의 열(Consolidate.js). 없으면 -1 → 예전처럼 부가정보 탭 · 발주계획에서 붙인다.
    madeAt: colIdx_(idx, ['작성일']), team: colIdx_(idx, ['발주요청팀']), reqOwner: colIdx_(idx, ['요청팀담당자']),
    useBy: colIdx_(idx, ['소진완료목표일']), preAt: colIdx_(idx, ['선금지급예정']), pre: colIdx_(idx, ['선금']),
    balAt: colIdx_(idx, ['잔금지급예정']), bal: colIdx_(idx, ['잔금']), link: colIdx_(idx, ['발주요청링크']),
    cur: colIdx_(idx, ['통화']), rec: colIdx_(idx, ['입고기록']),
    appr: colIdx_(idx, ['결재문서번호'])
  };
  S.hasParts = dbHasParts_(C0, S.inQty);

  /*
   * 쓰는 열까지만 읽는다(실행판ID · 진행상태는 readKeyValues_ 가 따로).
   */
  var nRows = lastRow - hr;
  var maxS = 0;
  Object.keys(S).forEach(function (k) { if (S[k] > maxS) maxS = S[k]; });
  // 회차 수량은 입고수량 오른쪽으로 20칸이다. 둘 중 더 먼 쪽까지만 읽는다.
  var headEnd = Math.min(lc, Math.max(maxS + 1, S.hasParts ? S.inQty + 1 + RB.PARTIAL_MAX : 0));

  var v = sh.getRange(hr + 1, 1, nRows, headEnd).getValues();

  // 실행판ID · 진행상태 (맨 오른쪽 멀리 떨어진 열) — 있으면 건ID는 이 값으로 고정된다
  var keyV = readKeyValues_(sh, hr, nRows, statusKeyCols_(sh, hr));

  var rows = [], byKey = {}, byId = {};
  for (var vi = v.length - 1; vi >= 0; vi--) {
    var r = v[vi];
    if (!str_(r[S.name])) continue;
    var it = statusRowToItem_(r, S, hr + 1 + vi);
    applyKeys_(it, keyV ? keyV[vi] : null);
    if (!it.id) continue;                       // 품의번호도 실행판ID도 없는 행은 건너뛴다

    // 발주 DB 는 기간 · 종결과 상관없이 전부 올린다(지난 발주도 '마감 포함 전체' 로 본다)
    rows.push(it);
    if (rows.length >= 5000) break;
  }

  /*
   * 같은 [품의번호 + 품목코드] 행이 여럿일 수 있다(완제품 + 임가공 덧방처럼 한 품의 · 한 코드로 두 발주).
   * 예전에는 가장 아래 행만 보여서 나머지는 화면에서 사라졌다. 이제 모두 보여준다.
   * 겹치는 행끼리는 건ID 뒤에 품목명을 붙이고, 품목명까지 같으면 위에서부터 #2, #3 을 붙인다.
   * 예전 건ID(품목명 없는 것)로 쌓인 진행 기록은 adoptOrphans_ 가 [품의번호|품목명]으로 찾아 옮긴다.
   */
  var groups = {};
  rows.forEach(function (it) {
    if (it.fixedId) { byId[it.id] = it; byKey[it.id] = byKey[it.id] || it; return; }   // ID가 고정된 행은 이름을 다시 붙이지 않는다
    (groups[it.id] = groups[it.id] || []).push(it);
  });
  Object.keys(groups).forEach(function (base) {
    var g = groups[base];
    byKey[base] = g[0];                         // 발주계획 값은 가장 아래(최근) 행에 보탠다
    if (g.length < 2) return;
    var seenName = {};
    g.slice().sort(function (a, b) { return a.statusRow - b.statusRow; }).forEach(function (it) {
      var id = base + '|n:' + norm_(it.name);
      seenName[id] = (seenName[id] || 0) + 1;
      it.id = seenName[id] > 1 ? id + '#' + seenName[id] : id;
    });
  });

  // 발주계획 → 발주현황 짝 찾기용: [품의번호 + 품목코드 + 차수]. 같은 열쇠가 여럿이면 목록으로 둔다(위에서부터 짝지음).
  var byMatch = {};
  rows.slice().sort(function (a, b) { return a.statusRow - b.statusRow; }).forEach(function (it) {
    var mk = planMatchKey_(it.doc, it.code, it.batch);
    (byMatch[mk] = byMatch[mk] || []).push(it);
  });
  return { rows: rows, byKey: byKey, byMatch: byMatch, byId: byId, noPayCols: S.pre < 0 && S.bal < 0 };
}

/** 입고기록 칸: '25/02/04: 55,000 · 3/19: 6,150 · 5/28' → [{ d, q }]. 날짜와 수량은 ': ' 로 나눈다(수량 없으면 날짜만, 날짜 없으면 ': 수량') */
function dbRecParse_(v) {
  var s = v instanceof Date ? fmtDate_(v) : str_(v);
  if (!s) return [];
  return s.split(' · ').map(function (tok) {
    var k = tok.lastIndexOf(': ');
    if (k < 0) return { d: tok.trim(), q: '' };
    var q = tok.slice(k + 2).replace(/,/g, '').trim();
    return { d: tok.slice(0, k).trim(), q: q === '' ? '' : num_(q) };
  }).filter(function (p) { return p.d || p.q !== ''; });
}
/** [{ d, q }] → 입고기록 칸 글자 */
function dbRecText_(parts) {
  return parts.map(function (p) {
    var q = p.q === '' || p.q == null ? '' : Number(p.q).toLocaleString('en-US');
    return q ? (str_(p.d) + ': ' + q) : str_(p.d);
  }).filter(String).join(' · ');
}

/** 발주계획 ↔ 발주현황 짝 열쇠 — 품의번호 + 품목코드 + 차수('1차' 와 '1' 은 같게) */
function planMatchKey_(doc, code, batch) {
  return norm_(doc) + '|' + norm_(code) + '|' + norm_(batch).replace(/차$/, '');
}

/** 실행판에 올릴 발주건 목록 */
function readOrderRows_(cfg) {
  var base = readStatusBase_(cfg);
  // 발주계획 탭은 없앴다. 발주건은 발주 DB(_실행판_발주)만 읽는다.
  var rows = base.rows;
  // 입고예정: 발주 DB 입고일정 칸이 비어 있으면 지급 줄 예정 날짜로 — 칸 맞추기가 빠진 건도 목록에 '일정 없음' 으로 나오지 않게
  try {
    var lmE = linesMapCached_(true);
    if (lmE) rows.forEach(function (it) {
      if (str_(it.eta)) return;
      var ds = (lmE[it.id] || []).filter(function (x) { return x.kind === '예정' && x.date; }).map(function (x) { var d = toDate_(x.date); return d ? fmtDate_(d) : str_(x.date); })
        .filter(function (d, i, a) { return d && a.indexOf(d) === i; }).sort();
      if (ds.length) it.eta = ds.join(', ');
    });
  } catch (eE) { /* 지급 줄 없이 */ }
  if (base.noPayCols) {
    // 선금 · 잔금 칸이 없는 새 양식: 지급 줄(원본)에서 — 선금 = 선금 줄 합 · 처음 날짜, 잔금 = 나머지 줄 합 · 마지막 지급월
    var lm = null;
    try { lm = linesMapCached_(true); } catch (e) { lm = null; }
    if (lm) rows.forEach(function (it) {
      var L = lm[it.id] || [], pre = 0, bal = 0, preAt = '', balAt = '';
      L.forEach(function (x) {
        if (x.kind === '선금') { pre += num_(x.amt) || 0; if (!preAt) preAt = x.date ? fmtDate_(toDate_(x.date)) || str_(x.date) : str_(x.payYm); }
        else if (x.kind === '예정' || x.kind === '입고') { bal += num_(x.amt) || 0; if (x.payYm && x.payYm > balAt) balAt = x.payYm; }
      });
      it.pre = pre; it.preAt = preAt; it.bal = bal; it.balAt = balAt;
    });
  }
  attachExtras_(rows);
  rows.sort(function (a, b) {
    var ka = a.madeAt || a.orderedAt || '';
    var kb = b.madeAt || b.orderedAt || '';
    return kb < ka ? -1 : (kb > ka ? 1 : 0);
  });
  return rows;
}

/* ============================================================
 * 진행 상태
 * ============================================================ */

function readProgress_(mode) {
  var sh = tab_(progTabName_(mode), RB.PROGRESS_HEAD);
  var map = {}, alt = {};
  if (sh.getLastRow() < 2) return { map: map, alt: alt, sh: sh, raw: [] };
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, RB.PROGRESS_HEAD.length).getValues();
  v.forEach(function (r, i) {
    if (!r[0]) return;
    var rec = progRec_(r, i + 2);
    // 같은 건ID 줄이 여럿이면 아래쪽(나중에 쓴) 줄이 이긴다
    map[rec.id] = rec;

    // 건ID 가 바뀐 기록을 되찾을 때만 쓰는 보조 열쇠. 겹칠 수 있어 목록으로 둔다.
    var dk = norm_(r[1]) + '|' + norm_(r[2]);
    if (dk !== '|') (alt[dk] = alt[dk] || []).push(rec);
  });
  // 건ID → 행 번호를 기억해 둔다. 체크 하나 저장할 때 탭 전체(0.7초)를 읽지 않고 그 한 줄만 읽게.
  try {
    var hint = {};
    Object.keys(map).forEach(function (k) { hint[k] = map[k].row; });
    cachePut_(progHintKey_(mode), hint, RB_TTL);
  } catch (e) { /* 넘어간다 */ }
  return { map: map, alt: alt, sh: sh, raw: v };
}

function progHintKey_(mode) { return 'progrow:v1:' + ((mode === 'sample') ? 'sample' : 'po'); }

/** 진행 기록 한 줄 → 기록 */
function progRec_(r, rowNum) {
  var checks = {}, notes = {}, dates = {};
  try { checks = JSON.parse(r[6] || '{}'); } catch (e) {}
  try { notes = JSON.parse(r[7] || '{}'); } catch (e) {}
  try { dates = JSON.parse(r[10] || '{}'); } catch (e) {}
  return {
    row: rowNum,
    id: String(r[0]),
    checks: checks,
    notes: notes,
    dates: dates,
    ownerSet: String(r[5] || '').trim(),
    updatedAt: r[8] ? fmtDate_(r[8] instanceof Date ? r[8] : toDate_(r[8])) : '',
    updatedBy: String(r[9] || '')
  };
}

/**
 * 한 건의 진행 기록만 빨리 찾는다(잠금 안에서 부른다). 기억해 둔 행을 한 줄 읽어 건ID 가 맞으면 그것,
 * 아니면(행이 바뀜 · 처음 보는 건) 예전처럼 탭 전체를 읽는다. 반환 모양은 readProgress_ 와 같다(map 에 그 건만).
 */
function readProgressOne_(mode, id) {
  var hint = cacheGet_(progHintKey_(mode));
  var at = hint && hint[id];
  if (at) {
    var sh = tab_(progTabName_(mode), RB.PROGRESS_HEAD);
    var r = sh.getRange(at, 1, 1, RB.PROGRESS_HEAD.length).getValues()[0];
    if (String(r[0]) === String(id)) {
      var m = {}; m[id] = progRec_(r, at);
      return { map: m, alt: {}, sh: sh, raw: null, fast: true };
    }
  }
  return readProgress_(mode);
}

/**
 * 진행 기록은 건ID 로만 찾는다.
 * 예전에는 못 찾으면 [품의번호|품목명] 으로 한 번 더 찾았는데, 한 품의 안에 품목명이 같은
 * 줄이 둘 있으면 두 건이 한 기록을 서로 뺏어 쓰며 덮어썼다.
 * 건ID 가 바뀐 기록은 화면을 읽을 때 adoptOrphans_ 가 주인 없는 것만 골라 옮겨 준다.
 */
function findProg_(p, id) {
  return (p && p.map[id]) || null;
}

function progState_(rec) {
  return {
    checks: (rec && rec.checks) || {},
    notes: (rec && rec.notes) || {},
    dates: (rec && rec.dates) || {},
    ownerSet: (rec && rec.ownerSet) || ''
  };
}

/** 진행 기록 한 줄. 담당자 칸(6열)은 직접 지정한 값만 넣는다(화면에 보이는 담당자를 넣으면 굳어 버린다). */
function progRowValues_(id, meta, st, who, at) {
  meta = meta || {};
  return [
    id,
    meta.doc || '',
    meta.name || '',
    meta.batch || '',
    meta.brand || '',
    st.ownerSet || '',
    JSON.stringify(st.checks || {}),
    JSON.stringify(st.notes || {}),
    at || new Date(),
    who || me_(),
    JSON.stringify(st.dates || {})
  ];
}

/** 읽어 둔 줄들 중 바뀐 줄만 한 번에 쓴다. 떨어져 있으면 덩어리별로 나눠 쓴다. */
function writeProgRows_(p, rowsChanged) {
  var list = Object.keys(rowsChanged).map(Number).sort(function (a, b) { return a - b; });
  var i = 0;
  while (i < list.length) {
    var a = list[i], b = a;
    while (i + 1 < list.length && list[i + 1] - b <= 3) { i++; b = list[i]; }
    var block = [];
    for (var r = a; r <= b; r++) block.push(rowsChanged[r] || p.raw[r - 2]);
    p.sh.getRange(a, 1, block.length, RB.PROGRESS_HEAD.length).setValues(block);
    i++;
  }
}

/**
 * 진행 기록 한 건을 고친다.
 * 잠금을 먼저 걸고, 그 안에서 시트를 새로 읽어 고친 뒤 쓴다.
 * 예전에는 잠그기 전에 읽어서, 체크를 연달아 누르거나 두 사람이 같은 건을 만지면
 * 먼저 한 저장이 뒤 저장에 덮여 사라졌다.
 * fn(state) 가 state 의 checks / notes / dates / ownerSet 을 고친다.
 * after(res) 는 잠금 안에서 쓰기 직후에 부른다(확인 · 이력 쓰기용).
 */
/**
 * 변경 번호 — 누가 저장하면 올린다. 화면은 15초마다 이 번호만 보고, 바뀌었을 때만 시트를 다시 읽는다
 * (다른 사람이 처리한 게 새로고침 없이 바로 보이게. 번호 확인은 캐시 한 칸이라 가볍다).
 */
var RB_VER_DEFER = null;      // 진행 기록 저장 중에는 변경 번호를 모아 두었다가 맨 끝에 한 번 반영(flush)한다
function bumpVer_(kind) {
  if (RB_VER_DEFER) { RB_VER_DEFER[kind || 'r'] = 1; return; }
  // 저장이 끝난 뒤에 부른다(그 전에 올리면 남의 화면이 저장 전 값을 읽고 지나간다). 쓴 값을 먼저 시트에 내려 보낸다.
  try { SpreadsheetApp.flush(); } catch (e) { /* 넘어간다 */ }
  try { CacheService.getScriptCache().put('rb:ver:' + (kind || 'r'), String(Date.now()) + ':' + me_(), 21600); } catch (e) { /* 넘어간다 */ }
}
/** 잠금 안의 저장 묶음 시작: 변경 번호를 모은다. 이미 묶음 안이면(바깥 저장이 부른 경우) 바깥이 반영한다. */
function deferVer_() {
  var outer = !!RB_VER_DEFER;
  if (!outer) RB_VER_DEFER = {};
  return outer;
}
function endVer_(outer) { if (!outer) flushVer_(); }
function flushVer_() {
  var kinds = Object.keys(RB_VER_DEFER || {});
  RB_VER_DEFER = null;
  try { SpreadsheetApp.flush(); } catch (e) { /* 넘어간다 */ }
  if (!kinds.length) return;
  var v = String(Date.now()) + ':' + me_(), m = {};
  kinds.forEach(function (k) { m['rb:ver:' + k] = v; });
  try { CacheService.getScriptCache().putAll(m, 21600); } catch (e) { /* 넘어간다 */ }
}
/** p = 진행 기록(체크 · 날짜) · l = 지급 줄 · r = 발주 DB(시트) — 화면은 바뀐 것만 다시 읽는다 */
/** 화면 코드 판 번호. 화면(브라우저 쪽) 코드를 바꿔 배포할 때마다 올린다 — 열어 둔 옛 화면에 새로고침 안내가 뜬다. */
var RB_BUILD = '2026-10-21o';
/** 브라우저 탭 아이콘 — 공개 PNG 주소(바꾸려면 이 주소만) */
var RB_FAVICON = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f44d.png';
function apiVer() {
  try {
    var c = CacheService.getScriptCache().getAll(['rb:ver:p', 'rb:ver:l', 'rb:ver:r', 'rb:ver:n', 'rb:build']);
    return { p: c['rb:ver:p'] || '', l: c['rb:ver:l'] || '', r: c['rb:ver:r'] || '', n: c['rb:ver:n'] || '', b: RB_BUILD, bc: c['rb:build'] || '' };
  } catch (e) { return { p: '', l: '', r: '', n: '', b: RB_BUILD }; }
}
/** 가장 새 판 번호를 캐시에 — 새 화면(doGet · 배포된 코드)만 적는다. 열어 둔 옛 화면이 옛 서버 코드에 붙어 있어도(b 가 옛 번호) 이 값으로 새 버전을 알아챈다.
 *  트리거(1분 · 10분)는 배포판이 아니라 마지막으로 올린 코드(HEAD)로 돌아서, 거기서 적으면 아직 배포 안 된 판을 알려 '새 버전' 안내가 계속 떴다 — 트리거에서는 부르지 않는다.
 *  배포판 번호는 스크립트 속성(rb.buildDeployed)에도 남긴다 — 트리거가 자기 코드가 배포판과 같은지 볼 때(deployedBuildOk_). */
function buildMark_() {
  try {
    var c = CacheService.getScriptCache(), g = c.getAll(['rb:build', 'rb:buildDep']), cur = g['rb:build'] || '';
    if (cur < RB_BUILD) c.put('rb:build', RB_BUILD, 21600);
    if ((g['rb:buildDep'] || '') !== RB_BUILD) {          // 판이 바뀐 뒤 첫 화면에서 한 번만 속성을 본다
      var P = PropertiesService.getScriptProperties();
      if ((P.getProperty('rb.buildDeployed') || '') !== RB_BUILD) P.setProperty('rb.buildDeployed', RB_BUILD);
      c.put('rb:buildDep', RB_BUILD, 21600);
    }
  } catch (e) { /* 넘어간다 */ }
}
/** 트리거로 도는 이 코드(HEAD)가 지금 배포판(doGet 이 적은 번호)과 같은가 — 데이터를 옮기는 정리 묶음은 같을 때만 돌린다 */
function deployedBuildOk_() {
  try { return (PropertiesService.getScriptProperties().getProperty('rb.buildDeployed') || '') === RB_BUILD; } catch (e) { return false; }
}
/** 현황 화면 오른쪽 공지 메모(모두 같이 보는 한 칸). { text, by, at } */
function apiNotice() {
  var v;
  try { v = JSON.parse(PropertiesService.getScriptProperties().getProperty('rb.notice') || 'null'); } catch (e) { v = null; }
  v = v || { by: '', at: 0 };
  // 세 칸으로 나눈 뒤: texts[0..2]. 예전 한 칸(text)은 첫 칸으로
  var t = Array.isArray(v.texts) ? v.texts : [v.text || ''];
  return { texts: [t[0] || '', t[1] || '', t[2] || ''], by: v.by || '', at: v.at || 0 };
}
function apiSaveNotice(texts) {
  requireEditor_();
  var t = Array.isArray(texts) ? texts : [texts];
  var v = { texts: [0, 1, 2].map(function (i) { return String(t[i] == null ? '' : t[i]).slice(0, 2000); }), by: me_(), at: Date.now() };
  PropertiesService.getScriptProperties().setProperty('rb.notice', JSON.stringify(v));
  bumpVer_('n');
  return v;
}
/** 진행 기록만(체크 · 메모 · 날짜) — 남이 체크한 걸 빨리 보여 줄 때. 시트 전체를 읽는 것보다 훨씬 가볍다. */
function apiProgressOnly(mode) {
  mode = mode === 'sample' ? 'sample' : 'po';
  var p = readProgress_(mode), out = {};
  try { journalOverlay_(p.map, mode); } catch (e) { /* 넘어간다 */ }   // 아직 시트에 안 옮긴 저장도 보이게
  Object.keys(p.map).forEach(function (k) { var r = p.map[k]; out[k] = { checks: r.checks, notes: r.notes, dates: r.dates, ownerSet: r.ownerSet, updatedBy: r.updatedBy }; });
  return { mode: mode, map: out };
}
/** 지급 줄만 */
function apiLinesOnly() {
  return { lineMap: linesMapCached_(true), lineMonths: payMonthOptions_() };
}

/**
 * 저장용 잠금 대기. 앞 저장이 끝날 때까지 최대 3분 기다린다.
 * 예전에는 20초만 기다리고 '잠금 시간초과'로 실패해, 체크를 몰아 누르면 뒤쪽 저장이 실패하고 화면에서 풀렸다.
 */
function waitLock_(lock, maxMs) {
  var end = Date.now() + (maxMs || 180000);
  while (!lock.tryLock(Math.max(1000, Math.min(30000, end - Date.now())))) {
    if (Date.now() >= end) throw new Error('저장이 몰려 3분 넘게 기다렸습니다. 잠시 뒤 다시 해 주세요.');
  }
}

/**
 * 샘플 진행 기록 건ID 바로잡기: 프로젝트ID 를 붙이기 전에 연 화면은 예전 건ID('p:코드' · 'p:n:이름')로 저장을 보낸다.
 * 그 프로젝트에 프로젝트ID 가 있으면 'p:프로젝트ID' 로 바꿔, 기록이 둘로 갈라지지 않게 한다.
 */
function sampleProgIdFix_(id, mode) {
  id = String(id || '');
  if (mode !== 'sample' || id.indexOf('p:') !== 0 || /^p:P[0-9A-F]{8}$/.test(id)) return id;
  var old = id.slice(2), map = null;
  try { map = cacheGet_('spidmap:v1'); } catch (e0) { map = null; }
  if (!map || !(old in map)) {
    map = {};
    try {
      var sh = sheet_(RB.SAMPLE_TAB), C = sampleCols_(sh, false), K = C.K, n = sh.getLastRow() - C.hr;
      if (K.pid >= 0 && n > 0) {
        var w = Math.max(K.name, K.code, K.pid) + 1;
        sh.getRange(C.hr + 1, 1, n, w).getValues().forEach(function (r) {
          var pid = str_(r[K.pid]); if (!pid || !str_(r[K.name])) return;
          var k = sampleKey_(K.code >= 0 ? str_(r[K.code]) : '', str_(r[K.name]));
          if (!map[k]) map[k] = pid;
        });
      }
      cachePut_('spidmap:v1', map, 600);
    } catch (e1) { return id; }
  }
  return map[old] ? 'p:' + map[old] : id;
}

/**
 * 갈라진 샘플 진행 기록 합치기: 프로젝트ID 를 붙인 뒤에도 예전 화면이 예전 건ID 로 저장해 새 줄이 생겼으면
 * 그 내용(체크 · 날짜 · 메모)을 'p:프로젝트ID' 기록에 합치고 예전 줄은 비운다. 고칠 게 없으면 잠금 없이 끝난다.
 */
function sampleProgMergeSplits_() {
  var pr = readProgress_('sample'), moves = [];
  Object.keys(pr.map).forEach(function (id) {
    if (id.indexOf('p:') !== 0 || /^p:P[0-9A-F]{8}$/.test(id)) return;
    var to = sampleProgIdFix_(id, 'sample');
    if (to !== id) moves.push([id, to]);
  });
  if (!moves.length) return 0;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return 0;
  var n = 0;
  try {
    try { drainJournal_(); } catch (eJ) { /* 다음에 */ }
    pr = readProgress_('sample');
    var changed = {};
    var at = function (rec) { var r = pr.raw[rec.row - 2][8]; return r instanceof Date ? r.getTime() : (toDate_(r) ? toDate_(r).getTime() : 0); };
    moves.forEach(function (mv) {
      var a = pr.map[mv[0]], b = pr.map[mv[1]];
      if (!a) return;
      if (!b) {                                       // 새 ID 기록이 없으면 이름만 바꾼다
        var raw0 = pr.raw[a.row - 2].slice(); raw0[0] = mv[1]; changed[a.row] = raw0; n++; return;
      }
      var newer = at(a) >= at(b) ? a : b, older = newer === a ? b : a;
      var st = { checks: Object.assign({}, older.checks, newer.checks), dates: Object.assign({}, older.dates, newer.dates), notes: {}, ownerSet: newer.ownerSet || older.ownerSet };
      Object.keys(older.notes).concat(Object.keys(newer.notes)).forEach(function (k) {
        if (k in st.notes) return;
        var x = older.notes[k], y = newer.notes[k];
        if (k.indexOf('tl:') === 0) {                 // 진행 메모 목록은 합친다(적은 날 · 내용이 같은 건 하나만)
          var L = [], seen = {};
          [x, y].forEach(function (s) { var arr = []; try { arr = JSON.parse(s || '[]'); } catch (e) { arr = []; } arr.forEach(function (o) { var key = String(o.at) + '|' + String(o.text || ''); if (!seen[key]) { seen[key] = 1; L.push(o); } }); });
          L.sort(function (p, q) { return String(p.at) < String(q.at) ? -1 : (String(p.at) > String(q.at) ? 1 : 0); });
          if (L.length) st.notes[k] = JSON.stringify(L);
        } else st.notes[k] = y != null ? y : x;
      });
      var rb = pr.raw[b.row - 2];
      changed[b.row] = progRowValues_(mv[1], { doc: rb[1], name: rb[2], batch: rb[3], brand: rb[4] }, st, '기록 합침', new Date());
      var ra = pr.raw[a.row - 2].slice(); ra[0] = ''; changed[a.row] = ra;     // 예전 줄은 비운다(읽을 때 건너뜀)
      n++;
    });
    if (n) writeProgRows_(pr, changed);
  } finally {
    lock.releaseLock();
  }
  if (n) { cacheDrop_('prog:v2:sample'); cacheDrop_(progHintKey_('sample')); try { bumpVer_('p'); } catch (eV) { /* 넘어간다 */ } }
  return n;
}

function editProgress_(id, meta, mode, fn, after) {
  requireEditor_();
  if (!id) throw new Error('건ID가 비어 있습니다.');
  id = sampleProgIdFix_(id, mode);
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var outer = deferVer_();
  try {
    // 장부에 먼저 적힌 변경부터(순서 유지). 못 옮겼으면 여기서 멈춘다 — 그대로 쓰면 장부의 옛 변경이 나중에 옮겨지며 이 저장을 덮었다
    try { drainJournal_(); } catch (eJ) { throw new Error('앞서 저장한 변경을 시트로 옮기지 못해 이번 저장을 멈췄습니다. 잠시 뒤 다시 해 주세요. (' + eJ.message + ')'); }
    var p = readProgressOne_(mode, id);
    var rec = findProg_(p, id);
    var st = progState_(rec);
    fn(st);
    var vals = progRowValues_(id, meta, st);
    var at = rec ? rec.row : p.sh.getLastRow() + 1;
    if (!rec) {                                  // 새 줄 — 행 번호 기억에 더한다
      try { var hn = cacheGet_(progHintKey_(mode)); if (hn) { hn[id] = at; cachePut_(progHintKey_(mode), hn, RB_TTL); } } catch (e) { /* 넘어간다 */ }
    }
    var res = { state: st, row: at, sh: p.sh };
    // 이력부터 붙이고 진행 줄을 쓴다. 쓰기 뒤에 읽으면(이력 탭 마지막 행 찾기 등) 그때마다 시트 전체 재계산을 기다려
    // 체크 하나 저장이 4~17초 걸렸다. 이제 반영(flush)은 맨 끝 한 번.
    if (after) after(res);
    if (!rec) ensureRows_(p.sh, at);             // 시트 줄이 꽉 찼으면 늘린다
    p.sh.getRange(at, 1, 1, vals.length).setValues([vals]);
    progCachePatch_(id, st, mode);
    bumpVer_('p');
    return res;
  } finally {
    try { endVer_(outer); } catch (e) { /* 넘어간다 */ }
    lock.releaseLock();
  }
}

/**
 * 여러 건을 한 번에 고친다. 잠금 한 번, 읽기 한 번, 쓰기는 바뀐 줄 덩어리만.
 * fn(state, item) 이 false 를 돌려주면 그 건은 쓰지 않는다.
 */
function bulkEditProgress_(items, mode, fn, after) {
  requireEditor_();
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var n = 0;
  try {
    try { drainJournal_(); } catch (eJ) { /* 다음에 */ }
    var p = readProgress_(mode);
    var changed = {}, appends = [], pending = {};
    (items || []).forEach(function (it) {
      if (!it || !it.id) return;
      var id = sampleProgIdFix_(String(it.id), mode);
      var rec = findProg_(p, id);
      var st = pending[id] ? pending[id].st : progState_(rec);
      if (fn(st, it) === false) return;
      var vals = progRowValues_(id, it.meta, st);
      if (rec) changed[rec.row] = vals;
      else if (pending[id]) appends[pending[id].i] = vals;       // 같은 건이 두 번 오면 한 줄로
      else { pending[id] = { st: st, i: appends.length }; appends.push(vals); }
      n++;
    });
    writeProgRows_(p, changed);
    if (appends.length) {
      ensureRows_(p.sh, p.sh.getLastRow() + appends.length);
      p.sh.getRange(p.sh.getLastRow() + 1, 1, appends.length, RB.PROGRESS_HEAD.length).setValues(appends);
    }
    if (after) after();
  } finally {
    lock.releaseLock();
    cacheDrop_('prog:v2:' + ((mode === 'sample') ? 'sample' : 'po'));   // 뒤(after)에서 실패해도 이미 쓴 진행 기록은 캐시에서 버린다
    bumpVer_('p');
  }
  return n;
}

/**
 * 건ID 가 바뀐 진행 기록을 새 ID 로 옮긴다(발주계획 → 발주현황으로 넘어가며 품목코드가 생기는 등).
 * [품의번호|품목명] 이 같은 기록 중, 지금 화면의 어느 건도 쓰고 있지 않은 것만 옮긴다.
 * 그래야 다른 건의 기록을 뺏어 오는 일이 없다.
 */
/** 바뀌지 않는 ID 로 붙은 진행 기록인지(실행판ID · 샘플 프로젝트ID) */
function fixedProgId_(id) { return RB_ID_RE.test(String(id || '')) || /^p:P[0-9A-F]{8}$/.test(String(id || '')); }
function adoptOrphans_(p, rows, changed) {
  var live = {};
  rows.forEach(function (r) { live[r.id] = 1; });
  var used = {};
  var n = 0;
  rows.forEach(function (r) {
    if (p.map[r.id]) return;
    var pick = null;
    nameVariants_(r.name, r.brand).forEach(function (nv) {
      (p.alt[norm_(r.doc) + '|' + nv] || []).forEach(function (rec) {
        if (live[rec.id] || used[rec.row]) return;   // 다른 건이 쓰는 기록 · 이미 옮긴 기록
        if (fixedProgId_(rec.id)) return;            // 고정 ID(실행판ID · 샘플 프로젝트ID) 기록은 주인 잃은 기록이 아니다 — 다른 건이 가져가지 않게
        if (p.map[rec.id] !== rec) return;           // 같은 ID 의 더 새 줄이 있는 낡은 줄
        if (!pick || rec.row > pick.row) pick = rec;
      });
    });
    // 미기안 때(품의번호 없이) 쌓인 기록 — 품의번호가 생긴 건이 이어받는다. 품목코드가 같아야 한다.
    if (!pick && r.doc) {
      var pref = 'nodoc|' + (norm_(r.code) || 'n:' + norm_(r.name)) + '|';
      nameVariants_(r.name, r.brand).forEach(function (nv) {
        (p.alt['|' + nv] || []).forEach(function (rec) {
          if (live[rec.id] || used[rec.row] || p.map[rec.id] !== rec) return;
          if (fixedProgId_(rec.id)) return;
          if (rec.id.indexOf(pref) !== 0) return;
          if (!pick || rec.row > pick.row) pick = rec;
        });
      });
    }
    if (!pick) return;
    used[pick.row] = 1;
    delete p.map[pick.id];
    pick.id = r.id;
    p.map[r.id] = pick;
    var raw = p.raw[pick.row - 2].slice();
    raw[0] = r.id;
    p.raw[pick.row - 2] = raw;
    changed[pick.row] = raw;
    n++;
  });
  return n;
}

/**
 * 입고일정(발주현황)이 바뀐 건은 [입고일정변경시초기화] 가 켜진 단계의 체크를 지워 다시 확인하게 한다.
 */
/** 입고일정이 바뀌면 풀 항목: 이름에 '지급일' 또는 '재고시트'가 들어간 항목 */
function etaResetItem_(it) {
  return /지급일|재고\s*시트/.test(String((it && it.t) || ''));
}

function etaResets_(p, rows, steps, changed, dry) {
  var targets = steps.filter(function (s) { return s.resetOnEta; });
  if (!targets.length) return 0;
  var n = 0, audits = [];
  rows.forEach(function (r) {
    var rec = findProg_(p, r.id);
    if (!rec) return;
    var dates = rec.dates || {};
    var prev = dates.__eta;
    var now = etaNorm_(r.eta || '');
    // 입고일정이 비어 있으면(누가 잠깐 지웠거나 아직 안 적음) 변경으로 보지 않는다. 기준값도 그대로 둔다.
    // 예전에는 비었다가 다시 채워질 때마다 생산진행상황 체크가 통째로 지워졌다.
    if (!now) return;
    if (prev !== undefined && etaNorm_(prev) === now) {
      if (prev !== now) { dates.__eta = now; } else return;   // 표기만 다르면 기준값만 새 표기로
    } else {
      var checks = rec.checks || {};
      if (prev !== undefined && prev !== '') {
        var removed = {};
        // 입고일정이 바뀌면 다시 해야 하는 항목(지급일 변경 · 재고시트 업데이트)만 푼다.
        // 다른 항목 체크와 단계 생략은 그대로 둔다(예전에는 단계 전체를 지워 체크가 '풀렸다').
        targets.forEach(function (st) {
          (st.items || []).forEach(function (x, i) {
            if (!etaResetItem_(x)) return;
            var k = itemKey_(st, i);
            if (checks[k]) { removed[k] = checks[k]; delete checks[k]; }
          });
        });
        if (Object.keys(removed).length) {
          // 되돌릴 수 있게 지운 체크를 남겨 둔다(화면의 [체크 되돌리기])
          checks._etaResetBak = { at: fmtDate_(new Date()), from: String(prev), to: now, keys: removed };
          audits.push({ tab: progTabName_('po'), row: rec.row, col: 7,
            what: '입고예정 변경으로 [' + Object.keys(removed).length + '개 항목(지급일 · 재고시트)] 체크 풀림 (' + r.name + ')',
            before: prev, after: now });
          n++;
        }
      }
      rec.checks = checks;
      dates.__eta = now;
    }
    var checksNow = rec.checks || {};
    rec.dates = dates;
    var raw = (changed[rec.row] || p.raw[rec.row - 2]).slice();
    raw[6] = JSON.stringify(checksNow);
    raw[10] = JSON.stringify(dates);
    p.raw[rec.row - 2] = raw;
    changed[rec.row] = raw;
  });
  if (audits.length && !dry) writeAudits_(audits);
  return n;
}

/**
 * 잠금 없이 읽은 진행 기록(p)에 화면 정리(주인 잃은 기록 옮기기 · 입고일정 변경 초기화 · 품의번호 자동 상신)가
 * 필요한지 본다. p 는 버리는 사본이라 고쳐져도 된다(필요하면 잠금 안에서 다시 읽어 실제로 고친다). 이력은 쓰지 않는다.
 */
function reconcileNeeded_(p, rows, steps, mode, fresh, cfg) {
  var changed = {};
  if (adoptOrphans_(p, rows, changed)) return true;
  if (mode === 'po' && fresh) {
    etaResets_(p, rows, steps, changed, true);
    if (Object.keys(changed).length) return true;
    var auto = autoSubmit_(p, rows, steps, cfg || {}, changed);
    if (auto.n || auto.appends.length) return true;
  }
  return Object.keys(changed).length > 0;
}

/** 캐시에 그 열쇠가 담겨 있는지(풀지 않고 칸 수만 본다) */
function cacheHas_(key) {
  try { return !!CacheService.getScriptCache().get(key + ':n'); } catch (e) { return false; }
}

/** 입고일정 비교용 표기 — '9/30' · '26/09/30' · 날짜값을 같은 모양으로 */
function etaNorm_(v) {
  // 'MM/DD' 모양으로 맞춘다 — '9/30' 과 '26/09/30' 처럼 연도 표기만 다른 건 변경으로 보지 않는다
  return splitArrived_(String(v == null ? '' : v)).map(function (t) {
    var raw = String(t).replace(/[()\s]/g, '');
    var d = toDate_(raw);
    if (d) return pad2_(d.getMonth() + 1) + '/' + pad2_(d.getDate());
    var m = raw.match(/^(\d{1,2})[.\/-](\d{1,2})$/);
    return m ? pad2_(Number(m[1])) + '/' + pad2_(Number(m[2])) : raw;
  }).join(',');
}

/** 입고일정 변경으로 지워진 체크를 되돌린다 */
function apiRestoreEtaReset(id, meta, mode) {
  var res = editProgress_(id, meta, mode, function (st) {
    var bak = st.checks._etaResetBak;
    if (!bak || !bak.keys) return;
    Object.keys(bak.keys).forEach(function (k) { st.checks[k] = bak.keys[k]; });
    delete st.checks._etaResetBak;
  });
  return { checks: res.state.checks };
}

/** 초기화 안내만 닫는다(체크는 그대로) */
function apiDismissEtaReset(id, meta, mode) {
  var res = editProgress_(id, meta, mode, function (st) { delete st.checks._etaResetBak; });
  return { checks: res.state.checks };
}

/**
 * 화면을 새로 읽을 때 진행 기록을 정리한다: 주인 잃은 기록 옮기기 + 입고일정 변경 초기화.
 * 잠금 안에서 새로 읽고 한 번에 쓴다. 잠금을 못 얻으면 읽기만 한다.
 */
function reconcileProgress_(rows, steps, mode, fresh, cfg, readOnly) {
  // 먼저 잠금 없이 읽어 고칠 게 있는지만 본다. 고칠 게 없고 진행 캐시도 있으면 잠금을 잡지 않는다.
  // 예전에는 화면이 다시 읽을 때마다(저장 뒤 · 2분마다 · 사람 수만큼) 잠금을 잡아 남의 저장을 줄 세웠다.
  // 진행 캐시는 저장(editProgress_ · 장부 옮기기)이 그때그때 고쳐 두므로 여기서 다시 담지 않아도 된다.
  // readOnly(저장 권한 없는 사람): 시트 · 장부를 고치지 않고 읽기만 한다.
  try {
    var p0 = readProgress_(mode);
    // 진행 캐시를 마지막으로 통째로 다시 담은 지 30분이 지났으면 잠금 안에서 다시 담는다(혹시 어긋난 캐시가 오래 남지 않게)
    var builtAt = 0;
    try { builtAt = Number(CacheService.getScriptCache().get('prog:at:' + mode) || 0); } catch (eA) { builtAt = 0; }
    if ((readOnly || Date.now() - builtAt < 1800000) && cacheHas_('prog:v2:' + mode) && !reconcileNeeded_(p0, rows, steps, mode, fresh, cfg)) {
      try { journalOverlay_(p0.map, mode); } catch (eO0) { /* 넘어간다 */ }
      p0.adopted = 0; p0.etaReset = 0; p0.docAuto = 0; p0.cachedInLock = true;   // 캐시는 그대로 맞다
      return p0;
    }
    if (readOnly) {
      // 고칠 게 있어도 쓰지 않는다(저장 권한이 있는 사람이 열 때 고친다). 잠금을 못 잡았을 때와 같다.
      // p0 는 위 검사에서 고쳐졌을 수 있다(초기화 · 옮기기 흉내) — 시트 그대로를 보여 주게 새로 읽는다
      p0 = readProgress_(mode);
      try { journalOverlay_(p0.map, mode); } catch (eO1) { /* 넘어간다 */ }
      p0.adopted = 0; p0.etaReset = 0; p0.docAuto = 0;
      return p0;
    }
  } catch (eDry) {
    if (readOnly) { var pr = readProgress_(mode); pr.adopted = 0; pr.etaReset = 0; pr.docAuto = 0; try { journalOverlay_(pr.map, mode); } catch (eO2) { /* 넘어간다 */ } return pr; }
    /* 아래 예전 방식으로 */
  }
  var lock = LockService.getScriptLock();
  var locked = lock.tryLock(15000);
  try {
    if (locked) { try { drainJournal_(); } catch (eJ) { /* 다음에 */ } }
    var p = readProgress_(mode);
    p.adopted = 0;
    p.etaReset = 0;
    p.docAuto = 0;
    if (!locked) { try { journalOverlay_(p.map, mode); } catch (eO) { /* 넘어간다 */ } return p; }
    var changed = {};
    p.adopted = adoptOrphans_(p, rows, changed);
    // 캐시에 담긴(옛) 입고일정으로 판단하면 옛 값 ↔ 새 값을 오가며 체크를 지운다. 시트에서 막 읽었을 때만 본다.
    if (mode === 'po' && fresh) p.etaReset = etaResets_(p, rows, steps, changed);
    var auto = (mode === 'po' && fresh) ? autoSubmit_(p, rows, steps, cfg || {}, changed) : null;
    if (Object.keys(changed).length) writeProgRows_(p, changed);
    if (auto && auto.appends.length) {
      ensureRows_(p.sh, p.sh.getLastRow() + auto.appends.length);
      p.sh.getRange(p.sh.getLastRow() + 1, 1, auto.appends.length, RB.PROGRESS_HEAD.length).setValues(auto.appends);
    }
    if (auto) { logSteps_('po', auto.logRows); p.docAuto = auto.n; }
    // 진행 캐시는 잠금 안에서 담는다. 잠금을 놓은 뒤에 담으면, 그 사이 저장된 체크가 옛 값으로 덮여
    // 다음 접속(캐시로 그리는 첫 화면)에 체크가 풀린 것처럼 보였다.
    var lean = {};
    Object.keys(p.map).forEach(function (k) {
      var r = p.map[k];
      lean[k] = { checks: r.checks, notes: r.notes, dates: r.dates, ownerSet: r.ownerSet, updatedBy: r.updatedBy };
    });
    cachePut_('prog:v2:' + mode, lean, RB_TTL);
    try { CacheService.getScriptCache().put('prog:at:' + mode, String(Date.now()), RB_TTL); } catch (eAt) { /* 넘어간다 */ }
    p.cachedInLock = true;
    return p;
  } finally {
    if (locked) lock.releaseLock();
  }
}

/* ============================================================
 * 품의번호 입력 → 발주품의서 상신 자동 체크
 * ------------------------------------------------------------
 * 1) 스프레드시트 수정 트리거(onPlanEditRB)가 발주현황 · 발주계획의 [품의번호] 칸에
 *    값이 들어오는 것을 보고, 품의번호 → 입력한 날을 스크립트 속성(rb.docq)에 적어 둔다.
 *    같은 내용을 _실행판_변경이력 에도 한 줄 남긴다.
 * 2) 화면이 시트를 새로 읽을 때(autoSubmit_) 그 품의번호를 가진 건 중
 *    아직 상신 처리가 안 된 건을 찾아 상신일이 붙은 항목을 체크하고 상신일을 그 날로 찍는다.
 *    한 번 처리한 건은 dates.__docAuto 로 표시해 두고 다시 건드리지 않는다
 *    (나중에 사람이 체크를 풀어도 되살리지 않는다).
 * 트리거를 켜기 전에 이미 들어가 있던 품의번호는 건드리지 않는다(과거 건이 한꺼번에 체크되지 않게).
 * 다른 스크립트가 써 넣은 값은 수정 트리거가 못 본다(구글 제약). 사람이 입력 · 붙여넣기한 값만 잡힌다.
 * ============================================================ */

var RB_DOCQ_PROP = 'rb.docq';
var RB_DOCQ_DAYS = 45;          // 이보다 오래된 입력은 잊는다
var RB_DOCQ_MAX = 150;          // 스크립트 속성 한 칸은 9KB 까지라 개수를 묶는다
var RB_DOC_TRIGGER = 'onPlanEditRB';

/** 'yyyy-MM-dd' — 화면의 날짜칸(상신일 등)과 같은 모양 */
function ymd_(d) {
  return d.getFullYear() + '-' + pad2_(d.getMonth() + 1) + '-' + pad2_(d.getDate());
}

function docQueueRead_() {
  try {
    var q = JSON.parse(PropertiesService.getScriptProperties().getProperty(RB_DOCQ_PROP) || '{}');
    return (q && typeof q === 'object') ? q : {};
  } catch (e) { return {}; }
}

function docQueueWrite_(q) {
  var cut = ymd_(new Date(Date.now() - RB_DOCQ_DAYS * 864e5));
  var keys = Object.keys(q).filter(function (k) { return String(q[k]) >= cut; })
    .sort(function (a, b) { return q[a] < q[b] ? 1 : (q[a] > q[b] ? -1 : 0); })
    .slice(0, RB_DOCQ_MAX);
  var out = {};
  keys.forEach(function (k) { out[k] = q[k]; });
  PropertiesService.getScriptProperties().setProperty(RB_DOCQ_PROP, JSON.stringify(out));
}

/** 탭의 머리글 행 · 품의번호 열 · 품목명 열(0부터). 수정 트리거가 자주 불리므로 캐시에 둔다. */
function docCols_(sh, name) {
  var ck = 'doccols:v2:' + name;
  var cache = CacheService.getScriptCache();
  try { var hit = cache.get(ck); if (hit) return JSON.parse(hit); } catch (e) { /* 다시 읽는다 */ }
  var isPlan = name === RB.PLAN_TAB;
  var lc = Math.min(sh.getLastColumn(), isPlan ? RB.PLAN_COLS : RB.STATUS_COLS);
  var hr = isPlan ? RB.PLAN_HEADER_ROW : statusHeaderRow_(sh, lc);
  if (hr < 1 || lc < 1) return null;
  var idx = headerIndex_(sh.getRange(hr, 1, 1, lc).getValues()[0]);
  var out = { hr: hr, doc: colIdx_(idx, ['품의번호']), name: colIdx_(idx, isPlan ? ['상품명', '품목명'] : ['품목명']) };
  try { cache.put(ck, JSON.stringify(out), RB_TTL); } catch (e) { /* 무시 */ }
  return out;
}

/**
 * 스프레드시트 수정 트리거. 발주 DB · 발주계획의 [품의번호] 칸을 손으로 고쳤을 때만 일한다.
 * 다른 칸 · 다른 탭은 곧바로 돌아간다(탭 이름만 보고 끝).
 */
function onPlanEditRB(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    var name = sh.getName();
    // 샘플 탭을 시트에서 직접 고치면(담당자 · 업체 등) 실행판 목록 캐시(6시간)를 바로 버린다 — 예전엔 고친 값이 몇 시간 안 보였다
    if (name === RB.SAMPLE_TAB) { dropSampleCache_(); try { bumpVer_('r'); } catch (eV) { /* 넘어간다 */ } return; }
    if (name !== RB.STATUS_TAB && name !== RB.PLAN_TAB) return;
    var cols = docCols_(sh, name);
    if (!cols || cols.doc < 0) return;
    var col = cols.doc + 1;
    if (col < e.range.getColumn() || col > e.range.getLastColumn()) return;
    var r0 = Math.max(e.range.getRow(), cols.hr + 1), r1 = e.range.getLastRow();
    if (r1 < r0) return;
    r1 = Math.min(r1, r0 + 499);             // 한꺼번에 붙여넣어도 500행까지만 본다
    var n = r1 - r0 + 1;
    var docs = sh.getRange(r0, col, n, 1).getValues();
    var names = cols.name >= 0 ? sh.getRange(r0, cols.name + 1, n, 1).getValues() : null;
    // 발주 DB 는 그 줄의 실행판ID 로 적는다 — 품의번호로만 적으면 같은 품의번호를 가진 다른 줄(복사한 2차 등)까지 상신 처리됐다
    var idc = name === RB.STATUS_TAB ? statusKeyCols_(sh, cols.hr).id : -1;
    var rids = idc >= 0 ? sh.getRange(r0, idc + 1, n, 1).getValues() : null;
    var today = ymd_(new Date());
    var single = n === 1 && e.range.getNumRows() === 1 && e.range.getNumColumns() === 1;
    var audits = [], fresh = {};
    docs.forEach(function (d, i) {
      var doc = str_(d[0]);                              // 발주계획 A열의 옛 체크박스(TRUE/FALSE)는 빈 값으로 읽힌다
      if (!doc) return;
      if (single && str_(e.oldValue) === doc) return;     // 같은 값을 다시 적은 것
      var rid = rids ? str_(rids[i][0]) : '';
      fresh[RB_ID_RE.test(rid) ? 'id:' + rid : norm_(doc)] = 1;
      audits.push({ tab: name, row: r0 + i, col: col, what: '품의번호 입력 → 실행판 상신 자동 체크',
        before: single ? str_(e.oldValue) : '', after: doc, item: names ? str_(names[i][0]) : '' });
    });
    if (!audits.length) return;
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) return;          // AP 다시 쓰기(10초 남짓)가 잠금을 쥐고 있어도 기다린다
    try {
      var q = docQueueRead_();
      Object.keys(fresh).forEach(function (k) { if (!q[k]) q[k] = today; });   // 처음 들어온 날을 지킨다
      docQueueWrite_(q);
      writeAudits_(audits);
    } finally {
      lock.releaseLock();
    }
  } catch (err) { try { console.error('onPlanEditRB 실패: ' + (err && err.stack || err)); } catch (eL) { /* 넘어간다 */ } }   // 트리거가 실패해도 시트 편집은 막지 않는다(기록만 남긴다)
}

/**
 * 화면이 시트를 새로 읽을 때: 품의번호가 들어온 건에 상신 체크 + 상신일.
 * changed 에 고친 줄을 넣고, 진행 기록이 없던 건은 새 줄(appends)로 돌려준다.
 */
function autoSubmit_(p, rows, steps, cfg, changed) {
  var out = { n: 0, appends: [], logRows: [] };
  var q = docQueueRead_();
  if (!Object.keys(q).length) return out;
  var keys = dateSlots_(steps, cfg, 'po').byField.submitted.map(function (x) { return x.key; });
  if (!keys.length) return out;
  var who = '품의번호 입력(자동)';
  rows.forEach(function (r) {
    if (!r.doc) return;
    // 실행판ID 가 있는 건은 그 ID 로 적힌 것만(품의번호가 같은 다른 줄 때문에 상신되지 않게). 예전 열쇠 건만 품의번호로.
    var day = RB_ID_RE.test(String(r.id || '')) ? q['id:' + r.id] : q[norm_(r.doc)];
    if (!day) return;
    var rec = findProg_(p, r.id);
    var st = progState_(rec);
    if (st.dates.__docAuto) return;                           // 한 번 처리한 건
    if (st.dates.submitted && keys.every(function (k) { return st.checks[k]; })) return;   // 이미 상신 처리됨
    keys.forEach(function (k) { st.checks[k] = 1; });
    if (!st.dates.submitted) st.dates.submitted = day;
    st.dates.__docAuto = day;
    var meta = { doc: r.doc, name: r.name, batch: r.batch, brand: r.brand };
    var ch = stampSteps_(st.checks, st.dates, steps);
    out.logRows = out.logRows.concat(stepLogRows_('po', r.id, meta, ch, st.dates, steps, who));
    var vals = progRowValues_(r.id, meta, st);
    vals[9] = who;
    if (rec) {
      rec.checks = st.checks; rec.dates = st.dates;
      p.raw[rec.row - 2] = vals;
      changed[rec.row] = vals;
    } else {
      out.appends.push(vals);
      p.map[r.id] = { id: r.id, checks: st.checks, notes: st.notes, dates: st.dates, ownerSet: '', updatedBy: who, updatedAt: fmtDate_(new Date()) };
    }
    out.n++;
  });
  return out;
}

/** 품의번호 감지 트리거가 켜져 있는지 */
function docWatchOn_() {
  return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === RB_DOC_TRIGGER; });
}

/**
 * 품의번호 감지 트리거를 켠다(이미 있으면 새로 한 개만 남긴다).
 * 처음 한 번은 편집기에서 이 함수를 직접 실행해 '트리거 관리' 권한을 허용해야 한다.
 */
function installDocWatch() {
  requireAdmin_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === RB_DOC_TRIGGER) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger(RB_DOC_TRIGGER).forSpreadsheet(RB.SS_ID).onEdit().create();
  return true;
}

/** 관리자: 품의번호 감지 상태 보기 · 켜기 · 끄기. on 이 없으면 상태만 본다. */
function apiDocWatch(on) {
  requireAdminFast_('po');
  try {
    if (on === true) installDocWatch();
    else if (on === false) {
      ScriptApp.getProjectTriggers().forEach(function (t) {
        if (t.getHandlerFunction() === RB_DOC_TRIGGER) ScriptApp.deleteTrigger(t);
      });
    }
    return { on: docWatchOn_(), queued: Object.keys(docQueueRead_()).length };
  } catch (e) {
    throw new Error('트리거 권한이 아직 없습니다. 편집기에서 installDocWatch 를 한 번 실행해 권한을 허용해 주세요. (' + e.message + ')');
  }
}

/* ============================================================
 * 캐시 — 시트가 커서 매번 읽으면 느리다.
 * 값이 100KB를 넘을 수 있어 조각내서 넣는다(한글은 글자당 3바이트).
 * ============================================================ */

var RB_CACHE_CHUNK = 25000;      // 한 칸 25,000자 — 한글만 있어도 75KB 라 칸 한도(100KB) 안
// 칸 수 한도. 예전 30칸(75만 자)은 발주 약 1,000건에서 넘쳐, 첫 화면 캐시가 소리 없이 안 담기고 모든 접속이 느린 길로 갔다.
var RB_CACHE_MAX_PARTS = 120;

function cacheGet_(key) {
  try {
    var c = CacheService.getScriptCache();
    var meta = c.get(key + ':n');
    if (!meta) return null;
    var n = Number(meta);
    if (!n || n > RB_CACHE_MAX_PARTS) return null;
    var keys = [];
    for (var i = 0; i < n; i++) keys.push(key + ':' + i);
    var all = c.getAll(keys);
    var s = '';
    for (var j = 0; j < n; j++) {
      var part = all[key + ':' + j];
      if (part == null) return null;
      s += part;
    }
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
}

function cacheDrop_(key) {
  try { CacheService.getScriptCache().remove(key + ':n'); } catch (e) { /* 무시 */ }
  // 설정 · 단계(meta:) · 발주 목록(rows:) 캐시는 세대 번호도 올린다 — 그 전에 시트를 읽기 시작한 느린 길이 옛 값을 다시 담지 않게(cacheGenSame_)
  if (/^(meta|rows):/.test(String(key))) cacheGenBump_(String(key).split(':')[0]);
}
/** 캐시 세대 번호(kind = 'meta' | 'rows') — 버릴 때마다 바뀐다 */
function cacheGen_(kind) {
  try { return CacheService.getScriptCache().get(kind + ':gen') || ''; } catch (e) { return ''; }
}
function cacheGenBump_(kind) {
  try { CacheService.getScriptCache().put(kind + ':gen', String(Date.now()) + ':' + Math.random().toString(36).slice(2, 8), 21600); } catch (e) { /* 넘어간다 */ }
}
/** 읽기 시작할 때 본 세대(g0)가 그대로인가 — 그 사이 누가 버렸으면 false(옛 값을 담지 않는다) */
function cacheGenSame_(kind, g0) {
  return cacheGen_(kind) === g0;
}

/** 진행 상태 캐시 — 체크 하나 바뀔 때마다 시트를 다시 읽지 않도록 제자리에서 고친다. */
function progCachePatch_(id, st, mode) {
  var key = 'prog:v2:' + ((mode === 'sample') ? 'sample' : 'po');
  var m = cacheGet_(key);
  if (!m) return;
  // 담당자 지정(ownerSet)도 같이 넣는다. 빠뜨리면 다음 접속에 담당자가 원래대로 돌아가 보였다.
  m[id] = { checks: st.checks || {}, notes: st.notes || {}, dates: st.dates || {},
            ownerSet: st.ownerSet || '', updatedBy: me_() };
  cachePut_(key, m, RB_TTL);
}

/**
 * 캐시 수명. 15분이라 조금만 안 쓰면 매번 시트를 통째로 다시 읽었다.
 * CacheService 최대치인 6시간으로 늘리고, 대신 화면은 캐시로 먼저 그린 뒤
 * 뒤에서 조용히 새로 읽어 바꿔치는 방식(아래 apiBootstrap 의 lvl 1)으로 신선도를 맞춘다.
 */
var RB_TTL = 21600;

/** 설정 · 단계 캐시 열쇠. 담는 모양이 바뀌면 v 번호를 올린다(v10: 항목별 날짜 연동 · 추가 버튼). */
function metaKey_(mode) {
  return 'meta:v10:' + ((mode === 'sample') ? 'sample' : 'po');
}

function cachePut_(key, obj, ttlSec) {
  try {
    var c = CacheService.getScriptCache();
    var s = JSON.stringify(obj);
    var parts = Math.ceil(s.length / RB_CACHE_CHUNK);
    if (parts > RB_CACHE_MAX_PARTS) { try { console.log('캐시 한도 넘음(안 담음): ' + key + ' ' + s.length + '자'); } catch (e0) { /* 넘어간다 */ } return; }
    var map = {};
    for (var i = 0; i < parts; i++) map[key + ':' + i] = s.substr(i * RB_CACHE_CHUNK, RB_CACHE_CHUNK);
    map[key + ':n'] = String(parts);
    c.putAll(map, ttlSec || 600);
  } catch (e) { try { console.warn('캐시 담기 실패(' + key + '): ' + e.message); } catch (eW) { /* 넘어간다 */ } }   // 캐시는 실패해도 그냥 넘어간다
}

/* ============================================================
 * 클라이언트에서 부르는 함수들
 * ============================================================ */

/**
 * 캐시에 설정 · 발주건 · 진행이 모두 있으면 첫 화면 데이터를 바로 만든다. 하나라도 없으면 null(시트는 열지 않는다).
 * doGet(HTML 에 담기) 과 apiBootstrap(빠른 길)이 같이 쓴다. embedded 는 doGet 에서 부를 때.
 */
function cachedBoot_(mode, embedded) {
  var t0 = Date.now();
  var meta = cacheGet_(metaKey_(mode));
  if (!meta || !meta.cfg) return null;
  var rowsC = cacheGet_(rowsCacheKey_(mode, meta.cfg));
  var progC = cacheGet_('prog:v2:' + mode);
  if (!rowsC || !progC) return null;
  try { journalOverlay_(progC, mode); } catch (e) { /* 넘어간다 */ }
  rowsC.forEach(function (r) { attachProg_(r, progC[r.id]); });
  var t = { total: Date.now() - t0, cached: 'all',
            age: meta.builtAt ? (Date.now() - meta.builtAt) : 99999999 };
  if (embedded) t.embedded = true;
  return bootResult_(mode, meta, rowsC, isAdminFast_(meta.cfg['admin.emails'], meta.ownerEmail), t);
}

function apiBootstrap(force, mode) {
  mode = (mode === 'sample') ? 'sample' : 'po';
  var t0 = Date.now(), t = {};
  var lvl = force === true ? 1 : (Number(force) || 0);   // 0 = 캐시, 1 = 발주계획 다시, 2 = 전부 다시
  var deep = lvl >= 2;

  // ── 빠른 길: 설정 · 발주건 · 진행이 모두 캐시에 있으면 스프레드시트를 한 번도 열지 않는다.
  if (!lvl) {
    var fast = cachedBoot_(mode);
    if (fast) return fast;
  }

  // ── 느린 길: 시트에서 실제로 읽는다.
  setup_();
  t.setup = Date.now() - t0;

  var m = Date.now();
  var metaGen0 = cacheGen_('meta');      // 시트를 읽는 사이 설정 · 단계가 저장되면(캐시 버림) 옛 값을 다시 담지 않는다
  var metaC = deep ? null : cacheGet_(metaKey_(mode));
  if (metaC && !metaC.cfg) metaC = null;
  var cfg, steps;
  if (metaC) {
    // 단계·링크·설정은 거의 안 바뀐다. [새로고침]은 발주계획 · 발주현황만 다시 읽는다.
    // 설정은 통째로 캐시에 들어 있다. 예전에는 3개만 되살려서 새로고침할 때마다
    // 관리자가 정한 단계 지정 · 기준일이 기본값으로 돌아갔다.
    steps = metaC.steps;
    cfg = metaC.cfg;
    t.metaCached = true;
  } else {
    cfg = readConfig_();
    steps = readSteps_(mode);
  }
  t.config = Date.now() - m;

  // 발주계획 · 발주현황 읽기가 제일 무겁다. 캐시에 담아두고, [새로고침]을 누르면 다시 읽는다.
  m = Date.now();
  var cacheKey = rowsCacheKey_(mode, cfg);
  var rows = lvl ? null : cacheGet_(cacheKey);
  t.cached = rows ? 'rows' : false;
  if (!rows) {
    // 읽는 사이 누가 발주 DB 를 고쳤으면(목록 캐시 버림 · 변경 번호 r) 방금 읽은 옛 목록을 캐시에 담지 않는다
    var rowsGen0 = cacheGen_('rows'), rowsVer0 = '';
    try { rowsVer0 = CacheService.getScriptCache().get('rb:ver:r') || ''; } catch (eV) { rowsVer0 = ''; }
    rows = (mode === 'sample') ? readSampleRows_(cfg) : readOrderRows_(cfg);
    var rowsVer1 = '';
    try { rowsVer1 = CacheService.getScriptCache().get('rb:ver:r') || ''; } catch (eV2) { rowsVer1 = ''; }
    if (cacheGenSame_('rows', rowsGen0) && rowsVer1 === rowsVer0) cachePut_(cacheKey, rows, RB_TTL);
    else t.rowsStale = true;
  }
  t.plan = Date.now() - m;

  m = Date.now();
  // 시트에 쓰는 정리(진행 기록 옮기기 · 담당 칸 맞추기)는 저장 권한이 있는 사람이 열 때만 한다.
  // 보기만 하는 사람은 읽기만 하고 화면은 그대로 띄운다(권한 없는 쓰기가 생기지 않게).
  var canW = RB_EDITOR_OK || editorOk_(cfg, metaC ? metaC.ownerEmail : '');
  t.readOnly = !canW;
  // 주인 잃은 진행 기록 옮기기 + 입고일정 변경 초기화 (잠금 안에서 한 번에)
  var p = reconcileProgress_(rows, steps, mode, !t.cached, cfg, !canW);
  t.adopted = p.adopted;
  t.etaReset = p.etaReset;
  t.docAuto = p.docAuto;
  t.progress = Date.now() - m;

  // 진행 캐시는 reconcileProgress_ 가 잠금 안에서 담는다. 잠금을 못 잡아 못 담았으면 옛 캐시를 버린다.
  if (!p.cachedInLock) cacheDrop_('prog:v2:' + mode);

  var metaNew = {
    cfg: cfg,
    steps: steps,
    links: metaC ? metaC.links : linksFromConfig_(cfg),
    linkDefs: metaC ? metaC.linkDefs : readLinkDefs_(cfg),
    ownerEmail: metaC ? metaC.ownerEmail : owner_(),
    builtAt: Date.now()
  };
  if (cacheGenSame_('meta', metaGen0)) cachePut_(metaKey_(mode), metaNew, RB_TTL);   // 그 사이 설정 · 단계 저장이 있었으면 담지 않는다(되살아남 방지)

  rows.forEach(function (r) {
    var rec = findProg_(p, r.id);
    attachProg_(r, rec);
    r.updatedAt = rec ? rec.updatedAt : '';
  });
  if (mode === 'po' && canW) {
    var fixOwners = rows.filter(function (r) { return r.statusRow >= 2 && r.ownerManual && !r.sheetOwner && r.owner && r.owner !== '미지정'; });
    if (fixOwners.length) {
      try {
        t.ownerSync = writeOwnerCells_(fixOwners.map(function (r) {
          return { statusRow: r.statusRow, expect: { id: r.id, doc: r.doc, code: r.code, batch: r.batch, name: r.name }, owner: r.owner };
        }), true);
        fixOwners.forEach(function (r) { r.sheetOwner = r.owner; });
        cacheDrop_(cacheKey);
      } catch (e) { try { console.warn('담당 칸 맞추기 실패: ' + e.message); } catch (e2) { /* 넘어간다 */ } }   // 실패해도 화면은 띄운다
    }
  }

  t.total = Date.now() - t0;
  return bootResult_(mode, metaNew, rows, isAdmin_(cfg), t);
}

/** 발주건 목록 캐시 열쇠. 행에 담는 항목이 바뀌면 v 번호를 올린다(안 올리면 옛 형태가 계속 나온다). */
function rowsCacheKey_(mode) {
  return 'rows:v35:' + mode;      // v31: 샘플 링크(links) · v32: 업체별 담당자(owners) · v35: 샘플ID · 프로젝트ID
}

/** 발주건 한 줄에 진행 기록을 붙인다. */
function attachProg_(r, rec) {
  r.checks = rec ? (rec.checks || {}) : {};
  r.notes = rec ? (rec.notes || {}) : {};
  r.dates = rec ? (rec.dates || {}) : {};
  r.updatedBy = rec ? (rec.updatedBy || '') : '';
  // '미지정' 은 지정이 아니다(예전 버전이 화면 담당자를 그대로 적어 둔 흔적).
  if (rec && rec.ownerSet && rec.ownerSet !== '미지정') { r.owner = rec.ownerSet; r.ownerManual = true; }
}

/** 설정 중 화면이 쓰는 값. 첫 화면(bootResult_)과 설정 저장(apiSaveConfig)이 같은 모양을 돌려준다. */
function cfgView_(cfg) {
  cfg = cfg || {};
  return {
    adminEmails: cfg['admin.emails'] || '',
    editEmails: cfg['edit.emails'] || '',                   // 저장할 수 있는 사람(관리자는 늘 가능) — 둘 다 아니면 보기만
    datesStepTitle: (cfg['dates.stepTitle'] === undefined ? '상신' : cfg['dates.stepTitle']),
    editStepTitle: (cfg['edit.stepTitle'] === undefined ? '입고' : cfg['edit.stepTitle']),
    editStepId: cfg['edit.stepId'] || '',
    datesStepId: cfg['dates.stepId'] || '',
    orderStepId: cfg['order.stepId'] || '',
    editOpen: !editList_(cfg).length,                       // [edit.emails] 가 비어 있어 누구나 저장할 수 있음(화면 경고용)
    fx: { CNY: Number(cfg['fx.CNY']) || 200, USD: Number(cfg['fx.USD']) || 1400 },   // 단가 통화 환율(원) — 설정에서 바꿈
    choices: choicesOf_(cfg)                                 // 드롭다운으로만 고르는 항목(구분 · 브랜드 · 채널 · 발주요청팀)
  };
}

/** 화면에 넘길 값. 빠른 길 · 느린 길이 같은 모양을 돌려주도록 한 곳에서 만든다. */
function bootResult_(mode, meta, rows, isAdmin, t) {
  var out = cfgView_(meta.cfg);
  out.me = me_();
  out.isAdmin = isAdmin;
  try { out.canEdit = RB_EDITOR_OK || editorOk_(meta.cfg || {}, meta.ownerEmail); } catch (e) { out.canEdit = true; }   // 화면이 보기 전용 안내를 띄울 때
  out.steps = meta.steps;
  out.links = meta.links;
  out.linkDefs = meta.linkDefs;
  out.rows = rows;
  out.mode = mode;
  out.ownerEmail = meta.ownerEmail;
  out.timing = t;
  out.build = RB_BUILD;                 // 화면 판 번호 — 열어 둔 옛 화면이 새로 읽을 때 새 버전 안내를 띄운다
  if (mode === 'po') {
    try { out.lineMap = linesMapCached_(!(t && t.cached === 'all')); out.lineMonths = payMonthOptions_(); } catch (e) { out.lineMap = null; }
  }
  return out;
}

/**
 * 여러 건의 발주일을 발주현황에 한꺼번에 적는다.
 * items: [{statusRow, name, doc, code, batch, id, meta}], value: 'yyyy-MM-dd'
 * id 가 있으면 발주일이 붙은 항목(발주서 발송)도 체크한다.
 */
function apiBulkOrderDate(items, value) {
  requireEditor_();
  var list = (items || []).filter(function (x) { return Number(x && x.statusRow) >= 2; });
  if (!list.length) return { n: 0 };

  var ymd = String(value || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!ymd) throw new Error('발주일을 넣어주세요.');
  var stamp = ymd[1].slice(2) + '/' + pad2_(Number(ymd[2])) + '/' + pad2_(Number(ymd[3]));

  var sh = statusSheet_();
  var C = sheetCols_(sh);
  var cOrd = colIdx_(C.idx, ['발주일']);
  if (cOrd < 0) throw new Error('[발주일] 열을 찾을 수 없습니다.');

  var dval = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
  var n = 0, skipped = [], wrote = [];
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var outer = deferVer_();
  try {
    // ① 모두 읽기: 행 찾기(ID 열 한 번) · 발주일 칸 값/수식 · 진행상태 칸. ② 한꺼번에 쓰기. 예전에는 건마다 읽기 → 쓰기 → 이력(시트 반영)을
    // 되풀이해서 쓰기 뒤 읽기마다 재계산을 기다렸다(10건이면 수십 초, 그동안 다른 저장이 모두 멈춤).
    var ix = statusIdIndex_(sh, C), rows = [], by = {};
    list.forEach(function (x) {
      var at;
      try { at = findStatusRow_(ix, sh, C, Number(x.statusRow), x); }
      catch (err) { skipped.push(x.statusRow + '행 (' + (x.name || '') + ') — 행이 바뀜, 새로고침 필요'); return; }
      if (by[at]) return;                              // 같은 행이 두 번 오면 한 번만
      by[at] = x; rows.push(at);
    });
    var a = rows.length ? Math.min.apply(null, rows) : 0, b = rows.length ? Math.max.apply(null, rows) : 0;
    var rg = rows.length ? sh.getRange(a, cOrd + 1, b - a + 1, 1) : null;
    var fv = rg ? rg.getFormulas() : [], vv = rg ? rg.getValues() : [];
    var stCur = ix.kc.state >= 0 ? colAt_(sh, ix.kc.state, rows) : {};
    var put = [], stUp = [], audits = [];
    rows.forEach(function (at) {
      var x = by[at];
      if (fv[at - a][0]) { skipped.push(at + '행 (' + (x.name || '') + ') — 수식 칸'); return; }   // 수식 칸은 건드리지 않는다(이유는 알린다)
      put.push(at);
      audits.push({ tab: RB.STATUS_TAB, row: at, col: cOrd + 1, what: '발주일', before: vv[at - a][0], after: stamp });
      if (x.id) wrote.push({ id: String(x.id), meta: x.meta || {} });
      // 진행상태: 발주일을 넣으면 '발주' 로(앞으로만 — 종결 · 취소 · 이미 발주면 그대로)
      var c0 = str_(stCur[at]), ci = RB_STATE_ORDER.indexOf(c0);
      if (ix.kc.state >= 0 && !(c0 && ci < 0) && ci < RB_STATE_ORDER.indexOf('발주')) {
        stUp.push(at);
        audits.push({ tab: RB.STATUS_TAB, row: at, col: ix.kc.state + 1, what: '진행상태(자동)', before: c0, after: '발주', item: str_(x.name) });
      }
    });
    setCellsSame_(sh, put, cOrd, dval);                 // 문자열이 아니라 날짜로 쓴다
    try { var og = ordGuardRead_(), ogW = me_(); wrote.forEach(function (w) { og[w.id] = { v: stamp, at: Date.now(), who: ogW }; }); ordGuardWrite_(og); } catch (eOg) { /* 지킴 목록은 실패해도 된다 */ }
    setCellsSame_(sh, stUp, ix.kc.state, '발주');
    writeAudits_(audits);
    n = put.length;
  } finally {
    try { endVer_(outer); } catch (e) { /* 넘어간다 */ }
    lock.releaseLock();
  }
  if (n) cacheDrop_(rowsCacheKey_('po'));
  // 발주일을 적은 건은 발주일이 붙은 항목(발주서 발송)도 체크한다. 시트 쓰기가 끝난 뒤 진행 기록만 따로 고친다.
  var checked = 0;
  if (wrote.length) {
    try {
      var M = metaFast_('po');
      var slots = dateSlots_(M.steps, M.cfg, 'po');
      var me = me_(), logRows = [];
      checked = bulkEditProgress_(wrote, 'po', function (st, it) {
        if (!checkByDate_(st.checks, slots, 'ordered').length) return false;
        logRows = logRows.concat(stepLogRows_('po', it.id, it.meta, stampSteps_(st.checks, st.dates, M.steps), st.dates, M.steps, me));
      }, function () { logSteps_('po', logRows); });
    } catch (e) { /* 체크가 실패해도 시트에 쓴 발주일은 그대로 둔다 */ }
  }
  if (n) apRefreshSoon_();                         // AP A열(발주일)
  return { n: n, stamp: stamp, skipped: skipped, col: colLetterRB_(cOrd + 1), checked: checked };
}

/** 시트가 날짜로 바꾸지 않게 글자 그대로 넣는 값. '9/23' 을 그냥 넣으면 올해 9월 23일 날짜가 된다. */
function asText_(s) {
  s = String(s == null ? '' : s);
  return s === '' ? '' : "'" + s;
}

/**
 * 시트에 넣을 값. 숫자는 숫자로, 연·월·일이 다 있는 날짜는 날짜로, 나머지는 글자 그대로.
 *  · 'YY/MM/DD' 를 글자로 넣으면 열 서식과 어긋나고 매입예정 자동화가 날짜로 못 읽는다.
 *  · 'M/D' 나 '10/15,10/28' 을 그냥 넣으면 시트가 올해 날짜로 멋대로 바꾼다.
 */
function cellValue_(v) {
  if (v === '' || v == null) return '';
  if (typeof v === 'number' || typeof v === 'boolean' || v instanceof Date) return v;
  var s = String(v).trim();
  if (s === '') return '';
  var n = s.replace(/,/g, '');
  if (/^-?\d+(\.\d+)?$/.test(n)) return Number(n);
  if (/^(\d{4}|\d{2})[.\-\/]\d{1,2}[.\-\/]\d{1,2}\.?$/.test(s)) {
    var d = toDate_(s);
    if (d) return d;
  }
  return asText_(s);
}

/** 건별 단가 통화(KRW · CNY · USD). 진행 기록 checks._cur 에 둔다. */
function apiSetCur(id, meta, cur, mode) {
  cur = String(cur || '').toUpperCase();
  if (['KRW', 'CNY', 'USD'].indexOf(cur) < 0) throw new Error('통화는 원화 · 위안 · 달러 중에서 고르세요.');
  var out = journalSave_({ mode: mode || 'po', id: id, meta: meta, kind: 'cur', cur: cur },
    function (st) { return { checks: st.checks }; },
    function () { var res = editProgress_(id, meta, mode || 'po', function (st) { st.checks._cur = cur; }); return { checks: res.state.checks }; });
  if ((mode || 'po') === 'po') { try { dbSetCur_(id, cur); } catch (e) { /* 진행 기록엔 저장됨 — 발주 DB 칸은 다음 이관 · 수정 때 */ } }
  return out;
}
/** 발주 DB 통화 칸(새 양식) — 다른 저장을 오래 막지 않게 잠금은 3초만 기다린다 */
function dbSetCur_(id, cur) {
  var sh = statusSheet_(), C = sheetCols_(sh), c = colIdx_(C.idx, ['통화']);
  if (c < 0 || !id) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return;
  try {
    var row = checkStatusRow_(sh, C, 0, { id: id });
    sh.getRange(row, c + 1).setValue(cur);
  } finally { lock.releaseLock(); }
}

/* ============================================================
 * 단계 완료 시각
 * 어느 단계에서 오래 걸렸는지 나중에 보려고 남긴다.
 * 완료 시각은 진행 기록의 날짜JSON 에 's:<단계ID>' 로 넣는다(새 열이 필요 없다).
 * 처리 한 건마다 _실행판_단계이력 탭에도 한 줄씩 쌓는다.
 * ============================================================ */

function stampNow_() {
  var d = (RB_ACT && RB_ACT.at) ? RB_ACT.at : new Date();     // 장부를 옮길 때는 저장한 시각으로
  return d.getFullYear() + '-' + pad2_(d.getMonth() + 1) + '-' + pad2_(d.getDate()) + ' ' +
    pad2_(d.getHours()) + ':' + pad2_(d.getMinutes()) + ':' + pad2_(d.getSeconds());
}

/** 'yyyy-MM-dd HH:mm:ss' 를 Date 로 */
function parseStamp_(s) {
  var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
}

/**
 * 이 시각 전에 이미 끝난 단계는 예전 규칙(필수 항목만 체크하면 통과)으로 본다.
 * 규칙을 바꿨다고 이미 끝난 과거 건의 진행이 되돌아가지 않게.
 * 화면도 이 값을 그대로 쓴다(SHARED_RULES_JS_).
 */
var RB_OPT_RULE_FROM = '2026-09-30 13:00:00';

/**
 * 한 단계가 끝났는지 — 건너뛰었거나, 모든 항목이 정리된 경우.
 * 정리 = 체크함 · 또는 생략 가능한 항목을 [생략] 함 · 또는 변경 여부 항목을 [변경 없음]으로 정함.
 * 화면도 이 함수를 그대로 쓴다(SHARED_RULES_JS_).
 */
function stepDoneSrv_(checks, st, dates) {
  if (checks['_skip_' + st.id]) return true;
  var at = dates && dates['s:' + st.id];
  if (!(at && String(at) < RB_OPT_RULE_FROM)) {
    var items = st.items || [];
    if (!items.length) return false;
    return items.every(function (it, i) { return itemResolved_(it, checks, itemKey_(st, i)); });
  }
  var need = 0, got = 0, decided = false;
  (st.items || []).forEach(function (it, i) {
    var k = itemKey_(st, i);
    if (it && it.chg && chgDec_(checks, k) === 'N') decided = true;
    if (itemRequired_(it, checks, k)) { need++; if (checks[k]) got++; }
  });
  // 필수 항목이 하나도 없으면, '변경 없음'으로 정리한 항목이 있을 때만 통과로 본다
  return need ? got === need : decided;
}

/** 항목이 정리됐는지 — 체크 · 생략 가능 항목의 [생략] · 변경 여부 항목의 [변경 없음] */
function itemResolved_(it, checks, key) {
  if (checks[key]) return true;
  if (itemRequired_(it, checks, key)) return false;
  return (it && it.chg && chgDec_(checks, key) === 'N') || !!checks['sk:' + key];
}

/** '변경 여부' 항목의 결정: 'Y'(있음) · 'N'(없음) · ''(아직) */
function chgDec_(checks, key) {
  var v = checks['cy:' + key];
  return (v === 'Y' || v === 'N') ? v : '';
}

/**
 * 이 항목을 체크해야 단계가 통과되는지.
 * 변경 있음 → 꼭 체크해야 한다. 변경 없음 → 생략 가능. 아직 안 정했으면 원래 설정(생략 가능 여부)대로.
 */
function itemRequired_(it, checks, key) {
  if (it && it.chg) {
    var d = chgDec_(checks, key);
    if (d === 'Y') return true;
    if (d === 'N') return false;
  }
  return !(it && it.o);
}

/**
 * 체크 항목의 저장 열쇠. 항목마다 붙은 k 를 쓴다(없으면 순번).
 * 순번만 쓰면 관리자가 항목을 지우거나 끼워 넣을 때 기존 체크가 다른 항목으로 옮겨 갔다.
 */
function itemKey_(st, i) {
  var it = (st.items || [])[i];
  var k = (it && it.k !== undefined && it.k !== '') ? it.k : i;
  return st.id + '_' + k;
}

/** 단계 정의 — 캐시에 있으면 그걸 쓴다. 체크 한 번에 시트를 한 번 덜 읽는다. */
function stepsFast_(mode) {
  return metaFast_(mode).steps;
}

/** 단계 정의 + 설정 — 캐시에 있으면 그걸 쓴다. */
function metaFast_(mode) {
  var m = cacheGet_(metaKey_(mode));
  if (m && m.cfg && m.steps && m.steps.length) return { steps: m.steps, cfg: m.cfg };
  return { steps: readSteps_(mode), cfg: readConfig_() };
}

/* ============================================================
 * 항목별 날짜 연동
 * ------------------------------------------------------------
 * 항목 하나에 날짜 하나를 붙일 수 있다(항목의 d).
 *   submitted 상신일 · approved 승인일 : 실행판 진행 기록에 저장
 *   ordered   발주일                  : 발주현황 시트의 [발주일] 칸에 저장
 *   req       요청일                  : 실행판 진행 기록에 저장(항목마다 따로)
 * 날짜를 넣으면 그 항목이 체크되고(상신일 · 승인일 · 발주일), 항목을 체크하면 비어 있던 날짜에 오늘이 들어간다.
 * d 를 정하지 않은 항목은 예전처럼 단계 · 항목 이름으로 짐작한다(설정 화면의 '자동').
 * 화면도 dateSlots_ 를 그대로 쓴다(SHARED_RULES_JS_).
 * ============================================================ */

var RB_DATE_FIELDS = ['submitted', 'approved', 'ordered', 'req'];
var RB_REQ_DATE_RE = /데이터\s*파일\s*이관|디자인\s*검토\s*시트/;   // 요청일 칸이 붙는 항목(둘은 같은 요청일을 같이 쓴다 — reqLinkKey)

/** 상신일 · 승인일을 짐작할 단계 — 설정의 dates.stepId, 없으면 단계명에 dates.stepTitle(기본 '상신')이 든 단계 */
function datesStepId_(steps, cfg) {
  var id = String(cfg['dates.stepId'] || '');
  if (id && steps.some(function (s) { return s.id === id; })) return id;
  var title = cfg['dates.stepTitle'] === undefined ? '상신' : String(cfg['dates.stepTitle'] || '');
  if (!title) return '';
  var hit = steps.filter(function (s) { return String(s.title || '').indexOf(title) > -1; })[0];
  return hit ? hit.id : '';
}

/** 발주일을 짐작할 단계 — 설정의 order.stepId, 없으면 단계명에 [발주서] 나 [발송]이 든 단계 */
function orderStepId_(steps, cfg) {
  var id = String(cfg['order.stepId'] || '');
  if (id && steps.some(function (s) { return s.id === id; })) return id;
  var hit = steps.filter(function (s) {
    var t = String(s.title || '');
    return t.indexOf('발주서') > -1 || t.indexOf('발송') > -1;
  })[0];
  return hit ? hit.id : '';
}

/**
 * 항목마다 붙는 날짜를 정한다.
 * 돌려주는 값: { byKey: { 항목열쇠: 'submitted' … }, byField: { submitted: [{ stepId, i, key }] … } }
 * 날짜 칸이 한 항목에 하나라, 이미 날짜가 붙은 항목에는 더 붙이지 않는다.
 */
function dateSlots_(steps, cfg, mode) {
  var byKey = {}, byField = {};
  RB_DATE_FIELDS.forEach(function (f) { byField[f] = []; });
  var claimed = {};
  function put(st, i, f) {
    var key = itemKey_(st, i);
    claimed[key] = 1;
    if (!f) return;
    byKey[key] = f;
    byField[f].push({ stepId: st.id, i: i, key: key });
  }
  // 1) 설정에서 직접 정한 것
  steps.forEach(function (st) {
    (st.items || []).forEach(function (it, i) {
      if (it && it.d !== undefined && it.d !== null) put(st, i, RB_DATE_FIELDS.indexOf(it.d) > -1 ? it.d : '');
    });
  });
  // 2) 정하지 않은 항목은 이름으로 짐작한다. 직접 정한 항목이 있는 날짜는 짐작하지 않는다.
  function guess(stepId, f, words) {
    if (!stepId || byField[f].length) return;
    var st = steps.filter(function (s) { return s.id === stepId; })[0];
    if (!st) return;
    var items = st.items || [];
    for (var i = 0; i < items.length; i++) {
      var t = String((items[i] && items[i].t) || '');
      if (!claimed[itemKey_(st, i)] && words.some(function (w) { return t.indexOf(w) > -1; })) { put(st, i, f); return; }
    }
  }
  if (mode !== 'sample') {
    var ds = datesStepId_(steps, cfg);
    guess(ds, 'approved', ['승인']);
    guess(ds, 'submitted', ['상신', '작성']);
    guess(orderStepId_(steps, cfg), 'ordered', ['발주서', '발송']);
  }
  steps.forEach(function (st) {
    (st.items || []).forEach(function (it, i) {
      if (!claimed[itemKey_(st, i)] && RB_REQ_DATE_RE.test(String((it && it.t) || ''))) put(st, i, 'req');
    });
  });
  return { byKey: byKey, byField: byField };
}

/**
 * 날짜를 넣었으면 그 날짜가 붙은 항목을 체크한다(on). 저장돼 있던 날짜를 지웠으면 체크를 푼다(on=false).
 * 체크를 풀 때 날짜는 지우지 않는다(체크 → 날짜는 비어 있을 때만 채우는 한쪽 방향).
 * 바뀐 항목 열쇠를 돌려준다.
 */
function checkByDate_(checks, slots, field, on) {
  var out = [];
  (slots.byField[field] || []).forEach(function (s) {
    if (on === false) { if (checks[s.key]) { delete checks[s.key]; out.push(s.key); } }
    else if (!checks[s.key]) { checks[s.key] = 1; out.push(s.key); }
  });
  return out;
}

/* ============================================================
 * 항목별 추가 버튼(항목의 f) — 예) 포장물사양서 이관 [mm.yyyy], 데이터 파일 이관 [18층] [mm.yyyy]
 * 누르면 초록색으로 켜지고 다시 누르면 꺼진다. 항목 체크 · 단계 완료와는 상관없다.
 * 켜고 끌 때마다 _실행판_변경이력 탭에 한 줄씩 남긴다.
 * 진행 기록의 checks 에 'fl:<항목열쇠>:<버튼열쇠>' = 켠 시각 으로 저장한다.
 * ============================================================ */

function flagKey_(itemKey, fk) {
  return 'fl:' + itemKey + ':' + fk;
}

/** 추가 버튼을 켜거나 끈다. */
function apiSetFlag(id, meta, stepId, itemIdx, flagKey, on, mode) {
  var steps = stepsFast_(mode);
  var st = steps.filter(function (x) { return x.id === stepId; })[0];
  var it = st && (st.items || [])[Number(itemIdx)];
  var fl = it && (it.f || []).filter(function (x) { return x && String(x.k) === String(flagKey); })[0];
  if (!fl) throw new Error('버튼 설정이 바뀌었습니다. 새로고침 후 다시 해 주세요.');
  var key = flagKey_(itemKey_(st, Number(itemIdx)), fl.k);
  meta = meta || {};
  var was = false;
  var res = editProgress_(id, meta, mode, function (s) {
    was = !!s.checks[key];
    if (on) s.checks[key] = s.checks[key] || stampNow_(); else delete s.checks[key];
  }, function (r) {
    if (was === !!on) return;                 // 이미 그 상태였다(두 번 눌림) — 이력은 한 줄만
    writeAudits_([{
      tab: progTabName_(mode), row: r.row, col: 7,
      what: '[' + fl.t + '] ' + (on ? '표시' : '표시 해제') + ' — ' + (steps.indexOf(st) + 1) + '. ' + st.title + ' › ' + it.t,
      before: was ? '표시' : '', after: on ? '표시' : '',
      item: (meta.name || '') + (meta.doc ? ' (' + meta.doc + ')' : '')
    }]);
  });
  return { checks: res.state.checks };
}

/** 추가 버튼 목록을 다듬는다: 이름이 빈 것은 빼고, 열쇠가 없거나 겹치면 새로 붙인다. */
function cleanFlags_(list) {
  var seen = {};
  return (Array.isArray(list) ? list : []).map(function (x) {
    var t = String((x && x.t) || '').trim().slice(0, 30);
    if (!t) return null;
    var k = String((x && x.k) || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20);
    if (!k || seen[k]) k = 'f' + Utilities.getUuid().replace(/-/g, '').slice(0, 6);
    seen[k] = 1;
    return { k: k, t: t };
  }).filter(Boolean).slice(0, 6);
}

/**
 * 방금 끝난 단계에 완료 시각을 찍고, 되돌린 단계는 지운다.
 * dates 를 그 자리에서 고치고 바뀐 단계만 돌려준다.
 */
function stampSteps_(checks, dates, steps) {
  var out = [];
  var now = stampNow_();
  steps.forEach(function (st, i) {
    var k = 's:' + st.id;
    var done = stepDoneSrv_(checks, st, dates);
    if (done && !dates[k]) {
      dates[k] = now;
      out.push({ i: i, id: st.id, title: st.title, at: now,
                 act: checks['_skip_' + st.id] ? '건너뜀' : '완료' });
    } else if (!done && dates[k]) {
      delete dates[k];
      out.push({ i: i, id: st.id, title: st.title, at: now, act: '되돌림' });
    }
  });
  return out;
}

/** 앞 단계를 끝낸 뒤로 이 단계까지 걸린 시간(시간 단위) */
/** 'yyyy-MM-dd HH:mm:ss' 에서 날짜만 떼어 Date 로(시각은 버린다) */
function dayOf_(stamp) {
  var d = parseStamp_(stamp);
  return d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()) : null;
}

/** 앞 단계를 끝낸 날부터 이 단계를 끝낸 날까지 며칠 걸렸는지(같은 날이면 0) */
function stepDays_(dates, steps, i, at) {
  var prev = null;
  for (var j = i - 1; j >= 0; j--) {
    var v = dates['s:' + steps[j].id];
    if (v) { prev = v; break; }
  }
  var b = dayOf_(at);
  if (!prev) return { prev: '', days: '' };
  var a = dayOf_(prev);
  if (!a || !b) return { prev: a || '', days: '' };
  return { prev: a, days: Math.round((b - a) / 864e5) };
}

/** 단계 처리 이력을 쌓는다. 한 번에 몰아 쓴다. */
function logSteps_(mode, rowsToLog) {
  if (!rowsToLog || !rowsToLog.length) return;
  try {
    // rowsToLog: stepLogRows_ 모양 [일자, 구분, 건ID, 품의번호, 품목명, 담당자, 단계순서, 단계명, 처리, 처리자, 앞단계완료일, 소요일수]
    appendHist_(rowsToLog.map(stepRowToHist_), 'p');
  } catch (e) { try { console.warn('이력 남기기 실패: ' + e.message); } catch (eW) { /* 넘어간다 */ } }   // 이력이 실패해도 본 작업은 막지 않는다
}

/** 단계 이력 한 줄(예전 _실행판_단계이력 모양) → 변경이력 한 줄. 병목 분석용 소요일수는 비고에 남긴다. */
function stepRowToHist_(r) {
  var prev = r[10] instanceof Date ? fmtDate_(r[10]) : str_(r[10]);
  return {
    at: r[0] || new Date(), who: str_(r[9]), mode: str_(r[1]) === '샘플' ? 'sample' : 'po', kind: '단계',
    id: str_(r[2]), doc: str_(r[3]), name: str_(r[4]), item: str_(r[6]) + '. ' + str_(r[7]), after: str_(r[8]),
    note: ['담당 ' + (str_(r[5]) || '-'), prev ? '앞 단계 완료 ' + prev : '', (r[11] !== '' && r[11] != null) ? '소요 ' + r[11] + '일' : '']
      .filter(String).join(' · ')
  };
}

/** 한 건의 단계 변화를 이력 줄로 만든다. */
function stepLogRows_(mode, id, meta, changed, dates, steps, who) {
  return changed.map(function (c) {
    var t = stepDays_(dates, steps, c.i, c.at);
    return [dayOf_(c.at) || '', (mode === 'sample' ? '샘플' : '발주'), id,
      (meta && meta.doc) || '', (meta && meta.name) || '', (meta && meta.owner) || '',
      c.i + 1, c.title, c.act, who, t.prev, t.days];
  });
}

/** 체크 하나를 켜고 끈다. */
function apiSetCheck(id, meta, itemKey, on, mode) {
  var ch = {};
  ch[String(itemKey)] = !!on;
  return apiSetChecks(id, meta, ch, mode);
}

/**
 * 한 건의 체크 여러 개를 한 번에 켜고 끈다. changes = { 열쇠: true(켬) | false(끔) }
 * 화면은 연달아 누른 체크를 모아 이걸 한 번 부른다(잠금 · 시트 왕복이 체크 수만큼 생기지 않게).
 */
function apiSetChecks(id, meta, changes, mode) {
  var keys = Object.keys(changes || {}).filter(function (k) { return k && k.length <= 200; });
  if (!keys.length) throw new Error('저장할 체크가 없습니다.');
  if (keys.length > 200) throw new Error('한 번에 저장할 체크가 너무 많습니다.');
  var ch = {};
  keys.forEach(function (k) { ch[k] = !!changes[k]; });
  // 장부에 적고 바로 끝낸다(시트에는 1분 안에 모아서). 못 적으면 예전처럼 바로 시트에.
  return journalSave_({ mode: mode, id: id, meta: meta, kind: 'checks', changes: ch }, function (st) {
    return { checks: st.checks, dates: st.dates, updatedBy: me_() };
  }, function () { return apiSetChecksSync_(id, meta, ch, mode); });
}
function apiSetChecksSync_(id, meta, changes, mode) {
  var keys = Object.keys(changes || {});
  var steps = null;
  try { steps = stepsFast_(mode); } catch (e) { steps = null; }
  var changed = [];

  var res = editProgress_(id, meta, mode, function (st) {
    keys.forEach(function (k) { if (changes[k]) st.checks[k] = 1; else delete st.checks[k]; });
    // 단계 완료 시각은 곁달렸다. 여기서 터져도 체크 저장을 막지 않는다.
    try { if (steps) changed = stampSteps_(st.checks, st.dates, steps); } catch (e) { changed = []; }
  }, function (r) {
    // 예전에는 쓴 칸을 다시 읽어 확인했는데, 그 읽기가 시트 재계산을 기다려 몇 초씩 걸렸다. 잠금 안의 쓰기라 다시 읽지 않는다.
    if (steps && changed.length) {
      logSteps_(mode, stepLogRows_(mode, id, meta, changed, r.state.dates, steps, me_()));
    }
    if (steps) {
      keys.forEach(function (k) {
        var f = findItemByKey_(steps, k);
        if (f && f.it.chg) logChange_(mode, id, meta, f.st, f.it, k, r.state);
      });
    }
  });

  return { checks: res.state.checks, dates: res.state.dates, updatedBy: me_(), savedRow: res.row };
}

/** 단계를 건너뛰거나(해당 없음) 되돌린다. */
/**
 * 항목의 변경 여부를 저장한다.
 * patch: { dec: 'Y'|'N'|'' , types: ['디자인', …], memo: '…' } — 준 것만 바꾼다.
 */
function apiSetChange(id, meta, stepId, itemIdx, patch, mode) {
  var steps = stepsFast_(mode);
  var st = steps.filter(function (x) { return x.id === stepId; })[0];
  if (!st) throw new Error('단계를 찾을 수 없습니다.');
  var it = (st.items || [])[Number(itemIdx)];
  if (!it || !it.chg) throw new Error('변경 여부를 쓰는 항목이 아닙니다. 새로고침 후 다시 해 주세요.');
  patch = patch || {};
  return journalSave_({ mode: mode, id: id, meta: meta, kind: 'change', stepId: stepId, idx: Number(itemIdx), patch: patch },
    function (s2) { return { checks: s2.checks, notes: s2.notes, dates: s2.dates }; },
    function () { return apiSetChangeSync_(id, meta, stepId, itemIdx, patch, mode, steps, st, it); });
}
function apiSetChangeSync_(id, meta, stepId, itemIdx, patch, mode, steps, st, it) {
  var key = itemKey_(st, Number(itemIdx));
  var changed = [];

  var res = editProgress_(id, meta, mode, function (s) {
    var c = s.checks;
    if (patch.dec !== undefined) {
      if (patch.dec === 'Y' || patch.dec === 'N') c['cy:' + key] = patch.dec; else delete c['cy:' + key];
      // 변경 없음(또는 취소)으로 바꾸면 적어 둔 종류 · 내용은 지운다
      if (patch.dec !== 'Y') { delete c['cs:' + key]; delete s.notes['c:' + key]; }
    }
    if (patch.types !== undefined) {
      var t = (patch.types || []).map(function (x) { return String(x).trim(); }).filter(String).join(', ');
      if (t) c['cs:' + key] = t; else delete c['cs:' + key];
    }
    if (patch.memo !== undefined) {
      var m = String(patch.memo || '').slice(0, 1000);
      if (m.trim()) s.notes['c:' + key] = m; else delete s.notes['c:' + key];
    }
    // 변경 여부에 따라 필수 여부가 바뀌므로 단계 완료도 다시 본다
    try { changed = stampSteps_(c, s.dates, steps); } catch (e) { changed = []; }
  }, function (r) {
    if (changed.length) logSteps_(mode, stepLogRows_(mode, id, meta, changed, r.state.dates, steps, me_()));
    logChange_(mode, id, meta, st, it, key, r.state);
  });
  return { checks: res.state.checks, notes: res.state.notes, dates: res.state.dates };
}

/** 체크 열쇠로 그 항목을 찾는다(변경 기록을 갱신할 때). */
function findItemByKey_(steps, key) {
  for (var a = 0; a < steps.length; a++) {
    var items = steps[a].items || [];
    for (var b = 0; b < items.length; b++) {
      if (itemKey_(steps[a], b) === key) return { st: steps[a], it: items[b] };
    }
  }
  return null;
}

/**
 * _실행판_변경내역 에 건 × 항목 한 줄을 남기거나 갱신한다. 부르는 쪽이 잠금을 쥐고 부른다.
 * 발주현황 시트에는 쓰지 않는다.
 */
function logChange_(mode, id, meta, st, it, key, s) {
  try {
    var h = changeHist_(mode, id, meta, st, it, key, s);
    if (h) appendHist_([h], 'p');
  } catch (e) { /* 기록이 실패해도 저장은 막지 않는다 */ }
}
/** 변경 여부 이력 한 줄(아직 아무것도 정하지 않은 항목이면 null) */
function changeHist_(mode, id, meta, st, it, key, s) {
  meta = meta || {};
  var dec = chgDec_(s.checks, key);
  var kinds = str_(s.checks['cs:' + key]), memo = str_(s.notes['c:' + key]);
  if (!dec && !kinds && !memo) return null;
  return {
    mode: mode, kind: '변경 여부', id: id, doc: meta.doc, code: meta.code, name: meta.name,
    item: str_(st.title) + ' / ' + str_(it.t),
    after: [dec === 'Y' ? '있음' : (dec === 'N' ? '없음' : ''), kinds].filter(String).join(' · '),
    reason: memo, note: (s.checks[key] ? '항목 완료' : '') + (key ? (s.checks[key] ? ' · ' : '') + '항목키 ' + key : '')
  };
}

/** 상신일 · 승인일 같은 날짜를 저장한다. field: 'submitted' | 'approved' */
function apiSetDate(id, meta, field, value, mode) {
  // req:<항목키> = 항목별 요청일(예: 데이터 파일 이관 요청일)
  // dv:<항목키> = 데이터 버전 날짜(데이터 파일 이관) — 요청일처럼 항목 체크와 묶지 않는다
  // need = 샘플 요청 납기(언제까지 줘야 하는지) — 항목 체크와 묶지 않는다
  var okField = ['submitted', 'approved', 'need'].indexOf(field) > -1 || /^(req|dv):[A-Za-z0-9_-]{1,60}$/.test(String(field || ''));
  if (!okField) throw new Error('알 수 없는 날짜 항목입니다.');
  var v = String(value || '').trim();
  // 상신일 · 승인일을 넣으면 진행상태도 앞으로만 올린다. 예전에는 여기서 바로 잠금을 잡고 발주 DB 에 써서
  // 날짜 저장이 체크보다 몇 초 느렸다. 이제 장부에 '올릴 상태'를 같이 적고, 장부를 옮길 때(1분 안) 함께 쓴다.
  var bumpTo = (v && (mode || 'po') === 'po' && RB_DATE_STATE[field]) ? RB_DATE_STATE[field] : '';
  var op0 = { mode: mode, id: id, meta: meta, kind: 'date', field: field, value: v.slice(0, 10) };
  if (bumpTo) op0.bump = bumpTo;
  var res0 = journalSave_(op0,
    function (st) { return { dates: st.dates, checks: st.checks }; },
    function () { return null; });
  if (res0) {
    res0.state = bumpTo;           // 화면은 지금 상태보다 앞일 때만 바꾼다
    return res0;
  }
  // 상신일 · 승인일을 넣으면 그 날짜가 붙은 항목(발주품의서 작성 · 승인)도 같이 체크하고, 지우면 체크를 푼다
  var M = null;
  if (!/^(req|dv):|^need$/.test(field)) { try { M = metaFast_(mode); } catch (e) { M = null; } }
  var changed = [];
  var res = editProgress_(id, meta, mode, function (st) {
    var had = !!st.dates[field];
    if (v) st.dates[field] = v.slice(0, 10); else delete st.dates[field];
    // 지울 때는 저장돼 있던 날짜를 지운 경우만(저장 안 된 빈 칸을 비운 건 아무 일도 아니다)
    var on = v ? true : (had ? false : null);
    if (M && on !== null && checkByDate_(st.checks, dateSlots_(M.steps, M.cfg, mode), field, on).length) {
      try { changed = stampSteps_(st.checks, st.dates, M.steps); } catch (e) { changed = []; }
    }
  }, function (r) {
    if (changed.length) logSteps_(mode, stepLogRows_(mode, id, meta, changed, r.state.dates, M.steps, me_()));
  });
  // 상신일 · 승인일을 넣으면 진행상태도 따라 올린다(AP 는 계획 · 상신 행을 빼고 계산한다)
  var bumped = 0;
  if (v && mode === 'po' && RB_DATE_STATE[field]) {
    try { bumped = bumpStates_([{ statusRow: 0, expect: meta }], RB_DATE_STATE[field]); } catch (e) { bumped = 0; }
  }
  return { dates: res.state.dates, checks: res.state.checks, state: bumped ? RB_DATE_STATE[field] : '' };
}

/** 단계 메모를 저장한다. */
function apiSetNote(id, meta, stepId, text, mode) {
  return journalSave_({ mode: mode, id: id, meta: meta, kind: 'note', stepId: String(stepId || ''), text: String(text || '').slice(0, 2000) },
    function (st) { return { notes: st.notes }; },
    function () { return apiSetNoteSync_(id, meta, stepId, text, mode); });
}
function apiSetNoteSync_(id, meta, stepId, text, mode) {
  var res = editProgress_(id, meta, mode, function (st) {
    if (text) st.notes[stepId] = String(text).slice(0, 2000); else delete st.notes[stepId];
  });
  return { notes: res.state.notes };
}

/**
 * 여러 건의 같은 단계를 한꺼번에 처리한다.
 * items: [{id, meta}], mode: 'done'(필수항목 전부 체크) 또는 'skip'(해당 없음)
 */
function apiBulkStep(items, stepId, doMode, mode) {
  if (!items || !items.length) return { n: 0 };
  var allSteps = readSteps_(mode);
  var step = allSteps.filter(function (s) { return s.id === stepId; })[0];
  if (!step) throw new Error('단계를 찾을 수 없습니다.');
  if (doMode === 'skip' && !step.skippable) throw new Error('이 단계는 건너뛸 수 없습니다.');

  var me = me_();
  var logRows = [];
  var n = bulkEditProgress_(items, mode, function (st, it) {
    if (doMode === 'skip') {
      st.checks['_skip_' + stepId] = 1;
    } else {
      (step.items || []).forEach(function (x, i) {
        var kk = itemKey_(step, i);
        // 필수 여부는 단계 완료 규칙과 같은 함수로 본다. '변경 있음'으로 정한 항목은 원래 생략 가능이어도 필수다.
        // 예전에는 x.o 만 봐서 그런 항목을 [생략]만 해 두고 넘어가 단계가 끝나지 않았다.
        if (itemRequired_(x, st.checks, kk)) st.checks[kk] = 1;
        else if (!st.checks[kk]) st.checks['sk:' + kk] = 1;     // 생략 가능 항목은 [생략] 처리
      });
      delete st.checks['_skip_' + stepId];
    }
    var changed = stampSteps_(st.checks, st.dates, allSteps);
    logRows = logRows.concat(stepLogRows_(mode, it.id, it.meta || {}, changed, st.dates, allSteps, me));
  }, function () {
    logSteps_(mode, logRows);
  });
  return { n: n };
}

/**
 * 실행판에서 다룰 필요 없는 건을 숨긴다(시트는 건드리지 않는다).
 * items: [{id, meta}], on: true면 숨김, false면 다시 보이기
 */
function apiBulkHide(items, on, mode) {
  if (!items || !items.length) return { n: 0 };
  var n = bulkEditProgress_(items, mode, function (st) {
    if (on) st.checks._hidden = 1; else delete st.checks._hidden;
  });
  return { n: n };
}


/**
 * 발주현황에 되쓰기 — 정해 둔 칸(입고일정 · 제품입고일 · 입고수량 · 비고)만 허용한다.
 * 바꾸기 전 값은 _실행판_변경이력 탭에 남긴다.
 * beforeVal(선택): 화면이 고치기 시작할 때 본 값. 주면 잠금 안에서 지금 칸 값과 비교해, 그 사이 다른 사람이 바꿨으면 쓰지 않는다.
 */
function apiWriteStatus(statusRow, field, col, value, label, expect, beforeVal) {
  requireEditor_();
  var row = Number(statusRow) || 0;
  if (row < 2) throw new Error('발주 DB에 아직 올라가지 않은 건은 수정할 수 없습니다.');

  var sh = statusSheet_();
  var C = sheetCols_(sh);

  var NAMED = { eta: ['입고일정'], arrived: ['제품입고일'], inqty: ['입고수량'], memo: ['비고', '메모'] };

  var target;
  if (NAMED[field]) {
    var ci = colIdx_(C.idx, NAMED[field]);
    if (ci < 0) throw new Error('[' + NAMED[field][0] + '] 열을 찾을 수 없습니다.');
    target = ci + 1;
  } else {
    throw new Error('수정할 수 없는 항목입니다.');
  }

  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var before;
  try {
    // 쓰기 직전 머리글 확인 — 기억해 둔 열 위치(hdr:status · keycols)가 시트와 어긋났으면 한 번 다시 읽고, 그래도 다르면 멈춘다
    var wantCols = function () {
      var L = [{ c: target - 1, names: NAMED[field] }];
      var kc0 = statusKeyCols_(sh, C.hr);
      if (kc0.id >= 0) L.push({ c: kc0.id, names: [RB_KEY.ID] });
      return L;
    };
    if (!statusHeadOk_(sh, C.hr, wantCols())) {
      statusColsReset_();
      C = sheetCols_(sh);
      var ci2 = colIdx_(C.idx, NAMED[field]);
      if (ci2 < 0) throw new Error('[' + NAMED[field][0] + '] 열을 찾을 수 없습니다.');
      target = ci2 + 1;
      if (!statusHeadOk_(sh, C.hr, wantCols())) throw new Error('발주 DB 머리글(열 이름)이 예상과 달라 저장하지 않았습니다. 새로고침한 뒤 다시 해 주세요.');
    }
    row = checkStatusRow_(sh, C, row, expect);
    var cell = sh.getRange(row, target);
    before = cell.getValue();
    // 동시 수정 확인 — 화면이 본 값(beforeVal)과 지금 칸 값이 다르면 남의 저장을 덮지 않는다
    if (beforeVal !== undefined && beforeVal !== null && !statusSameVal_(before, beforeVal)) {
      throw new Error('다른 사람이 먼저 이 칸을 바꿨습니다(지금 값: ' + (before instanceof Date ? fmtDate_(before) : str_(before) || '빈 칸') + '). 새로고침한 뒤 다시 해 주세요.');
    }
    if (field === 'inqty') {
      var num = String(value == null ? '' : value).replace(/[, ]/g, '');
      if (num !== '' && isNaN(Number(num))) throw new Error('숫자로 넣어주세요: ' + value);
      cell.setValue(num === '' ? '' : Number(num));
    } else if (field === 'memo') {
      // 메모는 적은 글자 그대로(날짜처럼 보여도 날짜로 바꾸지 않는다)
      cell.setValue(asText_(String(value == null ? '' : value).slice(0, 500)));
    } else {
      cell.setValue(cellValue_(value));
    }
    writeAudit_(RB.STATUS_TAB, row, target, label || field, before, value);
  } finally {
    lock.releaseLock();
  }

  // 목록 캐시만 버린다(예전에는 설정 · 단계 캐시를 버려 다음 접속이 설정 탭까지 다시 읽었고, 정작 목록 캐시는 옛 값이 남았다)
  cacheDrop_(rowsCacheKey_('po'));
  return { ok: true, before: before instanceof Date ? fmtDate_(before) : String(before == null ? '' : before) };
}

/** 발주 DB 헤더 행을 찾는다(지금은 1행). */
function statusHeaderRow_(sh, lc) {
  var scanN = Math.max(1, Math.min(60, sh.getLastRow()));
  return statusHeadIn_(sh.getRange(1, 1, scanN, lc).getValues(), false);
}

/**
 * 발주현황에 쓰기 직전, 쓸 행을 [품의번호 + 품목코드 + 발주차수] 로 다시 확인한다.
 * 화면이 기억한 행 번호는 읽은 뒤 누가 시트를 정렬하거나 행을 넣고 지우면 다른 품목을 가리킬 수 있다.
 * expect: 화면의 { doc, code, batch } (품의번호 · 품목코드 · 발주차수). 모두 발주현황에서 읽은 값이다.
 *  · 기억한 행의 세 값이 같으면 그 행에 쓴다.
 *  · 다르면 세 값이 같은 행을 찾아 그 행에 쓴다. 없거나 여럿이면 쓰지 않고 멈춘다.
 *  · 품의번호가 없으면(예전 화면) 확인 없이 그대로 둔다. 발주차수를 안 보내는 예전 화면은 품목명으로 가린다.
 * 잠금 안에서 불러야 한다(확인과 쓰기 사이에 행이 바뀌지 않게).
 */
function statusSig_(doc, code, third) {
  return norm_(doc) + '|' + norm_(code) + '|' + norm_(third);
}

function checkStatusRow_(sh, C, row, expect) {
  // 1) 실행판ID 로 확인한다. ID 열이 있고 그 ID가 시트에 있으면 그 행이다(행이 밀려도 따라간다).
  if (expect && str_(expect.id)) {
    var kc = statusKeyCols_(sh, C.hr);
    if (kc.id >= 0) {
      var wantId = str_(expect.id);
      // 기억한 행의 실행판ID 칸 하나만 읽어 맞으면 끝(마지막 행을 따로 묻지 않는다 — 빈 칸이면 아래에서 다시 찾는다)
      if (row > C.hr && str_(sh.getRange(row, kc.id + 1).getValue()) === wantId) return row;
      var nId = sh.getLastRow() - C.hr;
      var idHits = [];
      if (nId > 0) {
        sh.getRange(C.hr + 1, kc.id + 1, nId, 1).getValues().forEach(function (r, i) {
          if (str_(r[0]) === wantId) idHits.push(C.hr + 1 + i);
        });
      }
      if (idHits.length === 1) return idHits[0];
      if (idHits.length > 1) throw new Error('발주 DB에 실행판ID ' + wantId + ' 가 ' + idHits.length + '행 있습니다. 관리자에게 알려주세요.');
      // 실행판ID(형식 상관없이, 예전 조합 열쇠 '…|…' 가 아닌 것)인데 시트에 없으면 멈춘다 — 품의번호 · 코드 · 차수로 찾으면 같은 값을 가진 다른 줄에 써 버린다
      if (wantId.indexOf('|') < 0) throw new Error('발주 DB에서 이 건(실행판ID ' + wantId + ')을 찾지 못했습니다. 줄이 지워졌거나 ID 칸이 바뀌었을 수 있습니다. 새로고침 후 확인해 주세요.');
      // 예전 열쇠(ID 를 아직 안 채운 행) 면 아래 예전 방식으로 찾는다
    }
  }
  // 2) 예전 방식: 품의번호 + 품목코드 + 차수. 확인값 없이 행 번호만으로는 쓰지 않는다.
  if (!expect || !str_(expect.doc)) throw new Error('발주 DB 행 확인값이 없습니다. [새로고침] 후 다시 저장해 주세요.');
  var cDoc = colIdx_(C.idx, ['품의번호']);
  var cCode = colIdx_(C.idx, ['품목코드']);
  var byBatch = expect.batch !== undefined;
  var cThird = byBatch ? colIdx_(C.idx, ['발주차수']) : colIdx_(C.idx, ['품목명']);
  if (cDoc < 0 || cThird < 0) return row;
  var want = statusSig_(expect.doc, expect.code, byBatch ? expect.batch : expect.name);
  var width = Math.max(cDoc, cCode, cThird) + 1;
  var sigOf = function (r) {
    return statusSig_(r[cDoc], cCode >= 0 ? r[cCode] : '', r[cThird]);
  };
  if (row > C.hr && row <= sh.getLastRow() &&
      sigOf(sh.getRange(row, 1, 1, width).getValues()[0]) === want) return row;

  var n = sh.getLastRow() - C.hr;
  var hits = [];
  if (n > 0) {
    sh.getRange(C.hr + 1, 1, n, width).getValues().forEach(function (r, i) {
      if (sigOf(r) === want) hits.push(C.hr + 1 + i);
    });
  }
  if (hits.length === 1) return hits[0];
  throw new Error('발주 DB에서 이 건(품의번호 ' + expect.doc + ' · 품목코드 ' + (expect.code || '-') +
    (byBatch ? ' · 발주차수 ' + (expect.batch || '-') : '') + ')을 ' +
    (hits.length > 1 ? hits.length + '행에서 찾아 어느 행인지 알 수 없습니다' : '찾을 수 없습니다') +
    '. [새로고침] 후 다시 저장해 주세요.');
}

/** 발주수량 · 단가를 바꾸면 전후 값과 사유를 숨김 탭에 남긴다 */
function logQtyPrice_(row, audits, payload) {
  try {
    var ex = payload.expect || {};
    var why = String(payload.chgReason || '').slice(0, 500);
    var list = (audits || []).filter(function (a) { return a.what === '발주수량' || a.what === '단가'; }).map(function (a) {
      return { kind: '수량단가', id: ex.id, doc: ex.doc, code: ex.code, name: ex.name, item: a.what,
               before: a.before, after: a.after, reason: why, where: RB.STATUS_TAB + ' ' + row + '행' };
    });
    if (list.length) appendHist_(list);
  } catch (e) { try { console.warn('사유 기록 실패: ' + e.message); } catch (eW) { /* 넘어간다 */ } }   // 사유 기록 실패가 저장을 막지는 않는다
}

/** 변경이력 여러 줄을 한 번에 쓴다. 칸마다 appendRow 를 부르면 그만큼 느려진다. */
function writeAudits_(list) {
  try {
    if (!list || !list.length) return;
    // 발주 DB 칸 변경인데 실행판ID 를 안 준 기록은 그 행에서 ID · 품의번호 · 품목코드를 읽어 붙인다(이름 · 행이 바뀌어도 이력을 그 건에 이을 수 있게)
    var need = list.filter(function (a) { return a && a.tab === RB.STATUS_TAB && !a.id && Number(a.row) >= 2; });
    if (need.length) {
      try {
        var sh0 = statusSheet_(), C0 = sheetCols_(sh0), kc0 = statusKeyCols_(sh0, C0.hr);
        var cD = colIdx_(C0.idx, ['품의번호']), cC = colIdx_(C0.idx, ['품목코드']);
        var rows0 = need.map(function (a) { return Number(a.row); });
        var lo = Math.min.apply(null, rows0), hi = Math.max.apply(null, rows0);
        if (kc0.id >= 0 && hi - lo < 3000 && hi <= sh0.getLastRow()) {
          var w0 = Math.max(kc0.id, cD, cC) + 1, vv = sh0.getRange(lo, 1, hi - lo + 1, w0).getValues();
          need.forEach(function (a) {
            var r = vv[Number(a.row) - lo]; if (!r) return;
            a.id = str_(r[kc0.id]); if (!a.doc && cD >= 0) a.doc = str_(r[cD]); if (!a.code && cC >= 0) a.code = str_(r[cC]);
          });
        }
      } catch (eI) { /* ID 를 못 붙여도 이력은 쓴다 */ }
    }
    // 샘플 탭 칸 변경은 구분 '샘플'로, 품목명이 없으면 그 줄의 품목명(프로젝트명)을 붙인다 — 예전엔 모두 '발주' · 품목명 빈칸
    var needS = list.filter(function (a) { return a && a.tab === RB.SAMPLE_TAB; });
    if (needS.length) {
      try {
        var shS = sheet_(RB.SAMPLE_TAB), KS = sampleCols_(shS, false).K;
        needS.forEach(function (a) {
          a.mode = 'sample';
          if (!str_(a.item) && KS.name >= 0 && Number(a.row) >= 2 && Number(a.row) <= shS.getLastRow()) a.item = str_(shS.getRange(Number(a.row), KS.name + 1).getValue());
        });
      } catch (eS) { needS.forEach(function (a) { a.mode = 'sample'; }); }
    }
    appendHist_(list.map(function (a) {
      return {
        mode: a.mode, kind: '칸 변경', id: a.id, doc: a.doc, code: a.code, name: a.item, item: a.what,
        before: a.before, after: a.after,
        where: [a.tab || '', a.row ? a.row + '행' : '', a.col ? colLetterRB_(a.col) + '열' : ''].filter(String).join(' ')
      };
    }));
  } catch (e) { try { console.warn('변경이력 쓰기 실패: ' + e.message); } catch (eW) { /* 넘어간다 */ } }   // 이력 실패가 저장을 막지는 않는다
}

/**
 * 변경이력 한 곳(_실행판_변경이력)에 쌓는다. list: [{ at, who, mode, kind, id, doc, code, name, item, before, after, reason, where, note }]
 * 합치기 전(머리글이 예전 9칸 형식)이면 예전 형식으로 적는다 — 합치기가 나중에 같이 옮긴다.
 */
function histVal_(v) {
  if (v instanceof Date) return fmtDate_(v);
  return v == null ? '' : asText_(String(v));
}

function appendHist_(list, kind) {
  if (!list || !list.length) return;
  try {
    // 여러 줄(일괄 처리)은 나눠 장부에 — 한 번에 8천 자를 넘으면 잠금 없이 바로 쓰게 되어 1분 작업과 같은 줄에 겹쳐 쓸 수 있었다
    var direct = [];
    for (var i = 0; i < list.length; i += 8) {
      var part = list.slice(i, i + 8);
      if (!histDefer_(part)) direct = direct.concat(part);
    }
    if (direct.length) appendHistRows_(direct);       // 장부에 못 적은 것만 예전처럼 바로 쓴다
  } finally { bumpVer_(kind || 'r'); }   // 단계 · 체크 기록은 'p'(진행 기록만 다시 읽으면 됨)
}
/*
 * 이력 장부: 이력 탭 쓰기(탭 열기 · 마지막 행 · 서식 · 쓰기 = 저장마다 1~2초)를 미룬다.
 * 스크립트 속성 'h1:시각:번호' 에 적고 끝 — 1분 작업(journalDrain)이 모아서 한 번에 이력 탭에 쓴다(시각 · 사람은 적을 때 값 그대로).
 */
var RB_H = 'h1:';
function histDefer_(list) {
  try {
    var now = new Date(), who = me_();
    var rows = list.map(function (o) { var x = {}; Object.keys(o).forEach(function (k) { x[k] = o[k] instanceof Date ? { d: o[k].toISOString() } : o[k]; }); if (!x.at) x.at = { d: now.toISOString() }; if (!x.who) x.who = who; return x; });
    var s = JSON.stringify(rows);
    if (s.length > 8000) return false;
    var props = PropertiesService.getScriptProperties();
    if (!journalRoom_(props.getProperties(), s.length + 40)) return false;   // 장부가 너무 커졌으면 바로 이력 탭에(다른 속성 저장이 막히지 않게)
    journalTriggerEnsure_(true);             // 옮길 1분 작업부터 확인(바깥이 잠금을 쥐고 있을 수 있어 잠금 없이 · 못 만들면 바로 쓰기로)
    var key = RB_H + Date.now() + ':' + Utilities.getUuid().slice(0, 8);
    props.setProperty(key, s);
    if (props.getProperty(key) !== s) { try { props.deleteProperty(key); } catch (e2) { /* 넘어간다 */ } return false; }
    return true;
  } catch (e) { return false; }
}
/** 이력 장부를 이력 탭에 옮긴다(1분 작업 · 잠금 안). 옮긴 줄 수 */
function drainHist_() {
  var props = PropertiesService.getScriptProperties(), all = props.getProperties();
  var keys = Object.keys(all).filter(function (k) { return k.indexOf(RB_H) === 0; }).sort();
  if (!keys.length) return 0;
  // 장부 한 칸씩 붙이고 → 바로 그 칸을 지운다. 예전에는 다 붙인 뒤 한꺼번에 지워, 중간에 끊기면(시간 초과 등) 다음 번에 같은 이력이 또 붙었다
  var n = 0;
  keys.forEach(function (k) {
    var rows = [];
    try { JSON.parse(all[k]).forEach(function (x) { Object.keys(x).forEach(function (f) { if (x[f] && typeof x[f] === 'object' && x[f].d) x[f] = new Date(x[f].d); }); rows.push(x); }); } catch (e) { rows = []; /* 깨진 줄은 버린다 */ }
    if (rows.length) appendHistRows_(rows);
    props.deleteProperty(k);
    n += rows.length;
  });
  return n;
}
/** 끝에 붙일 행이 시트 격자 밖이면 행을 먼저 늘린다(꽉 찬 탭에 getRange 하면 '범위가 시트 밖' 오류). */
function ensureRows_(sh, lastRow) {
  var m = sh.getMaxRows();
  if (lastRow > m) sh.insertRowsAfter(m, lastRow - m);
}

function appendHistRows_(list) {
  var sh = tab_(RB.T_AUDIT, RB.HIST_HEAD);
  var now = new Date(), who = me_();
  // 이력 탭 머리글 형식(합친 뒤 = D1 '종류')은 한 번 확인하면 바뀌지 않는다. 캐시에 기억해 저장마다 읽지 않는다.
  var merged;
  try { merged = CacheService.getScriptCache().get('hist:merged') === '1'; } catch (e) { merged = false; }
  if (!merged) {
    merged = String(sh.getRange(1, 4).getValue()) === '종류';
    if (merged) { try { CacheService.getScriptCache().put('hist:merged', '1', RB_TTL); } catch (e) { /* 넘어간다 */ } }
  }
  var rows = list.map(function (o) {
    if (!merged) {
      return [o.at || now, o.who || who, o.where || o.kind || '', '', '', o.item || o.kind || '',
        histVal_(o.before), histVal_(o.after), str_(o.name)];
    }
    return [o.at || now, o.who || who, o.mode === 'sample' ? '샘플' : '발주', o.kind || '',
      histVal_(o.id), histVal_(o.doc), histVal_(o.code), histVal_(o.name), histVal_(o.item),
      histVal_(o.before), histVal_(o.after), histVal_(o.reason), histVal_(o.where), histVal_(o.note)];
  });
  var width = merged ? RB.HIST_HEAD.length : RB.AUDIT_HEAD.length;
  var r0 = sh.getLastRow() + 1;
  ensureRows_(sh, r0 + rows.length - 1);
  sh.getRange(r0, 4, rows.length, width - 3).setNumberFormat('@');   // 값 칸은 글자 그대로(날짜로 바뀌지 않게)
  sh.getRange(r0, 1, rows.length, width).setValues(rows);
}

function writeAudit_(tab, row, col, what, before, after) {
  writeAudits_([{ tab: tab, row: row, col: col, what: what, before: before, after: after }]);
}

/** 열 번호 → 글자(같은 일, 예전 이름 — Bom · ItemMaster · Keys 가 쓴다. 진단 파일 Perf.js 에 있던 것을 옮김) */
function colRB_(n) { return colLetterRB_(n); }

function colLetterRB_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - m) / 26); }
  return s;
}

/** 여러 건의 상신일 · 승인일을 한꺼번에 등록한다. */
function apiBulkDate(items, field, value, mode) {
  if (!items || !items.length) return { n: 0 };
  if (['submitted', 'approved'].indexOf(field) < 0) throw new Error('알 수 없는 날짜 항목입니다.');
  var v = String(value || '').trim().slice(0, 10);
  var M = metaFast_(mode);
  var slots = dateSlots_(M.steps, M.cfg, mode);
  var me = me_(), logRows = [];
  var n = bulkEditProgress_(items, mode, function (st, it) {
    var had = !!st.dates[field];
    if (v) st.dates[field] = v; else delete st.dates[field];
    // 한 건씩 넣을 때처럼 그 날짜가 붙은 항목도 체크한다(지우면 푼다)
    if ((v || had) && checkByDate_(st.checks, slots, field, !!v).length) {
      logRows = logRows.concat(stepLogRows_(mode, it.id, it.meta || {}, stampSteps_(st.checks, st.dates, M.steps), st.dates, M.steps, me));
    }
  }, function () {
    logSteps_(mode, logRows);
  });
  if (v && mode === 'po' && RB_DATE_STATE[field]) {
    try {
      bumpStates_(items.map(function (it) {
        var m = it.meta || {};
        if (!m.id) m.id = it.id;
        return { statusRow: it.statusRow || 0, expect: m };
      }), RB_DATE_STATE[field]);
    } catch (e) { /* 상태 올리기가 실패해도 날짜는 저장됐다 */ }
  }
  return { n: n };
}

/** 여러 건의 구매 담당자를 실행판에 직접 지정한다(발주현황은 건드리지 않는다). */
function apiBulkOwner(items, owner, mode) {
  if (!items || !items.length) return { n: 0 };
  var who = String(owner || '').trim().slice(0, 40);
  if (who === '미지정') who = '';
  var n = bulkEditProgress_(items, mode, function (st) { st.ownerSet = who; });
  // 발주현황 [이](구매 담당) 칸에도 적는다. 예전에는 실행판 진행 기록에만 남아 시트에는 비어 있었다.
  var w = (mode === 'sample') ? 0 : writeOwnerCells_(items.filter(function (x) { return Number(x && x.statusRow) >= 2; })
    .map(function (x) { return { statusRow: x.statusRow, expect: x.meta, owner: who }; }));
  return { n: n, owner: who, sheet: w };
}

/* ============================================================
 * 발주현황 쓰기 — 미리보기 후 저장
 * payload: { orderedAt } 또는 발주 정보 수정 { info, name, code, vendor, qty, price }
 * ============================================================ */

/** 머리글 행(hr)에서 list = [{ c: 열(0부터), names: [이름…] }] 의 칸 이름이 맞는지 — 잠금 안 쓰기 직전에 본다 */
function statusHeadOk_(sh, hr, list) {
  if (!list || !list.length) return true;
  var lo = Infinity, hi = -1;
  list.forEach(function (x) { if (x.c < lo) lo = x.c; if (x.c > hi) hi = x.c; });
  if (lo < 0 || hr < 1) return false;
  var vals = sh.getRange(hr, lo + 1, 1, hi - lo + 1).getValues()[0];
  return list.every(function (x) {
    var h = norm_(vals[x.c - lo]);
    return x.names.some(function (n) { return norm_(n) === h; });
  });
}
/** 기억해 둔 발주 DB 열 위치(머리글 · 실행판ID/진행상태 열)를 버린다 — 다음 sheetCols_ · statusKeyCols_ 가 시트에서 다시 찾는다 */
function statusColsReset_() {
  cacheDrop_('hdr:status:v3'); RB_COLS_MEMO = null;
  cacheDrop_('keycols:v4:status');
  try { RB_KEYCOLS_MEMO = {}; } catch (e) { /* 넘어간다 */ }
}
/** 칸 값(cur) 과 화면이 본 값(seen) 이 같은가 — 글자 · 날짜 · 숫자 모양 차이는 같게 본다 */
function statusSameVal_(cur, seen) {
  var a = cur instanceof Date ? fmtDate_(cur) : str_(cur), b = str_(seen);
  if (a === b || norm_(a) === norm_(b)) return true;
  if (a === '' || b === '') return false;
  var da = toDate_(cur), db = toDate_(seen);
  if (da && db && da.getMonth() === db.getMonth() && da.getDate() === db.getDate()) return true;   // 'MM/DD' 처럼 연도 없는 표기
  var na = Number(a.replace(/[, ]/g, '')), nb = Number(b.replace(/[, ]/g, ''));
  return !isNaN(na) && !isNaN(nb) && na === nb;
}

var RB_COLS_MEMO = null;
function sheetCols_(sh) {
  // 발주 DB 탭은 실행판만 쓰는 탭이라 머리글이 바뀌지 않는다(이관은 끝났다 — 열 구성이 바뀌면 캐시 hdr:status:v3 · keycols:v4:* 를 지운다).
  // 기억해 둔 머리글을 그대로 믿는다 — 예전에는 저장마다 마지막 열 묻기 + 머리글 줄 읽기로 0.3초 남짓 더 들었다.
  // 쓰기 전에 checkStatusRow_ 가 그 행의 실행판ID 를 읽어 확인하므로, 열이 어긋났으면 거기서 멈춘다.
  if (RB_COLS_MEMO) return RB_COLS_MEMO;
  var memo = cacheGet_('hdr:status:v3');
  if (memo && memo.hr > 0 && memo.head && memo.head.length) {
    RB_COLS_MEMO = { hr: memo.hr, lc: memo.lc, head: memo.head, idx: headerIndex_(memo.head) };
    return RB_COLS_MEMO;
  }
  var lc = Math.min(sh.getLastColumn(), RB.STATUS_COLS);
  var hr = statusHeaderRow_(sh, lc);
  if (hr < 0) throw new Error('발주 DB 머리글(품의번호 · 발주일)을 찾을 수 없습니다.');
  var head = sh.getRange(hr, 1, 1, lc).getValues()[0].map(function (h) { return h == null ? '' : String(h); });
  cachePut_('hdr:status:v3', { hr: hr, lc: lc, head: head }, RB_TTL);
  RB_COLS_MEMO = { hr: hr, lc: lc, head: head, idx: headerIndex_(head) };
  return RB_COLS_MEMO;
}

/**
 * 발주현황 날짜 칸 표기 — 시트에는 'MM/DD' 로 쓴다.
 * 연도는 읽는 쪽(실행판 · 매입예정 자동화)이 발주일로 짐작한다: 입고 월이 발주 월보다 앞이면 다음 해.
 * 실제 연도가 그 규칙과 다르면(1년 넘게 뒤 등) 연도를 잃지 않게 'YY/MM/DD' 로 남긴다.
 * ref: { y, m } 발주일. 없으면 짐작할 수 없으니 'YY/MM/DD' 로 둔다.
 */
function orderRefYm_(v) {
  var d = toDate_(v);
  return d ? { y: d.getFullYear(), m: d.getMonth() + 1 } : null;
}

function sheetDateTok_(tok, ref) {
  var t = String(tok == null ? '' : tok).trim();
  if (!t) return t;
  if (t.charAt(0) === '(') {
    return '(' + t.replace(/^\(/, '').replace(/\)$/, '').split(',').map(function (x) { return sheetDateTok_(x, ref); }).join(',') + ')';
  }
  var m = t.match(/^(\d{4}|\d{2})[.\/-](\d{1,2})[.\/-](\d{1,2})$/);
  if (!m) {
    var m2 = t.match(/^(\d{1,2})[.\/-](\d{1,2})$/);
    return m2 ? pad2_(Number(m2[1])) + '/' + pad2_(Number(m2[2])) : t;
  }
  var y = Number(m[1]); if (y < 100) y += 2000;
  var mo = Number(m[2]), dd = Number(m[3]);
  var md = pad2_(mo) + '/' + pad2_(dd);
  if (!ref) return String(y).slice(2) + '/' + md;
  var guessY = mo < ref.m ? ref.y + 1 : ref.y;
  return guessY === y ? md : String(y).slice(2) + '/' + md;
}

function showVal_(v) {
  if (v === '' || v == null) return '';
  if (v instanceof Date) return fmtDate_(v);
  if (typeof v === 'number') return String(v);
  return String(v);
}

/** 바뀔 칸 목록을 만든다. 시트의 현재 값을 실제로 읽어서 비교한다. */
function sheetPlan_(statusRow, payload) {
  var row = Number(statusRow) || 0;
  if (row < 2) throw new Error('발주 DB에 아직 올라가지 않은 건입니다.');

  var sh = statusSheet_();
  var C = sheetCols_(sh);
  row = checkStatusRow_(sh, C, row, payload.expect);
  var cur = sh.getRange(row, 1, 1, C.lc).getValues()[0];

  var items = [];
  var add = function (col0, name, after, kind, force) {
    var before = showVal_(cur[col0]);
    var a = showVal_(after);
    if (before === a) return;
    items.push({ col: col0, letter: colLetterRB_(col0 + 1), name: name, before: before, after: a, kind: kind || '', force: !!force });
  };
  // 다른 칸의 수식(회차 수량 합산식 등)은 매입예정 자동화가 읽으므로 지키고 건너뛴다.
  var fmlRow = null;

  if (payload.orderedAt !== undefined) {
    var cOrd = colIdx_(C.idx, ['발주일']);
    if (cOrd < 0) throw new Error('[발주일] 열을 찾을 수 없습니다.');
    add(cOrd, '발주일', payload.orderedAt);
  }

  // 사용자가 직접 고치는 칸(품목명 · 코드 · 업체 · 수량 · 단가)은 수식이 있어도 지우고 값으로 쓴다(미리보기에 표시)
  var infoSfx = payload.info ? ' (발주현황)' : '';
  var editF_ = function (col0, label, after, key, kind) {
    if (!fmlRow) fmlRow = sh.getRange(row, 1, 1, C.lc).getFormulas()[0];
    var n0 = items.length;
    add(col0, label + infoSfx + (fmlRow[col0] ? ' — 수식을 지우고 값으로 씁니다' : ''), after, kind || '', true);
    if (items.length > n0) items[items.length - 1].pvk = key;
  };
  [['name', ['품목명'], '품목명'], ['code', ['품목코드'], '품목코드'], ['vendor', ['업체명', '매입처'], '업체명']].forEach(function (f) {
    if (payload[f[0]] === undefined) return;
    var cF = colIdx_(C.idx, f[1]);
    if (cF < 0) throw new Error('[' + f[2] + '] 열을 찾을 수 없습니다.');
    var vF = String(payload[f[0]] == null ? '' : payload[f[0]]).trim();
    if (!vF) throw new Error(f[2] + '은(는) 비울 수 없습니다.');
    editF_(cF, f[2], vF, f[0], 'text');
  });

  // 발주수량 · 단가 변경 — 단계 체크는 건드리지 않는다. 발주잔량이 수식이면 시트가 알아서 다시 계산한다.
  if (payload.qty !== undefined) {
    var cQ = colIdx_(C.idx, ['발주수량']);
    if (cQ < 0) throw new Error('[발주수량] 열을 찾을 수 없습니다.');
    var nq = num_(payload.qty);
    if (!(nq > 0)) throw new Error('발주수량은 0보다 커야 합니다.');
    var cInQ = colIdx_(C.idx, ['입고수량']);
    var inQ = cInQ >= 0 ? num_(cur[cInQ]) : 0;
    if (nq < inQ) throw new Error('이미 입고된 수량(' + inQ.toLocaleString() + ')보다 적게 줄일 수 없습니다.');
    editF_(cQ, '발주수량', nq, 'qty');
    var cRm = colIdx_(C.idx, ['발주잔량']);
    if (cRm >= 0) {
      if (!fmlRow) fmlRow = sh.getRange(row, 1, 1, C.lc).getFormulas()[0];
      if (!fmlRow[cRm]) {
        var nR = items.length;
        add(cRm, '발주수량 변경에 따른 발주잔량', Math.max(0, nq - inQ));
        if (items.length > nR) items[items.length - 1].pvk = 'qty';
      }
    }
  }
  if (payload.price !== undefined) {
    var cP = colIdx_(C.idx, ['단가']);
    if (cP < 0) throw new Error('[단가] 열을 찾을 수 없습니다.');
    var np = num_(payload.price);
    if (!(np >= 0)) throw new Error('단가가 올바르지 않습니다.');
    editF_(cP, '단가', np, 'price');
  }

  return { row: row, items: items };
}

function apiPreviewSheet(statusRow, payload) {
  if (payload && payload.info) return infoPreview_(statusRow, payload);
  return sheetPlan_(statusRow, payload || {});
}

/* ============================================================
 * 발주 정보 수정(✎) — 품목명 · 품목코드 · 업체명 · 발주수량 · 단가
 * 미리보기는 발주 DB 의 지금 값과 견줘 보여 주고(sheetPlan_), 저장은 [발주 수정]과 같은 본체(editOrder_)로 한다.
 * 예전에는 따로 쓰는 길(writeInfo_)이 있어 잔량 계산 · 이력 규칙이 [발주 수정]과 달랐고, 없앤 발주계획 탭까지 찾아 썼다.
 * 건ID 는 실행판ID 로 고정이라 품목코드 · 품목명을 바꿔도 체크 · 메모 · 날짜는 그대로 따라간다.
 * ============================================================ */
var RB_INFO_RANK = { name: 1, code: 2, vendor: 3, qty: 4, price: 5 };

function infoPreview_(statusRow, payload) {
  if (!(Number(statusRow) > 1)) throw new Error('발주 DB에 아직 없는 건입니다.');
  var sp = sheetPlan_(statusRow, payload);
  return { row: sp.row, items: sortInfo_(sp.items), warn: '', planRow: 0 };
}

function sortInfo_(items) {
  return items.map(function (it, i) { return { it: it, i: i }; }).sort(function (a, b) {
    var ra = RB_INFO_RANK[a.it.pvk] || 9, rb = RB_INFO_RANK[b.it.pvk] || 9;
    return ra - rb || a.i - b.i;
  }).map(function (x) { return x.it; });
}

/** [발주 정보 수정] 저장 — editOrder_ 로 넘긴다(사유는 모든 칸 이력에 '발주정보' 로) */
function writeInfo_(statusRow, payload) {
  if (!(Number(statusRow) > 1)) throw new Error('발주 DB에 아직 없는 건입니다.');
  var patch = { reason: str_(payload.chgReason) };
  ['name', 'code', 'vendor'].forEach(function (k) {
    if (payload[k] === undefined) return;
    var v = String(payload[k] == null ? '' : payload[k]).trim();
    if (!v) throw new Error({ name: '품목명', code: '품목코드', vendor: '업체명' }[k] + '은(는) 비울 수 없습니다.');
    patch[k] = v;
  });
  if (payload.qty !== undefined) {
    if (!(num_(payload.qty) > 0)) throw new Error('발주수량은 0보다 커야 합니다.');
    patch.qty = String(num_(payload.qty));
  }
  if (payload.price !== undefined) {
    if (!(num_(payload.price) >= 0)) throw new Error('단가가 올바르지 않습니다.');
    patch.price = String(num_(payload.price));
  }
  if (!patch.reason) throw new Error('변경 사유를 넣어주세요.');
  var r = editOrder_(statusRow, payload.expect, patch, { info: true });
  return { n: r.n, skipped: [], items: [], warn: '', planRow: 0 };
}

/** 미리보기에서 승인한 내용을 실제로 쓴다. */
function apiWriteSheet(statusRow, payload) {
  requireEditor_();
  payload = payload || {};
  if (payload.info) return writeInfo_(statusRow, payload);

  var sh = statusSheet_();
  var done = 0, skipped = [], ordWritten = null, stateNow = '';   // 발주일: true 적음 · false 지움
  // 바뀔 칸 계산(시트의 지금 값과 비교)도 잠금 안에서 — 밖에서 계산하면 그 사이 남이 고친 값을 옛 값으로 보고 덮었다
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var plan;
  try {
    plan = sheetPlan_(statusRow, payload);
  } catch (eP) { lock.releaseLock(); throw eP; }
  if (!plan.items.length) lock.releaseLock();
  if (plan.items.length) {
    var outer = deferVer_();          // 이력 · 반영(flush)은 잠금 놓기 직전 한 번
    try {
      var C9 = sheetCols_(sh);
      // 수식 여부 · 진행상태는 쓰기 전에 그 행을 한 번에 읽어 본다(칸마다 물으면 칸 수만큼 느려진다)
      var kc9 = statusKeyCols_(sh, C9.hr);
      var maxCol = Math.max(Math.max.apply(null, plan.items.map(function (it) { return it.col; })), kc9.state) + 1;
      var rg9 = sh.getRange(plan.row, 1, 1, maxCol);
      var fml = rg9.getFormulas()[0];
      var stBefore = kc9.state >= 0 ? str_(rg9.getValues()[0][kc9.state]) : '';
      var audits = [], cells = {};
      plan.items.forEach(function (it) {
        // 수식 칸은 건드리지 않는다. 미리보기에 '수식을 지우고 값으로 씁니다' 로 보여 준 칸만 예외다.
        if (fml[it.col] && !it.force) {
          skipped.push(it.letter + '열 ' + it.name + ' — 수식 칸이라 못 씁니다');
          return;
        }
        // 제품입고일은 회차 목록이라 늘 글자로 둔다. 나머지는 숫자 · 날짜 · 글자를 가려 넣는다.
        cells[it.col + 1] = it.kind === 'text' ? asText_(it.after) : cellValue_(it.after);
        audits.push({ tab: RB.STATUS_TAB, row: plan.row, col: it.col + 1, what: it.name, before: it.before, after: it.after });
        if (it.name === '발주일') ordWritten = String(it.after || '') !== '';
        done++;
      });
      // 발주일을 적었으면 진행상태도 '발주' 로(앞으로만). 예전에는 잠금을 놓았다가 다시 잡아 따로 썼다.
      if (ordWritten === true && kc9.state >= 0) {
        var ci9 = RB_STATE_ORDER.indexOf(stBefore);
        if (!(stBefore && ci9 < 0) && ci9 < RB_STATE_ORDER.indexOf('발주')) {
          cells[kc9.state + 1] = '발주';
          audits.push({ tab: RB.STATUS_TAB, row: plan.row, col: kc9.state + 1, what: '진행상태(자동)', before: stBefore, after: '발주',
            item: str_((payload.expect || {}).name) });
          stateNow = '발주';
        }
      }
      setRowCells_(sh, plan.row, cells);   // 칸마다 쓰지 않고 붙은 칸끼리 한 번에(수식 칸은 비켜 간다)
      // 발주일: 쓴 뒤 시트에서 다시 읽어 확인하고, 1분마다 지워졌는지 지켜본다(저장 직후 칸이 비는 일이 있었다 10/21)
      if (ordWritten === true) ordGuardAfterWrite_(sh, plan.row, kc9.id, plan.items);
      else if (ordWritten === false) ordGuardForget_(sh, plan.row, kc9.id);       // 실행판에서 일부러 지운 건 되살리지 않는다
      writeAudits_(audits);
      logQtyPrice_(plan.row, audits, payload);
    } finally {
      try { endVer_(outer); } catch (e) { /* 넘어간다 */ }
      lock.releaseLock();
    }
    if (done) cacheDrop_(rowsCacheKey_('po'));
  }

  var out = { n: done, asked: plan.items.length, skipped: skipped, items: plan.items };
  // 발주일을 적었으면 발주일이 붙은 항목(발주서 발송)을 체크하고, 지웠으면 체크를 푼다. payload.prog = { id, meta, mode }
  var pg = payload.prog;
  if (ordWritten !== null && pg && pg.id) {
    try {
      var M = metaFast_(pg.mode);
      var ordChanged = [];
      var pr = editProgress_(pg.id, pg.meta, pg.mode, function (st) {
        if (checkByDate_(st.checks, dateSlots_(M.steps, M.cfg, pg.mode), 'ordered', ordWritten).length) {
          ordChanged = stampSteps_(st.checks, st.dates, M.steps);
        }
      }, function (r) {
        if (ordChanged.length) logSteps_(pg.mode, stepLogRows_(pg.mode, pg.id, pg.meta, ordChanged, r.state.dates, M.steps, me_()));
      });
      out.checks = pr.state.checks;
      out.dates = pr.state.dates;
    } catch (e) { /* 체크가 실패해도 시트에 쓴 발주일은 그대로 둔다 */ }
  }
  if (stateNow) out.state = stateNow;
  if (done) apRefreshSoon_();
  return out;
}

/** 관리자: 단계 정의 전체를 저장한다. */
function apiSaveSteps(steps, mode) {
  requireAdminFast_(mode);
  if (!steps || !steps.length) throw new Error('단계가 하나도 없습니다.');
  var seen = {};
  steps.forEach(function (s) {
    if (!s.id) s.id = 'st' + Utilities.getUuid().slice(0, 8);
    if (seen[s.id]) throw new Error('단계 ID가 중복됩니다: ' + s.id);
    seen[s.id] = 1;
    if (!s.title) throw new Error('단계명이 비어 있습니다.');
    // 항목마다 고유한 k 를 붙인다. 체크가 순번이 아니라 k 에 묶여서
    // 항목을 지우거나 끼워 넣어도 다른 항목의 체크가 옮겨 가지 않는다.
    var ks = {};
    (s.items || []).forEach(function (it) {
      // 변경 여부를 켠 항목만 선택지를 둔다. 선택지는 쉼표로 나눈 목록.
      if (it.chg) {
        it.chg = true;
        var o = Array.isArray(it.opts) ? it.opts : String(it.opts || '').split(/[,，]/);
        it.opts = o.map(function (x) { return String(x).trim(); }).filter(String)
          .filter(function (x, i, a) { return a.indexOf(x) === i; }).slice(0, 20);
      } else { delete it.chg; delete it.opts; }
      // 날짜 연동: 없으면 '자동'(이름으로 짐작), '' 이면 '없음'
      if (it.d === undefined || it.d === null) delete it.d;
      else if (RB_DATE_FIELDS.indexOf(it.d) < 0) it.d = '';
      // 추가 버튼: 하나도 없으면 '' 대신 빈 목록으로 남긴다(기본값 넣기가 다시 채우지 않게)
      if (it.f !== undefined) it.f = cleanFlags_(it.f);
      var k = (it.k === undefined || it.k === null) ? '' : String(it.k);
      if (!k || ks[k]) k = 'i' + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
      it.k = k;
      ks[k] = 1;
    });
  });
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var rows;
  try { rows = writeSteps_(steps, mode); } finally { lock.releaseLock(); }
  // 저장 직후 시트를 다시 읽으면 큰 시트가 다시 계산될 때까지 1초 넘게 기다렸다.
  // 방금 쓴 행을 그대로 단계 목록으로 바꿔 돌려준다(읽을 때와 같은 함수).
  var out = stepsFromRows_(rows);
  // 캐시를 지우면 다음 동작 · 다음 접속 때 시트를 통째로 다시 읽느라 느렸다. 단계만 바꿔 끼운다.
  var mk = metaKey_(mode);
  cacheGenBump_('meta');                  // 지금 시트를 읽던 느린 길이 옛 단계를 다시 담지 않게
  var mc = cacheGet_(mk);
  if (mc) { mc.steps = out; cachePut_(mk, mc, RB_TTL); }
  return out;
}

/** 관리자 확인 — 캐시에 설정이 있으면 시트를 열지 않는다(설정 탭 읽기에 1초 가까이 걸렸다) */
function requireAdminFast_(mode) {
  var mc = cacheGet_(metaKey_(mode));
  if (mc && mc.cfg && isAdminFast_(mc.cfg['admin.emails'], mc.ownerEmail)) return;
  requireAdmin_();
}

/** 관리자: 링크 · 기간 · 관리자 목록을 저장한다. */
function apiSaveConfig(patch) {
  requireAdmin_();
  var out = {};
  Object.keys(patch || {}).forEach(function (k) {
    if (k === 'admin.emails' || k === 'edit.emails' ||
        k === 'dates.stepTitle' || k === 'edit.stepTitle' ||
        k === 'dates.stepId' || k === 'edit.stepId' ||
        k === 'order.stepId') out[k] = patch[k];
    if (k === 'fx.CNY' || k === 'fx.USD') {
      var v = Number(String(patch[k]).replace(/[, ]/g, ''));
      if (!(v > 0)) throw new Error('환율은 0보다 큰 숫자로 넣어주세요.');
      out[k] = String(v);
    }
  });
  // 이전 값 읽기 → 쓰기를 한 잠금 안에서(그 사이 다른 설정 저장이 끼면 환율 변경을 놓쳤다)
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var fxChanged;
  try {
    var fxWas = readConfig_();
    fxChanged = ['fx.CNY', 'fx.USD'].some(function (k) { return out[k] !== undefined && String(out[k]) !== String(fxWas[k] || ''); });
    writeConfigNoLock_(out);
  } finally { lock.releaseLock(); }
  cacheDrop_(metaKey_('po'));
  cacheDrop_(metaKey_('sample'));
  var view = cfgView_(readConfig_());
  if (fxChanged) { try { view.bomFx = bomFxSync_(true).맞출줄 || 0; } catch (e) { view.bomFxErr = e.message; } }
  return view;
}

/** 관리자: 기본 7단계로 되돌린다. */
function apiResetSteps(mode) {
  requireAdmin_();
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  try { writeSteps_((mode === 'sample') ? defaultSampleSteps_() : defaultSteps_(), mode); } finally { lock.releaseLock(); }
  cacheDrop_(metaKey_(mode));
  return readSteps_(mode);
}


/* ============================================================
 * 화면 (HTML + CSS + JS)
 * ============================================================ */

/**
 * 서버와 화면이 똑같이 따라야 하는 규칙 함수들. 화면에는 이 함수들의 원본을 그대로 넣는다(PAGE_HTML_).
 * 예전에는 화면 쪽에 손으로 베낀 사본이 있어서, 한쪽만 고치면 서버와 화면이 다르게 판단했다
 * (일괄 완료가 단계를 못 끝내던 문제가 그렇게 생겼다). 이제 고칠 곳은 여기 한 군데다.
 */
var RB_SHARED_FNS = [itemKey_, itemResolved_, chgDec_, itemRequired_, stepDoneSrv_,
  datesStepId_, orderStepId_, dateSlots_];

function SHARED_RULES_JS_() {
  return [
    'var RB_OPT_RULE_FROM = ' + JSON.stringify(RB_OPT_RULE_FROM) + ';',
    'var RB_DATE_FIELDS = ' + JSON.stringify(RB_DATE_FIELDS) + ';',
    'var RB_REQ_DATE_RE = ' + RB_REQ_DATE_RE.toString() + ';'
  ].concat(RB_SHARED_FNS.map(function (f) { return f.toString(); })).join('\n');
}
