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

/*
 * 정정(같은 차수 덮어쓰기)으로 바꾼 단가도 네고 실적에(2026-10-22).
 * 신제품 1차 BOM 단가를 첫 발주 전에 네고로 낮추는 것처럼 차수가 안 바뀐 단가 변경은 차수 비교로는 안 잡혔다.
 * BOM변경이력 탭의 '정정'(유효) 중 '단가 A → 단가 B' 인 줄을 화면에 준다. 오타 정정과 섞이므로 줄마다 '네고로 집계'를 고른다
 * (기본: 사유에 네고 · 인하 · 절감 · 할인 · 인상 · 변경이 있으면 집계). 고른 값은 스크립트 속성 rb.negopick = { 변경ID: 1 | 0 }.
 */
var RB_NEGO_PICK = 'rb.negopick';
function negoPickRead_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(RB_NEGO_PICK) || '{}') || {}; } catch (e) { return {}; } }
function negoFixLog_() {
  var sh = bomSS_().getSheetByName(RB_BOM_LOG);
  if (!sh || sh.getLastRow() < 2) return [];
  var n = sh.getLastRow() - 1, kinds = sh.getRange(2, 6, n, 1).getValues(), idx = [];
  kinds.forEach(function (r, i) { if (str_(r[0]) === '정정') idx.push(i); });
  if (!idx.length) return [];
  var lo = idx[0], hi = idx[idx.length - 1], v = sh.getRange(lo + 2, 1, hi - lo + 1, 15).getValues(), out = [];
  var unitOf = function (s) { var m = str_(s).match(/단가 (-?[\d,.]+)/); return m ? num_(m[1].replace(/,/g, '')) : null; };
  idx.forEach(function (i) {
    var r = v[i - lo];
    if (str_(r[13]) && str_(r[13]) !== '유효') return;
    var a = unitOf(r[9]), b = unitOf(r[10]);
    if (a === null || b === null || a === b || !(a > 0) || !(b > 0)) return;      // 단가를 비우거나 0 으로 = 네고가 아니라 구성 정리
    out.push({ id: str_(r[14]), at: r[0] instanceof Date ? Utilities.formatDate(r[0], Session.getScriptTimeZone(), 'yyyyMMdd') : '', who: str_(r[1]).split('@')[0],
      product: str_(r[2]).toUpperCase(), round: str_(r[4]), type: str_(r[6]), code: str_(r[8] || r[7]).toUpperCase(), a: a, b: b, why: str_(r[11]) });
  });
  return out;
}
/** 화면: 네고 실적 자료 한 번에 — 직접 넣은 연간 발주량 · 정정 단가 변경 · 집계 고른 값 */
function apiNegoData() {
  var fixes = [];
  try { fixes = negoFixLog_(); } catch (e) { fixes = []; }
  return { qty: negoQtyRead_(), pick: negoPickRead_(), fixes: fixes };
}
/** 화면: 정정 단가 변경을 네고로 집계할지(on: true · false) */
function apiNegoPick(id, on) {
  requireEditor_();
  id = str_(id);
  if (!id) throw new Error('변경ID 가 없습니다.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('잠시 뒤 다시 해 주세요.');
  try {
    var o = negoPickRead_();
    o[id] = on ? 1 : 0;
    PropertiesService.getScriptProperties().setProperty(RB_NEGO_PICK, JSON.stringify(o));
    return o;
  } finally { lock.releaseLock(); }
}
