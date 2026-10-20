/**
 * ============================================================
 * 지급 줄 (_실행판_지급) — AP 를 계산 없이 만드는 원본
 * ------------------------------------------------------------
 * 한 줄 = 돈이 오가는 한 건(선금 · 입고 실적 · 입고 예정). 건 정보(품목 · 업체 · 단가 · 품의번호 …)는
 * 발주 DB(발주현황)에 한 번만 있고, 여기는 실행판ID 로 이어진다.
 * AP 탭 = 지급 줄 + 건 정보를 이어 붙인 것(A~R 은 예전 형식 그대로, S~ 에 실행판ID · 종류 · 줄ID).
 *
 * 1단계(지금): 지금 AP 계산 결과로 지급 줄을 만들고, 지급 줄 → AP 가 지금 AP 와 같은지 본다(?diag=lines, 쓰지 않음).
 * ============================================================
 */

var RB_LINE = {
  TAB: '_실행판_지급',
  // 채널: 비어 있으면 발주 건의 채널. 입고 · 예정 수량을 다른 채널에 나눠 줄 때만 적는다(AP D열 · 채널별 매입예산).
  HEAD: ['실행판ID', '줄ID', '종류', '입고일', '수량', '금액', '지급월', '메모', '만든곳', '수정시각', '채널'],
  AP_EXTRA: ['실행판ID', '종류', '줄ID']        // AP 탭 S열부터
};
/** AP K열 표시: 지급 줄의 실행판ID 가 발주 DB 에 없는 줄(예외 · 빨간 행) */
var RB_LINE_ORPHAN = '발주 DB 에 없음';

/** 건 정보: 실행판ID → AP 에 쓰는 값들(예전 AP 계산과 같은 규칙) */
function orderAttrsForAp_(ss) {
  var H = RB_AP.helpers;
  // 발주 DB 머리글은 1행이다(예전 발주현황처럼 [지급점검] 으로 찾지 않는다 — H.headerRow 는 지급점검 머리글을 찾는다)
  var sh = statusSheet_();
  var C = sheetCols_(sh);
  var hr = C.hr;
  var data = sh.getRange(1, 1, Math.max(hr, sh.getLastRow()), C.lc).getValues();
  var head = data[hr - 1];
  var idx = {};
  head.forEach(function (h, i) { var t = String(h).trim(); if (t && !(t in idx)) idx[t] = i; });
  var g = function (name) { return (name in idx) ? idx[name] : -1; };
  var c = { id: g('실행판ID'), state: g('진행상태'), doc: g('품의번호'), cat: g('구분'), ord: g('발주일'), brand: g('브랜드'),
            ch: g('채널'), code: g('품목코드'), name: g('품목명'), vendor: g('업체명'), price: g('단가'),
            team: g('발주요청팀'), req: g('요청팀담당자'), rep: g('소진완료목표일') };
  var plan = H.planLookup(ss);
  var tz = Session.getScriptTimeZone();
  var out = {};
  for (var i = hr; i < data.length; i++) {
    var r = data[i];
    var id = c.id >= 0 ? str_(r[c.id]) : '';
    if (!id) continue;
    var v = function (k) { return c[k] >= 0 ? r[c[k]] : ''; };
    var ordP = H.toDateSafe(v('ord'));
    var info = (plan.__byRbId && plan.__byRbId[id]) || {};      // 실행판ID 로만(품의번호로 찾으면 같은 품의의 다른 건 값이 들어왔다)
    if (!H.isEmpty(v('team')) || !H.isEmpty(v('req')) || !H.isEmpty(v('rep'))) info = { vendor: v('team'), requester: v('req'), report: v('rep') };
    out[id] = {
      excluded: c.state >= 0 && H.excluded(r, c.state),
      A: ordP ? Utilities.formatDate(ordP, tz, 'yyyy-MM-dd') : v('ord'),
      C: H.resolveBrand(v('brand')), D: v('ch'), E: (/부자재|부재료/.test(String(v('cat')))) ? '부자재' : '제품',
      F: v('vendor'), G: v('code'), H: v('name'), J: H.clean(v('price')), O: v('doc'),
      P: info.vendor === undefined ? '' : info.vendor, Q: info.requester === undefined ? '' : info.requester, R: info.report === undefined ? '' : info.report,
      kolmar: String(v('vendor')).indexOf('한국콜마') > -1
    };
  }
  return out;
}

/** 지급 줄 + 건 정보 → AP 행(A~R) + [실행판ID, 종류, 줄ID]. 승인 전 · 취소 건은 뺀다. 발주 DB 에 없는 건의 줄은 예외 행으로. */
function apFromLines_(lines, attrs) {
  var H = RB_AP.helpers;
  var rows = [], bad = [];
  lines.forEach(function (L) {
    var o = attrs[L.id];
    if (o && o.excluded) return;                    // 승인 전 · 취소 건은 AP 에 넣지 않는다
    if (!o) {
      // 발주 DB 에 없는 건(실행판ID 를 지웠거나 바꿈)의 줄 — 말없이 빼지 않고 '지급월 없음'처럼 맨 아래 빨간 행으로(금액 · 지급월은 비워 합계에 안 들어감)
      bad.push(['', L.date, '', str_(L.ch), '', '', '', '금액 ' + (L.amt === '' ? '-' : L.amt) + ' · 지급월 ' + (L.payYm || '-'), L.qty, '',
        RB_LINE_ORPHAN, '', '', '', '', '', '', '', L.id, L.kind, L.lineId]);
      return;
    }
    var noPay = L.kind === '지급월 없음';
    var m = /^(\d{2})-(\d{2})$/.exec(String(L.payYm || ''));
    var payDate = (!noPay && m) ? H.payDate(2000 + Number(m[1]), Number(m[2]), o.kolmar) : '';
    var row = [o.A, L.date, o.C, str_(L.ch) || o.D, o.E, o.F, o.G, o.H, L.qty, o.J,
      noPay ? '지급월 매칭 안됨' : H.month(L.date), noPay ? '' : L.amt, payDate, noPay ? '' : L.payYm,
      o.O, o.P, o.Q, o.R, L.id, L.kind, L.lineId];
    (noPay ? bad : rows).push(row);
  });
  rows.sort(function (a, b) { var x = String(a[0]), y = String(b[0]); return x < y ? -1 : (x > y ? 1 : 0); });
  return rows.concat(bad);
}

