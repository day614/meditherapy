# g1 — 발주 수정 · 일괄 저장을 "그 자리에서 Supabase 에 바로 + 진짜 결과"로 (f497 안 · 배포 안 함)

**기준 코드 = `$S/cn497`(cn494 + 저장 대조 고침 audW). `work/` · `patch.diff` 는 cn497 기준.** 1차(7개)는 cn497 위에 3-way 로 다시 얹음(화면 충돌 2곳: apiBulkDate/apiBulkStep · 알림 이름표 — cn497 쪽 고친 코드를 예전 길(`_bulkStepQ` 등)으로 두고 그 앞에 직접 길).

**사용자에게 한 줄:** 발주 수정 · 통화 · 표시 단추 · 여러 건 숨기기/담당자/상신일·승인일/단계 처리는 이제 대기열에 넣지 않고 누른 그 자리에서 저장되며, 화면은 실제 결과(건너뛴 건 · 빠진 날짜 등)를 바로 받습니다.

## 옮긴 것(15개)과 못 옮긴 것(1개)
| api | 새 길 | 예전 길(RB_FALLBACK 때) |
|---|---|---|
| apiEditOrder | `rb_od_save(p_token, p_args)` | rb_od_edit 할 일(`RB_DIRECT._odQueue` = 예전 코드 그대로) |
| apiSetCur · apiSetFlag · apiBulkHide · apiBulkOwner · apiBulkDate · apiBulkStep | `rb_pg_more(p_token, p_fn, p_args)` | pjDirect(rb_pj_add) |

| apiBulkDoc · apiBulkApprovalNo · apiBulkOrderDate · apiSetCode(force) | `rb_od_bulk(p_token, p_fn, p_args)` (m086) | cn497 화면 코드 그대로(`_BulkDocQ` · `_BulkApprovalNoQ` · `_BulkOrderDateQ` · apiSetCode 의 pjDirect) |
| apiOldAck · apiNegoQtySet · apiNegoPick · apiCloseExpSet | `rb_kv_set(p_token, p_fn, p_args)` (m087) — 원본 rb_conf | `_OldAckQ` 등(할 일 길) |

**남은 것: apiCloseRemain(잔량 마감)** — 지급 줄 사본(예정 줄 지우기 replaceLinesFor_) + syncOrderFromLines_(입고수량 · 잔량 · 입고일정 · 자동 종결) + 종결 칸을 한 트랜잭션에 옮겨야 해서 이번에 못 함. 지금처럼 할 일 길(화면은 cn497 의 같은 규칙으로 결과를 먼저 만듦 · 차례는 rb_pd_busy 가 지킴). 다음: rb_ln_do(m014/m016)로 예정 줄 지우기 + PD 종결/진행상태 칸 직접 + 뒷정리에 lnPostApply_ 같은 syncOrderFromLines_ — m088~m094 남음.

### 2차 규칙(m086 · m087)
- **apiBulkDoc = apiBulkDoc0_ + markSubmitted_**: 품의번호 빈칸/결재문서번호(메디테라피) 문구 · statusRow≥2 만 · 행 못 찾음 '이름 — 행을 찾지 못함, 새로고침 필요'(skippedIds) · 같은 행 두 번은 처음 것 · 취소/종결 '— X된 건' · 덮어쓰기 아니고 다른 번호 '— 이미 품의번호 Y' · 계획→상신(states) · 진행 기록 상신일(없을 때 day — 'yyyy-MM-dd' 아니면 오늘)·상신 항목 체크·__docAuto(바뀐 게 없으면 안 씀) → checked. 응답 {n, states, skipped, skippedIds, checked}. 뒷정리: rb.docq(그 건 ID) · 이력(품의번호(일괄) · 진행상태) · 단계 이력.
- **apiBulkApprovalNo = 건마다 editOrder_**: SQL 도 건마다 rb_od_save_do 를 부분 트랜잭션으로 — 오류는 그 건만 fails('이름(없으면 statusRow): 문구') · failIds, RB_FALLBACK/세션은 통째로. 응답 {n, fails, failIds}(audW 화면 문구와 같음).
- **apiBulkOrderDate = apiBulkOrderDate0_**: '발주일을 넣어주세요.' · stamp yy/MM/dd · 발주일 칸 = 서울 자정 날짜(넘치는 날 · 13월도 JS Date 처럼) · 앞으로만 '발주'(진행상태(자동)) · 발주일 이력엔 item 없음(예전 그대로) · 진행 기록 발주일 항목 체크 → checked · 발주일 지킴 목록(rb.ordguard)은 뒷정리. 응답 {n, stamp, skipped('N행 (이름) — 행이 바뀜, 새로고침 필요'), col(열 글자 — odConf.ordLetter), checked}. 수식 칸 건너뜀은 사본이 수식을 몰라 예전 가상 저장 길과 같이 없음.
- **apiSetCode(force)**: 바코드 · 빈 코드 · 글자 검사(같은 문구) → 행(기억 행 먼저) · 종결/취소 막기 → 코드 칸 · 이력 · 뒷정리에서 품목 DB 등록(appendItems_ · productCodeRegister_ · setItemBarcode_ — 같은 인자). force 아님(CODE_TAKEN 검사)은 RB_FALLBACK — 화면은 예전처럼 품목 목록으로 먼저 검사하고 force 로 부름.
- **설정 값(rb_conf 원본)**: rb_conf 'kv:oldack' · 'kv:negoqty' · 'kv:negopick' · 'kv:closeexp' = {o, ks(열쇠 차례)}. 1분 작업 `kvSeed_`가 한 번 지금 값(속성 · 마감상신 탭)을 올림(rb_kv_seed — 있으면 그대로 · 쓰는 쪽과 같은 잠금) → rb.kvSeed. 올리기 전엔 SQL 이 RB_FALLBACK.
  읽기 `oldAckRead_` · `negoQtyRead_` · `negoPickRead_` · `closeExpMap_`(→ apiOldAcks · apiNegoData · apiCloseList — 캐시 맞아도 exp 는 늘 새로)는 rb_conf 먼저(못 읽으면 예전 원본). 서버 길 apiOldAck/apiNegoQtySet/apiNegoPick/apiCloseExpSet 도 올린 뒤엔 `kvSrv_` → `rb_kv_srv`(같은 SQL — 저장 길 하나).
  뒷정리 `kvPost_`: 속성 · 마감상신 탭을 rb_conf 지금 값으로 · 이력(설정 탭 칸 변경 · '마감'). 규칙: 옛 코드 400건 · 속성 한 칸 8500자(오래된 것부터) · 네고 수량 숫자(음수 · 글자 오류 · 지수 표기 RB_FALLBACK) · 빈칸 = 지움 · 집계 1/0 · 상신 체크 {on Y/'', by, at 서울 분}.
- 새 SQL 이름(2차): 공개 **`rb_od_bulk`**, **`rb_kv_set`**(rb_once 허용 목록 · 화면 RB_ONCE_FN `od_bulk` · `kv_set` 에 더할 것) · 안쪽 rb_od_bulk_do · rb_kv_do · rb_kv_jslen · 서버만 rb_kv_srv · rb_kv_seed.

## 새 SQL — `m085_od_direct.sql`(Supabase.js 에 `SB_MIGRATIONS.push({ id: 'm085_od_direct' … })` · JSON.stringify · U+2028/2029/FEFF 0개 확인)
- 공개: **`rb_od_save`**, **`rb_pg_more`**(+ 2차 `rb_od_bulk` · `rb_kv_set`) ← **rb_once 허용 목록(SQL ok[]) · 화면 `RB_ONCE_FN` 에 `od_save` · `pg_more` · `od_bulk` · `kv_set` 을 통합 때 넣어 주세요**(지금 work 의 RB_ONCE_FN 은 안 고침 → 넣기 전엔 요청 번호 없이 직접 부름).
- 안쪽(공개 키 막음): rb_od_save_do · rb_pg_more_do · rb_odx_{s, astral, jsnum, num, cell, put, cs, todate, diso, tok, amt, amt_fix, loc, ready, col, pg_ready, pg_get, pg_put, rownum, mode} · 서버만 `rb_odx_conf_put`(세 잠금 pg · sp · pd).
- 공유 함수(rb_once · rb_pj_do · rb_pd_busy · rb_pg_busy)는 다시 만들지 않음. m081/m083 도우미(rb_pd_ready/find/busy/ver · rb_pg_apply/stamp/ckset/req/ikey/json/busy) 재사용.
- 설정 `rb_conf 'odConf'`(서버 odConfPublish_): 켜짐(SQL m085 · rb.odDirect≠0 · pdConf 켜짐) · 발주 DB 열 위치 전부(statusFieldCols_ + 결재문서번호) · 머리글 검사 이름 · 발주금액 계산 여부 · 모드마다 단계 정의(제목 · 건너뛰기 · 표시 단추 f · 항목 t) · byKey · reqKey · 지문 sh(= pgConf 의 sh — 다르면 RB_FALLBACK '단계 정의가 바뀌는 중'). 목록은 기존 odLists · brandAlias.
- 잠금: 진행 기록(rb_tab_pg|sp) → 발주 DB(rb_tab_pd) 차례(m083 과 같음). 발주 수정에 owner 가 있으면 pg 먼저. 서버 가상 저장 끝맺기는 이미 rb_tab_commit + p_chk 라 직접 저장 뒤 옛 줄로 덮으면 RB_ROW_TAKEN(lock_test ②).

### 규칙(서버 그대로 옮긴 것)
- **apiEditOrder = editOrder_**: 날짜 · 숫자 · 사유 검사(같은 문구) → 행 찾기(checkStatusRow_: 기억한 행 먼저 · 겹친 ID · 없는 ID 문구) → 종결/취소 막기 → 필수 칸 비우기 → 목록(바뀐 값만 · 메디테라피→메디 · 브랜드별 채널 문구까지) → 입고보다 적게 줄이기 → put 13칸(code 대문자 · 메모/코드/결재번호는 시트에 ' 붙임 · 입고목표 sheetDateTok_(발주일로 연도 짐작 — ISO/글자/일련번호 toDate_) · 소진목표일 toDate_(넘치는 날 · 13월=빈칸) · 수량/단가 num_) → 잔량 → 부가 칸(요청팀 · 요청자 · 소진 · 링크) → **발주금액 다시 계산(가상 저장처럼 고친 행마다 · JS 부동소수 곱)** → owner 면 진행 기록 담당자(메타 = 확인값 · 없으면 새 줄). 결과 `{ok, row, n}`(n = 이력 줄 수 — 같은 값도 셈, 예전 그대로).
- 이력 · 수량단가 이력 · 지급 줄 따라 고치기(linesFollowPrice_/Qty_ — 같은 조건 · 같은 인자)는 뒷정리. 지급 줄 실패/고칠 예정 줄 없음은 `linesError` · `linesQtyNeed` 로 그 사람 알림 → 화면 pjKick 이 예전 문구로 alert.
- **apiSetCur**(통화 _cur + 발주 DB 통화 칸 — 종결/취소/못 찾음은 조용히 건너뜀, 이력 없음) · **apiSetFlag**(fl:항목:단추 = 켠 시각 · 상태가 바뀔 때만 이력 '[단추] 표시 — n. 단계 › 항목') · **apiBulkHide** · **apiBulkOwner**(진행 기록 + 발주 DB 구매담당자 — 같은 값 건너뜀 · 같은 행 두 번이면 나중 값 · 종결 건도 씀 · sheet 수) · **apiBulkDate**(rb_pg_apply 날짜 + 모드가 정확히 'po' 일 때만 상태 앞으로 올리기 '진행상태(자동)') · **apiBulkStep**(건너뛰기 · 완료 — 날짜 빠짐 miss 문구 · 품의번호 · 발주일 ord · 요청일 · 생략 sk: · 체크 시각 ct:/cw: · kept). bulkEditProgress_ 처럼 같은 건은 같은 상태에 이어서 · 새 건은 맨 아래 차례대로.

### 뒤처리 일
- `pdx`(칸 → 시트, PdDirect) · `pgx`(줄 → 시트, PgDirect).
- `pj '_pgPost' {x}` → pgDirectPost_ 첫 줄에서 `odDirectPost_`(OdDirect.js)로: 발주 수정은 이력(RB_ROWKEY = 확인값 — writeAudits_ 와 같은 id/doc/code), 진행 기록 묶음은 **실제 api(apiBulkStep 등)를 before 상태에 다시 돌려**(bulkEditProgress_ · editProgress_ · journalSave_ · 발주 DB 쓰기 함수는 잠깐 바꿔 끼움 — 시트 안 씀) 단계 이력(logSteps_) · 표시 이력을 쓰고 SQL 결과와 대조. 다르면 rb.odDiff + (같은 단계 정의면) rb.odDirect=0 → 직접 저장 저절로 꺼짐. `_pgPost` 라 rb_pd_busy/rb_pg_busy 가 막지 않음(이력만).
- 수량 · 단가로 지급 줄이 따라가야 하면 `pj '_odLines'`(IssueDb fnMap 추가) — 이름이 _pdPost/_pgPost 가 아니라 **이 일이 남은 동안 그 건의 다음 직접 저장은 RB_FALLBACK**(차례 지킴). 서버 길 apiEditOrder 도 pjDrainIn_ 을 먼저 부름(Keys.js).

### RB_FALLBACK(아무것도 안 바뀜)
꺼짐(odConf · pdConf · pgConf) · gate · 머리글 다름 · 단계 정의 지문 다름 · 앞선 저장(pj/od/ln 의 그 건 · 진행 장부 pgJ · _odLines) · 옛 열쇠/ID 없는 확인값 · 결재문서번호 열 없음(처음 만드는 저장) · 부가정보 옛 탭 · 4바이트 글자 · 지수/16진 숫자(1e3) · 객체/배열 값 · 이상한 모드 · 샘플 옛 건ID(p:코드) · 깨진 진행 JSON · 400건 넘는 일괄.

## 서버 바꾼 곳(patch.diff)
- 새 **OdDirect.js**(회사 전용): odStepsConf_/odConfBuild_/odConfPublish_ · odDirectPost_(odEditPost_ · odProgPost_ · odBulkPost_ · odSetCodePost_ · kvPost_) · kv*(kvSeed_ · kvRead_ · kvSrv_) · odDirectSelfTest_(가짜 토큰 → rb_once → rb_od_save · rb_pg_more 가 RB_SESSION → rb.odDirectTest=ok).
- PgDirect.js: pgDirectPost_ 첫 줄 넘김 · pgConfPublish_ 뒤 odConfPublish_(단계 저장 때 지문 같이). Journal.js: 1분 작업에 odConfPublish_ · odDirectSelfTest_(typeof). IssueDb.js: fnMap `_odLines`. Keys.js: apiEditOrder 앞 pjDrainIn_. Notes.js: 세션 `ods`. Supabase.js: m085 · m086 · m087. 2차: BomExtra.js(oldAckRead_ · apiOldAck) · Nego.js(negoQtyRead_ · negoPickRead_ · apiNegoQtySet · apiNegoPick) · Closing.js(closeExpMap_ · apiCloseExpSet · apiCloseList 캐시) — 모두 typeof 로 kvRead_/kvSrv_ · Journal.js 1분 작업 kvSeed_.
- 개인용: OdDirect.js 없음 · 공용 파일은 typeof 로만 부름 · 화면은 ss.ods 가 없어 예전 길.
- 켜기: m085 이주 + rb_once 목록 → 1분 작업 자체 시험 ok → 세션 ods. 끄기: rb.odDirect=0(1분 안에 odConf off).

## 화면(PageHtml.html)
- `odDirect(rpc, fn, body, ok, fail, gas, old)` · `pgMore(fn, …)`: 세션 ods → noteRpc → 진짜 결과로 ok · pjKick(뒷정리 · 알림 · 남은 일 8초마다 · 다시 읽기). RB_FALLBACK → rbWhy + 예전 길 · 연결/세션 → gas · 규칙 오류 → fail(입력 되살리기 등 예전 처리 그대로).
- apiEditOrder: 수량 · 단가면 4초 · 15초 뒤 지급 줄 다시 읽기. 예전 rb_od_edit 길은 `_odQueue` 로 그대로. 알림 이름표 `_odLines`.
- ext.js 로 뽑아 node --check 통과 · 이름 붙은 함수 중복 없음.

## 시험(로컬 PG16 · DB g1 = template pg3 + m085)
- `TZ=Asia/Seoul RB_DB=g1 node run.js work res.json` — harness.js 가 **실제 서버 코드(work 의 Code/Keys/Journal/ProgLater/Choices/TabShim/SampleShim/LinesShim/PdDirect/PgDirect/OdDirect)를 vm 으로**: 발주 DB 는 운영과 같은 가상 저장 길(tabVirtual_('pd') → rb_tab_commit 사본), 진행 기록은 가짜 시트 · 진행 장부 옮기기, 시계는 고정. SQL 쪽은 뒷정리 일을 실제 pgDirectPost_/odDirectPost_ 로 돌려 이력까지.
  대조: 결과 · 오류 문구 · 발주 DB 사본 모든 칸(발주금액 포함) · 진행 기록 줄(JSON 풀어서 · 최종수정 · 저장한 사람 · 새 줄 위치) · 샘플 진행 · 이력 줄(종류 · id/doc/code · 항목 · 전후 · 사유 · 어디 · 단계 이력 시각) · 지급 줄 따라 고치기 인자 · 뒷정리 대조(rb.odDiff 없음).
  **208/208**(cn497 기준 work) — apiEditOrder 79(서버 길 13) · apiSetCur 12 · apiSetFlag 12 · apiBulkHide 11 · apiBulkOwner 13 · apiBulkDate 14 · apiBulkStep 16 · apiBulkDoc 13 · apiBulkApprovalNo 4 · apiBulkOrderDate 8 · apiSetCode 7 · apiOldAck 4 · apiNegoQtySet 7 · apiNegoPick 4 · apiCloseExpSet 4 (results_table.md · run_harness.txt).
  2차는 + 속성(rb.docq · rb.ordguard · rb.oldack · rb.negoqty · rb.negopick — SQL 쪽은 뒷정리가 맞춘 값) · rb_conf 원본(열쇠 차례까지) · 마감상신 탭 줄 · 품목 DB 등록 인자도 대조.
- 새 DB(template pg3)에 Supabase.js 에서 뽑은 m085 · m086 · m087 차례로 적용 — 오류 없음.
- `./lock_test.sh`(run_lock.txt): ① rb_tab_pd 3초 쥔 동안 rb_od_save 2.5초 기다린 뒤 저장 ② 직접 저장 뒤 옛 줄로 rb_tab_commit pd → RB_ROW_TAKEN ③ rb_tab_pg 쥔 동안 rb_pg_more 기다림 ④ odConf 끈 뒤 RB_FALLBACK.

## 남은 위험 · 통합 시 주의
- **rb_once ok[] · RB_ONCE_FN 에 rb_od_save · rb_pg_more 추가 필수**(다른 작업자 목록과 합쳐서).
- 실제 Supabase · GAS 로는 안 돌려 봄. odEditPost_ 의 지급 줄 따라 고치기는 인자만 대조(실제 linesFollow* 는 예전 코드 그대로 부름).
- 발주 수정 응답에 lines(지급 줄 표)가 없음 — 예전 할 일 길(f347)과 같음 · 화면이 다시 읽음.
- 진행 기록 묶음은 bulkEditProgress_ 처럼 '바뀐 것 없어도' 줄을 다시 씀(최종수정 · 저장한 사람). 예전과 같음.
- 이력의 at: 서버 길은 쓰는 때, 직접 길은 누른 때(RB_J_AT) — f493 과 같은 방향.
- pdConf 에 발주금액 열이 있고 rb.pdHead 의 amt/qty/price 가 statusFieldCols_ 와 같아야 amtCalc(아니면 발주금액을 안 고침 · 발주금액 열 있고 없음이 다르면 odConf 꺼짐).
- RB_BUILD · CLAUDE.md · 개인용 반영 안 함.

## 2차 통합 주의
- 개인용: BomExtra.js · Nego.js · Closing.js 갈고리는 typeof kvRead_/kvSrv_ — OdDirect.js 가 없으면 예전 그대로.
- rb_conf 를 원본으로 바꾼 뒤 속성은 사본(뒷정리가 맞춤). 속성 한 칸이 넘치면(9KB) 속성 쓰기만 실패하고 rb_conf 는 그대로 — 진단이 속성을 볼 때만 늦음.
- apiCloseList 캐시는 그대로 두고 exp 만 rb_conf 에서 새로 덮음(직접 저장은 캐시를 못 버리므로).
- 화면 apiWriteSheet(발주 상세 발주일 · f417)은 아직 pjDirect apiBulkOrderDate(할 일 길) — rb_od_bulk 로 바꿔도 됨(응답 모양만 맞추면).
