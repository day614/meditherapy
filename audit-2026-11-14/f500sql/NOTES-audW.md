# audW — 저장 쪽 기능 대조(이관 전 서버 길 ↔ 지금 직접 저장 길) · f497 후보

**쉬운 한 줄 요약:** 1분 작업 대기열로 넘긴 저장 중 몇 개가 "N건 건너뜀 · 실패" 알림을 잃었거나(못 한 건도 된 것처럼 보임), 틀린 입력을 그 자리에서 막지 않고 1분 뒤 조용히 실패했다. 화면이 서버와 같은 규칙으로 바로 세고 막게 고쳤다.

바꾼 파일: `work/PageHtml.html`, `work/IssueDb.js`(서버 · 회사판 전용) · `patch.diff`(277줄). SQL 없음(m135~m139 안 씀).
검사: `node --check` 모든 .js 와 ext.js 로 뽑은 화면 스크립트 통과 · 함수 이름 중복 0.

## 고친 것(심각한 것부터)
| # | 함수 | 이관 전(서버) | 지금(cn494 직접/할 일) | 차이 | 고침 |
|---|---|---|---|---|---|
| 1 | apiPoRedraft(기안 원복 · BOM 따라 원복) | 입고 · 종결 · 취소 건은 skipped, n=실제 건수 | 항상 n=건수, skipped=[] | 못 한 건도 화면에 "원복했습니다"(품의번호 지움 · 계획) → 1분 뒤 알림 | 화면이 같은 규칙(계획 · 상신 · 승인 · 발주만)·같은 문구로 셈, 할 일엔 할 건만 넣음 |
| 2 | apiPoCancel의 할 일 대체 길(pdDirect viaPj — RB_FALLBACK · 세션 pds 꺼짐) | n · skipped · skippedIds | `{skipped:[]}`, **n 없음** | 토스트 "undefined건 품의를 취소" · 발주/입고 건도 화면에서 취소로 보임 · 사유 빈칸이 1분 뒤 실패 | 같은 규칙(계획 · 상신 · 승인)으로 셈 · 사유 검사 그 자리에서 |
| 3 | apiPoSubmit(상신 완료) | 취소 · 종결 건과 이미 다른 품의번호가 있는 건은 skipped → 화면 되돌림 + 상신 대기에 남김 | skipped [] · n -1 | 그런 건이 화면에 '상신'으로 남고 상신 대기에서도 빠짐 | 호출부가 바꾸기 전 값을 `PO_SUBMIT_WAS[no]`에 남김 → 같은 규칙으로 skipped/skippedIds 계산, 그 건은 상신 대기에 남김(서버와 같음) · 토스트 건수 |
| 4 | apiBulkDoc(일괄 품의번호) | 취소 · 종결 건 skipped · 결재문서번호 형식(메디테라피)·빈칸은 바로 오류 | skipped [] · 검사 없음 | "시트에 못 넣은 건" 경고가 사라짐 · 잘못된 번호가 1분 뒤 실패 | 같은 검사 · 같은 문구 · 못 넣은 건은 화면도 바로 되돌림 |
| 5 | apiBulkApprovalNo(일괄 승인의 결재문서번호) | 종결 · 취소 건은 fails | fails [] | "실패 N건"이 안 뜸 | 같은 문구로 fails 계산 |
| 6 | apiBulkStep(단계 일괄 완료 · 건너뛰기) | miss(날짜 없어 체크 안 함) · kept · n | miss [] · kept 없음 · n=건수 | 'N개 체크 안 함' 경고 · 'N건 건너뛰지 않음' 안내가 사라짐(서버 알림 목록에도 miss 없어 영영 안 뜸) | 화면 ckNeedMiss · stepHasCheck 로 같은 문구 계산 · 건너뛸 수 없는 단계 오류 |
| 7 | apiCreateOrder(발주 등록) | pay.missed(지급월에 못 넣은 금액) 알림 · 실패하면 행 빼고 새 발주 표에 다시 채움(ngRefill) | pay 없음 · 1분 뒤 실패하면 '저장 중' 줄이 15분 남다 사라지고 **입력 잃음** | 알림 빠짐 · 실패 때 입력 잃음 | payYm_ 이식(rbPayYm)으로 pay.missed · 서버 pjNotePut_ 가 새 발주 id 를 남기게 → pjKick 이 jobErr 받으면 줄 빼고 ngRefill |
| 8 | apiDailySaveRep(일일보고 저장) | 지난 날짜 바로 오류 | 대기열 → 1분 뒤 실패(화면은 '저장됨') | 저장 실패를 저장됨으로 봄 | 지난 날짜는 그 자리에서 같은 문구 · 앞날은 서버 길 |
| 9 | apiBulkOrderDate(일괄 발주일) | col = 열 글자 | col "발주일" → "발주일열에 적었습니다" | 문구 | 직접이면 "발주 DB [발주일] 칸에"(수식 칸 건너뜀은 화면이 모름 → 1분 뒤 알림 그대로) · 날짜 검사 |
| 10 | pjKick 알림 | — | 화면이 이미 알린 건너뜀이 1분 뒤 또 뜰 수 있음 · 이름 없는 [apiBulkStep] | 중복 · 문구 | RB_NOTE_SEEN(10분)으로 이미 알린 문구 뺌 · miss · payMissed 보임 · 이름표 추가 |

서버 IssueDb.js `pjNotePut_`: `miss`, `payMissed`(rv.pay.missed) 담기 · 인자가 객체면 `o.id = args[0].id`(새 발주). **주의: 처음 고칠 때 한 줄 끝 `o.at = …`가 주석 안으로 들어갔던 것을 잡아 고쳤다(시험으로 확인).**

## 그대로(차이 없음 또는 받아들일 만함) — 함수마다 한 줄
- SQL 직접(진짜 결과): apiBomSave · FixOnly · SemiBomLink · SemiBomFromProduct · Undo · SaveNewVersion · FixMany · Reorder · CostSetMany · CodeSet · CommonSet · PriceSpread · HfSet(bomhf) · ReviewCloseAll · apiEditOrder · apiSaveLines · apiAddInbound(Many) · apiSetChecks/SetCheck/SetNote/SetChange/SetDate(pgDirect) · apiSetState · apiPoCancel(rb_po_cancel) · apiSampleBulkSet/Add/New/EditRow · 메모장 · issRun · qualRun · linkRun · closeDbRun · itemRun — 응답 모양 대조만 함. 차이: BOM 응답 `dropped: []`(품목 DB 고아 정리를 1분 작업이 해 "품목 DB 에서도 지움" 문구 없음 — f364 이미 알려짐).
- 할 일 길인데 화면 결과가 서버와 같음: apiBulkItems(계획 단계에서 서버 건너뜀 규칙을 다 막아 skipped [] 가 맞음) · apiBulkItemsUndo · apiBulkHide · apiBulkDate(n) · apiBulkOwner(sheet 없음 → 호출부가 null 로 처리) · apiSetCode(CODE_TAKEN 화면 검사) · apiItemRegister(exists) · apiVendorAdd · apiSampleProjMemo/ProjInfo/Project/ProjEdit/DeleteRow · apiDailyHide · apiDailyIssues · apiCloseExpSet · apiOldAck · apiNegoQtySet · apiPoPendDrop · apiPoPendAdd · apiWaitReply · apiCloseRemain · apiSetChoices · apiSetSampleChoices · apiItemDelete · apiSaveSteps · apiSaveLinks · apiSaveNotice · apiWriteSheet(발주일) · apiSampleRemap · ViewsRebuild · apiNegoPick · apiBomSetCompOff · apiBomAddType · apiSemiPin · apiBomReviewRegAll/Fix · apiSetCur · apiSetFlag(표시 시각 '방금'은 다시 읽기 때) · apiSampleLog · apiSampleDone · apiSampleWaitDone · apiDailyUnlock(서버 길).
- RB_FALLBACK · 세션 없음 · 연결 끊김: pjDirect/pgDirect/pdDirect 모두 서버 길 또는 할 일 길(아무것도 안 들어간 경우만), noteRpc 의 rb_once 로 두 번 저장 없음 — 새 코드도 같은 pjDirect 를 거친다.

## 남은 위험(고치지 못함 — 화면이 모르는 서버 상태)
- 동시 수정 검사(그사이 다른 사람이 바꿈: apiSampleStatus · apiSampleLog · apiWaitReply · apiSampleWaitDone 등) · 수식 칸(apiBulkOrderDate) · 행을 못 찾음 — 여전히 1분 뒤 알림 + 다시 읽기로 되돌림(f448/f485 틀).
- apiSampleDeleteRow 직접 응답 뒤 화면이 시트 줄 번호를 미리 당김 — 1분 작업 전에 같은 샘플을 줄 번호로 고치면 어긋날 수 있음(대부분 샘플ID 로 막힘).
- 1분 작업 실패는 다음 '지금 맞추기'(최대 75초 뒤) 알림 + 다시 읽기로만 되돌린다 — 저장 직후 화면은 '저장됨'. 근본 해결은 SQL 직접 함수(다른 작업자).

## 시험
- `test/rbd.js`(Playwright 목업 · google.script.run 가짜 · 페이지 안에서 noteSess/noteRpc 바꿔 끼움): 13가지 호출 + pjKick. 결과 `test/out_work.txt`, 고치기 전 판 비교 `test/out_cn494.txt`:
  - bulkDoc 전 n3 skipped0 → 후 n1 skipped2(할 일엔 1건만) · 형식 오류/모두 건너뜀(할 일 안 넣음) · apNo fails 0→2 · redraft skipped 0→1 · cancel n 없음 → n1 skipped2 · 사유 빈칸 오류 · step miss 0→2 · skip kept 0→1 · create pay.missed · 지난 날짜 오류 · submit n -1 → 1, skipped 2, 상신 대기에 2건 남김 · pjKick: 새 발주 jobErr → 줄 빠짐 + 새 발주 표에 다시 채움(전: 줄 남음 · 입력 없음) · 이미 알린 문구는 다시 안 뜸 · 페이지 오류 0.
- `test/note.js`: 실제 IssueDb.js pjNotePut_ — miss · payMissed · 새 발주 id · at 들어감.

## SQL 전환 작업자에게 넘길 규칙 메모
- 할 일 길을 SQL 로 옮길 때 응답에 서버와 같은 칸을 줄 것: apiPoRedraft = rb_po_cancel 에 withOrdered(인자 a->2 또는 별 함수)로 '발주'도 허용 · 문구 "<이름> — 진행상태 X(계획 · 상신 · 승인만 취소)". apiBulkDoc = 취소 · 종결 → "<이름> — X된 건", 덮어쓰기 아님+다른 번호 → "<이름> — 이미 품의번호 Y", 형식(메디테라피 포함) 오류. apiBulkApprovalNo fails "<이름>: X된 건은 고칠 수 없습니다 — 먼저 [종결 풀기]/[취소 풀기]를 해 주세요." + failIds. apiBulkStep miss "<이름> · <항목> — <상신일|승인일|발주일|요청일|품의번호> 없음", kept, n(건너뛰지 않은 건 뺌). apiPoSubmit skipped(apiBulkDoc 규칙) + 못 넣은 건만 상신 대기에 남김(pend). apiCreateOrder pay.missed · warn.
- 새 화면 상태: `PO_SUBMIT_WAS`, `CREATE_DIRECT`, `RB_NOTE_SEEN`, 함수 `rbStateSplit` · `rbNoteSeen` · `rbNoteUnseen` · `rbPayYm`(새 함수 이름 — 합칠 때 겹침 확인). rb_once · rb_pj_do · RB_ONCE_FN 은 건드리지 않음.
