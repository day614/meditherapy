# 이 저장소에서 작업할 때

## 발주 실행판 (Apps Script 웹앱) — 사용자가 "실행판 · 품목 정보 · BOM · 발주" 얘기를 하면 이것
- 웹앱 URL: https://script.google.com/a/meditherapy.co.kr/macros/s/AKfycbxDxIa0VfBSUfkBhfSVsLb4S2udMPkWFE8Viu1FpDcolSvL42bHTKwE2d3dnqAvnt_nWw/exec
  - 배포 ID: `AKfycbxDxIa0VfBSUfkBhfSVsLb4S2udMPkWFE8Viu1FpDcolSvL42bHTKwE2d3dnqAvnt_nWw`
- Apps Script 프로젝트 "발주 실행판" — Drive 파일 ID(= 스크립트 ID): `1FZuAuWlsQu8qX6UzH49pOiaNY90fICD3JhqjkLET6uvJCIkd6qBHDhIc`
- 원본은 저장소에 없다. 최신 원본은 Google Drive 커넥터로 받는다:
  `download_file_content(fileId=위 ID, exportMimeType="application/vnd.google-apps.script+json")` → `content` 를 base64 로 풀면 `{files:[{name,type,source}]}`.
- 주요 파일: `ItemInfo.gs`(품목 정보 창) · `Bom.gs` · `BomExtra.gs`(BOM 저장 · 1분 작업에 미루는 일 `bomLater_`) · `BomShim.gs`(Supabase 먼저 저장) · `Journal.gs`(1분 · 10분 트리거) · `PageHtml.html`(화면 전체).
- 무거운 일은 1분 작업으로 미루는 패턴(`bomLater_({k:...})` → `bomLaterDrainIn_`)을 따른다.

### 배포 — 고치면 Claude 가 끝까지 배포한다(설명 · 붙여넣기 안내로 끝내지 말 것)
몇 달째 이 방식으로 배포해 왔다. 사용자에게 다시 설명을 요구하지 말 것.
1. clasp 설치(스크래치 폴더): `mkdir -p $S/clasp && cd $S/clasp && npm init -y && npm i @google/clasp`
   - script.googleapis.com · oauth2.googleapis.com 은 열려 있다(script.google.com 만 막힘 — 웹앱 화면 확인은 못 함).
2. 로그인(세션마다 한 번 — 컨테이너가 바뀌면 사라짐): FIFO 로 `clasp login --no-localhost` 를 띄우고
   나온 주소를 사용자에게 준다 → 사용자가 붙여 준 `http://localhost:8888/?...code=...` 주소 전체를 FIFO 에 넣는다.
   ```
   mkfifo in.fifo; (tail -f in.fifo | node_modules/.bin/clasp login --no-localhost > out.log 2>&1 &)
   # out.log 의 주소를 사용자에게 → 받은 주소: echo '<주소>' > in.fifo
   ```
3. 작업 폴더: `.clasp.json` = `{"scriptId":"1FZuAuWlsQu8qX6UzH49pOiaNY90fICD3JhqjkLET6uvJCIkd6qBHDhIc","rootDir":"."}` → `clasp pull`
   (파일은 `.js` · `PageHtml.html` · `appsscript.json`). 고치기 전에 pull 한 것을 기준으로 한다.
4. `Code.js` 의 `RB_BUILD`(예: `'2026-11-10f288'`)를 다음 번호로 올린다 — 열린 화면에 새 버전 안내가 뜬다.
5. `node --check` 로 고친 .js 검사 → `clasp push -f` → `clasp create-version "<판> <설명>"` →
   `clasp list-versions | tail -1` 로 번호 확인(쉼표가 붙어 나온다: 1,049) →
   `clasp update-deployment AKfycbxDxIa0VfBSUfkBhfSVsLb4S2udMPkWFE8Viu1FpDcolSvL42bHTKwE2d3dnqAvnt_nWw -V <번호> -d "<설명>"`
6. `clasp list-deployments` 로 `@<번호>` 확인. 결과를 시트(Drive 커넥터)로 확인할 수 있으면 확인한다.

## 자재 아카이브 (`index.html`)
- 별도 앱. GAS 백엔드 URL 은 `index.html` 안의 `GAS_URL`. 시트: "소싱 아카이브 DB".
