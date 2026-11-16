# 읽기 쪽 기능 대조 — 이관 전(@1072) ↔ 지금(@1250) (audR · 판 표시 f497)

**쉬운 한 줄 요약**: 화면이 Supabase 에서 바로 읽는 곳 7군데와 서버가 Supabase 사본을 읽는 곳을 이관 전 서버 함수와 같은 가짜 데이터로 돌려 비교했습니다. 서로 다르게 보이던 8가지(BOM 이름, 품목 목록 이름·브랜드, BOM 이력 시각, 링크 코드 띄어쓰기, 이슈 체크 칸, 일일보고 피드백 시각과 1000줄 넘는 이슈, 링크·품목 정보 1분 옛 캐시)를 고쳤습니다. 정렬 순서(오름/내림)는 모든 직접 읽기가 서버와 같았습니다.

## 방법
- `test/rd.js`: 실제 서버 코드(Code · Keys · Bom · BomLinks · Issues · Supabase · SupabaseAll · Migrate.js)를 vm 으로 띄우고 가짜 시트(BOM3 · BOM변경이력 · 품목 · 품목링크 · 이슈)를 줌. 같은 시트를 실제 `sbSyncBom_`(sbVal_ · SB_BOM_MAP) · `sbSyncTab_`(sbCell_) 규칙으로 bom_rows · bom_log · sheet_rows 로 바꾸고, PostgREST 흉내(eq · in · gt · order · limit/offset · max-rows 1000)로 화면 함수(PageHtml 에서 그대로 뽑은 sbGet · sbGetAll · sbBomAll · sbTabRows · sbKst · sbIssAll · sbLinksOf · bvSbRow · bvSbLogRow · bvSbLoad · sbItemsLoad · bvRowsSame)를 돌려 서버 함수(apiBomGet0_ · apiBomAllRows · apiBomCodes · apiItems · issAll_+issPub_ · bomLinksOf_)와 비교.
  - 실행: `cd test && TZ=Asia/Seoul node rd.js <서버 폴더> <s0.js>`
  - 결과: 고치기 전(cn494) **23/37 같음** → 고친 뒤(work) **30/37 같음**. 남은 7개는 아래 '남은 차이(데이터 모양)' — 칸 순서 · 사본 숫자 칸 모양 차이(bvRowsSame 은 같다고 봄, 아래 1개 빼고).
- `test/fb.js`: apiDailyFbSync(실제 Daily.js · Issues.js) — 사본에 이슈 1203줄 · 피드백 시각 ISO/글자 섞음.
  - 고치기 전: `I1 at = "2026-11-02T02:00:00.000Z"`, 1000줄 뒤 `I1100` 없음 → 고친 뒤: `"2026-11-02 11:00"`, `I1100` 있음.
- 정렬: 서버 · 화면 `.sort(` 를 v1072 ↔ cn494 로 모두 대조 — 없어진 정렬은 품의서 지급 계획(f357 새 규칙으로 바뀜 · 의도) 하나뿐. 직접 읽기는 모두 시트 행 순서(row · sheet_row)로 받아 서버 순서와 같음(harness '품목 순서' · 'BOM 전체 품목 순서' · 이슈 · 링크 순서 같음). BOM 이력은 최근 것부터 50줄 같음.

## 고친 것 (이관 전 동작 / 지금 동작 / 고친 뒤)
1. **BOM 보기 이름** — PageHtml `bvSbLoad`(s0 16352 부근)
   - 이관 전: 서버 apiBomGet 의 이름 = 제품 줄(구분 '제품' · 코드=제품코드) 품목명, 없으면 '제품명' 칸(bomIdxAdd_).
   - 지금: Supabase 첫 줄의 제품명 칸(`product_name`) — 첫 줄이 자재면 BOM 목록 · 서버와 다른 이름. 서버 값이 와도 줄이 같으면 이름은 안 바꿔 그대로 남음. 세트는 '세트'처럼 짧은 이름.
   - 고친 뒤: 서버와 같은 규칙(제품 줄 품목명 → 제품명 칸) · `brand` 도(빈 브랜드는 코드 첫 글자 짐작 — bomBrandOf_). 시험: M0001AA1 '진짜 제품 이름' · M0003AA1 '세트 이름' 같음.
2. **품목 목록(새 발주 검색 · 품목코드 칸)의 BOM 에만 있는 품목** — `sbItemsLoad`
   - 이관 전: 이름 = 제품 줄 품목명 → 없으면 제품명 칸, 브랜드가 비면 코드 첫 글자로(H 히디프 · M 메디테라피).
   - 지금: 제품 줄이 없으면 이름 = 코드, 브랜드 빈칸(서버 apiItems 가 3~6초 뒤 덮을 때까지 · 서버 응답 실패면 계속).
   - 고친 뒤: product_name 도 받아 같은 규칙 · 브랜드 짐작. 시험: H0002AA1 '히디프 크림/히디프', M0004AA1 브랜드 '메디테라피' 같음.
3. **BOM 변경 이력 시각** — `bvSbLogRow`
   - 이관 전: 시트 날짜 칸만 'yy/MM/dd HH:mm'(서울), 글자로 적힌 시각은 그대로.
   - 지금: 무엇이든 `new Date()` 로 풀어 브라우저 시간대로 다시 씀(글자 시각 '2026-11-04 10:00' → '26/11/04 10:00', 해외 PC 면 시각이 밀림).
   - 고친 뒤: ISO(시트 날짜 · 직접 저장 nowiso)만 서울 시각으로, 나머지는 그대로. bvDirectOut(직접 저장 응답)도 같은 함수라 같이 맞음.
4. **품목 링크 코드 비교** — `sbLinksOf`
   - 이관 전: itemCodeKey_(대문자 + 모든 공백 뺌).
   - 지금: 앞뒤 공백만 뺌 → 'M 0001AA2' 처럼 가운데 띄어쓰기 있는 줄은 '다른 버전' 링크에서 빠지고 code 도 다르게 보임.
   - 고친 뒤: 같은 규칙. 시험 '링크 M0001AA3 · M 0001AA2' 같음.
5. **이슈 직접 읽기의 체크(true/false) 칸** — `sbIssAll`: 이관 전 str_ 는 빈칸, 지금 'true'/'false' 글자 → 빈칸으로.
6. **BOM 직접 읽기 줄 순서 고정** — `sbBomAll` · `sbItemsLoad` · `bvSbLoad`(구성 BOM 포함) `order=sheet_row` → `order=sheet_row,id`(이력 `sheet_row.desc,id.desc`). 서버 BomShim 은 이미 `sheet_row.asc,id.asc`. 같은 행 번호 줄이 생기면 1000줄씩 나눠 받을 때 줄이 빠지거나 두 번 받을 수 있었음.
7. **일일보고 피드백 맞추기(15초마다)** — Daily.js `apiDailyFbSync`
   - 이관 전(v1072): issAllCached_ → 피드백 시각 'yyyy-MM-dd HH:mm'.
   - 지금(f351 뒤): 사본 `cells[11]` 그대로 → 시트가 날짜로 둔 줄은 'ISO(…Z)' 글자가 확인 칸에 찍힘 · `limit=1000` 이라 이슈가 1000줄 넘으면 뒤 이슈는 답에서 빠짐.
   - 고친 뒤: ISO 만 서울 'yyyy-MM-dd HH:mm' · `sbGetAllRaw_`(1000줄씩 · row 순, 없는 판은 예전 한 번 읽기).
8. **직접 저장한 링크 · 품목 정보를 서버가 1분 동안 옛 캐시로 읽음**
   - 이관 전: 링크 추가/지우기 · 품목 정보 저장이 그 자리에서 캐시(blink:v1 6시간 · iilist:v1 6시간)를 버림.
   - 지금: 화면 직접 저장(rb_link_save · rb_item_save)은 시트 · 캐시를 1분 작업이 맞출 때까지 그대로 → 그 사이 BOM 보기(apiBomGet 이 받아 온 links 로 화면 링크를 덮음) · 단계 '포장물 사양서'(apiItemLinks) · 품목 정보 창(apiItemDbList)이 옛 값. (이슈 · 품질 · 품목 목록은 f485 에서 이미 고침 — 링크 · 품목 정보 창만 빠져 있었음)
   - 고친 뒤: BomLinks.js `bomLinksAll_` — 안 옮긴 lk 일이 있으면 캐시 버리고 옮긴 뒤 읽음(잠금을 쥔 채면 `tabJobDrainIn_('lk')`, 아니면 issJobDrain_). Keys.js `itemPendFlush_()`(apiItems 의 f485 코드를 함수로) → ItemInfo.js `apiItemDbList` 도 부름. 개인용은 `typeof` 로 그냥 넘어감.

## 바꾼 파일
- PageHtml.html(bvSbLogRow · sbItemsLoad · sbBomAll · sbIssAll · sbLinksOf · bvSbLoad) · Daily.js · BomLinks.js · Keys.js(새 함수 `itemPendFlush_`) · ItemInfo.js. SQL 없음(m130~ 안 씀). 공유 목록(rb_once · rb_pj_do · RB_ONCE_FN) 안 건드림.
- 검사: 모든 .js `node --check` · ext.js 로 뽑은 s0.js `node --check` 통과 · 새 이름 있는 화면 함수 중복 없음 · U+2028/2029/FEFF 없음.
- 개인용: PageHtml 고친 곳은 모두 Supabase 직접 읽기 블록(개인용엔 없을 수 있음 — 없으면 건너뛰면 됨). Daily/BomLinks/Keys/ItemInfo 고침은 typeof 로 감싸 개인용에서도 그대로 동작.

## 남은 차이 — 고치지 않음(업무 · 데이터 판단 필요)
1. **bom_rows 숫자 칸(MOQ · 소요량 · 단가 · 임가공 · 배송비 · 소요원가 · 환율)에 글자가 있으면 사본에서 사라짐**(sbVal_: 숫자가 아니면 null). 예: MOQ '1만', 소요량 '반개' → 직접 읽기 · BOM 직접 저장 모두 빈칸. 원가반영 칸이 체크박스(true)면 사본엔 없음(서버 str_ 도 빈칸으로 보므로 판정은 같음). 이런 줄이 있으면 BOM 을 열 때 bvRowsSame 이 달라 "그사이 다른 사람이 이 BOM을 바꿨습니다"가 잘못 뜸. BOM 이 Supabase 먼저 저장이라 표 모양(숫자 열)을 바꾸거나 시트 값을 숫자로 정리하는 결정 필요. 실제 BOM 탭에 숫자 칸 글자가 있는지 먼저 세어 볼 것.
2. BOM 사양 등 글자 칸에 시트 날짜가 있으면 서버 'yy/MM/dd' · 사본 'yyyy-MM-dd'(같은 이유로 '바뀜' 판정). 품목 DB 사양 칸 날짜는 서버가 'Mon Feb 02 …' 글자 · 사본 ISO(둘 다 이상 — 원래 버그).
3. 같은 줄ID 가 두 줄이면 서버는 둘 다 그 ID, 사본은 뒷줄을 'R행-ID' → 화면 id ''(10분 작업이 ID 를 다시 붙이므로 잠깐).
4. 업체명 등 글자 칸 앞뒤 공백: 서버는 시트 그대로(' 가업체 '), 사본은 잘라 냄(화면 표시만 다름).
5. Bom.js 1544 `bom_rows?...&limit=20000` — Supabase 는 1000줄까지라 BOM 이 1000줄 넘으면 늘 시트 전체 읽기로(맞게 돌아가지만 느림). 성능 일이라 안 바꿈.
6. (쓰기 쪽, 참고) TabShim/SampleShim 의 `getFormulas` 가 늘 '' — 발주 DB 가상 저장 중 apiBulkOrderDate 의 '수식 칸은 건드리지 않는다' 검사가 흉내 시트에서는 안 걸림.
7. 직접 저장 응답을 화면이 서버 모양으로 만드는 곳(RB_DIRECT — apiDailyHide · 샘플 notes 등)은 표본만 봄(같음). 전부 대조는 저장 쪽 작업자 harness 몫.
