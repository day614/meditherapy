# 진행상태 · 품의 취소 — Supabase 직접(안 · f491) — 배포 안 함

## 무엇
- `rb_od_state(p_token, p_args)` · `rb_po_cancel(p_token, p_args)` — p_args 는 예전 api 인자 그대로(`[statusRow, expect, state]` · `[items, why]`).
  규칙 = Keys.js `apiSetState0_` · `poCancel_(withOrdered=null)`. 결과 모양도 같음(+ `direct:1`).
- 발주 DB 사본 = `sheet_rows(tab '_실행판_발주')`. 열 위치 · 머리글 줄 · 켜짐 = `rb_conf 'pdConf'`(서버 `pdConfPublish_` → `rb_pd_conf_put`, 같은 잠금).
  SQL 은 사본 머리글 줄 글자가 pdConf.names 와 다르면 RB_FALLBACK.
- 잠금: `pg_advisory_xact_lock(hashtext('rb_tab_pd'))` = `rb_tab_commit(kind 'pd')`. 서버 가상 저장 끝맺기(`tvVirtualCommit_` pd)를 PostgREST upsert →
  `rb_tab_commit('pd', p_full, p_dels, p_chk=읽은 그대로)`로 바꿈 → 그사이 직접 저장한 줄이면 RB_ROW_TAKEN('그사이 다른 사람이 같은 줄에 저장' → 화면 gsr 이 다시).
- 뒤처리 두 일:
  - `rb_tab_job tab='pdx' {rows:[{id,row,cols}]}` — `pdxDrainIn_` 가 **그 칸의 지금 Supabase 값**을 시트에(가상 저장 대기열 rb.tv.pd.* 먼저). 값이 아니라 칸을 적어 두므로 차례가 뒤바뀌어도 시트 = 사본.
  - `rb_tab_job tab='pj' fn='_pdPost'` — pjDrainIn_ 가 다른 할 일과 차례대로: 이력(누른 사람 · 누른 때) · rb.docq · 진행 기록 상신일/승인일/체크(`poCancelProg_` — poCancel_ 와 같은 함수) · 캐시 · bumpVer r · AP.
  - `rb_ver 'r'` 은 SQL 이 바로 올림(pj 트리거는 'p').
- RB_FALLBACK(아무것도 안 바뀜 → 화면은 **예전 할 일 길 pjDirect**):
  꺼짐(pdConf.on≠1: Supabase 먼저 꺼짐 · rb.pddirty · 사본 없음/다른 판 · 머리글 정보 없음 · rb.pdDirect=0 · 전체 맞추기 중) · 머리글 다름 ·
  **앞선 저장**(pj/od/ln 대기열에 그 건ID 가 든 미처리 일, `_pdPost` 제외 · 진행 장부(j1:)에 그 건 bump/down → rb_conf 'pdJ') ·
  실행판ID 없는 확인값 · 옛 조합 열쇠(…|…) 못 찾음. 품의 취소는 한 건이라도 걸리면 통째로.

## 차례(장부) 위험과 막는 법
1. 진행 장부의 상태 올리기/내리기(apiSetDate bump · down)가 남은 채 직접 진행상태를 바꾸면, 1분 뒤 drainJournal_ 가 그 위에 올리기/내리기(계획↔상신 · 발주→계획)를 덮는다.
   서버 길은 `drainJournalIfState_()` 로 먼저 옮겼지만 SQL 은 스크립트 속성을 못 읽음 → `journalAdd_` 가 bump/down 줄을 **적기 전에** rb_conf 'pdJ' 에 건ID 를 올림(못 올리면 장부에 안 적고 예전 방식) · drainJournal_ 뒤 다시 올림 → SQL 이 그 건이면 RB_FALLBACK → 화면이 할 일 길 → drain 의 apiSetState0_ 가 drainJournalIfState_ 후 적용(예전 그대로).
2. 할 일 대기열(pj apiSetDate/apiBulkStep… · od rb_od_edit · ln 지급 줄 post — syncOrderFromLines_ 가 종결로 바꿀 수 있음)에 같은 건이 남아 있으면 직접 저장이 앞질러 나중에 뒤집힘 → `rb_pd_busy` 가 job 글자에 건ID 가 있으면 RB_FALLBACK(넉넉히 막음 — 다른 건과 섞인 일괄 일도).
3. 사본이 시트보다 늦을 때(rb.pddirty)는 직접 저장 금지: `tvDirty_('pd')` 가 그 자리에서 pdConf off 를 올림. 전체 맞추기(시트 → 사본 덮어쓰기)는 ① pdConf off(같은 잠금이라 진행 중 직접 저장이 끝난 뒤) ② pdx 를 시트에 ③ 시트 읽기 ④ 다시 켬 — 안 그러면 직접 저장 칸이 옛 시트 값으로 덮인다.
4. 남는 틈(받아들임): tvDirty_ 가 표시를 올리기 직전 몇 백 ms 사이의 직접 저장 → pdx 가 전체 맞추기 전에 시트로 옮겨지므로 값은 남지만 그 틈에 서버 옛 길이 같은 칸을 썼다면 순서가 시계 차이로 정해짐.
   첫 화면 목록 캐시(rows:v36:po)는 `_pdPost`/apiPdKick 까지 옛 값(몇 초) — 화면 pdKick 이 끝난 뒤 다시 읽음. 품의 취소의 진행 기록(상신일 지움)은 `_pdPost` 까지 다른 사람 화면에 남음(1분 안).
   rb.docq(자동 상신 대기열)도 `_pdPost` 까지 남지만 autoSubmit_ 은 품의번호가 있는 행만 보므로(사본은 이미 빈칸) 영향 작음.
5. 사람이 시트를 직접 정렬 · 줄 끼움 → pdx 는 실행판ID 로 쓰고 못 찾으면 rb.pddirty.

## 서버(GAS) 바꿀 곳 — server_patch.diff
- 새 PdDirect.js: pdConfBuild_/pdConfPublish_ · pdJournalPublish_ · pdxDrainIn_ · poCancelProg_ · poCancelDocq_ · pdDirectPost_(_pdPost) · apiPdKick.
- TabShim.js: tvDirty_('pd') → pdConfPublish_(true) · tvVirtualLoad_ 가 raw(읽은 그대로) · tvVirtualCommit_ pd → rb_tab_commit + p_chk(RB_ROW_TAKEN 이면 맞추기 대기열 지우고 멈춤) · tvSbFullSync_ pd: 끄기 → pdx → 읽기 → 켜기 · rb.pdHead 에 st(진행상태 열).
- Journal.js: journalAdd_ bump/down 전 pdJ · drainJournal_ 뒤 pdJ · journalDrainRun_ 에 pdConfPublish_/pdJournalPublish_/pdxDrainIn_.
- IssueDb.js: pjDrainIn_ fnMap `_pdPost: pdDirectPost_`.
- Keys.js: poCancel_ 의 대기열 · 진행 기록 부분을 PdDirect.js 도우미로(같은 규칙 한 곳).
- Notes.js: 세션에 `pds`(SQL m081 + rb.pdDirectTest ok). **자체 시험(pdDirectSelfTest_)은 아직 없음** — 만들거나 rb.pdDirectTest 를 손으로 'ok'.
- Supabase.js: m081_pd_direct(SQL 파일 그대로) · m082_once_pd(rb_once ok[] 에 rb_od_state · rb_po_cancel).
- rb.pdHead 에 st 가 생기려면 pd 전체 맞추기가 한 번 돌아야 함(그전엔 pdConf off '머리글 정보 없음').

## 화면 — client_patch.js
RB_ONCE_FN 에 `od_(edit|state)` · `po_cancel` · RB_DIRECT apiSetState/apiPoCancel → `pdDirect`(noteRpc rb_od_state/rb_po_cancel · RB_FALLBACK 은 pjDirect) · `pdKick`(apiPdKick, busy 로 다시 읽기 잠깐 막고 끝나면 revalidate).

## 시험(로컬 Postgres 16 · DB ds / ds2 = 모든 이주 + m081 + m082 새로)
- `node harness.js ../cn PdDirect.js` — 실제 Keys.js apiSetState0_ · poCancel_ 를 가짜 시트로 돌린 결과 ↔ SQL: 결과 · 오류 글 · 모든 칸 · 이력 줄(id/doc/code/이름/항목/전후/위치) · rb.docq 결과 · 진행 기록 건 목록 · 시트 맞추기 칸 = 바뀐 칸 · 변경 번호. **56/56** (results_table.md).
- `./lock_test.sh` — 직접 저장 뒤 옛 줄로 rb_tab_commit pd → RB_ROW_TAKEN · 잠금 3초 쥔 동안 rb_od_state 2.5초 기다림.
- `node pdx_test.js ../cn patched` — SQL 직접 저장 3건 + 같은 칸 옛 값 가상 저장 대기열 + 행 번호 틀린 일 → pdxDrainIn_(실제 tvRepApply_ · sampleRepApply_) 뒤 가짜 시트 = 사본(0칸 차이) · 글자 '02035' '10/15' 그대로.
| # | 사례 | 기대 | 결과 | 비고 |
|---|---|---|---|---|
| 1 | 상태 계획→상신 | same | OK | 결과 {"ok":true,"state":"상신","before":"계획"} |
| 2 | 상태 상신→승인 | same | OK | 결과 {"ok":true,"state":"승인","before":"상신"} |
| 3 | 상태 승인→발주 | same | OK | 결과 {"ok":true,"state":"발주","before":"승인"} |
| 4 | 상태 발주→취소 | same | OK | 결과 {"ok":true,"state":"취소","before":"발주"} |
| 5 | 상태 발주→종결 | same | OK | 결과 {"ok":true,"state":"종결","before":"발주"} |
| 6 | 상태 종결→계획(풀기) | same | OK | 결과 {"ok":true,"state":"계획","before":"종결"} |
| 7 | 상태 취소→발주(취소 풀기) | same | OK | 결과 {"ok":true,"state":"발주","before":"취소"} |
| 8 | 상태 빈칸→계획 | same | OK | 결과 {"ok":true,"state":"계획","before":""} |
| 9 | 같은 상태(바뀜 없음) | same | OK | 결과 {"ok":true,"state":"계획","before":"계획"} |
| 10 | 상태 앞뒤 공백 " 승인 " | same | OK | 결과 {"ok":true,"state":"승인","before":"상신"} |
| 11 | 모르는 상태 "보류" | same | OK | 오류 같음: 알 수 없는 진행상태입니다: 보류 |
| 12 | 빈 상태 | same | OK | 오류 같음: 알 수 없는 진행상태입니다:  |
| 13 | 행 번호 1 | same | OK | 오류 같음: 발주 DB에 없는 건입니다. |
| 14 | 행 번호 0 | same | OK | 오류 같음: 발주 DB에 없는 건입니다. |
| 15 | 행 번호 글자 "3" | same | OK | 결과 {"ok":true,"state":"승인","before":"상신"} |
| 16 | 행 번호 null | same | OK | 오류 같음: 발주 DB에 없는 건입니다. |
| 17 | 행이 밀림(기억 4 · 실제 2) | same | OK | 결과 {"ok":true,"state":"상신","before":"계획"} |
| 18 | 행 번호가 끝 넘음(99) | same | OK | 결과 {"ok":true,"state":"승인","before":"상신"} |
| 19 | 없는 실행판ID | same | OK | 오류 같음: 발주 DB에서 이 건(실행판ID RB261101-NOPE99)을 찾지 못했습니다. 줄이 지 |
| 20 | 겹친 ID · 기억한 행이 맞음 | same | OK | 결과 {"ok":true,"state":"승인","before":"상신"} |
| 21 | 겹친 ID · 기억한 행이 다름 | same | OK | 오류 같음: 발주 DB에 실행판ID RB261101-DUP009 가 2행 있습니다. 관리자에게 알려주세 |
| 22 | ID 앞뒤 공백 행 | same | OK | 결과 {"ok":true,"state":"승인","before":"상신"} |
| 23 | 옛 조합 열쇠 ID(…|…) 있음 | same | OK | 결과 {"ok":true,"state":"발주","before":"승인"} |
| 24 | 옛 조합 열쇠 ID 못 찾음 | fallback | OK | SQL→서버 길: RB_FALLBACK 예전 열쇠(품의번호 · 코드 · 차수) |
| 25 | ID 없는 확인값 | fallback | OK | SQL→서버 길: RB_FALLBACK ID 없는 건(예전 열쇠) |
| 26 | 앞선 할 일(pj · 같은 건) | fallback | OK | SQL→서버 길: RB_FALLBACK 앞선 저장 반영 전(pj #31 apiSetDate) |
| 27 | 앞선 할 일(od · 같은 건) | fallback | OK | SQL→서버 길: RB_FALLBACK 앞선 저장 반영 전(od #32 ) |
| 28 | 앞선 할 일(다른 건) — 그대로 | same | OK | 결과 {"ok":true,"state":"상신","before":"계획"} |
| 29 | 앞선 직접 뒷정리(_pdPost)는 막지 않음 | same | OK | 결과 {"ok":true,"state":"상신","before":"계획"} |
| 30 | 진행 장부 상태 올리기 남음(pdJ) | fallback | OK | SQL→서버 길: RB_FALLBACK 앞선 저장 반영 전(진행 장부 상태 올리기) |
| 31 | 직접 저장 꺼짐(pdConf on=0) | fallback | OK | SQL→서버 길: RB_FALLBACK 발주 DB 직접 저장 꺼짐(시트가 Supabase 보다 앞섬) |
| 32 | 머리글이 다름 | fallback | OK | SQL→서버 길: RB_FALLBACK 발주 DB 머리글이 다름(13 열) |
| 33 | 보기 전용 세션 | sqlerr:RB_SESSION | OK | RB_SESSION 저장 권한 확인 |
| 34 | rb_once 같은 요청 두 번 | once | OK | 결과 {"ok":true,"state":"상신","before":"계획"} |
| 35 | 품의 취소 상신(품의번호) | same | OK | 결과 {"n":1,"skipped":[],"skippedIds":[]} |
| 36 | 품의 취소 승인(품의번호 · 결재번호) | same | OK | 결과 {"n":1,"skipped":[],"skippedIds":[]} |
| 37 | 품의 취소 계획(품의번호만) | same | OK | 결과 {"n":1,"skipped":[],"skippedIds":[]} |
| 38 | 품의 취소 빈 상태 | same | OK | 결과 {"n":1,"skipped":[],"skippedIds":[]} |
| 39 | 품의 취소 계획 · 품의번호 없음 | same | OK | 결과 {"n":1,"skipped":[],"skippedIds":[]} |
| 40 | 품의 취소 발주 건 → 건너뜀 | same | OK | 결과 {"n":0,"skipped":["크림 D — 진행상태 발주(계획 · 상신 · 승인만 취소)"],"skippedIds":["R |
| 41 | 품의 취소 종결 · 취소 → 건너뜀 | same | OK | 결과 {"n":0,"skipped":["앰플 E — 진행상태 종결(계획 · 상신 · 승인만 취소)","패드 F — 진행상태 취소(계 |
| 42 | 품의 취소 여러 건(섞임) | same | OK | 결과 {"n":3,"skipped":["크림 D — 진행상태 발주(계획 · 상신 · 승인만 취소)","앰플 E — 진행상태 종결(계 |
| 43 | 품의 취소 없는 ID → 건너뜀 | same | OK | 결과 {"n":1,"skipped":["없는 건 — 행을 찾지 못함"],"skippedIds":["RB261101-NOPE99"]} |
| 44 | 품의 취소 겹친 ID → 건너뜀 | same | OK | 결과 {"n":1,"skipped":["겹침 I — 행을 찾지 못함"],"skippedIds":["RB261101-DUP009"]} |
| 45 | 품의 취소 행이 밀림 | same | OK | 결과 {"n":1,"skipped":[],"skippedIds":[]} |
| 46 | 품의 취소 같은 건 두 번 | same | OK | 결과 {"n":2,"skipped":[],"skippedIds":[]} |
| 47 | 품의 취소 사유 빈칸 | same | OK | 오류 같음: 취소 사유를 적어 주세요. |
| 48 | 품의 취소 행 번호 1 뿐 | same | OK | 결과 {"n":0} |
| 49 | 품의 취소 빈 목록 | same | OK | 결과 {"n":0} |
| 50 | 품의 취소 statusRow 글자 "4" | same | OK | 결과 {"n":1,"skipped":[],"skippedIds":[]} |
| 51 | 품의 취소 공백 상태 " 상신 "(행 14) | same | OK | 결과 {"n":1,"skipped":[],"skippedIds":[]} |
| 52 | 품의 취소 x.id 만(expect.id 없음) | fallback | OK | SQL→서버 길: RB_FALLBACK ID 없는 건(예전 열쇠) |
| 53 | 품의 취소 옛 조합 열쇠 ID(있음) | same | OK | 결과 {"n":1,"skipped":[],"skippedIds":[]} |
| 54 | 품의 취소 앞선 할 일(한 건이라도) | fallback | OK | SQL→서버 길: RB_FALLBACK 앞선 저장 반영 전(ln #68 ) |
| 55 | 품의 취소 꺼짐 | fallback | OK | SQL→서버 길: RB_FALLBACK 발주 DB 직접 저장 꺼짐() |
| 56 | 품의 취소 rb_once 두 번 | once | OK | 결과 {"n":2,"skipped":[],"skippedIds":[]} |
