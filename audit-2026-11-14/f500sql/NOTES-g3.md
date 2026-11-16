# 묶음 3: 샘플 저장 — 대기열 → Supabase 에 바로 + 진짜 응답 (f497 안 · 배포 안 함)

**쉬운 한 줄 요약**: 샘플 진행 메모 · 완료/드롭 · 회신 받음 · 회차 상태 · 프로젝트 담당자/브랜드/코드 · 프로젝트 비고 · 요청 정보/견적 · 프로젝트 수정 · 회차 지우기를
누르면 이제 1분 뒤가 아니라 **그 자리에서 Supabase 에 저장**되고, 화면은 예전 서버와 **똑같은 응답**(견적 업체 순서 · 단가 항목 순서까지)을 받습니다.

기준 코드: `$S/cn497`(작업 중 cn494 → cn497 로 바뀜 — 3-way 로 다시 얹음, 충돌 0). 결과물 `work/` · `patch.diff`(cn497 대비 8파일).

## 무엇을 바꿨나
- **SQL `m105_sm_direct2.sql`** (Supabase.js 에 `SB_MIGRATIONS.push({ id: 'm105_sm_direct2' … })` — JSON.stringify, U+2028/2029/FEFF 없음 확인)
  - 입구 `rb_sm2_save(p_token text, p_fn text, p_argj text)` — p_argj = 화면 인자 **JSON 글자 그대로**(jsonb 는 열쇠 순서를 잃어 견적 `pu:`/`pf:` 항목 순서 · 120개 자르기가 달라짐).
  - p_fn: apiSampleDone · apiSampleLog · apiSampleWaitDone · apiSampleProjMemo · apiSampleProjInfo · apiSampleStatus · apiSampleProject · apiSampleProjEdit · apiSampleDeleteRow (각 `rb_sm2_<…>`).
  - 메모 JSON 은 `json`(순서 보존)으로 다루고 `rb_js`(JS JSON.stringify 와 같은 글자 — 정수 모양 열쇠 앞으로 · 겹친 열쇠/이상한 숫자는 RB_FALLBACK)로 씀.
    응답은 `{__j: '<JS 와 같은 JSON 글자>'}` → 화면이 JSON.parse(rb_once 가 jsonb 라 순서를 잃는 문제 피함).
  - 진행 기록(`_실행판_샘플진행`): pgConf.sample · 잠금 rb_tab_sp · 머리글 검사 · rb_pg_busy(앞선 할 일 · 진행 장부) · 마지막 줄 · 새 줄 = m083 과 같은 틀.
    뒤처리 = `pgx` + `_pgPost`(op kind **'set'**: 바뀐 열쇠 값 → 서버가 실제 progSetApply_ 로 다시 돌려 대조).
  - 샘플 탭(`_실행판_샘플`): rb_conf `sm2Conf`.on · smK · 잠금 rb_tab_sm · 샘플ID 로 줄 찾기(checkSampleRow_ 샘플ID 길 — 기억 행 먼저) · 시트 일 rb_tab_job `sm`(rb_sm_edit 모양 + who/at · 줄 지우기는 ops + h0) · 이력은 일의 audits(누른 사람 · 때).
  - **잠금 순서는 늘 sp → sm**(진행 메모 · 프로젝트 수정이 둘 다 잡음. 거꾸로 잡는 곳 없음).
  - 그 밖 뒤처리 rb_tab_job `sm2`: views(요청서 · 견적 보기 탭) · gwpq · daily · del(지운 회차 보관). pj 가 아니어서 rb_pg_busy 를 막지 않음.
  - 서버만: `rb_sm2_conf_put(p_conf)`(같은 잠금). 안쪽 함수는 모두 public/anon/authenticated 에서 revoke.
- **새 서버 `SmDirect2.js`(회사 전용)**: sm2Mig_ · sm2On_ · sm2ConfBuild_/sm2ConfPublish_(샘플 줄 고치기 켜짐 · rb.smdirty 없음 · 사본 있음 · rb.smDirect2≠0) ·
  sm2DrainIn_(끝 표시 먼저 · 보기 탭은 프로젝트마다 한 번 · **지금 사본 메모**로 · 실패는 되돌려 5번) · sm2DelRec_ · apiSm2Kick · sm2SelfTest_(→ rb.smDirect2Test=ok) · sm2Tick_.
- 공용 파일(모두 `typeof` 로 감쌈 — 개인용은 SmDirect2 없음 → sm2=0 → 예전 길):
  PgDirect.js pgOpJs_ 'set' · Journal.js journalDrainRun_ 에 sm2Tick_ · SampleShim.js sampleSbDirty_ 가 sm2Conf 바로 끔 · Notes.js 세션 `sm2` · PerfRun.js 상태 줄 '샘플 저장 직접 2(f497)'.
- **화면(PageHtml)**: `sm2Direct` — RB_DIRECT 9개 항목을 감쌈(세션 sm2 → noteRpc rb_sm2_save · RB_FALLBACK → 예전 길(old: pjDirect 등) · 연결/세션 → 서버 길 · 규칙 오류 → 그대로).
  진행 기록 쪽 · 프로젝트 수정 · 회차 지우기 뒤 `sm2Kick`(pgKick 틀 · apiSm2Kick). 샘플 추가/새 프로젝트의 '다시 열기'도 RB_DIRECT.apiSampleDone 으로.
  **apiSampleRemap · apiSampleViewsRebuild 는 RB_DIRECT 에서 뺌 → 서버 길(그 자리에서 · 진짜 응답)** — 관리자 작업이라 직접 SQL 대신.
  ext.js 로 뽑아 node --check 통과 · 이름 있는 함수 중복 없음.

## rb_once 허용 목록에 넣을 이름(공유 목록 — 직접 안 고침)
- SQL `rb_once` ok[] 에 **`rb_sm2_save`** · 화면 `RB_ONCE_FN` 정규식에 **`sm2_save`**. (안 넣어도 동작: 화면이 rb_sm2_save 를 바로 부름 — 다만 요청 번호 중복 막기는 넣은 뒤부터.)
- 새 conf 열쇠: `sm2Conf`. 새 rb_tab_job tab: `sm2`. 스크립트 속성: rb.smDirect2(끄기 0) · rb.smDirect2Test · rb.sm2Err.

## 시험(숫자)
- `TZ=Asia/Seoul RB_DB=g3db node harness.js work 600` (DB g3db = pg3 + m105): **실제 서버 함수**(apiSample* — 샘플 가상 저장 SampleShim 실제 · editProgress_ 실제 · writeAudits_ 실제)
  ↔ rb_sm2_save. 비교: 응답 글자(JSON.stringify 그대로) · 오류 문구 · 진행 기록 줄 11칸(JSON 칸 글자까지 · 최종수정 ms · 저장한 사람 · 새 줄 위치) · 샘플 사본 줄 · 시트 일(rows/ops/h0) · 이력 줄 · 뒤처리(보기 탭 · daily · gwpq · 보관 줄) · _pgPost 대조.
  **726 경우: 같음 673 · RB_FALLBACK 53(모두 사본 · 일 바뀐 것 없음 확인) · 다름 0** (`run_harness.txt`). 정해진 126 + 무작위 600(진행 메모 · 비고 · 정보 · 완료 · 상태 · 담당자).
- `lock_test.sh`(run_lock.txt): ① rb_tab_sm 3초 쥔 동안 상태 저장 → 2.5초 기다린 뒤 저장 ② rb_tab_sp 쥔 동안 진행 메모 → 기다린 뒤 ③ 직접 저장 뒤 서버 가상 저장 끝맺기(옛 줄 p_chk) → RB_ROW_TAKEN(덮지 않음) ④ 진행 기록도 RB_ROW_TAKEN ⑤ 끈 뒤 RB_FALLBACK.
- `clienttest.js` 8/8(화면 덮개: __j 순서 · RB_FALLBACK → 예전 길 · 연결 → 서버 길 · 규칙 오류 · 세션 없음 · 값 정리/탭 다시 만들기 서버 길). `drain_test.js` 9/9(뒤처리 · 켜짐).

## RB_FALLBACK(아무것도 안 바뀜 → 예전 할 일 길)
꺼짐(pgConf.sample / sm2Conf) · 앞선 저장(그 프로젝트 pj 할 일 · 진행 장부 · 샘플 탭 바꾸는 pj 할 일 · 값 정리/탭 다시 만들기 대기) · 옛 건ID(p:코드 · n:) · 샘플ID 없는 줄(시트 쪽이 필요할 때) ·
진행 기록 칸 JSON 깨짐/배열 · 메모 목록이 배열 아님 · 4바이트 글자(이모지 — UTF-16 자르기) · 겹친 JSON 열쇠 · 흔치 않은 숫자/값 모양 · 요청 정보 값이 객체 · 옛 열쇠 프로젝트 이름 바꾸기.

## 남은 위험 · 차이
- 실제 Supabase · GAS 로는 안 돌림(로컬만). RB_BUILD · CLAUDE.md · 개인용 반영 안 함(개인용은 SmDirect2 없음 — 세션 sm2 없어 예전 길 그대로; 공용 파일 변경은 typeof 로 감쌈).
- 회차 지우기 보관 줄 JSON 은 사본 칸 폭(smK.lc)까지 · 뒤 빈칸은 뺌(예전은 시트 끝 열까지 빈칸 포함) — 되살릴 때 값은 같음.
- 회차 지우기 직접 저장은 사본 줄 번호를 그 자리에서 당기고(실제 결과) 시트 일에 ops+h0(줄 순서 다르면 샘플ID 로 지움) — audW 의 '화면이 줄 번호를 미리 당김' 위험은 이제 사본과 같아짐.
- 요청서 · 견적 보기 탭은 뒤처리(sm2 — 1분 작업 또는 kick)라 몇 초 늦음(예전 대기열 길보다는 빠름).
- 진행 메모의 '시트 비고 · 전달예정일'은 샘플ID 로만 줄을 찾음(없으면 RB_FALLBACK).
