# 이 저장소에서 작업할 때

## 발주 실행판 (Apps Script 웹앱) — 사용자가 "실행판 · 품목 정보 · BOM · 발주" 얘기를 하면 이것
- 웹앱 URL: https://script.google.com/a/meditherapy.co.kr/macros/s/AKfycbxDxIa0VfBSUfkBhfSVsLb4S2udMPkWFE8Viu1FpDcolSvL42bHTKwE2d3dnqAvnt_nWw/exec
  - 배포 ID: `AKfycbxDxIa0VfBSUfkBhfSVsLb4S2udMPkWFE8Viu1FpDcolSvL42bHTKwE2d3dnqAvnt_nWw`
- Apps Script 프로젝트 "발주 실행판" — Drive 파일 ID(= 스크립트 ID): `1FZuAuWlsQu8qX6UzH49pOiaNY90fICD3JhqjkLET6uvJCIkd6qBHDhIc`
- 원본은 저장소에 없다. 최신 원본은 Google Drive 커넥터로 받는다:
  `download_file_content(fileId=위 ID, exportMimeType="application/vnd.google-apps.script+json")` → `content` 를 base64 로 풀면 `{files:[{name,type,source}]}`.
- 주요 파일: `ItemInfo.gs`(품목 정보 창) · `Bom.gs` · `BomExtra.gs`(BOM 저장 · 1분 작업에 미루는 일 `bomLater_`) · `BomShim.gs`(Supabase 먼저 저장) · `Journal.gs`(1분 · 10분 트리거) · `PageHtml.html`(화면 전체).
- 내 메모장(f309): 서버 `Notes.js`(숨김 탭 `_실행판_메모장` · 계정마다 한 줄 · 판 번호로 충돌 확인) · 화면은 PageHtml 끝의 `NOTE`/`note*` 함수(블록 편집).
- 무거운 일은 1분 작업으로 미루는 패턴(`bomLater_({k:...})` → `bomLaterDrainIn_`)을 따른다.

### 배포 — 고치면 Claude 가 끝까지 배포한다(설명 · 붙여넣기 안내로 끝내지 말 것)
몇 달째 이 방식으로 배포해 왔다. 사용자에게 다시 설명을 요구하지 말 것.
1. clasp 설치(스크래치 폴더): `mkdir -p $S/clasp && cd $S/clasp && npm init -y && npm i @google/clasp`
   - script.googleapis.com · oauth2.googleapis.com 은 열려 있다(script.google.com 만 막힘 — 웹앱 화면 확인은 못 함).
2. 로그인(세션마다 — 컨테이너가 바뀌면 사라짐). **`tools/clasp-login2.mjs` 를 쓴다**(대기 프로세스 없이 2단계 — 예전 FIFO 방식은 프로세스가 꺼져 사용자가 두 번 로그인했다):
   - 회사(default): 처음엔 `clasp login --no-localhost` 한 번이 필요(clasprc 에 client_id/secret 생김). 그 뒤 계정은 아래로.
   - `node tools/clasp-login2.mjs start <user>` → 주소를 사용자에게 → 받은 `http://localhost:8888/?state=...` 를
     `node tools/clasp-login2.mjs finish <user> '<주소>'` (state 가 start 때와 같은지 확인).
   - 회사 = `default`(day@meditherapy.co.kr), 개인용 = `personal`(rjfwndrjf@gmail.com). 둘 다 필요하면 **한 번에 두 주소를 같이** 준다.
3. 작업 폴더: `.clasp.json` = `{"scriptId":"1FZuAuWlsQu8qX6UzH49pOiaNY90fICD3JhqjkLET6uvJCIkd6qBHDhIc","rootDir":"."}` → `clasp pull`
   (파일은 `.js` · `PageHtml.html` · `appsscript.json`). 고치기 전에 pull 한 것을 기준으로 한다.
4. `Code.js` 의 `RB_BUILD`(예: `'2026-11-10f288'`)를 다음 번호로 올린다 — 열린 화면에 새 버전 안내가 뜬다.
5. `node --check` 로 고친 .js 검사 → `clasp push -f` → `clasp create-version "<판> <설명>"` →
   `clasp list-versions | tail -1` 로 번호 확인(쉼표가 붙어 나온다: 1,049) →
   `clasp update-deployment AKfycbxDxIa0VfBSUfkBhfSVsLb4S2udMPkWFE8Viu1FpDcolSvL42bHTKwE2d3dnqAvnt_nWw -V <번호> -d "<설명>"`
   - **버전 한도 200개**: `create-version` 이 "limit of 200 versions" 로 실패하면 API 로는 못 지운다 — 사용자에게 편집기 → 프로젝트 기록(시계 아이콘)에서 오래된 버전 삭제를 부탁한다(배포 중인 번호는 남김). 지운 뒤 반영까지 30초쯤 걸리니 몇 번 다시 시도.
6. `clasp list-deployments` 로 `@<번호>` 확인. 결과를 시트(Drive 커넥터)로 확인할 수 있으면 확인한다.

### 개인용(빈 시트판) — 회사판을 고치면 개인용에도 같이 반영 · 배포한다(묻지 말 것)
- 스크립트 ID `1Wn8a5OdWSQLAB8EYzOHkkMmzG4gXTXwZm1QC1yP1s8BW4fCs9mbcX8_j` · 배포 ID `AKfycbx8DuktVoqi_Dgx-aztSo9cix_ciXXAok0grG_au9qlRmoeZ8j82dC0spN38_PzC7CUEw` · clasp 는 `-u personal`.
- 회사판 축소판: `BLANK_SETUP: true` · 시트 ID = 활성 시트(`RB_ACTIVE_ID`) · Setup.js/Custom.js/ShimOff.js 만 있음 · Supabase · 슬랙 · GWP · 재고 · Share · Archive · Audit 없음.
- `Notify.js`(슬랙 알림)는 회사용만 — 개인용에 넣지 않는다(다른 파일은 `typeof` 로 있을 때만 부름).
- 판 번호는 회사판 번호 + `p`(예: 회사 `f288` → 개인 `f288p`).
- 반영: 개인용을 pull → 바꾼 파일마다 `git merge-file -p <개인 파일> <회사 고치기 전> <회사 고친 뒤>`(3-way). 충돌은 개인용 쪽(Supabase 등 없음)으로 푼다.
- 올리기 전: `node --check` · 회사 ID 검사 `grep -rln "1pmCAw1qqxUOlQGtYJhq672ieg1w0cGJMC\|1krXu_Vf7WahKKgIW6oVK4cDVbpcRX04lTo885\|meditherapy-gwp\|hooks.slack" .` 가 비어야 함.

## 자재 아카이브 (`index.html`)
- 별도 앱. GAS 백엔드 URL 은 `index.html` 안의 `GAS_URL`. 시트: "소싱 아카이브 DB".
