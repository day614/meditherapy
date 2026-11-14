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
