# 발주 실행판 (Apps Script) — 2026-11-10 수정본

These are the changed files from the Apps Script project "발주 실행판", taken from the version saved on 2026-11-10 at 05:34 UTC.
Paste each file over the same-named file in the Apps Script editor, then go to **배포 → 배포 관리 → 새 버전** to publish it.
If the script was edited after that time, apply `changes.patch` by hand instead of replacing whole files.

| 파일 | 바뀐 것 |
|---|---|
| `ItemInfo.gs` | 품목 정보 창 저장(`apiItemDbSave`) — 같은 코드 BOM 줄 맞추기(`bomNameSync_`, BOM 탭·품목 DB를 두 번씩 읽음)를 1분 작업으로 미룸 → 저장 응답이 빨라짐 |
| `BomExtra.gs` | 1분 작업(`bomLaterDrainIn_`)에 `nsync` 일 추가 — 미룬 코드들을 한 번에 맞춤, 실패하면 다음 1분에 다시 |
| `Bom.gs` | 신제품 BOM 다시 저장 시 "그사이 BOM이 생겼습니다" — 시트에 있는 줄이 보내는 줄과 같으면(앞 저장이 이미 들어감) 막지 않고 저장된 BOM을 돌려줌 (`bomNewSame_`) |
| `PageHtml.html` | ① 위 경우 안내 문구 ② 저장으로 받은 새 코드가 1분 동안 "품목코드 생성 필요"·[등록]으로 보이던 것 → 3분간 등록된 것으로 표시 ③ 정정·구성 표에서 추천 코드 입력칸이 품목명 칸을 덮던 것 ④ "새 코드(추천) · 저장 때 등록" 문구 ⑤ 품목 정보 저장 뒤 BOM 다시 받기 |
