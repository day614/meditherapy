# 이 저장소에서 작업할 때

## 발주 실행판 (Apps Script 웹앱) — 사용자가 "실행판 · 품목 정보 · BOM · 발주" 얘기를 하면 이것
- 웹앱 URL: https://script.google.com/a/meditherapy.co.kr/macros/s/AKfycbxDxIa0VfBSUfkBhfSVsLb4S2udMPkWFE8Viu1FpDcolSvL42bHTKwE2d3dnqAvnt_nWw/exec
  - 배포 ID: `AKfycbxDxIa0VfBSUfkBhfSVsLb4S2udMPkWFE8Viu1FpDcolSvL42bHTKwE2d3dnqAvnt_nWw`
- Apps Script 프로젝트 "발주 실행판" — Drive 파일 ID(= 스크립트 ID): `1FZuAuWlsQu8qX6UzH49pOiaNY90fICD3JhqjkLET6uvJCIkd6qBHDhIc`
- 원본은 저장소에 없다. 최신 원본은 Google Drive 커넥터로 받는다:
  `download_file_content(fileId=위 ID, exportMimeType="application/vnd.google-apps.script+json")` → `content` 를 base64 로 풀면 `{files:[{name,type,source}]}`.
- 주요 파일: `ItemInfo.gs`(품목 정보 창) · `Bom.gs` · `BomExtra.gs`(BOM 저장 · 1분 작업에 미루는 일 `bomLater_`) · `BomShim.gs`(Supabase 먼저 저장) · `Journal.gs`(1분 · 10분 트리거) · `PageHtml.html`(화면 전체).
- 내 메모장(f309): 서버 `Notes.js`(숨김 탭 `_실행판_메모장` · 계정마다 한 줄 · 판 번호로 충돌 확인) · 화면은 PageHtml 끝의 `NOTE`/`note*` 함수(블록 편집).
- 무거운 일은 1분 작업으로 미루는 패턴(`bomLater_({k:...})` → `bomLaterDrainIn_`)을 따른다.

### 배포 — 고치면 Claude 가 끝까지 배포한다(설명 · 붙여넣기 안내로 끝내지 말 것)
몇 달째 이 방식으로 배포해 왔다. 사용자에게 다시 설명을 요구하지 말 것.
1. clasp 설치(스크래치 폴더): `mkdir -p $S/clasp && cd $S/clasp && npm init -y && npm i @google/clasp`
   - script.googleapis.com · oauth2.googleapis.com 은 열려 있다(script.google.com 만 막힘 — 웹앱 화면 확인은 못 함).
2. 로그인(세션마다 — 컨테이너가 바뀌면 사라짐). **`tools/clasp-login2.mjs` 를 쓴다**(대기 프로세스 없이 2단계 — 예전 FIFO 방식은 프로세스가 꺼져 사용자가 두 번 로그인했다):
   - 회사(default): 처음엔 `clasp login --no-localhost` 한 번이 필요(clasprc 에 client_id/secret 생김). 그 뒤 계정은 아래로.
   - `node tools/clasp-login2.mjs start <user>` → 주소를 사용자에게 → 받은 `http://localhost:8888/?state=...` 를
     `node tools/clasp-login2.mjs finish <user> '<주소>'` (state 가 start 때와 같은지 확인).
   - 회사 = `default`(day@meditherapy.co.kr), 개인용 = `personal`(rjfwndrjf@gmail.com). 둘 다 필요하면 **한 번에 두 주소를 같이** 준다.
3. 작업 폴더: `.clasp.json` = `{"scriptId":"1FZuAuWlsQu8qX6UzH49pOiaNY90fICD3JhqjkLET6uvJCIkd6qBHDhIc","rootDir":"."}` → `clasp pull`
   (파일은 `.js` · `PageHtml.html` · `appsscript.json`). 고치기 전에 pull 한 것을 기준으로 한다.
4. `Code.js` 의 `RB_BUILD`(예: `'2026-11-10f288'`)를 다음 번호로 올린다 — 열린 화면에 새 버전 안내가 뜬다.
5. `node --check` 로 고친 .js 검사 → `clasp push -f` → `clasp create-version "<판> <설명>"` →
   `clasp list-versions | tail -1` 로 번호 확인(쉼표가 붙어 나온다: 1,049) →
   `clasp update-deployment AKfycbxDxIa0VfBSUfkBhfSVsLb4S2udMPkWFE8Viu1FpDcolSvL42bHTKwE2d3dnqAvnt_nWw -V <번호> -d "<설명>"`
   - **버전 한도 200개**: `create-version` 이 "limit of 200 versions" 로 실패하면 API 로는 못 지운다 — 사용자에게 편집기 → 프로젝트 기록(시계 아이콘)에서 오래된 버전 삭제를 부탁한다(배포 중인 번호는 남김). 지운 뒤 반영까지 30초쯤 걸리니 몇 번 다시 시도.
6. `clasp list-deployments` 로 `@<번호>` 확인. 결과를 시트(Drive 커넥터)로 확인할 수 있으면 확인한다.

### 개인용(빈 시트판) — 회사판을 고치면 개인용에도 같이 반영 · 배포한다(묻지 말 것)
- 스크립트 ID `1Wn8a5OdWSQLAB8EYzOHkkMmzG4gXTXwZm1QC1yP1s8BW4fCs9mbcX8_j` · 배포 ID `AKfycbx8DuktVoqi_Dgx-aztSo9cix_ciXXAok0grG_au9qlRmoeZ8j82dC0spN38_PzC7CUEw` · clasp 는 `-u personal`.
- 회사판 축소판: `BLANK_SETUP: true` · 시트 ID = 활성 시트(`RB_ACTIVE_ID`) · Setup.js/Custom.js/ShimOff.js 만 있음 · Supabase · 슬랙 · GWP · 재고 · Share · Archive · Audit 없음.
- `Notify.js`(슬랙 알림)는 회사용만 — 개인용에 넣지 않는다(다른 파일은 `typeof` 로 있을 때만 부름).
- 판 번호는 회사판 번호 + `p`(예: 회사 `f288` → 개인 `f288p`).
- 반영: 개인용을 pull → 바꾼 파일마다 `git merge-file -p <개인 파일> <회사 고치기 전> <회사 고친 뒤>`(3-way). 충돌은 개인용 쪽(Supabase 등 없음)으로 푼다.
- 올리기 전: `node --check` · 회사 ID 검사 `grep -rln "1pmCAw1qqxUOlQGtYJhq672ieg1w0cGJMC\|1krXu_Vf7WahKKgIW6oVK4cDVbpcRX04lTo885\|meditherapy-gwp\|hooks.slack" .` 가 비어야 함.

### 속도 개선 방향 — B: Supabase 직접 저장(2026-11-10 담당자 결정)
- 이유: Apps Script 는 호출마다 2~4초 고정(코드 2.5MB 다시 띄움) + 시트 읽기/쓰기 · 잠금 줄서기. 화면이 서버를 기다리는 구조로는 2초 안 불가.
- 원칙: **저장 화면은 '저장됨' 확인까지 기다린다**(먼저 닫고 뒤에서 저장 — 실패하면 다시 들어가야 해서 안 됨). 뒤로 미는 건 시스템이 스스로 다시 하는 뒷정리만.
- 방식: 실행판이 열릴 때 서버가 로그인 계정으로 세션 토큰(rb_session)을 만들어 화면에 줌 → 화면이 Supabase RPC(security definer · 토큰으로 계정 확인 · 규칙 검사)를 anon 키로 직접 부름. 테이블은 RLS 로 잠금. 시트는 1분 작업이 맞추는 보기용 사본.
- 순서: ① 메모장(rb_note) ② 발주 등록 ③ 발주 수정 · 지급 줄 ④ BOM. 단계마다 실측 · 시트 맞는지 확인 후 다음.
- 준비: 이 환경 변수 `SUPABASE_PAT`(Supabase 관리 토큰 · sbp_…). 있으면 https://api.supabase.com/v1/projects/ybtqbxifkqfynrqpbkop/database/query 로 SQL · /api-keys 로 키. 없으면 사용자에게 위 이름으로 환경 변수 추가를 부탁(채팅에 붙이지 않게).
- **진행(2026-11-11 새벽)**: ① 메모장 끝 — f313. SQL m002_rb_core(rb_session · rb_note · rb_me · rb_note_get/save · RLS) · `sbAnon_`(관리 API 로 공개 키 → SB_ANON) · `sbSessionNew_` · `sbRpcAnon_` · 1분 작업 `noteDbSelfTest_`(통과 → rb.noteDb=ok · 시트 메모 옮김) · 화면 `noteSess`/`noteRpc`(직접 · 안 되면 서버 길 apiNoteGet/Save — 둘 다 rb_note). 결과 확인은 '실행판 속도 요약' 파일(Drive 1EpN9IpCC5uQ67z_IzBlP4Ii0qnXvxN9WwDWFvAtAQRM) 'Supabase 상태' 탭 'Supabase 직접(속도 B)' 줄.
- ② 발주 등록: 서버 안에서 8가지(검사 · 발주 DB 행 80칸 · 지급 줄 · 발주 행 맞추기 · AP · 이력 · 품목 DB · 진행 기록). 방식(접수만 Supabase + 1분 작업 반영 / 전부 Supabase 함수)은 사용자 결정 기다림.
- **이미 있는 직접 읽기(f92 · 2026-11-11 확인)**: 서버 `apiSbToken`(Supabase.js)이 12시간 JWT(role authenticated · 스크립트 속성 SB_JWT 로 서명 · SB_ANON 공개 키)를 화면에 줌 → 화면 `SB_TOK`/`sbGet`(PageHtml)으로 bom_rows · bom_log 를 직접 읽음(`bvSbLoad`). SB_JWT · SB_ANON 둘 다 '있음'(속도 요약 파일 확인).
- **BOM 보기가 느린 직접 원인**: `bomLoad` 가 Supabase 사본을 먼저 그리지만 `bvStale(true)`로 고치기를 막고 서버 apiBomGet(가운데값 4.6초)을 기다림. BOM 은 Supabase 먼저 저장이라 bom_rows 가 가장 최신 — 다음 할 일: 고치기에 필요한 것(compBom · semiPin · links · prev)을 Supabase 에서 같이 읽고 바로 고칠 수 있게. 저장은 서버(apiBomSave)가 줄ID · 행 확인으로 지킴.
- **f314(2026-11-11 09시 · 회사 @1074 · 개인 f314p @174)**: BOM 보기 즉시 고치기 끝 — `bvSbLoad` 가 구성 완제품 · 반제품 BOM(compBom · compMats)까지 Supabase 에서 읽고, 고치기 막음(bvStale) 없이 바로 그린다. 서버 값은 `bvRowsSame` 으로 비교해 같으면 이력 · 링크만 채움. 링크는 `BV_LINKC`(서버에서 받은 것 기억). 개인용은 Supabase 읽기 블록 없음(그대로).
- **f315(2026-11-11 12시 · 회사 @1075 · 개인 f315p @175)**: 이슈 · 품목 링크 직접 읽기 — SQL m003_tab_read(sheet_rows 읽기 정책 rb_auth_read_tabs: authenticated · 이슈/품목링크/품질 탭만 · 옛 메모장 사본 지움, 전체 사본도 메모장 탭 안 올림). 1분 작업 `tabReadSelfTest_`(화면 JWT 줄 수 = 서버 줄 수 · 발주/메모장/설정 안 읽힘) 통과 → rb.tabRead=ok. `apiSbToken` 이 `tabs`(통과 + 그 탭 Supabase 먼저일 때 is · lk)를 줌 → 화면 `sbTabOk` · `sbIssAll`(issAllLoad · issLoad) · `sbLinksOf`(bvSbLoad 링크). 안 되면 서버 길. 일일보고 · 품목 목록(apiItems) · 시작(apiBootstrap)은 원본 탭이 Supabase 먼저가 아니라(사본이 늦음) 직접 읽기 못 함 — 저장을 옮겨야 함.
- **f316 · f317(2026-11-11 12시 · 회사 @1076 · @1077 · 개인 @176 · @177)**: 품목 목록 · BOM 전체 직접 읽기.
  - 품목 DB(`_실행판_품목`)는 원본이 시트 — `cacheDrop_(RB_ITEM.CACHE)` 가 `sb:itemDirty` 를 켜고 1분 작업 `itemSbSync_` 가 탭을 sheet_rows 로(10분마다도). SQL m004_item_read(읽기 정책에 품목 탭 추가). `sbReadTabsOk_` 는 'it' 를 사본이 15분 안 · 더러움 없음일 때만 줌. 자체 시험 판 `RB_TABREAD_V='ok2'`.
  - **Supabase 는 한 번에 1000줄까지**(max-rows) — 화면 `sbGetAll`(1000줄씩 3개 동시) · 서버 자체 시험도 1000줄씩. f316 은 이걸 몰라 시험 실패(품목 1500줄) → 서버 길로 돌아감(틀린 값 안 보임) → f317 에서 고침.
  - 화면: `sbItemsLoad`(loadItemDB — Supabase 먼저 · 서버 apiItems 는 뒤에서 그대로) · `sbBomAll`(bom_rows 전체 → BV_ALL · BOMC; apiBomAllRows · apiBomCodes 대신, 3초 묶음). `apiSbToken` 의 `bom`(BOM Supabase 먼저 · rb.sbdirty 없음)일 때만 → `sbBomOk`.
  - 일일보고 · 첫 화면 · BOM 목록은 이미 브라우저 기억(localStorage)을 먼저 그림. 남은 느림은 저장(서버 고정 3초 + 시트) — 발주 수정(editOrder_ Keys.js: 발주 DB 80칸 · 지급 줄 따라 고치기 · 이력 · AP · 감사)은 Supabase 함수로 다시 써야 함.
- **f318(회사 @1078 · 개인 @178)**: 이슈 저장 Supabase 함수 직접(속도 B ③ 첫 저장) — 새 파일 `IssueDb.js`(회사만). SQL m005_iss_db: rb_session.editor(저장 권한 · `sbSessionNew_` 가 canEdit_ 로) · `rb_tab_job`(시트 맞추기 일) · `rb_iss_do`(규칙 = Issues.js …0_ · advisory lock · 지우기는 아래 행 당김) · `rb_iss_save`(화면 · 세션) · `rb_iss_save_srv`(서버 길 · 서비스 키만). 서버 apiIssue* 도 `issDbOn_()` 면 같은 함수 → 저장 길 하나. 1분 작업 `issJobDrain_`(rb_tab_job → `tvRepApply_` · 이미 있는 줄 추가는 건너뜀) · `tvSbFullSync_('is')` 는 남은 일을 먼저 씀. 자체 시험 `issDbSelfTest_` → rb.issDb=ok. 화면 `issRun()`(gsr 모양 · 세션 `iss` 일 때 직접 · 연결/세션 문제면 서버 길) · 세션 키 `rb.noteSess2`. **SQL 은 로컬 Postgres 16(/usr/lib/postgresql/16 · nobody 로 /tmp/rbpg 에 initdb)에서 모든 작업 시험 후 올림** — 다음 함수도 이렇게.
  - 같은 품목 이슈 이력(사용자 요청): 발주 이슈 칸 아래 '같은 품목(M0086) 다른 발주 이슈 이력' — `issStem`(영문1+숫자4, HX · MP 도 같은 번호) · `issHistLoad`(Supabase 직접 또는 서버 `apiIssueAll`).
- **f319(회사 @1079 · 개인 @179)**: BOM 메뉴에서 바로 연 BOM 의 보기 막대에 [+ 차수 추가 (다음 발주용)] — `bvChgStart(true)`. 이 품목 발주(취소 빼고 · 종결 포함) 최대 차수 다음부터만(이미 있는 발주 차수에 만들면 그 발주의 BOM 단가 · BOM 확인 기준이 바뀌므로 막음). 저장은 예전 [차수 추가](BV.draft) 그대로.
- **f320(회사 @1080)**: 이슈 자체 시험의 PostgREST 주소에 `>` 그대로(`cells->>2`) → Apps Script '잘못된 인수' — `encodeURIComponent('cells->>2')`. 시험 통과(rb.issDb=ok 13:06).
- **f321(회사 @1081 · 개인 @180)**: "메모장이 없어졌다" — 버튼 z-index 25 라 BOM 보기(75) · 일일보고(900) · 건 상세(950) 같은 전체 화면에 가려짐 → `.notefab` 960 · `#ntPop` 9000 · `#ntMenu` 9001. Playwright(목업 google.script.run)로 BOM 화면 위 elementFromPoint 확인. 상태 줄에 '저장된 메모 N명(계정 판)' 추가 — 내용은 그대로였음(day 판3).
- **f322 · f323(회사 @1082 · @1083 · 개인 @181 · @182)**: 품질 기록 · 품목 링크 저장도 Supabase 함수(SQL m006_qual_db · m007_link_db · `IssueDb.js` 의 qualDb*/linkDb*). 1분 작업 `tabJobDrainIn_(k)`(is · ql · lk 공통 — 탭 열쇠(d.key)로 이미 있는 줄 건너뜀 · 일에 든 hist(저장한 사람 · 때)는 appendHist_ 로). 세션 `ql` · `lk`. 화면 `qualRun` · `linkRun`. 자체 시험 rb.qualDb · rb.linkDb = ok(14:17 · 14:20).
- **f324(회사 @1084 · @1085 · 개인 @183)**: ① "새 품목코드 저장했는데 품목 등록하라고 함"(H0033AA2) — 서버는 품목 DB 에 넣었음(점검 확인). 화면이 새 품목코드 저장(apiBomSaveNewVersion) 뒤 `bvPendReg` 를 안 해, 다시 받은 품목 목록(f316 Supabase 사본 · 1분 늦음)에 없어 '품목코드 생성 필요'. → 저장 성공 때 `bvPendReg([newCode] + made)` · loadItemDB 가 방금 등록한 코드(BV_PENDREG)를 받은 목록에 남김. ② BOM 화면에 품질 이력 · 이슈 이력(`bvQiShow` · `#bomv-qi` — 변경 이력 위 · 읽기만). ③ BOM 관리에서 연 BOM 과 발주 상세 [BOM 보기]는 같은 모듈(bomOpen → bomLoad → bomShow) — 발주에서 열면 `BV.order` 만 붙음.
- **트리거(1분 · 10분 작업)는 HEAD 가 아니라 배포된 판으로 돈다**(f324 점검 줄을 push 만 했을 때 안 바뀜 → 버전 올리니 바뀜). 서버 고침은 버전까지 올려야 1분 작업에 반영.
- **f325(회사 @1086 · 개인 @184)**: ① 품목 정보 저장 Supabase 함수(SQL m008_item_db: rb_item_save/_srv · rb_conf(구분 목록 — itemSbSync_ 가 choicesOf_ 로 올림)). 품목 DB 는 원본이 시트라 Supabase 사본 행을 고치고 rb_tab_job(tab=it · {code,set,hist,nsync}) → 1분 작업 `itemJobDrainIn_`(칸마다 예전처럼: 단가 숫자 · 바코드 @ · 나머지 asText_ · 이력 · BOM 줄 맞추기 nsync). `itemSbSync_`(시트 → 사본)는 남은 일을 먼저 씀. 서버 apiItemDbSave 는 `_ui` 저장만 같은 함수로. 화면 `itemRun`(세션 it). 자체 시험 rb.itemDb=ok(17:39 — 사본에 시험 행 999999 넣고 지움). ② BOM 이슈(SQL m009_iss_bom): BOM 관리에서 연 BOM(BV.order 없음)에서만 등록 · 대상키 `bom:<품목코드>` · 종류 BOM · 일일보고 '발주 이슈'에 'BOM 이슈'로(Weekly.js) · 이슈 이력(BOM 화면 · 발주 상세)에 같은 번호로. ③ 슬랙 기록: rb.slackQ(넣음) · rb.slackLast(보냄) · rb.slackErr → 상태 줄.
- **f326 · f327(회사 @1087 · @1088)**: H0033AA2 슬랙 알림 안 감 — 다시 보내니 정상(17:43). 원인: `bomLaterDrainIn_` 가 대기열을 먼저 지우고 슬랙을 맨 끝에 보냄 → 앞 일이 길어 1분 작업이 끊기면 알림 사라짐 → 슬랙을 맨 앞으로.
- **f328(회사 @1089 · 개인 @185)**: 샘플 업체 견적 비교(.qtab) — 탈락 열 머리칸(`th.qoff`) 배경이 투명이라 아래 줄이 비침 → 배경색. 머리칸 단추 두 줄(`th:not(.qtl)` 230px). 업체(안) 열 4개 이상이면 상세 패널(`--drawer-w`)을 표가 넘치는 만큼 넓힘(화면 폭 −80px 까지 · MutationObserver on #view-run · 닫으면 되돌림) · 넓을 때 메모장 단추는 패널 안(`body.drawer-wide`). Playwright 1920px: 6개 업체 가로 스크롤 0.
- **다음 순서(사용자: 전부 · 당장)**: ① BOM 보기 즉시 고치기 ② 현황 목록 · 이슈 · 품목 정보 · 일일보고 직접 읽기(같은 JWT · RLS authenticated 읽기) ③ 저장(BOM → 발주 수정 → 지급 줄)을 Supabase 함수로 — 그림자 비교 후 새벽 전환. 발주 등록은 이미 화면 먼저 · 뒤에서 저장(pumpCreate) 구조라 마지막.
- 지금 Supabase: sheet_rows(tab,row,cells — 시트 행 사본) · bom_rows · bom_log. 서버만 service_role(스크립트 속성 SB_KEY)로 씀. SQL 이주는 SB_MIGRATIONS(Supabase.js) → 1분 작업 sbMigrate_(SB_PAT).

## 자재 아카이브 (`index.html`)
- 별도 앱. GAS 백엔드 URL 은 `index.html` 안의 `GAS_URL`. 시트: "소싱 아카이브 DB".
