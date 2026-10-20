/**
 * 분석(관리자만) — 적시 공급률 · 업체 성적표에 쓸 건별 원자료.
 * 계산(기간 · 기준 목표일 · 허용 일수)은 화면에서 한다. 여기서는 관리자 확인 뒤 재료만 모아 준다.
 *
 * 건마다:
 *  · due   = 지금 입고목표일, due0 = 처음 입고목표일(변경이력에서 입고목표를 처음 바꾸기 전 값, 바꾼 적 없으면 '')
 *  · ins   = 입고 [날짜, 수량] (지급 줄 '입고' 줄. 지급 줄이 없는 예전 건은 발주현황 제품입고일 · 회차 수량)
 *  · dueChg = 입고목표 변경 횟수, etaChg = 입고예정 변경 횟수(변경이력 '입고일정')
 */
function apiSupplyStats() {
  var cfg = readConfig_();
  if (!isAdmin_(cfg)) throw new Error('관리자만 볼 수 있습니다.');
  var t0 = Date.now();
  var rows = cacheGet_(rowsCacheKey_('po', cfg)) || readOrderRows_(cfg);

  var iso = function (v) {
    var d = toDate_(v);
    return d ? d.getFullYear() + '-' + pad2_(d.getMonth() + 1) + '-' + pad2_(d.getDate()) : '';
  };

  // 지급 줄의 입고 줄
  var ins = {};
  readLinesAll_().rows.forEach(function (r) {
    var L = rowToLine_(r);
    if (L.kind !== '입고') return;
    var d = iso(L.date);
    if (!d) return;
    (ins[L.id] = ins[L.id] || []).push([d, Number(L.qty) || 0]);
  });

  // 변경이력: 입고목표 · 입고예정 변경. 예전 기록은 실행판ID 가 비어 있어 [품의번호 + 품목코드 + 차수]로 찾는다.
  // 변경이력 탭 전체를 읽어야 해서 무겁다 — 모은 결과(건ID → 횟수)를 10분 캐시에 둔다(분석용이라 10분 늦어도 된다).
  var hist = cacheGet_(RB_STATS_HIST_CK);
  if (!hist) { hist = supplyHist_(rows, iso); cachePut_(RB_STATS_HIST_CK, hist, 600); }
  return supplyOut_(rows, ins, hist, iso, t0);
}

var RB_STATS_HIST_CK = 'stats:hist:v2';

/**
 * 입고예정 글자('2026-10-20, 2026-10-28' · '10/20' · '26.10.20(일부)' …) → 가장 늦은 날짜 'yyyy-MM-dd'.
 * 연도가 없는 'M/D' 는 기준 시각(ref, 변경한 때)에 가까운 해로 본다.
 */
function etaLastIso_(v, ref) {
  var best = '';
  splitArrived_(String(v == null ? '' : v)).forEach(function (t) {
    var raw = String(t).replace(/\([^)]*\)/g, '').replace(/\s/g, '');
    var d = toDate_(raw), iso = '';
    if (d) iso = d.getFullYear() + '-' + pad2_(d.getMonth() + 1) + '-' + pad2_(d.getDate());
    else {
      var m = raw.match(/^(\d{1,2})[.\/-](\d{1,2})$/);
      if (m) {
        var r = ref instanceof Date ? ref : new Date(), y = r.getFullYear(), mo = Number(m[1]);
        if (mo - (r.getMonth() + 1) > 6) y--; else if ((r.getMonth() + 1) - mo > 6) y++;
        iso = y + '-' + pad2_(mo) + '-' + pad2_(Number(m[2]));
      }
    }
    if (iso > best) best = iso;
  });
  return best;
}

/**
 * 변경이력 → { 건ID: { due0, dueChg, etaChg, log } }
 * log = 입고예정 바꾼 기록(오래된 순) [시각 'yyyy-MM-dd', 이전 예정(가장 늦은 날짜), 새 예정, 사유, 첫 등록 1/0]
 *   첫 등록 = 예정 줄이 없던 건에 처음 예정을 넣은 것(이전 값은 등록 때 입고목표로 채운 칸) — 분석에서 '변경'으로 세지 않는다.
 */
function supplyHist_(rows, iso) {
  var hist = {};
  // 실행판ID 가 없는 예전 기록만 [품의번호 + 품목코드]로 찾는다 — 같은 품의 · 코드가 여럿이면 어느 건인지 몰라 버린다
  var kDc = {};
  rows.forEach(function (r) {
    var dc = norm_(r.doc) + '|' + norm_(r.code);
    kDc[dc] = kDc[dc] === undefined ? r.id : null;
  });
  var idOf = function (r) {
    var id = str_(r[4]);
    if (id) return id;
    var dc = norm_(r[5]) + '|' + norm_(r[6]);
    if (dc === '|') return '';
    return kDc[dc] || '';
  };
  var sh = sheet_(RB.T_AUDIT);
  if (sh && sh.getLastRow() >= 2 && String(sh.getRange(1, 4).getValue()) === '종류') {
    sh.getRange(2, 1, sh.getLastRow() - 1, 12).getValues().forEach(function (r) {
      var kind = str_(r[3]), item = str_(r[8]);
      if (kind !== '입고일정' && !/입고목표/.test(item)) return;
      var id = idOf(r);
      if (!id) return;
      var h;
      if (/입고목표/.test(item) && kind !== '입고일정') {
        h = hist[id] = hist[id] || { due0: '', dueChg: 0, etaChg: 0 };
        h.dueChg++;
        if (!h.due0 && str_(r[9])) h.due0 = iso(r[9]);            // 위에서부터 쌓이므로 처음 만난 값 = 가장 이른 변경
      } else if (kind === '입고일정') {
        if (str_(r[9]).replace(/\s/g, '') === str_(r[10]).replace(/\s/g, '')) return;   // 띄어쓰기만 바뀐 건 변경 아님
        h = hist[id] = hist[id] || { due0: '', dueChg: 0, etaChg: 0 };
        h.etaChg++;
        var at = r[0] instanceof Date ? r[0] : toDate_(r[0]);
        (h.log = h.log || []).push([at ? iso(at) : '', etaLastIso_(r[9], at), etaLastIso_(r[10], at), str_(r[11]).slice(0, 120), item === '입고예정' ? 1 : 0]);
      }
    });
  }
  return hist;
}

/** 화면에 줄 건별 원자료 */
function supplyOut_(rows, ins, hist, iso, t0) {
  var out = [];
  rows.forEach(function (r) {
    if (r.src && r.src !== '현황') return;                         // 발주현황에 올라간 건만(계획만 있는 건 제외)
    var h = hist[r.id] || {};
    var list = ins[r.id] || [];
    var inQ = Number(r.inQty) || 0;
    var lsum = list.reduce(function (a, x) { return a + x[1]; }, 0);
    // 이관한 예전 건은 지급 줄 수량이 '금액 ÷ 단가'라 실제 입고수량보다 적다(선금 몫 빠짐 · 입고 대신 예정 줄).
    // 그럴 땐 발주현황의 실제 기록(제품입고일 · 회차 수량)을 쓰고, 그것도 없으면 지급 줄 날짜에 수량만 비율대로 늘린다.
    if (inQ > lsum + 0.5) {
      var parts = (r.parts || []).map(function (p) { return [iso(p.d), Number(p.q) || 0]; }).filter(function (x) { return x[0]; });
      if (parts.length === 1 && !parts[0][1]) parts[0][1] = inQ;          // 날짜만 하나 → 입고수량 전체를 그날로
      var psum = parts.reduce(function (a, x) { return a + x[1]; }, 0);
      if (parts.length && psum >= inQ * 0.95) list = parts;
      else if (list.length && lsum > 0) list = list.map(function (x) { return [x[0], x[1] * inQ / lsum]; });
      else if (parts.length) list = parts;
    }
    out.push({
      id: r.id, name: r.name, code: r.code, batch: r.batch, vendor: r.vendor || '(업체 없음)', brand: r.brand, owner: r.owner, cat: r.cat,
      orderedAt: iso(String(r.orderedAt || '').replace(/^⚠\s*/, '')), due: iso(r.due), due0: h.due0 || '',
      qty: Number(r.qty) || 0, inQty: Number(r.inQty) || 0, closed: !!r.closed, cancelled: !!r.cancelled, state: r.state || '',
      ins: list.slice().sort(function (a, b) { return a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0); }),
      dueChg: h.dueChg || 0, etaChg: h.etaChg || 0,
      etaNow: etaLastIso_(r.eta, new Date()), etaLog: (h.log || []).slice().sort(function (a, b) { return a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0); })
    });
  });
  return { rows: out, at: Date.now(), ms: Date.now() - t0 };
}
