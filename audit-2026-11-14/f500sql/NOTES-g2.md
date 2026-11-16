# 묶음 2 — 발주 등록 · 품의 · 품목: 할 일 대기열 → Supabase 함수로 바로(진짜 결과) — f497(안) · 배포 안 함

**쉬운 한 줄**: 새 발주 등록 · 품목코드 등록 · 업체 추가 · 기안 원복 · 상신 대기 올리기/버리기 · 상신 완료가 이제 누르는 그 자리에서 Supabase 에 저장되고, 화면은 '저장 중' 흉내 대신 진짜 결과(새 행 번호 · 못 넣은 건 · 바뀐 품의번호)를 바로 받습니다.

## 옮긴 것(새 SQL 함수 — rb_once 허용 목록 · 화면 RB_ONCE_FN 에 넣어 주세요)
| 화면 api | SQL(p_token, p_args) | 세션 표시 | 규칙 원본 |
|---|---|---|---|
| apiCreateOrder | `rb_co_create` | pos | Keys.js apiCreateOrder0_(writeStatusRows_ · linesForNewOrder_ · replaceLinesFor_ · syncOrderFromLines_ · regItem) |
| apiItemRegister | `rb_item_reg` | pos | Bom.js apiItemRegister |
| apiVendorAdd | `rb_vendor_add` | pos | Vendors.js apiVendorAdd(vendorList_ 많이 쓴 순 · 표기만 다른 업체) |
| apiPoRedraft | `rb_po_redraft` | pos | poCancel_(…, withOrdered=true) — m081 rb_po_cancel_do 와 같은 틀 + '발주' 건 |
| apiPoPendAdd | `rb_po_pend_add` | pos | Keys.js apiPoPendAdd(번호 다시 쓰기 · 겹친 대기 지움 · 빈 번호 · BOM 확인 막기) |
| apiPoPendDrop | `rb_po_pend_drop` | pos | apiPoPendDrop |
| apiPoSubmit | `rb_po_submit` | pos | apiPoSubmit = apiBulkDoc0_ + podbBulkApprovalNo_ + 상신 대기 정리 |

- RB_ONCE_FN 정규식에 더할 것: `co_create|item_reg|vendor_add|po_(redraft|submit|pend_add|pend_drop)` · rb_once ok[] 에 `rb_co_create, rb_item_reg, rb_vendor_add, rb_po_redraft, rb_po_pend_add, rb_po_pend_drop, rb_po_submit`.
  (지금 화면은 RB_ONCE_FN 에 없으면 rb_once 없이 함수를 바로 부른다 — 합친 뒤엔 요청 번호 중복 막기가 붙는다. 발주 등록은 같은 실행판ID 면 '이미 있음'을 돌려주므로 두 번 들어가지 않는다.)
- 서버 서비스 키 전용(허용 목록 불필요): `rb_po_conf_put` · `rb_po_pend_get/put/import`.
- 공유 목록 함수(rb_once · rb_pj_do · RB_ONCE_FN)는 고치지 않았다. 내부 도우미 이름은 모두 `rb_po_*` · `rb_vendor_*` · `rb_item_reg_do`.

## SQL 이주(Supabase.js 에 JSON.stringify 로 넣음 · U+2028/2029/FEFF 없음 확인)
- `m095_po_direct.sql` — 도우미(rb_po_truthy · todate(넘치는 날 포함 toDate_) · ym(payYm_ · '11월말일' · 27'1월) · tok(sheetDateTok_) · col · set · cat) · rb_po_conf(part) · rb_po_item_add · rb_item_reg · rb_vendor_add · rb_co_create · rb_po_conf_put.
  **bom_rows.vendor 열을 읽는다**(실서버 표에는 있음 — 로컬 시험 DB 는 `alter table bom_rows add column vendor text` 로).
- `m096_po_redraft.sql` — rb_po_redraft(_do).
- `m097_po_pend.sql` — 상신 대기 원본을 rb_conf 'poPend' {o, ver} 로 · rb_po_pend_add/drop · rb_po_submit · 서버용 get/put(판 번호 확인)/import.

## 어떻게(잠금 · 결과 · 뒤처리)
- 잠금 차례 rb_tab_pd → rb_tab_ln → rb_tab_it(거꾸로 잡는 곳 없음). 켜짐 = rb_conf 'poConf'(서버 `poConfPublish_` · 1분 작업 · parts: co · it · ln · vd · pp) + 발주 DB 는 pdConf(rb_pd_ready — 머리글 검사 · 꺼짐 · 'gate:<함수>').
- **발주 등록**: SQL 이 그 자리에서 ① 발주 DB 사본 새 줄(nextFreeRow_ 규칙 · 보이는 값 = 흉내 시트가 올리던 값, 발주금액은 값) ② 지급 줄 사본(빈 자리 → 맨 아래 · 줄ID id-n1…) ③ 발주 행 맞추기(입고 0 · 잔량 · 입고일정) ④ 품목 DB 사본(없는 코드면 새 줄 · 빈 바코드 채움) → 결과 `{id, statusRow, lines, pay:{missed}, warn:'', direct:1}`(예전 서버 결과와 같은 모양).
  뒤처리: `pdx {add:[{id,row,w}]}`(시트에 쓸 원래 값 · 수식 · 날짜 {d} — pdxDrainIn_ 이 tvRepApply_ addAt 으로, 줄이 차 있으면 아래로 밀고 수식 행 번호 고침) · `ln`(lnDbDrainIn_ · post 가 AP) · `it {add}`(itemJobDrainIn_ → appendItems_ — 슬랙 신규 코드 알림 그대로) · `pj '_poPost' kind create`(이력 '실행판 신규 등록' · 통화 기록 _cur(editProgress_) · 캐시 · AP).
  같은 ID 다시 → `{already:true}`(예전과 같음, 지급 줄이 빠진 옛 건은 RB_FALLBACK → 서버 길이 이어 씀).
- 화면 pumpCreate: 진짜 statusRow 를 받아 바로 진짜 행(pending 풀림) — PROV_KEEP '저장 중' 흉내는 RB_FALLBACK(예전 할 일 길)일 때만.
- **상신 대기 원본 이동**: m097 뒤 1분 작업 `poPendImport_` 가 스크립트 속성 rb:popend 를 한 번 옮기고 rb.poPendSb 표시 → 그 뒤 서버 poPendRead_/poPendWrite_ 도 Supabase(판 번호가 다르면 '잠시 뒤 다시' — 할 일 길은 다시 넣고 gsr 은 저절로 다시). 개인용은 PoDirect.js 가 없어 예전 그대로(typeof).
- **상신 완료**: 발주 DB 칸(품의번호 · 계획→상신 · 결재문서번호)과 상신 대기는 SQL 이 바로, 진행 기록(상신일 · 상신 체크 — 실제 markSubmitted_) · rb.docq · 이력은 `_poPost kind submit`(할 일 차례 — 그동안 그 건 진행 기록 직접 저장은 rb_pg_busy 로 서버 길). `checked` 는 사본으로 센 값(상신일 없음 또는 상신 항목 체크 빠짐 — markSubmitted_ 과 같은 판정).
- **기안 원복**: '_pdPost kind poCancel'(품의 취소와 같은 뒷정리 · rb.docq · 진행 기록 상신일/승인일).

## RB_FALLBACK(아무것도 안 들어감 → 화면은 예전 할 일 길 pjDirect)
poConf/pdConf 꺼짐 · 머리글 다름 · gate · 지급 줄 직접 꺼짐/시트 맞추기 중/머리글 다름 · 품목 DB 직접 꺼짐 · 신제품 + 코드(품목 DB · BOM · 채번 확인은 서버 길) · 발주요청팀 열 없음(부가정보 탭 길) ·
같은 건 앞선 할 일(rb_pd_busy) · 진행 장부(pgJ) · 상신 대기 아직 안 옮김 · 결재문서번호 열 없음 · 예전 열쇠(ID 없는 건) · 진행 기록 사본 꺼짐(BOM 확인 검사) · 객체/배열 값 · 4바이트 글자.

## 시험(로컬 Postgres 16 · 내 DB g2 = pg3 + m095~m097 · test_setup.sql) — 숫자
- `TZ=Asia/Seoul RB_DB=g2 node h_co.js ../cn497 work` — 실제 apiCreateOrder0_ · apiItemRegister · apiVendorAdd · apiPoRedraft0_(가짜 시트) ↔ SQL: 결과 · 오류 문구 · 발주 DB 모든 칸(보이는 값) · 시트에 쓸 값(pdx w = 예전 길이 쓴 원래 값 · 수식) · 지급 줄 · 지급 줄 시트 쓰기 · 품목 DB · 이력 · 통화 기록 · RB_FALLBACK · 세션 · 두 번. **78/78** (results_co.md · run_co.txt). 일부러 SQL 을 틀리게 하면 44/70 으로 잡힘(대조가 실제로 본다).
- `node h_pp.js ../cn497 work` — 상신 대기 올리기(14) · 버리기(2) · 상신 완료(11): 결과 · 상신 대기 목록(옛 스크립트 속성 ↔ rb_conf) · 발주 DB 칸 · 이력 · 상신일 건 · 품의번호 대기열 열쇠. **27/27** (results_pp.md).
- `node pdx_co_test.js ../cn497 work` — SQL 등록 → 실제 pdxDrainIn_(고친 PdDirect.js · TabShim tvRepApply_) → 가짜 시트 줄 = 예전 길이 쓴 줄('02035' · '02' · '10/15' 글자 · 수식 · 날짜). 시트가 한 줄 앞서도 아래로 밀고 수식 행 번호 고침. **3/3**.
- `node it_test.js ../cn497 work` — SQL 품목 등록 → 실제 itemJobDrainIn_(고친 IssueDb.js) → 품목 탭 = 예전 길. **4/4**.
- `./lock_test.sh` — 동시 등록 두 건: 앞 건이 잠금 2초 → 뒤 건 1.5초 기다린 뒤 다음 행(5 → 6) · 지급 줄 다른 자리. (run_lock.txt)
- 모든 .js node --check · 화면 ext.js → s0.js node --check 통과 · 새 화면 함수(poDirect · poKick) 이름 중복 없음.

## 기준 판: cn497(= cn494 + audW/audR 고침) 위에 다시 얹음
- 3-way 병합(git merge-file). 화면 충돌 3곳은 cn497 의 새 할 일 길 규칙(rbPayYm pay.missed · CREATE_DIRECT · ngRefill 되살리기 · PO_SUBMIT_WAS skipped · rbStateSplit 기안 원복)을 **RB_FALLBACK 때 쓰는 예전 길(old) 안에 그대로** 두고, 그 앞에 poDirect(진짜 결과)를 붙임. 직접 성공이면 PO_SUBMIT_WAS[no] 도 지움.
- SQL 응답 문구 · 칸 = 서버와 같음(audW 메모와도 같음): 기안 원복 "<이름> — 진행상태 X(계획 · 상신 · 승인만 취소)" · n · skippedIds / 상신 완료 skipped "<이름> — X된 건" · "<이름> — 이미 품의번호 Y" + 결재번호 실패 "<이름>: X된 건은 고칠 수 없습니다 — 먼저 [종결 풀기]/[취소 풀기]를 해 주세요." · 못 넣은 건만 상신 대기에 남김(pend) / 발주 등록 pay.missed · warn.
- 상신 완료 직접 응답은 `direct` 대신 `sb:1`(화면 토스트가 실제 n · 결재문서번호 · 못 넣은 건 수를 보여 주게).
- cn497 pjNotePut_ 는 객체 인자의 id 를 남긴다 → _poPost(args[0].id = 새 발주 ID) 실패도 그 건 이름으로 알림. 직접 등록 건은 CREATE_DIRECT 에 없어 ngRefill 되살리기는 안 함(행은 이미 저장됨).
- 시험은 모두 cn497 기준으로 다시 돌림(숫자 같음).

## 서버 · 화면 바꾼 곳(patch.diff — `diff -ruN $S/cn497 work`)
- 새 `PoDirect.js`(회사 전용): poConfBuild_/Publish_ · poPendSbOn_/poPendImport_ · poDirectPost_(_poPost: create · vendor · submit) · apiPoKick · poDirectSelfTest_(가짜 토큰 → RB_SESSION) → rb.poDirectTest=ok.
- PdDirect.js pdxDrainIn_: `add` 새 줄. IssueDb.js: itemJobDrainIn_ `add`(appendItems_) · fnMap `_poPost`. Notes.js 세션 `pos`. Journal.js 1분 작업 poConfPublish_ · poDirectSelfTest_. Keys.js poPendRead_/Write_ Supabase 길(typeof). PerfRun.js 상태 줄 '발주 등록 · 품의 직접(f497)'. Supabase.js m095~m097.
- PageHtml: `poDirect`(noteRpc → 세션 pos · RB_FALLBACK 이면 예전 pjDirect 그대로) · `poKick`(apiPoKick · busy · 남은 일 있으면 8초마다 6번) · RB_DIRECT apiCreateOrder/ItemRegister/VendorAdd/PoRedraft/PoPendAdd/PoPendDrop/PoSubmit.

## 남은 것 · 위험
- **못 옮김(할 일 길 그대로)**: apiWaitReply(샘플 진행 기록 메모 JSON — rb_pg 쪽 'sample' 줄 쓰기 필요) · apiItemDelete(품목 · BOM · 발주 확인 미리보기 → 지우기) · apiBulkItems · apiBulkItemsUndo(진행 기록 일괄 — rb_pg_apply 에 kind 추가로 가능).
- 신제품 + 코드 등록은 RB_FALLBACK(서버 길) — 채번 탭(bomRegCodes_)을 Supabase 가 못 봄.
- 상신 완료의 진행 기록(상신일 · 체크)은 뒷정리 일(몇 초 · kick)로 — 그 사이 다른 사람 화면은 상신일이 잠깐 비어 보일 수 있음(발주 DB 칸은 바로). 이력의 건 열쇠 doc 은 새 품의번호로 적음(예전은 expect.doc 일 수 있음 — 표시만 차이).
- 결재문서번호는 podbBulkApprovalNo_ 규칙(SB_PODB_LATER 켜진 길)으로 맞춤 — 꺼진 회사판이면 editOrder_ 의 추가 검사가 없을 수 있음(확인 필요).
- 업체 목록 순서: BOM 은 bom_rows(3행부터) 기준 — 시트에만 있고 사본에 없는 BOM 줄은 빠짐. 설정 목록의 반영 전 추가는 15분 안의 _poPost 일로 셈.
- 품목 DB 사본이 시트보다 늦으면(다른 서버 길 추가 직후) '이미 있음' 판단이 늦을 수 있음 — 시트 쓰기는 appendItems_ 가 다시 걸러 두 줄은 안 생김(사본은 1분 뒤 전체 맞추기로 바로잡힘).
- 실제 Supabase · GAS 로 돌려 보지 않음(로컬만). RB_BUILD · CLAUDE.md · 개인용 반영 안 함(개인용: PoDirect.js 없음 → 세션 pos 없음 → 화면은 예전 길. Keys.js 변경은 typeof 로 안전).
- 통합 주의: rb_pd_busy 는 m083_pg_direct 가 다시 만든 판을 씀(같은 이름 그대로 부름). _poPost 일 글자에 실행판ID 가 들어가 있어 반영 전엔 그 건의 직접 진행상태/진행 기록 저장이 서버 길로 감(차례 지킴 — kick 이 곧 비움).
