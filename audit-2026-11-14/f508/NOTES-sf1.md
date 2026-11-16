# sf1 — 화면(PageHtml) 저장 길 실패 갈래 (기준 cn502 = @1255)

**쉬운 한 줄**: 연결이 끊기거나 서버가 잠깐 오류를 내도 이제 화면이 같은 저장을 저절로 다시 보내고, 두 번 들어가지 않으며, 사람이 고쳐야 하는 오류만 화면에 뜹니다.

## 저장 길 목록 (전체 표: `t/inv_table.md`, 만든 스크립트: `t/inv.js`)
- 서버 쓰기 호출 자리 **211곳 · 함수 128개**(읽기 빼고). 길: gsr 172 · RB_DIRECT 안쪽 22 · issRun 7 · linkRun 2 · closeDbRun 1 · itemRun 1 · gsrq 3 · google.script.run 바로 3.
- 실패 처리 방식: 처리 함수 96 · toast 59 · alert 18 · 끝맺기 14 · optFail(되돌림 + 알림) 4 · 무시 8 · 없음 12(그중 대부분은 RB_DIRECT · issRun 안쪽이라 부른 쪽 처리로 넘어감).
- RB_DIRECT 항목은 모두 gsr 를 거친다. 직접 저장 helper(sm2/od/pg/pd/po/cf/pj Direct · bvDirectRpc · bvReviewDirect · lnInbDirect · issRun · qualRun · linkRun · closeDbRun · itemRun · 메모장)는 모두 `noteRpc` 를 쓰고, 연결 · 세션 문제면 `gas`(= gsr 의 서버 길)로 간다. 그래서 **gsr 서버 길과 noteRpc 두 곳**이 일시 오류를 처리하는 자리다.

## 찾은 실패 길 (cn502 기준)
| # | 어디 | 언제 | 지금 사용자에게 보이는 것 | 고친 뒤 | 시험 |
|---|---|---|---|---|---|
| 1 | gsr 서버 길(모든 서버 저장 · 직접 저장이 서버로 넘어간 것) | 연결 끊김 HTTP 0 · '서버 오류가 발생했습니다' · 동시 실행/호출 한도 · 6분 초과 · 빈 오류 | 바로 실패 alert/toast/optFail(화면 되돌림) | 같은 요청으로 저절로 다시(쓰기 1.5→30초 늘려 가며 12번 ≈ 4분, 인터넷이 끊겼으면 다시 연결될 때까지 최대 10분 · 읽기 3번). 두 번째부터 "다시 보내는 중 — 다시 입력하지 마세요" toast | S1 S3 S4 S7 S9 S11: 전 실패 → 뒤 저장됨 |
| 2 | 같은 곳 | 서버는 저장했는데 응답만 잃음 | 실패로 보이고, 사람이 다시 누르면 **두 번 저장**(발주 등록 · 샘플 추가 등) | 쓰기는 요청 번호(rq)와 함께 서버 `apiOnce`(새 파일 SaveOnce.js)로 감 → 다시 보내면 처음 결과를 돌려주고 다시 저장하지 않음 | S2: 전 실패(서버 1번 실행됨) → 뒤 성공 · 서버 실행 1번 |
| 3 | 같은 곳 | 다시 보냈는데 처음 것이 아직 서버에서 도는 중 | — | 서버가 20초까지 기다렸다 결과, 그래도 도는 중이면 `{__once:'running'}` → 화면이 조금 뒤 같은 번호로 다시 물음 | S8 |
| 4 | 같은 곳 | 새 판 배포 직후 'Script function not found' · 'Authorization is required' | 알 수 없는 영어 오류 | 3번 다시 시도(배포가 바뀌는 순간이면 그 안에 통과). 계속되면 "새 판으로 바뀌어 이 화면이 옛 판입니다 — 새로고침" | S5 · S5b |
| 5 | noteRpc(모든 Supabase 직접 저장) | 502~504 가 세 번 이상 · 429 · 408 · 52x · 본문 없는 500 | 두 번 다시 한 뒤 **HTML 오류 글이 규칙 오류처럼** 실패로 뜸(서버 길로도 안 감) | 같은 rq 로 5번(2→30초), 그래도 안 되면 '들어갔는지 확인'(apiOnceCheck) 길 | R1: 전 실패 → 뒤 저장됨 |
| 6 | noteRpc | 연결 끊김이 이어지고 apiOnceCheck 도 한 번 실패 | "연결이 끊겨 저장하지 못했습니다"(실제로는 들어갔을 수도 있음) | `rbOnceResolve`: 확인이 될 때까지 늘려 가며 8번(≈6분) 물음. 들어갔으면 그 결과, 안 들어갔으면 tomb 뒤 서버 길. 끝내 확인 못 하면 "새로고침해 저장됐는지 확인"(그냥 '실패'라고 하지 않음) | R3: 전 실패 → 뒤 저장 결과 받음 |
| 7 | noteRpc | Postgres 연결 오류(PGRST000~003 · too many connections · terminating connection) · 공개 키 바뀜(Invalid API key/JWT) | 규칙 오류처럼 실패 | 같은 rq 로 다시 / 키 문제는 서버 길(아무것도 안 들어감) | R2 |
| 8 | 창 닫기 경고 | 저장을 다시 보내는 중에 창을 닫음 | 경고 없음 → 저장 사라짐 | `GSR_PEND`(쓰기가 끝나기 전) 도 beforeunload 경고 대상 | P1 |
| 9 | pgKick · pdKick · poKick 뒤 | 직접 저장의 1분 작업 뒷정리 실패 · 경고(pjNotePut_) | 그 사람의 다음 apiProgKick 때만 보임 — 다음 저장을 안 하면 **영영 안 보임** | 뒷정리 '지금 맞추기'가 끝나면 75초 뒤 apiProgKick 한 번 더(rbNotesSoon) | 코드 확인 |
| 10 | 샘플 요청 추가 · 새 프로젝트(rb_sm_add · rb_sm_new) 뒤 완료/드롭 프로젝트 다시 열기 | 다시 열기 저장 실패 · 세션 sm2/pj 가 꺼짐 | **조용히 버림**(rb_sm_new 쪽은 서버 길이 빈 함수라 아예 안 보냄) → 프로젝트가 '완료'로 남음 | `sampleReopenSave` — gsr 길(직접 → 서버 · 일시 오류는 다시), 끝내 안 되면 알림 + 다시 읽기 | 코드 확인 |
| 11 | BOM 직접 저장(bvDirectRpc) 뒤 다시 읽기 | bvSbLoad 한 번 실패 | "저장은 됐습니다 — BOM 을 다시 열어 확인"이 **실패로** 뜸 | 두 번 더(1.5 · 3초) · 그래도 안 되면 서버 apiBomGet 으로 같은 모양 | 코드 확인 |
| 12 | 샘플 진행 기록 지우기의 '수신 취소' | 저장 실패 | toast 만, 화면은 '진행중'으로 남아 저장된 것처럼 보임 | 화면 되돌림 + 다시 읽기 + 알림 | 코드 확인 |
| 13 | gsr 의 예전 자동 다시(f461 · f486) | — | '저장이 몰려' 15초 · RB_ROW_TAKEN 1.5초 · 10번은 그대로. 읽기 판단은 이제 `gsrIsRead`(예전 이름 앞머리 regex 와 같은 범위 + 정확한 목록) | S10 그대로 됨 |

직접 저장(RB_DIRECT)의 실패는 gsr 가 다시 하지 않는다(`onFail(err, fromSrv)` — 서버 길 실패만 다시). 직접 길은 noteRpc 가 rq 로 이미 판단했고, 서버 길로 다시 하면 두 번 들어갈 수 있어서다.

## 바꾼 파일
- `work/PageHtml.html`: gsr(일시 오류 분류 GSR_TRANSIENT · 다시 하기 · 쓰기 apiOnce · GSR_PEND · gsrWhenOnline) · noteRpc(5xx/429/PG 연결 · rbOnceResolve · RB_RPC_WAIT) · rbNotesSoon · sampleReopenSave · bvDirectRpc 다시 읽기 · 수신 취소 되돌림 · beforeunload.
- `work/SaveOnce.js`(**새 파일 · 회사 · 개인 공통** — Supabase 안 씀): `apiOnce(rq, fn, {a, u})`. 스크립트 캐시에 '도는 중/끝남 + 결과'(30분 · 3만 자씩 나눠 40조각까지) · 사용자 잠금(getUserLock 5초)으로 같은 번호 동시 시작 막기 · 오류면 표시 지워 다시 하면 새로 · 7분 넘은 '도는 중'은 죽은 실행으로 보고 새로. 부를 수 있는 이름은 `api…`(google.script.run 으로 바로 부를 수 있는 것과 같음 · apiOnce · apiBatch 제외).
  - 개인용에도 이 파일을 넣어야 한다(PageHtml 이 같으니). 없으면 화면이 'apiOnce 없음'을 보고 예전처럼 바로 부른다(GSR_ONCE_OFF).
- SQL 없음(m150~m154 안 씀). 공유 목록(rb_once ok[] · RB_ONCE_FN · rb_pj_do) 손대지 않음.

## 시험
- `t/gsr_fail.js` (Playwright · 가짜 google.script.run 이 처음 N번 실패/응답 잃음/도는 중을 주고 그 뒤 성공 · 가짜 Supabase 가 502/503/끊김/규칙 오류) — 같은 시나리오를 cn502 와 work 에 돌림:
  - **고치기 전 3/16 기대대로**(13개 실패 · S8 은 `{__once}` 를 그대로 받아 잘못된 성공) → **고친 뒤 16/16 기대대로**(저장됨 13 · 의도한 실패 3: 규칙 오류 2 · 옛 판 새로고침 안내 1). 결과 `t/before.out` · `t/after.out`.
  - 쓰기는 다시 보내도 요청 번호 1개 · 서버 실행 1번(S1~S11 rqs=1 · runs=1).
- `t/once_srv.js` — 실제 SaveOnce.js 를 node vm(가짜 CacheService/LockService/Utilities)에서: **13/13 통과**(같은 번호 한 번만 · 같은 결과 · undefined 인자 지킴 · 오류 뒤 다시 · 도는 중 기다림 · 20초 넘으면 running · 죽은 실행 · 1MB 결과 나눠 담기 · undefined 결과 · 이름 막기).
- node --check: 모든 .js · 화면 스크립트(ext.js) 통과 · 함수 이름 중복 없음. 화면 오류 2개는 cn502 에서도 똑같이 나는 목업 첫 화면 오류(가짜 서버가 apiBootstrap 실패).

## 남은 것 (서버 · SQL 필요 — 다른 갈래)
1. **충돌류 3-way 는 서버/SQL 쪽**: RB_ROW_TAKEN(rb_tab_commit · rb_sm_commit p_chk) 은 지금 '다시 읽어 다시 보냄'뿐 — 서버 길 가상 저장이 줄 통째 비교라 **바꾼 칸만 비교**하도록 SQL 이 바뀌어야 진짜 3-way. BOM '그사이 바뀌었습니다'(apiBomFixMany · apiBomSave 의 시트 행 확인) · 'BOM 탭에 M0160AA2 줄이 없습니다'(신제품 등록 전 [수정]) 도 서버(Bom.js) 에서 줄ID 로 다시 찾기가 필요. 화면은 그 오류를 받아도 입력은 BOM 보기에 남는다(bvDirty).
2. 메모장 판 충돌은 지금 confirm(그쪽 내용 / 내 내용으로 덮기). 블록 id 단위 3-way 는 화면만으로 가능 — 이번엔 손대지 않음(두 창에서 같은 사람이 쓸 때만).
3. 할 일 길(rb_pj_add) 1분 작업 실패는 지금도 사람에게 "저장하지 못했습니다 — 다시 해 주세요" alert(서버 pjDrainIn_ 5번 다시 뒤). 원칙상 서버가 더 다시 하고 관리자 알림으로 가야 함(서버 몫).
4. optFail(4곳 · 발주 단가 · 샘플 칸 등)과 이슈 이력 고치기 실패는 화면을 되돌리고 알림 — 알림 글에 적은 값이 들어 있음. 이제 규칙 오류에서만 일어남.
5. apiOnce 결과 캐시는 30분 · 스크립트 캐시라 드물게 지워질 수 있다(그러면 다시 보낸 것이 새로 실행 = 예전과 같음). 더 단단히 하려면 Supabase rb_recent 에 남기는 판(회사용)을 서버 쪽에서.
6. 첫 화면 목업 오류 `(L || []).map is not a function` 은 cn502 에도 있는 것(가짜 서버 응답 탓으로 보임 — 실제 화면 영향 확인 안 함).
