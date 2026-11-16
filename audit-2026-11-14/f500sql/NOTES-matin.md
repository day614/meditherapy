# BOM 자재 입고(발주 상세 [▸ BOM 자재 입고]) — 2026-11-16 · 배포 안 함

**쉬운 한 줄**: 발주 상세의 체크 목록 아래(AP 업데이트 위)에 [▸ BOM 자재 입고]를 만들었습니다. 이 발주 차수 BOM 자재마다 입고일 · 수량을 여러 번 나눠 적고 고치고 지울 수 있습니다. 사급 자재는 사급 발주에 자동으로 연결돼 그 발주의 입고 · 예정만 보입니다(골라 바꾸기 가능). AP 칸에는 수량 요약만 보이고 AP 금액은 그대로입니다.

기준: `$S/cn498base`(= 작업 시작 때 복사한 cn498). `patch.diff = diff -ruN $S/cn498base work`. SQL 이주 id: **m140_mat_inb** 하나(m141 · m142 안 씀).

## 바꾼 파일
| 파일 | 내용 |
|---|---|
| `m140_mat_inb.sql` + `Supabase.js` 끝 `SB_MIGRATIONS.push({ id: 'm140_mat_inb' … })` (JSON.stringify · 특수 글자 없음 · 문자열 = 파일 그대로 확인) | 표 · RLS · 함수 |
| `MatInb.js` **(새 파일 · 회사 + 개인용 공통)** | `apiMatInbGet(oid)` · `apiMatInbSave(op, args)` — 회사판이 켜져 있으면(`matDbOn_`) Supabase, 아니면 숨김 탭 `_실행판_자재입고` · `_실행판_자재연결` 에 바로(같은 규칙 · 같은 문구) |
| `MatInbDb.js` **(새 파일 · 회사만)** | `matDbOn_` · `matDbRpc_` · `matDbGet_/Save_`(rb_mat_get_srv/save_srv) · `matDbSelfTest_`(자체 시험 → 잠금 안에서 시트 → Supabase 옮기기 → 켬, rb.matDb=ok) · `matDbDrainIn_`(rb_tab_job 'mi' 있으면 두 탭을 Supabase 값 전체로 다시 씀 · rb.matSync) · `matDbTick_` |
| `Notes.js` apiNoteSession | 세션에 `mi`(matDbOn_) |
| `Journal.js` journalDrainRun_ | sm2Tick_ 다음에 `matDbTick_()`(typeof 감쌈) · jdm('matDbTick_') |
| `PageHtml.html` | 화면(아래) · CSS(.mibox · .mitab · .milines · .michip · .lnmat) · verApply 'mi' · applyRowLock 예외(data-mitoggle · data-miopen · data-mireload) |

**개인용 반영**: `MatInb.js` 는 개인용에도 넣는다. `MatInbDb.js` · Notes/Journal 줄은 넣지 않아도 됨(typeof 로만 부름). 개인용은 세션 `mi` 가 없어 화면이 늘 서버 길(숨김 탭).

## SQL(m140) — 새 이름(rb_once · RB_ONCE_FN 은 안 고침 → 통합 때 넣어 주세요)
- 표: `rb_mat_inb`(id 화면이 만든 줄ID PK · oid 발주 실행판ID · code · d date · qty numeric>0 · memo · by_email · at · upd_by · upd_at · ver) · `rb_mat_link`(oid, code PK → link: 사급 발주ID 또는 '-'=연결 안 함) · `rb_mat_log`(바꾼 기록 앞/뒤).
  RLS 켬 · anon 막음 · **authenticated 는 rb_mat_inb · rb_mat_link 읽기만**(SB_TOK 직접 읽기 가능 — 화면은 지금 세션 RPC 로 읽음) · rb_mat_log 는 서버만.
- `rb_mat_do(email, op, args)` 본체(revoke) — op = add · set · del · link. 잠금 `pg_advisory_xact_lock(hashtext('rb_mat:'||oid))`. 검사: 발주ID · 줄ID `^[A-Za-z0-9_-]{6,64}$` · 자재코드(공백 빼고 대문자) · 입고일 yyyy-mm-dd 실제 날짜 2000~2100 · 수량 >0 · 소수 4자리 · 10억 이하 · 쉼표 허용 · 메모 300자.
  - add: 같은 줄ID·같은 값 = 그대로 성공(`again` — 응답만 잃은 재전송), 다른 값 = 오류. 연결된 자재(link ≠ '' · '-')면 `RB_MAT_LINKED`.
  - set/del: `ver`(화면이 본 판) 다르면 `RB_MAT_CHANGED 그사이 X님이…`(단 같은 값 set 은 `same` 성공 · 이미 지운 del 은 `again` 성공 → 재전송 안전). 없는 줄 set = `RB_MAT_GONE`.
  - link: '' = 연결 지움(자동으로) · '-' = 연결 안 함 · ID = 연결. 그 자재에 여기서 적은 입고가 있으면 `RB_MAT_HAS_LINES`(두 번 세기 막기) · 자기 발주 막음.
  - 바뀌면 rb_mat_log · `rb_tab_job('mi', {oid, op, code, who, at})` · **rb_ver 'mi'** 올림(selftest 계정 제외). 결과 = `rb_mat_state(oid)` {oid, lines[], links{code:{link,by,at}}, db:1} + op/id/again/same.
- 화면: **`rb_mat_save(p_token, p_op, p_args)`**(세션 · editor · rb_conf 'miConf'.on=1 아니면 RB_FALLBACK · `gate:rb_mat_save` 면 RB_FALLBACK) · **`rb_mat_get(p_token, p_oid)`**(읽기 — rb_once 대상 아님).
- 서버만(service_role): `rb_mat_save_srv(p_email, p_op, p_args)` · `rb_mat_get_srv(p_oid)` · `rb_mat_import(p_rows, p_links, p_on)`(이미 있는 것 그대로 · 잘못된 줄 수 bad · p_on 이면 miConf 켬).
- **통합 때**: rb_once 허용 목록(SQL ok[])과 화면 `RB_ONCE_FN` 에 `rb_mat_save`(→ 정규식에 `mat_save`) 를 넣어 주세요. 인자 이름 p_token · p_op · p_args 그대로라 noteRpc 가 `p_body={p_op,p_args}` 로 보내면 맞습니다. 넣기 전에도 저장은 줄ID 로 재전송이 안전(위 again/same).

## 화면(PageHtml)
- `matInbBlock(row)` 를 renderRunInner 의 `(wantEdit ? matInbBlock(row) + linesBlock(row) : "")` 로 — 진행 단계 체크 목록 · 날짜 줄 아래, AP 업데이트(lnbox) 위. 펼침 상태는 브라우저 기억(rb.miOpen).
- 자재 = `miMats(row)`: BV_ALL(없으면 BV_ALL_SNAP 로 보이고 bomAllEnsure) · `poBomPrice` 와 같은 차수 규칙(bvPlan · bvGroupsOf · 발주 차수 > 최대면 최종 차수) · 자기 제품 줄(스케일 줄 포함) · 코드 없는/X 줄 빼고 · **같은 코드는 소요량 합침**. 필요 = 발주수량 × 소요량(빈 소요량 = 1). 품목명은 BOM name → ITEMDB → 발주 목록.
- 칸: 자재코드 · 품목명(업체) · 구분 · 매입(턴키/사급) · 필요 · 입고 합계 · 남음(넘으면 '+n 초과') · [+ 입고]. 아래에 입고 줄(입고일 · 수량 · 메모 · 적은 사람 · [고치기][✕]) — 더하기/고치기는 줄 안 입력(Enter = 저장).
- 사급 연결(`miLinkOf`): 저장된 연결 > (사급이고 여기서 적은 줄이 없으면) 자동 = `miCands` 첫째(같은 코드 · 취소/pending 빼고 · 진행 중 먼저 · 차수 거리 · 같으면 ID 큰 것). select 로 자동/후보/연결 안 함 고르기 → `link` 저장. 연결되면 보기 전용: 연결 발주 지급 줄(apiGetLines · LN_CACHE 먼저)의 입고 · 예정 칩 + [그 발주 열기](openRun). 입고 합계 = 연결 발주 입고 줄 수량.
- 저장 `miSave` → `miRun`: 세션 `mi` 면 noteRpc rb_mat_save, RB_FALLBACK · 세션 · 연결 문제면 서버 apiMatInbSave, 규칙 오류는 그대로 보임. '저장 중…' 동안 단추 막음 → 응답(그 건 지금 값)으로 다시 그리고 '저장됨 HH:MM'. CHANGED/GONE 이면 다시 읽고 문구는 남김. 입력 중 값은 다시 그려도 남음(miGrab).
- AP 칸: lnhead 아래 `<div id="lnmat">` = `miApHtml(row)` "BOM 자재 입고 (수량만 · AP 금액과 무관) — 코드 입고/필요 …". **AP 금액(lnInner sum · diff) · apFromLines_ · 지급 줄 저장은 전혀 안 건드림.**
- 다른 사람 저장: verApply 에 `chM = v.mi !== lv0.mi && verWho(v.mi) !== DATA.me` → 열린 건만 miLoad(force). (서버 apiVer 길엔 'mi' 가 없음 — Supabase rb_ver 읽기일 때만.)
- 잠긴 건(종결 · 취소)·권한 없음: 보기만(펼침 · 그 발주 열기 · 다시 불러오기는 됨).

## 시험(숫자)
- SQL `test_m140.sql`(DB `matin` = pg3 + m140, 두 번 적용해도 됨): **67/67** (`run_sql.txt`) — 꺼짐 RB_FALLBACK · 옮기기(잘못된 줄 bad · 다시 옮기기 0) · 세션 없음/끝남/권한 없음 · 더하기 · 재전송 · 같은 ID 다른 값 · 잘못된 값 13가지(하나도 안 들어감) · 고치기/판 충돌/재전송/없는 줄/다른 건 · 지우기/재전송 · 연결(입고 있으면 막음 · 자기 · 바꾸기 · 같은 값 · '-' · 지움) · 연결된 자재 입고 막음 · 기록 순서 · gate · 서버 길 · 시트 일 수(바뀐 것만 11) · anon(표 · srv · import · 본체 막힘, 세션 저장 됨) · authenticated(읽기만) · service_role.
- 시트 길 ↔ SQL 같은 순서 35가지 **35/35 같음**(`parity.js` — 결과 줄 · 판 · 사람 · 연결 · 오류 문구) (`run_parity.txt`).
- 잠금 `lock_test.sh`: 같은 건 저장은 잠금 2.5초 기다린 뒤 들어감 · 다른 건 0.03초 (`run_lock.txt`).
- 화면 Playwright 목업(`mat.js` + `mat_mock.js` — google.script.run 가짜 서버 길): **30/30 · 화면 오류 0** (`run_ui.txt`) — 칸 위치(AP 위) · 2차 자재만 · 소요량 합침 · 소수 소요량 · 사급 자동 연결(진행 중 · 차수 가까운 S2 · 종결 S1 · 취소 S3 빼고) 보기 전용 · 연결 발주 입고/예정 · 부분 입고 2번 · 저장 중 막힘 · 저장됨 · 잘못된 수량 문구 + 입력 남음 · 고치기 · 그사이 남이 고침 → 알림 + 다시 읽음 · 지우기 · 연결 바꾸기(S1) · 연결 안 함 → [+ 입고] · AP 금액 문구 · 지급 줄 금액 그대로 · apiSaveLines 안 부름 · AP 칸 수량 요약 · [그 발주 열기] · BOM 없는 품목 · rb_ver 'mi' 로 남의 저장 반영 · 종결 건 잠금.
- 스크린샷(deviceScaleFactor 1): `shot1_closed.png`(접힘) · `shot2_open.png`(펼침 + AP 칸) · `shot4_addform.png`(입고 줄 입력) · `shot3_sagup.png`(사급 발주 상세 — BOM 없음).
- node --check: 모든 .js · 화면 s0.js 통과 · 새 화면 함수 이름 겹침 없음(겹침 목록은 cn498 과 같음 — 익명 function 3개).

## 남은 위험 · 통합 때 볼 것
- 실제 Supabase · GAS 로는 안 돌려 봄. 켜지는 순서: m140 이주 → 1분 작업 matDbSelfTest_ → rb.matDb=ok → 세션 mi=1. 그 전에는 회사판도 시트 길(같은 규칙)로 동작.
- 옮기기 중 시트 줄이 잘못된 모양(손으로 고친 숨김 탭)이면 켜지 않고 rb.matDb 에 '못 옮김' — 그 줄을 고친 뒤 4분 뒤 다시. (그사이 시트에서 지운 줄은 Supabase 에 남을 수 있음 — 드묾.)
- 시트 사본은 rb_tab_job 'mi' 있을 때 두 탭 전체를 다시 씀(줄이 많아지면 칸 맞추기로 바꿀 것 — 지금 규모엔 단순 · 안전).
- 사급 연결 후보는 화면 목록(DATA.rows — 숨김/필터와 무관하게 받은 행)에서만 고름. 연결한 발주가 목록에 없으면 경고 문구.
- 연결 발주의 지급 줄은 패널을 열 때 한 번 읽음(그 발주를 바꾸면 [다시 불러오기]).
- 화면은 읽기도 세션 RPC(rb_mat_get) — SB_TOK 직접 표 읽기로 바꾸려면 RLS 는 이미 열려 있음.
- PerfRun 상태 줄(rb.matDb · rb.matSync · rb.matJobErr)은 안 넣음 — 원하면 추가.
