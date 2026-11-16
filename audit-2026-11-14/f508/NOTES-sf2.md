# sf2 — 서버 저장 길 실패 갈래(잠금 · 가상 저장 · 1분 작업 · Supabase 일시 오류) — 기준 v1255(f502)

**쉬운 한 줄**: 1분 작업이 잠금을 쥐고 사람 저장을 3분 넘게 세워 두던 것을 막고(사람이 기다리면 바로 비킴), Supabase 가 잠깐 안 될 때 · 그사이 다른 칸을 누가 바꿨을 때는 서버가 스스로 다시 해서 저장되게 했다.

## 찾은 실패 길 · 고친 것
| # | 어디 | 언제 | 지금 사용자에게 | 고친 뒤 | 시험 |
|---|---|---|---|---|---|
| 1 | 1분 작업 잠금(issJobDrain_ · tabJobDrainIn_ 200개 한 번에 · 탭 사이에서만 비킴) | 11/13 apiSampleAdd 184초 '저장이 몰려 3분'(쥔 곳 issJobDrain_) | 저장 실패 | `bgTryLock_`(Code.js): 1분 작업(RB_IS_BG)은 사람이 기다리면 잡지 않음 · 1.5초마다 다시 봄 · 잡은 뒤 사람이 기다리면 바로 놓음. `bgYield_`: 쥔 채 일하는 곳은 사람 대기/15초면 멈춤. tabJobDrainIn_ 20개씩 쓰고 끝 표시(1분 작업은 60개까지). drainHist_ 칸마다 멈춤 가능. 1분 작업 쪽 tryLock 42곳(+journalDrain 2곳) → bgTryLock_(사람 저장 길은 예전과 똑같이 동작). warmCaches(10분) · apRebuildDeferred 에도 RB_IS_BG. waitLock_: 바로 잡은 저장은 '기다림' 표시 안 함(예전엔 저장마다 20초 동안 1분 작업이 다 비켜 뒷정리가 밀림) · 기다림 표시 3초마다 새로 | test/t1_lock.js: 이슈 일 200개(1개 1초) — 고치기 전 사람 대기 195~200초 → **실패**(3분 한도), 고친 뒤 0~19초 → 저장됨 |
| 2 | pgxDrainIn_ · pdxDrainIn_ | 11/16 1분 작업 pgxDrainIn_ 11초 | (잠금 몰림 원인) | Supabase 읽기(일의 줄 · 밀린 줄 찾기)를 **잠금 밖에서** · 밀린 줄은 건마다 묻지 않고 40개씩 한 번에 · 1분 작업은 60/80개씩 | node --check · 같은 결과 구조(읽은 뒤 바뀐 값은 그 저장의 새 일이 다시 씀) |
| 3 | sbFetch_ · sbRpc_ · issDbRpc_ 등 5 · cfRpc_ · matDbRpc_ · sbRpcAnon_ · sbGetAllRaw_ · sbFetchMany_ · bomSbLoadFast_ | Supabase 503/429/연결 끊김('Address unavailable' — 11/12 rb.issJobErr)/statement timeout | 저장 실패(한 번에) | `sbHttp_` · `sbFetchAllRetry_`(Supabase.js): 실행 안 된 게 확실한 것(연결 못 함 · 429 · 503 · 57014 · 40001 · 40P01 · 55P03 · 53300 · PGRST000~3)은 무엇이든 2번 더(0.5 · 1.5초, statement timeout 은 1번) · 들어갔는지 모르는 것(502/504/시간 초과)은 읽기 · patch · delete · upsert 만 다시 — **함수(rpc) 504 는 다시 안 함**(두 번 저장 막기) · 규칙 오류(400 등)는 그대로. 마지막 다시 한 것 캐시 sb:retryLast | test/t2_retry.js: 10경우 — 고치기 전 10/10 오류, 고친 뒤 기대대로(7 저장 · 3 알림: 함수 504 · 400 · timeout 두 번) |
| 4 | tvVirtualCommit_(발주 DB · 진행 기록 서버 길 끝맺기) RB_ROW_TAKEN | 그사이 화면 직접 저장(rb_od_* · rb_pg_save)이 같은 줄을 바꿈 | '그사이 다른 사람이 같은 줄에 저장 — 다시 해 주세요'(gsr 이 저절로 10번) | `tvMerge3_`(TabShim.js): 지금 줄을 다시 읽어 3-way — 내가 안 바꾼 칸은 지금 값 · 그쪽이 안 바꾼 칸은 내 값 · 최종수정/수정자 칸은 내 값 · JSON 객체 칸(진행 · 메모 · 날짜)은 열쇠 단위로 합침 → 같은 함수로 다시(최대 3번). 합친 칸은 시트 맞추기 일도 합친 값으로 다시 넣음. 같은 칸(같은 열쇠)을 둘 다 바꿨을 때만 멈추고 '같은 칸: 2행 진행JSON' 표시 | test/t3_merge.js(실제 tvVirtualLoad_/tvVirtualCommit_): 다른 칸 · 같은 JSON 다른 열쇠 — 전 실패/후 저장(합친 값 확인 · 시트 일도 합친 값) · 진짜 충돌 — 둘 다 멈춤(후에는 무슨 칸인지) · 안 바뀜 — 둘 다 저장 |
| 5 | BOM 정정 여러 줄 '그사이 바뀌었습니다' — 서버 apiBomFixManyCore_ + SQL rb_bom_fixmany_core | 11/16 jayden MP0086PU1(BOM 진단: 1~4차로 닫히고 5차 PU2 새 줄) · MP0160UG2 | 저장 실패 | 종료 차수만 바뀐 줄(같은 줄ID · 자재코드 · 초도, 시작/끝/코드를 고치는 줄 아님)은 그 줄에 그대로 저장(`bomReRowRebase_` · SQL **m156_bom_fm_rebase**) · 결과 res.rebased. 그래도 막을 때(코드 바뀜 · 종료를 고치는 줄 · 줄 삭제)는 무엇이 바뀌었는지 문구에(`bomReRowWhy_`: '그사이 종료 없음 → 4차') | test/t4_bom.js(실제 bomReRow_): 단가 정정 전 막음 → 후 저장, 막아야 할 2경우는 계속 막고 이유 표시. SQL(로컬 PG sf2): 같은 상황 전 'BOM 시트가 그사이 바뀌었습니다' → 후 ok · 단가 200 · 종료 4차 그대로 |
| 6 | 반제품 연결 statement timeout(rb_bom_semilink_do) · 되돌리기(rb_bom_undo_do) | 11/13 23:50 day apiSemiBomLink | 저장 실패 | 지운 줄마다 아래 줄 전체 update(k × 2천 줄) → 한 번의 delete + update(SQL **m155_bom_shift_once**). m076 인덱스는 있음. 남은 원인 후보: 다른 BOM 저장의 advisory lock(rb_bom) 대기도 30초 안에 들어감 → 서버 길은 sbHttp_ 가 57014 를 1번 다시 | 로컬 PG 2,501줄 · 15줄 지움: 결과 md5 같음(d8c598…) · 657~957ms → 380~520ms (지운 줄 수에 비례하던 부분 제거) |
| 7 | 1분 작업이 옮기던 사용자 저장(od · pj 일) 실패 → pjNotePut_ jobErr '저장하지 못했습니다' | 11/13 16:17 apiSampleProjInfo '서버 오류가 발생했습니다' 등 | 이미 '저장됨'을 본 뒤 나중에 실패 알림 | `jobRetryable_`(IssueDb.js): 잠금 몰림 300번(예전) + 시스템 일시 오류(Supabase 5xx/429 · 연결 · 시간 초과 · Apps Script 서버 오류 · 실행 시간 초과 · 그사이 같은 줄/칸) 30번 다시(차례 지키며 멈춤). 입력 · 규칙 오류만 사람에게 | test/t5_job.js: 8경우 분류 확인 |
| 8 | apiBomSave '줄이 없습니다'(M0160AA2 — 신제품 BOM 등록 전 [수정]) | 11/16 10:23 | 무엇을 할지 모름 | 서버 문구에 '아직 BOM 이 없음 — [신제품 BOM 등록]으로(고친 값은 화면에 그대로)'. **근본은 화면(sf1)**: BOM 없는 품목은 [수정]이 아니라 신제품 저장(meta.newProduct)으로 보내야 함. SQL rb_bom_save_do 같은 문구는 안 고침(sf3) | — |

## 새 이름(통합 때)
- 서버(Code.js 공용): `bgTryLock_` · `bgYield_` · `RB_BG_LOCK_AT`. Supabase.js(회사): `sbHttp_` · `sbFetchAllRetry_` · `sbTransient_` · `sbIdem_` · `RB_SB_RETRY`. TabShim.js: `tvMerge3_` · `tvJsonMerge3_` · `RB_TV_MERGED`. Bom.js: `bomReRowRebase_` · `bomReRowWhy_`. IssueDb.js: `jobRetryable_`.
- SQL: m155_bom_shift_once(rb_bom_semilink_do · rb_bom_undo_do 다시 — v1255 의 마지막 정의 m061 · m067 기준), m156_bom_fm_rebase(rb_bom_fixmany_core — m054 기준). **다른 작업자가 이 세 함수를 다시 만들면 m155/m156 을 그 뒤 정의 위에 다시 떠야 함**(같은 줄 당기기 · raise 문구를 찾아 바꾼 것). rb_once ok[] · RB_ONCE_FN · rb_pj_do 는 안 건드림.
- 개인용: Code.js 등 공용 파일은 bgTryLock_ 를 Code.js 에서 씀(있음). BomShim 은 `typeof sbFetchAllRetry_` 로 감쌈.

## 시험 실행
`cd $S/sf2/test && node t1_lock.js $S; node t2_retry.js $S; node t3_merge.js $S; node t4_bom.js $S; node t5_job.js $S` (결과 t*_result.txt). SQL: 로컬 PG db `sf2`(pg3 복사 + bom_rows 실제 칸 · test/bench_setup.sql) — fm_test.sql · bench_run2.sql.
모든 .js `node --check` 통과 · PageHtml 은 안 고침(v1255 와 같음).

## 남은 위험
- 1분 작업 시험은 가상 시계(일 1개 1초)로 잰 것 — 실제 시트 쓰기 시간은 다름. 사람 저장이 계속 몰리면 1분 작업이 계속 비켜 시트 사본이 늦어질 수 있음(사본은 보기용 · Supabase 가 원본이라 저장은 안전).
- jobRetryable_: 일시 오류로 중간까지 쓴 할 일을 다시 돌리면 이력이 두 번 남을 수 있음(예전엔 버리고 '실패' 알림). 저장 값은 대부분 '설정' 동작이라 같음.
- 3-way(4번): pd/pg/sp 서버 길만. 지급 줄 · 샘플의 RB_ROW_TAKEN 은 '새 줄 자리 겹침'(맨 아래 줄을 둘이 동시에 씀)이라 칸 합치기로는 못 풂 — 지금처럼 gsr 이 저절로 다시(줄 자리를 새로 받음).
- 반제품 연결 timeout 의 진짜 원인(advisory lock 대기 vs 줄 당기기)은 실서버 로그로 확인 못 함.
