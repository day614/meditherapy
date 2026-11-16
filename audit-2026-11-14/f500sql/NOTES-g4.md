# 묶음 4 — 일일보고 · BOM 설정 저장을 "그 자리에서 Supabase + 진짜 응답"으로 (f497 안 · 배포 안 함)

**쉬운 한 줄**: 일일보고 [저장] · 병목/이슈 · 보고 제외 · 저장 풀기, 그리고 BOM 의 반제품 차수 고르기 · 자재 구분 추가 · 세트 구성 빼기가
1분 대기열(가짜 '저장됨')이 아니라 누르는 순간 Supabase 에 저장되고 진짜 결과(저장 시각 · 이미 저장 · 잠긴 날짜 오류 등)가 돌아옵니다. 시트는 몇 초 안에 뒤에서 맞춥니다.

## 기준
- **cn497 기준**(work/ = cn497 + 이 작업 · patch.diff = `diff -ruN cn497 work`). cn497 의 apiDailySaveRep 화면 고침(지난 날짜 바로 오류 · 다음 날은 서버 길)은 직접이 안 될 때의 예전 길(oldR)로 그대로 두고, 직접 길에서는 SQL 이 같은 검사(지난 날짜 · 다음 보고 날짜 · 이미 저장)를 같은 문구로 한다. Daily.js 의 cn497 고침(apiDailyFbSync 1000줄 · 시각)은 3-way 로 합침. 시험은 모두 cn497 원본으로 다시 돌림.

## 한 것
| api | 예전 | 이제 | SQL 함수 |
|---|---|---|---|
| apiDailySaveRep | 할 일 대기열(가짜 응답) · 40만 자 넘으면 서버 | `rb_dly_save` 직접 · 진짜 savedAt/savedBy · '이미 저장' · 지난/앞 날짜 · 크기 검사 | rb_dly_save → rb_dly_do |
| apiDailyIssues | 대기열 · 잠긴 날짜면 서버 길 | 직접(잠긴 날짜도 SQL 이 같은 문구로) | 〃 |
| apiDailyHide | 대기열 | 직접 · 진짜 목록(40자 · 8500자 앞에서 지움) | 〃 |
| apiDailyUnlock | 서버 길(f485 — 대기열로는 다시 읽은 보고서가 잠긴 채라) | 직접(관리자 = 설정 admin.emails + 배포자) · 서버가 일일보고를 읽기 전에 남은 일을 먼저 옮기므로 f485 문제 없음 | 〃 |
| apiSemiPin | 대기열 | 직접 · 응답 = 그 품목 BOM 줄 · 이력 + 고른 차수 | rb_bom_cfset → rb_bom_semipin_do |
| apiBomAddType | 대기열 | 직접 · 진짜 구분표 | rb_bom_cfset → rb_bom_addtype_do |
| apiBomSetCompOff | 대기열 | 직접 · 응답 = BOM 줄 + 뺀 자재 | rb_bom_cfset → rb_bom_compoff_do |
| apiHfSet(대기열 쪽) | rb_bom_hfset 이 안 될 때 대기열 | 서버 길(진짜 결과) | (기존 rb_bom_hfset 그대로) |

### 일일보고 — 원본을 Supabase 로
- 새 표 `rb_daily`(날짜 · 시트 줄 번호 pos · 저장 시각 · 저장자 · 특이사항 · 보고서 있음 · 직접 저장한 보고서 글 rep/rep_w · seq) · `rb_dly_hide`(보고 제외 = 예전 속성 rb.dlyhide.*). RLS 켬 · anon/authenticated 권한 없음.
- 보고서는 화면이 **JSON 글**로 보낸다(jsonb 는 열쇠 차례를 바꿈) — 시트에 쓰는 글 = 예전 서버 JSON.stringify 와 같음(시험에서 숫자 열쇠 차례까지 같음).
- 시트 맞추기: `rb_tab_job tab='dly' {d, kind}` → `cfDailyDrainIn_`(CfDirect.js) 가 그 날짜 줄을 **지금 rb_daily 값**으로(차례 바뀌어도 시트 = 원본) · 머리 캐시 dly:head · 속성 rb.dlyhide · 뒤처리(변경이력 · daily:dirty · 미리 계산본 · 저장 풀기 기준 시각 rb.dlykeep — 시트 칸을 비우기 전에 옛 보고서를 읽음).
- **서버 쪽 읽기도 원본과 같게(f351 교훈)**: `dailyTab_()` · `dailyHideGet_()` 가 실행마다 한 번 남은 dly 일을 먼저 옮긴다(`cfDailyEnsure_` — 예전 3초 캐시는 시험에서 놓쳐서 실행마다 한 번으로).
- **저장 길 하나**: 켜져 있으면 서버 api(gas 길 · 할 일 대기열에 남은 옛 일 · dailyReportCore_ [저장] · [덮어쓰기])도 `rb_dly_srv` / `rb_dly_write_srv`(같은 잠금 rb_dly · '이미 저장' 다시 확인 · 보고서 저장은 특이사항을 안 덮음).
- 켜기(`cfDailyConfPublish_`, 1분 작업): 꺼진 상태에서 잠금 안 → 남은 일 옮김 → 시트 → `rb_dly_seed`(첫 줄 · 보고 제외 속성) → `rb_dly_conf_put` on(+admins) → 상태 rb.cfDailyState=on. 끄기 rb.cfDaily=0: SQL off(같은 잠금) → 남은 일 옮김 → off(서버 길은 시트로). 다시 켜면 다시 채움.
- RB_FALLBACK(아무것도 안 들어감 → 화면은 예전 길 pjDirect): 꺼짐 · 처음 채우기 전 · **할 일 대기열에 일일보고 저장(apiDaily*)이 남음(차례)** · 흔치 않은 모양(이슈 칸이 객체 · 4바이트 글자 · 보고서에 issues/author/weekMode).

### BOM 설정
- 원본은 그대로 속성(rb.semipin · bom:types · bom:setx). 함수는 사본 `rb_conf bomConf`(semipins · types · **setx 새로 올림**)를 그 자리에서 고치고 `rb_tab_job tab='bom'`(cfSemiPin · cfTypeAdd · cfSetx + BOM변경이력 줄) → `bomDbDrainIn_` 가 **같은 바꾸기를 속성에 다시**(덮어쓰기 아님 — 그사이 서버 길로 고친 다른 칸 유지 · 시험함).
- 사본 덮어쓰기 막기: `bomConfPublish_` → `rb_bom_conf_put`(같은 잠금 rb_bom · 아직 안 옮긴 직접 저장이 있으면 hf · semipins · types · setx 칸은 사본 값 유지). 서버 길 apiBomAddType · apiBomSetCompOff 뒤에 바로 bomConfPublish_(true) · 세 서버 길은 남은 bom 일을 먼저 옮김(차례).
- 켜짐 · 겹침은 기존 BOM 직접과 같음(rb_bom_guard — bomGate · 시트 앞섬 · 서버 BOM 가상 저장 중 RB_FALLBACK) · 같은 op 두 번이면 처음 결과.

## 바꾼 파일 (work/ · patch.diff)
- 새 `CfDirect.js`(회사만): cfRpc_ · cfDailySrv_/cfDailyWrite_ · cfDailyEnsure_ · cfDailyDrainIn_ · cfDailySeed_ · cfDailyConfPublish_ · apiCfKick · cfDirectTick_ · cfDirectSelfTest_(가짜 토큰 → rb_once 가 rb_dly_save · rb_bom_cfset 에 닿고 RB_SESSION · 안쪽 함수 공개 키 불가 → rb.cfDirectTest=ok).
- Daily.js(모두 `typeof` 로 감쌈 — 개인용은 CfDirect 없음 → 예전 그대로): dailyTab_ · dailyHideGet_ 먼저 맞추기 · dailyWrite_ · apiDailySaveRep/Issues/Hide/Unlock 켜졌을 때 SQL.
- Bom.js: 세 서버 길 앞에 bomDbDrainIn_ · 뒤에 bomConfPublish_(true). BomDb.js: 맞추기 ⑯ cfSemiPin · cfTypeAdd · cfSetx · bomConfPublish_ 가 setx 를 올리고 rb_bom_conf_put 사용(m116 뒤).
- Notes.js 세션 `cf` · Journal.js 1분 작업 cfDirectTick_ · Supabase.js m115 · m116(build.sh 가 SQL 파일로 다시 넣음 · U+2028/2029/FEFF 0개).
- PageHtml: `cfDirect` · `cfKick` · `cfBomDirect` 와 RB_DIRECT apiDailyHide · apiDailyIssues · apiDailySaveRep · apiDailyUnlock · apiSemiPin · apiBomAddType · apiBomSetCompOff · apiHfSet(대기열 쪽 → 서버 길).

## 통합 담당에게(공유 목록 — 내가 다시 만들지 않음)
- **rb_once 허용 목록(ok[])에 `rb_dly_save`, `rb_bom_cfset` 추가** + 화면 `RB_ONCE_FN` 에 `dly_save` · `bom_cfset`(예: `bom_(cfset|ckset|…)` · `dly_save`). 안 넣으면 자체 시험이 'RB_FALLBACK 모르는 저장'으로 실패 → 세션 cf=0 → 예전 길(안전).
- 새 SQL 함수: rb_cf_trim · rb_cf_str · rb_cf_astral · rb_cf_num · rb_cf_ntxt · rb_cf_bomout · rb_cf_bomlog · rb_cf_bomjob · rb_dly_today · rb_dly_okdate · rb_dly_vok · rb_dly_ready · rb_dly_do · rb_dly_save · rb_dly_srv · rb_dly_write_srv · rb_dly_seed · rb_dly_conf_put · rb_bom_semipin_do · rb_bom_addtype_do · rb_bom_compoff_do · rb_bom_cfset · rb_bom_conf_put. 표: rb_daily · rb_dly_hide.
- rb_pj_do 는 그대로(옛 대기열 일 처리용).
- 시험 DB 전용: once_test.sql(로컬 rb_once 에 두 이름) · test_setup.sql(pg3 의 bom_rows/bom_log 가 껍데기라 실제 칸 모양으로).

## 시험 (로컬 Postgres 16 · DB g4db = pg3 + test_setup + m115 + m116 + once_test)
- `TZ=Asia/Seoul RB_DB=g4db node harness_daily.js ../cn497 work` — 원본 cn497 Daily.js(가짜 시트 · 속성 · 캐시) ↔ ① 화면 직접(rb_once → rb_dly_save → 시트 맞추기) ↔ ② 고친 서버 길(rb_dly_srv): 결과 · 오류 문구 · 시트 12칸 · 보고 제외 속성 · rb.dlykeep · dly:head · 이력 · 미리 계산본. **51/51 같음(둘 다)** (results_daily.md · run_daily.txt). 상태 5가지(오늘 없음/특이사항만/저장함/내일까지/날짜 칸이 Date) × 날짜(어제 · 오늘 · 내일 · 모레 · 빈칸 · 틀림) · 보고서 모양(v6 · v '8' · asOf 없음 · null · 빼는 열쇠 · 36만 자 넘음/경계) · 이슈(8칸 · 빈 줄 · null 줄 · 600자 · 숫자 · true · 60줄 · NBSP/전각/BOM 공백) · 보고 제외(중복 · 40자 · 8500자 자르기 · on=1) · 저장 풀기(관리자 · 대소문자 · 뒤 보고서 겹침 · 없음).
- `harness_daily2.js` **23/23**: 저장 7개를 쌓고 맞추기 한 번 = 원본에서 차례로 한 결과(시트 · 속성 · 이력) · 보고서 글 비움 · 보기 세션 · 대기열 앞선 저장 RB_FALLBACK(서버 길은 통과) · 꺼짐 · 객체 칸 · 권한(anon 은 rb_dly_save 만) · 서버 [저장] 겹침 막음 · 서버 보고서 저장이 직접 특이사항 유지 · **서버 읽기 전 맞추기(일일보고 탭 · 보고 제외)** · 끄기 → 남은 일 옮김 · 다시 켜기 → 다시 채움.
- `harness_bom.js` — 원본 cn497 Bom.js(apiSemiPin0_ · apiBomAddType · apiBomSetCompOff) ↔ rb_once → rb_bom_cfset + 실제 bomDbDrainIn_: 결과 · 오류 문구 · 속성 3개 · BOM변경이력 줄(시트 줄 = bom_log 사본) · rb_conf 사본 = 속성. **31/31** (results_bom.md).
- `harness_bom2.js` **11/11**: 보기 세션 · 서버 BOM 저장 중 · 직접 꺼짐 · setx 사본 없음 · 쓰인 코드 오래됨 → RB_FALLBACK · 같은 op 한 번 · conf_put 이 남은 일 칸 유지 · 맞추기가 그사이 서버 길 변경을 안 지움 · 권한.
- `ui_test.js`(Playwright · 실제 work/PageHtml · google.script.run 가짜 · Supabase 주소를 로컬 Postgres 로) **9/9 · 페이지 오류 0** (ui_result.txt): gsr → RB_DIRECT → noteRpc → rb_once → 함수, 서버 길 안 감 · apiCfKick 부름 · 규칙 오류 문구 그대로 · 대기열 앞선 저장이면 예전 길(rb_pj_add).
- m115 · m116 을 pg3 새 사본에 **두 번** 적용 통과(다시 돌려도 됨). 모든 .js node --check · 화면 ext.js node --check · 이름 있는 함수 중복 0.

## 응답이 예전과 다른 점(일부러 · 화면 영향 없음)
- 구분 추가 결과 구분표의 열쇠 차례(jsonb) — 화면 bvTypesSet 은 새 열쇠만 뒤에 붙여 차이 없음. '약호가 이미 X 에 쓰고 있음' · '이미 자재코드에 쓰였습니다(…3개)' 예시 차례가 서버와 다를 수 있음(문구 · 막힘은 같음).
- 저장 풀기 '관리자' 판정은 1분마다 올리는 목록(설정 admin.emails + 배포자) — 설정을 바꾼 직후 1분은 옛 목록(그동안 아니면 서버 길과 같은 문구로 막힘).

## 안 한 것 · 남은 위험
- **설정 저장(apiSetChoices · apiSetSampleChoices · apiSaveSteps · apiSaveLinks)**: 원본이 시트 '설정' 탭(readConfig_)이고 거의 모든 서버 함수가 읽는다(metaFast_ 캐시 · 관리자 판정 · 단계 정의 dateSlots_). Supabase 에 설정 탭 사본은 없음. rb_conf 를 원본으로 하려면 readConfig_ 에 일일보고와 같은 '읽기 전 맞추기'를 넣어야 하는데 호출이 매우 잦고, 단계 정의는 진행 기록 직접 저장(pgConf)과 엮여 있다(apiSaveSteps → pgConfPublish_). 이번엔 안 옮김 — 관리자만 가끔 쓰는 저장이라 서버 길로 돌리는 편(대기열 대신)을 권함. 하려면: rb_conf 'cfg' 를 원본 + readConfig_ 실행마다 한 번 맞추기 + 단계 저장은 pgConf 를 같은 트랜잭션에서.
- **apiSaveNotice**(속성 rb.notice · 자동 저장): f369 메모대로 다른 화면 읽기가 옛 글로 되돌릴 수 있어 그대로.
- **apiWriteSheet**(발주일만 apiBulkOrderDate 대기열) · **apiBomReviewRegAll · apiBomReviewFix 대기열 쪽**: 이번 범위 밖으로 둠(발주 DB · 품목 DB 등록 — 각각 pd/it 묶음과 함께 옮겨야 함).
- **apiWriteStatus**: 비고(memo)는 이미 rb_od_edit 직접, 다른 칸은 서버 길(진짜 응답) — 그대로. **apiBomPriceSpread**: 화면 bvPriceSpreadRun 이 품목마다 Supabase 줄을 읽어 apiBomFixMany 직접(rb_bom_fixmany)을 부르고 못 읽은 품목만 서버 한 번(확인함 · 손대지 않음).
- 실제 Supabase · GAS 로 돌려 보지 않음. RB_BUILD · CLAUDE.md · 개인용 반영 안 함(개인용은 CfDirect 없음 → 모든 새 부름이 typeof 로 꺼져 예전 그대로 · 화면은 세션 cf 가 없어 예전 길).
- 일일보고 시트를 사람이 직접 고치면(켜진 동안) rb_daily 는 모른다 — 끄고 켜면 다시 채움(rb.cfDaily=0 → 지움).
- 같은 날짜를 두 사람이 몇 ms 차이로 [저장]: 잠금 rb_dly 로 한 사람만 되고 다른 사람은 '이미 저장(…)했습니다'(예전 대기열은 둘 다 '저장됨'을 보였다).
