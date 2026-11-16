# sf3 — Supabase 직접 저장 SQL 함수의 실패 갈래 (기준 v1255 = f502)

**사용자에게 한 줄**: 직접 저장 함수의 오류 754곳을 모두 나눠 보고, 사람이 고칠 일이 아닌 실패(안쪽 오류 · 설정 늦음 · 같은 값 충돌 · 다른 칸 충돌)는 사용자에게 안 보이게 서버 길로 넘기거나 SQL 안에서 합쳐 저장하도록 고쳤습니다. 잠금 순서는 순환이 없고, 8개 연결 1200번 동시 저장에서 교착 · 시간 초과 · 실패는 0이었습니다.

## 범위 · 방법
- 대상: rb_once 허용 목록 46개 + 거기서 부르는 함수 = **294개 함수**(최신 정의 — 로컬 DB `sf3` = pg3 + v1255 의 m105~m126 이주. Supabase.js 는 cn502 와 v1255 가 같음).
- `graph.js`(부르는 함수 따라가기) → `raises.json`(raise exception 754개) → `raises_classified.tsv`(한 줄씩 분류) · `class_table.md`.
- 잠금 순서 `locks.js` → `lockseq.json`.

## raise 754개 분류
| 분류 | 수 | 지금 사용자에게 | 판단 |
|---|---|---|---|
| (a) 사람 입력 오류(필수 칸 · 형식 · 목록 밖 · 업무 규칙) | 249 | 문구 그대로 | 대부분 한 줄로 알아들을 수 있음. 서버(GAS) 문구와 같게 맞춰져 있음 |
| (b) RB_FALLBACK(아무것도 안 들어감 → 서버 길/예전 할 일 길) | 370 | 안 보임 | 아래 '서버 길도 막히나' 참고 |
| (c) 충돌 · 그사이 바뀜 | 35 | 문구 + 다시 열기 | 샘플(rb_sm_edit · rb_sm2_status)은 이미 칸별 3-way(같은 값이면 통과). **BOM 정정 · 자재 입고는 고침(m162 · m163)** |
| (d) RB_SESSION · 권한 | 80 | 화면이 세션 새로 받아 한 번 더 → 그래도면 서버 길 | 문제 없음 |
| (e) 안쪽(열 위치 · 설정 · 모르는 작업) | 18 | 문구 그대로("…열이 없습니다. 관리자에게") | **7곳 RB_FALLBACK 로(m161)**. 나머지('알 수 없는 … 작업'·'RB_NEEDV3')는 화면이 잘못 부른 경우라 그대로 |
| rb_once RB_ONCE_LATE | 2 | 안 보임(화면이 이미 포기한 요청) | 문제 없음(아래) |

그 밖에 **raise 가 아닌 Postgres 오류**(22P02 형식 · 23502 null · 42703 없는 열 · 22012 등): 고치기 전엔 원래 영어 문구가 사용자에게 그대로 보였다 → 화면 고침(아래 ④).

## (b) RB_FALLBACK — 넘긴 서버 길이 같은 이유로 또 막히나
- 서버 길이 **같은 SQL**인 것: 이슈 · 품질 · 링크 · 품목 · 마감 · 자재 입고(`*_save_srv`). 이 6개 `_do` 에는 RB_FALLBACK 이 하나도 없음 → 되돌이 없음. 대신 시간 초과 · 교착은 서버 길에서 같은 SQL 을 한 번 더 하는 것이라 대개 통과.
- 일일보고(rb_dly_srv) · kv(rb_kv_srv)는 서버도 같은 SQL 이지만 RB_FALLBACK 이면 예전 길(Daily.js:30 · OdDirect.js:320) → 막히지 않음.
- '앞선 저장 반영 전'(rb_pd_busy · rb_pg_busy · rb_sm2_sbusy · rb_dly_ready): 예전 할 일 길(rb_pj_add)로 → 차례 뒤에 들어감, 실패 아님. 다만 **rb_pd_busy 는 `_poPost`(발주 등록 뒤처리) · `_odLines`(수량/단가 뒤처리)도 '앞선 저장'으로 봐서**, 발주 등록 직후 1분 안의 그 건 진행상태 바꾸기 등은 할 일 길(대기열)로 간다(실패는 아님 · 담당자가 싫어하는 '밀어 넣기'). 빼도 되는지는 뒤처리 순서 검토가 필요해 손대지 않음 → 남은 것.
- BOM 'BOM 서버 저장 중'(bomLease) · '시트가 앞섬' · 꺼짐: 서버 길은 스크립트 잠금 차례 → 통과.

## (c) 충돌 · 그사이 바뀜
- `rb_bom_fixmany_core` '칸을 그사이 다른 사람이 고쳤습니다(지금 X)': 지금 값이 **내가 넣을 값과 같아도** 막았다(같은 고침이 서버 길 · 다른 사람으로 이미 들어간 경우). → m162: 그 칸은 충돌 아님 · 고칠 칸이 모두 그러면 '바뀐 값이 없습니다' 오류 대신 성공(`already`). GAS 쪽(Bom.js 2202행)도 같은 규칙이라 서버 길 담당(sf2)이 맞추면 좋음.
- `rb_mat_do` set 'RB_MAT_CHANGED': 판 번호만 달라도 막았다. → m163: 화면이 본 판의 값(rb_mat_log 'set' 의 before — 화면이 `prev` 를 주면 그것)을 찾아 칸(입고일 · 수량 · 메모)마다 3-way. 같은 칸을 서로 다른 값으로 바꾼 것만 RB_MAT_CHANGED(칸 · 지금 값 · 누가). 지운 줄 대 고친 줄(del)은 그대로 충돌.
- BOM '시트가 그사이 바뀌었습니다(코드)'(줄 찾기 — 줄ID+코드+시작/끝 차수): 이미 줄ID 로 다시 찾음. 코드까지 다르면 막는 건 그대로 둠(f498 과 같은 규칙 · 코드 바꿈과 섞이면 위험). 11/16 jayden 'MP0160UG2 / MP0086PU1' 문구 모양은 GAS 길 것.
- 11/16 apiBomSave 'BOM 탭에 M0160AA2 줄이 없습니다': 서버 길(Bom.js 1587)도 같은 검사 → 화면이 신제품 길(meta.newProduct)로 보내지 않은 것이 원인(sf1 몫).

## (e) 안쪽 → RB_FALLBACK (m161)
rb_co_create_do(2곳 · 열 위치) · rb_od_state_do([진행상태] 열) · rb_od_bulk_do([품목코드]·[품의번호]·[발주일] 열) · rb_po_submit_do([품의번호] 열) · rb_bom_common_do(공용여부 칸). 모두 서버 길이 GAS(시트 머리글로 판단)라 넘기면 통과.
또 rb_bom_fixmany_do · rb_bom_fmshare_do 가 모든 오류를 '… — 저장하지 않았습니다.'(P0001 · 사람 오류)로 바꾸던 것을 **SQLSTATE ≠ P0001 이면 원래 오류 그대로**(화면 ④ 가 서버 길로).

## 잠금 순서 (pg_advisory_xact_lock)
| 함수 | 순서 |
|---|---|
| rb_pg_save · rb_pg_more | rb_tab_pg(샘플이면 sp) → rb_tab_pd |
| rb_od_save · rb_od_bulk | rb_tab_pg → rb_tab_pd |
| rb_odx_conf_put(서버) | pg → sp → pd |
| rb_sm2_save | rb_tab_sp → (rb_ver 'p' 줄) → rb_tab_sm |
| rb_co_create | rb_tab_pd → rb_tab_it → rb_tab_ln |
| rb_od_state · rb_po_* · rb_vendor_add | rb_tab_pd |
| rb_ln_save · rb_ln_inb | rb_tab_ln |
| rb_sm_add/bulk/edit/new | rb_tab_sm |
| rb_iss/qual/link/item/close · rb_item_reg | 그 탭 하나(is · ql · lk · it · cl) |
| BOM 18개 | rb_bom 하나 |
| rb_dly_save · rb_kv_set · rb_mat_save | rb_dly · rb_kv · rb_mat:<발주ID> |
| rb_once | op:once:<요청번호> (맨 앞) |
- 순서 그래프 pg→sp→sm, pg→pd, sp→pd, pd→it→ln, pd→ln: **순환 없음**(거꾸로 잡는 함수 없음). 줄 잠금을 쥔 채 다른 권고 잠금을 기다리는 곳은 rb_sm2_save 하나(rb_ver 'p' → rb_tab_sm)인데, rb_tab_sm 을 쥔 쪽은 rb_ver 'p' 를 잡지 않음(sm → 'r') → 교착 없음.
- 시간 제한: anon · authenticated statement_timeout 30초(m075) · lock_timeout 없음 → 잠금 대기가 30초 넘으면 시간 초과 → 화면이 서버 길로(f477). 함수 자체 설정 없음.
- 느린 쿼리: '앞선 저장' 검사(rb_pd_busy · rb_pg_busy · rb_sm2_sbusy · rb_dly_ready · rb_item_reg_do · rb_po_item_add)가 rb_tab_job **7일 치 전체**를 훑었다(인덱스는 id 뿐) → m160 부분 인덱스. 시트 사본 줄 찾기(샘플ID · 실행판ID 칸 값)는 탭 전체 훑기(칸 위치가 설정마다 달라 식 인덱스 못 만듦) — 탭 수천 줄이면 수십 ms, 남은 위험.

## rb_once 자체
- 요청 번호 모양 · 모르는 함수 · 인자 이름 안 맞음 → RB_FALLBACK(아무것도 안 들어감) → 서버 길. 화면 RB_ONCE_FN 과 SQL ok[] 46개 같음(대조함).
- 연결 끊김 뒤 같은 번호 다시: 첫 요청이 아직 돌면 권고 잠금에서 기다렸다 처음 결과 → 두 번 안 들어감. apiOnceCheck(tomb)와 엇갈리는 세 경우(원래 요청이 먼저 끝남 / 나중에 끝남 / 아직 안 옴) 모두 한 번만 들어감(읽어서 확인).
- 작은 틈(안 고침 · 공유 함수라): 같은 rb_recent 열쇠가 1~2일 된 것으로 남아 있으면 찾기는 1일만 보고 넣기는 충돌 → 거짓 RB_ONCE_LATE. 요청 번호가 무작위라 사실상 안 생김. jsonb 인자에 null 을 주면 SQL NULL 이 아닌 JSON null 로 넘어감 — 지금 함수들은 모두 coalesce/jsonb_typeof 로 받아 문제 없음(대조함).

## 바꾼 것
1. SQL(work/Supabase.js 끝에 SB_MIGRATIONS.push · 파일도 따로): `m160_job_open_idx` · `m161_fail_class` · `m162_bom_fm_same` · `m163_mat_merge`. 함수는 **최신 정의(pg_get_functiondef)를 그대로 가져와 고친 줄만 바꿈**(`gen.js` — 바꿀 곳이 정확히 1곳인지 확인). 두 번 적용해도 됨. U+2028/2029/FEFF 0개.
2. 화면(work/PageHtml.html `noteRpc` 1곳): Postgres 오류 코드가 P0001 이 아니고 RB_ 문구가 아니면 `RB_FALLBACK 안쪽 오류(코드)` 로 바꿔 서버 길 + 속도 기록 '직접→서버(안쪽 오류 …)'. (sf1 과 겹칠 수 있음 — 그 한 블록만)
- 공유 목록(rb_once ok[] · RB_ONCE_FN · rb_pj_do)은 건드리지 않음. 새 함수 이름 없음.

## 시험 (tests/ — 로컬 Postgres · 결과 out_*.txt)
| 시험 | 고치기 전 | 고친 뒤 |
|---|---|---|
| t_mat.sh 자재 입고: 판1 화면이 메모만 바꿈(남이 수량 바꾼 뒤) | RB_MAT_CHANGED 실패 | 저장 · 수량 12(남의 값) + 메모 b |
| 〃 같은 칸 다른 값(수량 15) | RB_MAT_CHANGED | RB_MAT_CHANGED '수량(지금 12)' (진짜 충돌만) |
| 〃 이미 같은 값 · prev 를 준 저장 | — | 성공 · 남의 칸 유지 |
| t_bomfm.sh BOM 정정: 같은 단가 + 사양 | '단가 칸을 그사이…' 실패 | 저장(사양 60ml) |
| 〃 같은 단가만(이미 들어감) | 실패 | 성공(already 1) |
| 〃 다른 단가 130 | 실패 | 실패(진짜 충돌) |
| t_fallback.sh 정정 안쪽 오류(0 나누기) | P0001 '…저장하지 않았습니다'(사용자에게) | 22012 → 서버 길 |
| 〃 진행상태 열 정보 없음 | '[진행상태] 열이 없습니다. 관리자에게'(사용자에게) | RB_FALLBACK → 서버 길 |
| t_client.js 화면 noteRpc: 22P02 · 23502 · 42703 | 영어 원문이 사용자에게 | 서버 길 / P0001 입력 오류는 그대로 보임 |
| t_idx.sh 끝난 일 6만 줄일 때 앞선 저장 검사 100번 | 913 ms | 8 ms |
| t_conc.sh 연결 8개 × 150번(진행 날짜 pg→pd · 진행상태 pd · 메모 · 자재) 같은 건 | — | 1200/1200 성공 · deadlock 0 · timeout 0 · rb_once 기록 1200(두 번 저장 0) |
- `node --check` 모든 work/*.js 통과 · 화면 ext.js → s0.js 통과 · 이름 중복 함수 새로 없음.

## 남은 것 · 위험
- rb_pd_busy 가 `_poPost` · `_odLines` 대기 일도 막아 1분 안 같은 건 저장이 할 일 길로 감(실패 아님 · 결정 필요).
- rb_item_do '…를 품목 DB 에서 찾지 못했습니다': 1분 작업으로 등록되는 새 코드(BOM 새 품목코드 등)는 사본이 늦어 바로 품목 정보 저장 시 실패 — 서버 길도 같은 SQL 이라 사용자에게 보임. 사본에 없으면 미처리 'it' 일 · bom 일의 reg 를 보고 줄을 만들거나 화면이 잠시 뒤 저절로 다시 하는 처리 필요(sf1/sf2 와 같이).
- rb_od_bulk_do 의 건마다 `exception when others` 는 교착 · 안쪽 오류도 그 건 '실패' 목록으로 보여 줌(나머지는 저장).
- BOM 줄 찾기에서 코드까지 바뀐 줄은 그대로 '그사이 바뀜'.
- 시트 사본 줄 찾기(칸 값 비교)는 탭 전체 훑기.
- 실제 Supabase 에는 안 돌려 봄(로컬만).
