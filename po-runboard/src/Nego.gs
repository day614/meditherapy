/**
 * 네고 실적(2026-10-21 · 예전 '구매팀 네고실적' 시트 네고 탭을 실행판에서 자동으로)
 *  · 화면이 BOM 차수별 원가(원가 체크 줄 소요원가 합)와 발주 DB 로 계산한다 — 차수가 바뀔 때 원가가 준(는) 만큼 × 연간 발주량 = 절감액.
 *  · 연간 발주량은 기본 = 지난 12개월 발주수량(화면에서 계산). 품목마다 직접 넣은 값이 있으면 그것(이 파일이 보관).
 *  · 스크립트 속성 rb.negoqty = { 품목코드: 수량 }
 */
var RB_NEGO_QTY = 'rb.negoqty';

function negoQtyRead_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(RB_NEGO_QTY) || '{}') || {}; } catch (e) { return {}; }
}

/** 화면: 품목별 직접 넣은 연간 발주량 */
function apiNegoQty() { return negoQtyRead_(); }

/** 화면: 연간 발주량 직접 넣기 · 지우기(qty 빈칸 = 자동으로 돌아감) */
function apiNegoQtySet(code, qty) {
  requireEditor_();
  code = itemCodeKey_(code);
  if (!code) throw new Error('품목코드가 없습니다.');
  var q = String(qty == null ? '' : qty).replace(/,/g, '').trim();
  if (q !== '' && !(Number(q) >= 0)) throw new Error('연간 발주량은 숫자로 넣어 주세요.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('잠시 뒤 다시 해 주세요.');
  try {
    var o = negoQtyRead_();
    if (q === '') delete o[code]; else o[code] = Number(q);
    PropertiesService.getScriptProperties().setProperty(RB_NEGO_QTY, JSON.stringify(o));
    writeAudit_(RB.T_CONFIG, 1, 1, '네고 실적 연간 발주량 ' + code, '', q === '' ? '(자동)' : q);
    return o;
  } finally { lock.releaseLock(); }
}
