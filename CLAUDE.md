# 이 저장소에서 작업할 때

## 발주 실행판 (Apps Script 웹앱) — 사용자가 "실행판 · 품목 정보 · BOM · 발주" 얘기를 하면 이것
- 웹앱 URL: https://script.google.com/a/meditherapy.co.kr/macros/s/AKfycbxDxIa0VfBSUfkBhfSVsLb4S2udMPkWFE8Viu1FpDcolSvL42bHTKwE2d3dnqAvnt_nWw/exec
  - 배포 ID: `AKfycbxDxIa0VfBSUfkBhfSVsLb4S2udMPkWFE8Viu1FpDcolSvL42bHTKwE2d3dnqAvnt_nWw`
- Apps Script 프로젝트 "발주 실행판" — Drive 파일 ID(= 스크립트 ID): `1FZuAuWlsQu8qX6UzH49pOiaNY90fICD3JhqjkLET6uvJCIkd6qBHDhIc`
- 원본은 저장소에 없다. 최신 원본은 Google Drive 커넥터로 받는다:
  `download_file_content(fileId=위 ID, exportMimeType="application/vnd.google-apps.script+json")` → `content` 를 base64 로 풀면 `{files:[{name,type,source}]}`.
- 주요 파일: `ItemInfo.gs`(품목 정보 창) · `Bom.gs` · `BomExtra.gs`(BOM 저장 · 1분 작업에 미루는 일 `bomLater_`) · `BomShim.gs`(Supabase 먼저 저장) · `Journal.gs`(1분 · 10분 트리거) · `PageHtml.html`(화면 전체).
- 무거운 일은 1분 작업으로 미루는 패턴(`bomLater_({k:...})` → `bomLaterDrainIn_`)을 따른다.

### 배포
- 사용자는 **배포까지 Claude 가 하기를 원한다.** 고친 뒤 설명만 하고 끝내지 말 것.
- 배포 순서: `clasp push` 로 코드를 올리고 `clasp deploy -i <배포 ID>` 로 같은 URL 에 새 버전을 낸다.
- 필요한 환경 설정(없으면 배포 불가 — 그때만 사용자에게 알린다):
  - 네트워크 허용 도메인: `script.googleapis.com`, `oauth2.googleapis.com`, `script.google.com`, `www.googleapis.com`
  - 환경 변수 `CLASPRC_JSON`: day@meditherapy.co.kr 계정으로 `clasp login` 한 뒤 생기는 `~/.clasprc.json` 내용
  - 설치: `npm i -g @google/clasp` 후 `printf '%s' "$CLASPRC_JSON" > ~/.clasprc.json`
- 배포가 막힌 경우: 고친 파일을 `apps-script/order-run/` 에 올리고 `changes.patch` 를 만든다.

## 자재 아카이브 (`index.html`)
- 별도 앱. GAS 백엔드 URL 은 `index.html` 안의 `GAS_URL`. 시트: "소싱 아카이브 DB".
