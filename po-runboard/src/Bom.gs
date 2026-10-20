/**
 * ============================================================
 * BOM 보기 · 차수 생성(BOM 변경)
 * ------------------------------------------------------------
 * BOM 원본: 실행판 시트의 숨김 탭 '_실행판_BOM2'(2026-10-17 새 양식 — 옛 '_실행판_BOM' 은 보관). 실행판은 읽어서 보여 주고,
 * 1단계 [BOM 보기]에서 만든 변경(단가 · 업체 · 사양(새 코드) · 자재 추가 · 빼기)을 그 발주 차수부터 BOM 탭에 쓴다.
 *  · 바뀌는 자재의 기존 줄은 종료를 (N−1)차로 닫고, 바로 아래에 N차부터의 새 줄을 넣는다(그 줄이 N차에 시작했으면 그 줄을 고친다).
 *  · 사양 변경 · 자재 추가는 같은 분류의 다음 버전 코드로 채번하고 '신규코드채번' 탭에도 한 줄 등록한다.
 *  · 바꾼 내용은 BOM 줄의 '변동사항' 칸과 실행판 변경이력에 사유와 함께 남긴다.
 * 칸은 2행 머리글 이름으로 찾는다(열이 옮겨져도 깨지지 않게).
 * ============================================================
 */

/* BOM 원본 위치: 실행판 시트(구매팀 업무 한판)의 숨김 탭 '_실행판_…'(2026-10-06 운영 · 시안 모두 옮김 — 옛 BOM 시트는 더 쓰지 않는다) */
var RB_BOM_PFX = '_실행판_';
/** BOM 탭이 든 스프레드시트 = 실행판 시트. 한 실행 안에서 openById 를 한 번만(ss_() 가 기억해 둔 것) */
function bomSS_() { return ss_(); }
var RB_BOM_TAB = RB_BOM_PFX + 'BOM3';           // 2026-10-20 운영 양식(무엇 → 언제 · 원가 → 업체 → 금액 → 메모 · 제품명 칸) — Migrate.gs bomMigrateV3_
var RB_BOM_V2_TAB = RB_BOM_PFX + 'BOM2';        // 2026-10-17 양식 — 보관만(더 쓰지 않음)
var RB_BOM_OLD_TAB = RB_BOM_PFX + 'BOM';        // 옛 양식 — 보관만(더 쓰지 않음)
var RB_BOM_REG = RB_BOM_PFX + '신규코드채번';
var RB_BOM_TYPES = RB_BOM_PFX + '신규채번_도움';
var RB_BOM_HEAD = {
  brand: '브랜드명', seq: '품목코드', product: '제품코드', search: '제품명', costKey: '원가반영', start: '초도', end: '종료', firstAt: '초도 발주일',
  code: '자재코드', common: '공용여부', type: '구분', name: '품목명', vendor: '업체명', buy: '매입정보', spec: '사양', moq: 'MOQ',
  place: '입고지', qty: '소요량', unit: '단가', proc: '임가공', ship: '배송비/기타', cost: '소요원가', remark: '구매발주 특이사항',
  change: '변동사항', fx: '환율', cur: '통화', oldCode: '기존코드', id: '줄ID', semi: '반제품 구성', ord: '순서'
};
var RB_BOM_SEND = ['row', 'start', 'end', 'code', 'type', 'name', 'vendor', 'buy', 'spec', 'moq', 'qty', 'unit', 'proc', 'ship', 'cost', 'change', 'fx', 'cur', 'common', 'place', 'costKey', 'semi', 'id', 'ord'];   // id = 줄ID — 화면이 저장 · 정정 · 원가 체크 때 같이 보내 줄 번호가 밀려도 엉뚱한 줄을 고치지 않게(없으면 예전처럼 코드 · 초도)
/** 화면이 보낸 줄ID 가 있고 시트 줄ID 와 다르면 다른 줄 — 줄ID 가 비었으면(옛 화면 · 옛 줄) 예전처럼 코드 · 초도만 본다 */
function bomIdDiff_(C, x, id) { return !!(str_(id) && C.id >= 0 && x && str_(x[C.id]) && str_(x[C.id]) !== str_(id)); }

function bomSheet_() {
  // 운영 양식(BOM3)이 있으면 그것, 아직이면 BOM2. 옮기기는 1분 작업(journalDrain → bomMigrateV3Run_)만 한다 — 사용자 요청 안에서 하면 그 사람이 1~2분 기다렸다
  var ss = bomSS_(), sh = ss.getSheetByName(RB_BOM_TAB) || ss.getSheetByName(RB_BOM_V2_TAB);
  if (!sh) throw new Error('BOM 시트에 BOM 탭이 없습니다.');
  return sh;
}
/** 1분 작업: BOM3 로 옮기기(한 판에 한 번 시도 · 실패 사유는 BOM변경이력). 잠금을 못 잡은 건 다음에 다시 */
function bomMigrateV3Run_() {
  var ss = bomSS_();
  if (ss.getSheetByName(RB_BOM_TAB) || !ss.getSheetByName(RB_BOM_V2_TAB)) return '';
  var P = PropertiesService.getScriptProperties(), fl = P.getProperty('rb.bomv3fail') || '';
  if (fl.indexOf(RB_BUILD + ' ') === 0) return '';
  try { var r = bomMigrateV3_(); bomDropCache_([]); try { costTableRefresh_(true); } catch (eC) { /* 넘어간다 */ } return JSON.stringify(r); }
  catch (eM) {
    var busyL = /옮기는 중입니다/.test(String(eM.message));
    try {
      console.log('BOM 운영 양식 옮기기 실패: ' + eM.message);
      if (!busyL) {
        P.setProperty('rb.bomv3fail', RB_BUILD + ' ' + new Date().toISOString() + ' ' + String(eM.message).slice(0, 400));
        bomLogWrite_(ss, [[new Date(), '실행판', '', '', '', 'BOM 운영 양식 실패', '', '', '', RB_BOM_V2_TAB, '', String(eM.message).slice(0, 2000), '', '참고', Utilities.getUuid().slice(0, 8) + '-v3x', '']]);
      }
    } catch (eP) { /* 넘어간다 */ }
    return 'fail';
  }
}

function bomCols_(sh) {
  var lc = sh.getLastColumn();
  var head = sh.getRange(2, 1, 1, lc).getDisplayValues()[0].map(function (s) { return String(s).replace(/\s+/g, ' ').trim(); });
  var col = { lc: lc };
  Object.keys(RB_BOM_HEAD).forEach(function (k) { col[k] = head.indexOf(RB_BOM_HEAD[k]); });
  var alias = { unit: '내용물/자재', fx: '평균환율', search: '검색' };              // BOM2(보관 양식)로 돌아가 읽을 때
  Object.keys(alias).forEach(function (k) { if (col[k] < 0) col[k] = head.indexOf(alias[k]); });
  var miss = ['product', 'start', 'end', 'code', 'type', 'name', 'vendor', 'unit', 'cost'].filter(function (k) { return col[k] < 0; });
  if (miss.length) throw new Error('BOM 탭 2행에서 칸을 찾지 못했습니다: ' + miss.map(function (k) { return RB_BOM_HEAD[k]; }).join(', '));
  return col;
}

function bomRowObj_(r, C, rowNum) {
  var o = { row: rowNum };
  Object.keys(RB_BOM_HEAD).forEach(function (k) {
    if (C[k] < 0) return;
    var x = r[C[k]];
    o[k] = x instanceof Date ? fmtDate_(x) : x;
  });
  o.product = str_(o.product).toUpperCase();
  o.code = str_(o.code).toUpperCase();
  return o;
}

/**
 * BOM 탭 전체를 읽어 품목별로 캐시에 담는다(6시간). 품목 목록(검색용)도 함께.
 * 10분 작업(warmCaches → warmBom_)이 비었거나 1시간 지났으면 다시 채운다 — 화면에서 BOM 보기를 열 때 시트를 읽지 않게(예전 5초).
 * 실행판에서 BOM을 저장하면 그 품목 캐시는 바로 버린다. BOM 시트를 사람이 직접 고친 건 1시간 안에 반영.
 */
function bomBuildCache_() {
  var gen0 = ''; try { gen0 = CacheService.getScriptCache().get('bom4:gen') || ''; } catch (eG) { /* 넘어간다 */ }
  var sh = bomSheet_(), C = bomCols_(sh), lr = sh.getLastRow();
  var v = lr > 2 ? sh.getRange(3, 1, lr - 2, C.lc).getValues() : [];
  var byP = {}, idx = {};
  v.forEach(function (r, i) {
    var o = bomRowObj_(r, C, i + 3);
    if (!o.product) return;
    var slim = {};
    RB_BOM_SEND.forEach(function (k) { if (o[k] !== undefined && o[k] !== '') slim[k] = o[k]; });
    (byP[o.product] = byP[o.product] || []).push(slim);
    bomIdxAdd_(idx, o);
  });
  var list = Object.keys(idx).map(function (k) { return bomIdxDone_(idx[k]); });
  // 읽는 사이 누가 BOM 을 저장했으면(세대 표시가 바뀜) 캐시에 쓰지 않는다 — 방금 저장한 품목이 옛 값으로 덮이지 않게
  var gen1 = ''; try { gen1 = CacheService.getScriptCache().get('bom4:gen') || ''; } catch (eG2) { /* 넘어간다 */ }
  if (gen1 !== gen0) return { list: list, byP: byP, stale: true };
  var put = {};
  Object.keys(byP).forEach(function (k) { put['bom4:p:' + k] = JSON.stringify(byP[k]); });
  try {
    var c = CacheService.getScriptCache(), keys = Object.keys(put);
    for (var i = 0; i < keys.length; i += 100) {
      var part = {};
      keys.slice(i, i + 100).forEach(function (k) { if (put[k].length < 95000) part[k] = put[k]; });
      c.putAll(part, 21600);
    }
  } catch (e) { /* 캐시는 실패해도 된다 */ }
  cachePut_('bom4:idx', list, 21600);
  try { CacheService.getScriptCache().put('bom4:at', String(Date.now()), 21600); } catch (e) { /* 넘어간다 */ }
  costTableMark_();                                  // 목록을 통째로 다시 만들었으면 원가표도(다음 1분 작업 — 캐시에서 쓰니 시트는 다시 안 읽음)
  return { list: list, byP: byP };
}

/* ============================================================
 * 원가표(실행판 시트의 '원가표' 탭) — 품목마다 최종 차수 구성 중 원가반영(F) 줄의 소요원가 합계.
 * 옛 BOM 시트 '원가검색_자동' 대신. BOM 을 저장하면 표시만 해 두고 1분 트리거가 다시 쓴다(목록 캐시에서 — 시트는 안 읽음).
 * ============================================================ */
var RB_COST_TAB = '원가표';
var RB_COST_HEAD = ['브랜드', '품목코드', '품목명', '최종 차수', '원가 VAT-', '원가 VAT+'];
function costTableMark_() { try { CacheService.getScriptCache().put('costtab:dirty', '1', 21600); } catch (e) { /* 넘어간다 */ } }
function costTableRefresh_(force) {
  var c = CacheService.getScriptCache();
  // 배포용 파일이 아직 없으면 처음 한 번은 표시가 없어도 만든다(Share.js)
  if (!force && !c.get('costtab:dirty') && PropertiesService.getScriptProperties().getProperty(RB_SHARE_PROP)) return 0;
  c.remove('costtab:dirty');
  var list = bomIndex_(), bo = { '메디테라피': 1, '히디프': 2 };
  var rows = list.filter(function (it) { return it.code; }).map(function (it) {
    var cost = Number(it.cost) || 0;
    return [it.brand || '', it.code, it.name || '', it.round ? it.round + '차' : '', Math.round(cost), Math.round(cost * 1.1)];
  });
  rows.sort(function (a, b) { return ((bo[a[0]] || 9) - (bo[b[0]] || 9)) || String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])); });
  var ss = ss_(), sh = ss.getSheetByName(RB_COST_TAB), W = RB_COST_HEAD.length;
  if (!sh) {
    sh = ss.insertSheet(RB_COST_TAB);
    sh.setFrozenRows(1);
    try { sh.protect().setDescription('원가표 — 실행판이 자동으로 씁니다').setWarningOnly(true); } catch (eP) { /* 넘어간다 */ }
  }
  var lr = sh.getLastRow();
  sh.getRange(1, 1, 1, W).setValues([RB_COST_HEAD]).setFontWeight('bold');
  sh.getRange(1, W + 2).setValue('실행판 BOM 에서 자동 — 최종 차수 구성 중 원가반영 줄의 소요원가 합계(VAT+ = ×1.1) · 직접 고치지 마세요 · 갱신 ' +
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'));
  if (rows.length) {
    ensureRows_(sh, rows.length + 1);
    sh.getRange(2, 1, rows.length, W).setValues(rows);
    sh.getRange(2, 5, rows.length, 2).setNumberFormat('#,##0');
  }
  if (lr > rows.length + 1) sh.getRange(rows.length + 2, 1, lr - rows.length - 1, W).clearContent();
  try { shareBomRefresh_(list, rows); } catch (eS) { try { console.log('배포용 BOM · 원가표 실패: ' + eS.message); } catch (eS2) { /* 넘어간다 */ } }   // 배포용 파일도 같이(Share.js)
  return rows.length;
}
/**
 * 원가 체크 겹침(이원화 · MOQ 구간): 같은 자재(같은 코드 또는 같은 품목명) · 같은 구분 · 같은 반제품 구성 줄이 같은 차수에 둘 다 원가면 막는다.
 * 디바이스 단상자 + 세트 단상자처럼 다른 자재 두 줄은 괜찮다. rows = 이 품목 줄 [{ r, x }] · cands = 원가로 켜는(켜진 채 바뀌는) 줄 · off = 끄거나 빼는 줄 번호
 */
/** 반제품 구성 칸 비교용: 반제품 코드 버전 숫자를 뗀 줄기(MX0185AA1 → MX0185AA). 반제품 코드가 새 번호로 바뀌어도 그 구성 자재는 같은 반제품으로 본다 */
function bomSemiKey_(v) { return str_(v).toUpperCase().replace(/\d+$/, ''); }
function bomCkClash_(rows, C, cands, off) {
  var skipT = /^(제품|반제품|세트|구성제품)$/, nm = function (t) { return str_(t).replace(/\s+/g, '').toUpperCase(); };
  // 종료가 빈 옛 버전 줄은 다음 버전 앞 차수까지(화면 · 원가 합계와 같은 규칙) — 예전엔 끝없이 쓰는 줄로 보고 잘못 막았다
  var vr = rows.filter(function (o) { return o.x && str_(o.x[C.end]) !== '단종'; }).map(function (o) {
    return { r: o.r, t: str_(o.x[C.type]), code: str_(o.x[C.code]).toUpperCase(), s: bomRnum_(o.x[C.start]) || 1, e: bomRnum_(o.x[C.end]), sm: C.semi >= 0 ? bomSemiKey_(o.x[C.semi]) : '' };
  });
  bomVerEnds_(vr);
  var e2 = {}; vr.forEach(function (v) { e2[v.r] = v.e2 >= 1e9 ? 99999 : v.e2; });
  cands.forEach(function (c) { if (c.r && e2[c.r] && e2[c.r] < c.e) c.e = e2[c.r]; });
  var live = [];
  rows.forEach(function (o) {
    var x = o.x;
    if (!x || (off && off[o.r]) || !str_(x[C.costKey]) || str_(x[C.end]) === '단종' || skipT.test(str_(x[C.type]))) return;
    if (cands.some(function (c) { return c.r === o.r; })) return;
    live.push({ r: o.r, type: str_(x[C.type]), semi: C.semi >= 0 ? bomSemiKey_(x[C.semi]) : '', code: str_(x[C.code]).toUpperCase(), name: str_(x[C.name]), vendor: str_(x[C.vendor]),
      s: bomRnum_(x[C.start]) || 1, e: e2[o.r] || bomRnum_(x[C.end]) || 99999 });
  });
  var pool = live.slice();
  cands.forEach(function (c) {
    if (skipT.test(str_(c.type))) return;
    var hit = pool.filter(function (o) {
      return o.type === str_(c.type) && o.semi === bomSemiKey_(c.semi) && o.s <= c.e && c.s <= o.e &&
        ((c.code && o.code === str_(c.code).toUpperCase()) || (nm(c.name) && nm(o.name) === nm(c.name)));
    })[0];
    if (hit) throw new Error(str_(c.type) + ' 줄 2개(' + (hit.code || '새 줄') + ' ' + hit.vendor + ', ' + (str_(c.code) || '새 줄') + ' ' + str_(c.vendor) + ')가 같은 자재인데 다 원가에 들어갑니다 — 두 업체 · MOQ 구간을 같이 두면 원가는 한 줄만 체크해 주세요.');
    pool.push({ r: c.r || 0, type: str_(c.type), semi: bomSemiKey_(c.semi), code: str_(c.code).toUpperCase(), name: str_(c.name), vendor: str_(c.vendor), s: c.s, e: c.e });
  });
}
/** 새 줄ID 만들기 — 줄을 복사하면 ID 까지 같이 복사돼 둘이 같아진다(되돌리기 · 원가 체크가 엉뚱한 줄에). 잠금 안에서 부른다 */
function bomIdGen_(sh, C) {
  if (C.id < 0) return function () { return ''; };
  var lr = sh.getLastRow(), max = 0;
  if (lr >= 3) sh.getRange(3, C.id + 1, lr - 2, 1).getValues().forEach(function (r) { var m = /^B(\d+)$/.exec(str_(r[0])); if (m) max = Math.max(max, Number(m[1])); });
  return function () { return 'B' + ('00000' + (++max)).slice(-6); };
}
/** 줄ID 채우기(10분 작업): 새로 붙인 줄은 위 줄을 복사해 만들어 ID 가 비었거나 겹친다 — 뒤 줄에 다음 번호 */
function bomStampIds_() {
  var sh = bomSheet_(), C = bomCols_(sh);
  if (C.id < 0) return 0;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return 0;                 // 잠금 안에서 읽고 쓴다(그사이 줄이 밀리면 엉뚱한 줄에 쓰게 된다)
  try {
    var lr = sh.getLastRow();
    if (lr < 3) return 0;
    var ids = sh.getRange(3, C.id + 1, lr - 2, 1).getValues(), ps = sh.getRange(3, C.product + 1, lr - 2, 1).getValues();
    var seen = {}, max = 0, need = [];
    ids.forEach(function (r) { var m = /^B(\d+)$/.exec(str_(r[0])); if (m) max = Math.max(max, Number(m[1])); });
    ids.forEach(function (r, i) {
      var id = str_(r[0]);
      if (!str_(ps[i][0])) return;
      if (!id || seen[id]) need.push(i); else seen[id] = 1;
    });
    if (!need.length) return 0;
    bomSetColRuns_(sh, C.id + 1, need.map(function (i) { return [i + 3, 'B' + ('00000' + (++max)).slice(-6)]; }));
    return need.length;
  } finally { lock.releaseLock(); }
}
/** BOM 보기 목록 한 품목(줄 하나씩 더한다) */
function bomIdxAdd_(idx, o) {
  var it = idx[o.product] || (idx[o.product] = { code: o.product, brand: str_(o.brand), name: '', search: str_(o.search), mats: [], vendors: [], semis: {} });
  if (!it.brand && str_(o.brand)) it.brand = str_(o.brand);
  var vd = str_(o.vendor);
  if (vd && it.vendors.indexOf(vd) < 0) it.vendors.push(vd);
  // 이름은 제품 줄 품목명이 먼저 — 앞에 다른 품목 자재 줄(검색 칸이 그 품목 이름)이 섞여 있어도 목록 이름이 바뀌지 않게
  if ((str_(o.type) === '제품' || o.code === o.product) && !it._pn && str_(o.name)) { it.name = str_(o.name); it._pn = 1; }
  if (!it.name && o.search) it.name = str_(o.search);
  if (o.code && o.code !== o.product && it.mats.indexOf(o.code) < 0) it.mats.push(o.code);
  if (str_(o.type) === '반제품' && o.code) { var sc = str_(o.code).toUpperCase(); if (!it.semis[sc]) it.semis[sc] = str_(o.name); }   // BOM 보기 목록에 반제품도
  (it._r = it._r || []).push({ s: bomRnum_(o.start), e: bomRnum_(o.end), c: Number(String(o.cost == null ? '' : o.cost).replace(/,/g, '')) || 0, ck: !!str_(o.costKey), done: str_(o.end) === '단종', code: str_(o.code).toUpperCase(), db: bomNeedsDb_(o.type, o.buy),
    t: str_(o.type), sm: bomSemiKey_(o.semi) });
}
/**
 * 버전 줄 끝 차수(화면 bvPlan 과 같은 규칙): 같은 구분 · 코드 줄기(MP0078CA1 → CA2)에서 종료가 빈 줄은 다음 버전 초도 바로 앞까지.
 * 반제품 구성이 있는 줄은 같은 반제품 줄만 다음 버전으로 본다(공용 자재는 반제품마다 한 줄). rs: [{ s, e, code, t, sm }] → 각 줄에 e2
 */
function bomVerEnds_(rs) {
  var fam = {};
  rs.forEach(function (x) { var k = (x.t || '') + '|' + String(x.code || '').replace(/\d+$/, ''); (fam[k] = fam[k] || []).push(x); });
  Object.keys(fam).forEach(function (k) {
    var vs = fam[k].slice().sort(function (a, b) { return (a.s || 1) - (b.s || 1); });
    vs.forEach(function (x, i) {
      var s = x.s || 1, nx = null;
      for (var j = i + 1; j < vs.length; j++) if ((vs[j].s || 1) > s && (!x.sm || vs[j].sm === x.sm)) { nx = vs[j]; break; }
      x.e2 = x.e != null ? x.e : (nx ? (nx.s || 1) - 1 : 1e9);
    });
  });
}
/** 품목 목록(BOM 보기 첫 화면) 항목 마무리: 최신 차수 구성 중 원가반영(F) 체크된 줄의 소요원가 합계 — 턴키 · 사급은 구분 없이 */
function bomIdxDone_(it) {
  var rs = it._r || [], max = 0;
  rs.forEach(function (x) { if (x.s > max) max = x.s; if (x.e && x.e > max) max = x.e; });
  bomVerEnds_(rs);                                   // 종료가 빈 옛 버전 줄은 다음 버전 앞 차수까지(화면 BOM 보기와 같은 규칙)
  var on = rs.filter(function (x) { return !x.done && (!max || ((x.s || 1) <= max && x.e2 >= max)); });
  it.round = max; it.n = on.length;
  if (!it.brand) { it.brand = bomBrandOf_(it.code); it.brandGuess = !!it.brand; }
  it.cost = Math.round(on.reduce(function (a, x) { return a + (x.ck ? x.c : 0); }, 0) * 100) / 100; it.ck = 6;
  // 최신 차수 구성의 코드(겹침 없이) — BOM 보기 목록 '품목코드 생성 필요' 개수
  var lv = {}; lv[it.code] = 1; on.forEach(function (x) { if (x.code && x.db) lv[x.code] = 1; }); it.live = Object.keys(lv).join(' ');
  delete it._r; delete it._pn;
  it.mats = it.mats.join(' '); it.vendors = it.vendors.join('|');
  return it;
}
/**
 * 저장 뒤: 바꾼 품목만 다시 읽어 캐시(그 품목 줄 · 목록 항목)를 맞춘다 — BOM 탭 통째 읽기 + 278개 품목 캐시 다시 담기를 하지 않게.
 * 줄 번호가 밀리지 않은 저장에만 쓴다(줄을 끼우거나 지우면 다른 품목 줄 번호도 밀리니 전체를 다시 — bomDropCache_).
 * 목록 캐시가 없으면 전체를 다시 만든다.
 */
function bomRefreshOne_(codes) {
  codes = (codes || []).map(function (c) { return str_(c).toUpperCase(); }).filter(String);
  var list = cacheGet_('bom4:idx');
  if (!list || !list.length || list[0].ck !== 6) { bomBuildCache_(); return; }
  var sh = bomSheet_(), C = bomCols_(sh), lr = sh.getLastRow();
  var pcol = lr > 2 ? sh.getRange(3, C.product + 1, lr - 2, 1).getValues() : [];
  var want = {}; codes.forEach(function (c) { want[c] = []; });
  pcol.forEach(function (r, i) { var p = str_(r[0]).toUpperCase(); if (want[p]) want[p].push(i + 3); });
  var put = {}, drop = [];
  codes.forEach(function (code) {
    var rows = want[code], objs = [];
    for (var i = 0; i < rows.length;) {                    // 붙어 있는 줄끼리 한 번에 읽는다
      var j = i; while (j + 1 < rows.length && rows[j + 1] === rows[j] + 1) j++;
      var r0 = rows[i];
      sh.getRange(r0, 1, j - i + 1, C.lc).getValues().forEach(function (r, k) { objs.push(bomRowObj_(r, C, r0 + k)); });
      i = j + 1;
    }
    var slim = objs.filter(function (o) { return o.product; }).map(function (o) { var x = {}; RB_BOM_SEND.forEach(function (k) { if (o[k] !== undefined && o[k] !== '') x[k] = o[k]; }); return x; });
    var js = JSON.stringify(slim);
    if (js.length < 95000) put['bom4:p:' + code] = js; else drop.push('bom4:p:' + code);
    var idx = {}; objs.forEach(function (o) { if (o.product) bomIdxAdd_(idx, o); });
    var at = -1; list.forEach(function (x, k) { if (x.code === code) at = k; });
    if (idx[code]) { var it = bomIdxDone_(idx[code]); if (at > -1) list[at] = it; else list.push(it); }
    else if (at > -1) list.splice(at, 1);
  });
  var c = CacheService.getScriptCache();
  if (Object.keys(put).length) c.putAll(put, 21600);
  drop.forEach(function (k) { c.remove(k); });
  cachePut_('bom4:idx', list, 21600);
}
/**
 * 화면: 앱을 연 뒤 뒤에서 한 번 — 모든 품목의 BOM 줄(캐시에서). 품목을 처음 열 때도 서버를 기다리지 않고 바로 보이게.
 * { 품목코드: [줄…] } · 캐시가 비었으면 다시 만든다.
 */
function apiBomAllRows() {
  var list = bomIndex_(), keys = list.map(function (it) { return 'bom4:p:' + it.code; }), out = {}, miss = [];
  var c = CacheService.getScriptCache();
  for (var i = 0; i < keys.length; i += 100) {
    var got = c.getAll(keys.slice(i, i + 100));
    keys.slice(i, i + 100).forEach(function (k) { if (got[k]) { try { out[k.slice(7)] = JSON.parse(got[k]); } catch (e) { miss.push(k); } } else miss.push(k); });
  }
  if (miss.length > 20) { var b = bomBuildCache_().byP; return b; }
  miss.forEach(function (k) { out[k.slice(7)] = bomRowsOf_(k.slice(7)); });
  return out;
}
/** 저장 뒤 캐시 맞추기: 줄 번호가 밀렸으면(shift) 예전처럼 버리고(다음에 전체 다시), 아니면 그 품목만 다시 읽는다 */
function bomAfterSave_(codes, shift) {
  costTableMark_();
  try { cacheDrop_(RB_II_REF); cacheDrop_(RB_II_CACHE); } catch (eR) { /* 넘어간다 */ }      // 품목 정보의 업체 · 단가(BOM 원가반영 줄)도 새로
  if (shift) { bomDropCache_(codes); bomDropAllRows_(); return; }
  // 세대 번호를 먼저 올린다 — 저장 전에 시작한 캐시 만들기가 끝나며 방금 고친 값을 옛 값으로 덮지 않게(bomBuildCache_ 가 세대를 보고 건너뜀)
  try { CacheService.getScriptCache().put('bom4:gen', String(Date.now()) + Math.random(), 21600); } catch (eG) { /* 넘어간다 */ }
  try { bomRefreshOne_(codes); } catch (e) { bomDropCache_(codes); }
}
/** 줄을 끼우거나 지워 줄 번호가 밀렸을 때: 다른 품목 줄 캐시(bom4:p:*)도 옛 줄 번호라 모두 버린다 — 다음에 읽을 때 BOM 탭 전체를 다시 읽어 채운다 */
function bomDropAllRows_() {
  try {
    var c = CacheService.getScriptCache(), l = cacheGet_('bom4:idx') || [];
    var keys = l.map(function (it) { return 'bom4:p:' + it.code; });
    for (var i = 0; i < keys.length; i += 100) c.removeAll(keys.slice(i, i + 100));
    c.put('bom4:gen', String(Date.now()) + Math.random(), 21600);        // 그 전에 시작한 캐시 만들기가 옛 줄 번호로 덮지 않게
  } catch (e) { /* 넘어간다 */ }
}
function bomIndex_() {
  var l = cacheGet_('bom4:idx');
  if (l && l.length && l[0].ck !== 6) l = null;      // 옛 캐시(원가 합계 · 반제품 · 최신 구성 코드가 없던 것)
  return l || bomBuildCache_().list;
}

/** 화면: BOM 보기 첫 화면 — 품목(제품) 전체와 최신 차수 소요원가 합계 */
/**
 * 품목 DB 에 있어야 하는 BOM 줄인지 — 사용자 기준(2026-10-08):
 *  · 사급 자재: 우리가 직접 발주하니 품목 DB 코드를 쓴다(없으면 '품목코드 생성 필요', 같은 번호 · 구분의 DB 코드가 있으면 그 코드로 바꾸기)
 *  · 턴키 자재: 제조사가 사니 품목코드 생성(채번) 규칙으로 만든 코드 — 품목 DB 와 맞대지 않는다
 *  · 제품 · 세트 · 반제품: 품목 DB 에 있어야 한다
 */
function bomNeedsDb_(type, buy) {
  // 2026-10-08 정정: 턴키 자재도 품목 DB 에 있어야 한다(코드는 채번 규칙으로 만들고 등록). 차이는 '어떻게 코드를 정하나' 뿐 —
  // 사급은 품목 DB 코드를 가져다 쓰고(약호가 틀리면 DB 코드로 바꾸기), 턴키는 채번 규칙 코드 그대로 등록(DB 코드로 바꾸라 하지 않음)
  return true;
}
function bomIsSa_(buy) { return str_(buy).indexOf('사급') > -1; }
/**
 * 품목코드 채번 규칙에 맞는 코드인지(2026-10-09):
 *  · 제품 · 세트: 브랜드 1글자 + 번호 4자리 + 국가/구분 2글자 + 버전(예: M0159AA1, H0002TW1)
 *  · 반제품: 브랜드 + X + 번호 + 2글자 + 버전(예: HX0065AA1)
 *  · 자재: 브랜드 + P + 번호 + 구분 약호 2글자 + 버전, 약호는 그 구분의 약호(튜브+캡 → TB). 표에 없는 구분이면 모양만 본다
 */
function bomRuleOk_(code, type, tmap) {
  var c = str_(code).toUpperCase(), t = str_(type);
  if (t === '제품' || t === '세트') return /^[A-Z]\d{4}[A-Z]{2}\d+$/.test(c);
  if (t === '반제품') return /^[A-Z]X\d{4}[A-Z]{2}\d+$/.test(c);
  var m = c.match(/^[A-Z]P\d{4}([A-Z]{2})\d+$/);
  if (!m) return false;
  return !tmap[t] || tmap[t] === m[1];
}
/** 규칙대로 새로 줄 코드: 같은 브랜드 · 번호 + 그 구분 약호 + (쓰인 적 없는 다음 버전) */
function bomRuleNext_(code, type, tmap, known) {
  var c = str_(code).toUpperCase(), tc = tmap[str_(type)];
  var m = c.match(/^([A-Z])P?(\d{4})/);
  if (!m || !tc) return '';
  var base = m[1] + 'P' + m[2] + tc, mx = 0;
  Object.keys(known).forEach(function (k) { if (k.indexOf(base) === 0) { var q = k.slice(base.length).match(/^(\d+)$/); if (q) mx = Math.max(mx, Number(q[1])); } });
  return base + (mx + 1);
}
/** 같은 번호 · 같은 구분 약호의 품목 DB 코드(예: MP0178TU1 튜브+캡 → MP0178TB1) */
function bomDbCands_(code, type, dbCodes, tmap) {
  // 구분 약호가 맞는 코드(예: 파우치 HP0011PH2)는 새 버전 — 이전 버전(PH1)으로 바꾸라고 하지 않는다(품목 DB 에 등록할 코드).
  // 약호가 구분과 다를 때만(예: 튜브+캡인데 TU) 같은 번호 · 맞는 약호의 품목 DB 코드를 권한다.
  var m = str_(code).toUpperCase().match(/^([A-Z]{1,2})(\d{4})([A-Z]{2})\d+$/), tc = tmap[str_(type)];
  if (!m || !tc || m[3] === tc) return [];
  var re = new RegExp('^' + m[1] + m[2] + tc + '\\d+$');
  return dbCodes.filter(function (c) { return re.test(c); }).sort();
}
function apiBomList() {
  // 제품(BOM 품목) + 그 안의 반제품(따로 BOM 이 없는 것 — 누르면 완제품 BOM 안의 그 반제품 구성). 같은 반제품이 여러 완제품에 있으면 한 줄로.
  var idx = bomIndex_(), have = {}, semi = {}, out = [];
  idx.forEach(function (it) { have[it.code] = 1; });
  idx.forEach(function (it) {
    out.push({ code: it.code, name: it.name, brand: it.brand, brandGuess: !!it.brandGuess, round: it.round || 0, n: it.n || 0, cost: it.cost || 0, live: it.live || '', mats: it.mats || '', vendors: String(it.vendors || '').replace(/\|/g, ' ') });   // 목록 검색: 자재코드 · 업체명으로도
    var s = it.semis || {};
    Object.keys(s).forEach(function (sc) {
      if (have[sc]) return;
      var x = semi[sc] || (semi[sc] = { code: sc, name: '', brand: it.brand, semi: 1, parents: [], round: 0, n: 0, cost: 0, live: sc });
      if (!x.name) x.name = s[sc];
      if (x.parents.indexOf(it.code) < 0) x.parents.push(it.code);
    });
  });
  Object.keys(semi).forEach(function (k) { semi[k].parents = semi[k].parents.join(' '); out.push(semi[k]); });
  return out.sort(function (a, b) { return a.code < b.code ? -1 : 1; });
}
/**
 * 화면: BOM 보기 '품목코드 생성 필요' 줄에서 [품목코드 등록] — 사용자가 코드 · 품목명을 확인하고 품목 DB 에 한 줄 넣는다.
 * 이미 품목 DB 에 있는 코드(되돌린 · 미사용 포함)는 넣지 않는다(중복 금지).
 */
function apiItemRegister(code, name, brand, vendor, spec) {
  requireEditor_();
  var c = itemCodeKey_(code), nm = str_(name);
  if (!/^[A-Z0-9-]{4,30}$/.test(c)) throw new Error('품목코드 형식이 아닙니다: ' + c);
  if (!nm) throw new Error('품목명을 넣어 주세요.');
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  try {
    if (itemDbAllCodes_().indexOf(c) > -1) return { code: c, name: nm, brand: str_(brand), vendor: str_(vendor), spec: str_(spec), exists: true };   // 이미 있음 — 화면 표시만 고친다
    if (!appendItems_([{ code: c, name: nm, brand: str_(brand), vendor: str_(vendor), spec: str_(spec) }], 'BOM 보기에서 확인 후 등록')) throw new Error('등록하지 못했습니다(이미 있거나 이름이 비었음).');
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return { code: c, name: nm, brand: str_(brand), vendor: str_(vendor), spec: str_(spec) };
}
/**
 * 화면: 이 자재코드를 쓰는 품목(공용 확인) — BOM 탭의 모든 품목에서 같은 자재코드 줄을 찾아 품목 · 차수 · 공용여부를 돌려준다.
 */
function apiBomWhereUsed(code) {
  code = itemCodeKey_(code);
  if (!code) return { code: '', list: [] };
  var list = [];
  bomIndex_().forEach(function (it) {
    if (it.code !== code && (' ' + String(it.mats || '') + ' ').indexOf(' ' + code + ' ') < 0) return;
    var rows = bomRowsOf_(it.code).filter(function (r) { return itemCodeKey_(r.code) === code; });
    if (!rows.length) return;
    list.push({ product: it.code, name: it.name || '', brand: it.brand || '',
      ranges: rows.map(function (r) { return (r.start || '') + '~' + (r.end || ''); }),
      common: rows.some(function (r) { return /공용/.test(str_(r.common)); }), live: rows.some(function (r) { return !str_(r.end); }) });
  });
  return { code: code, list: list };
}
/**
 * 공용 끄기 예외(스크립트 속성 bom:cmoff = { 자재코드: 1 }) — 사람이 [공용]을 끈 코드. 같은 코드 맞추기(bomNameSync_)는
 * '두 품목 이상이 쓰면 공용'으로 다시 켰기 때문에 끄기가 남지 않았다. 다시 켜면(또는 기존 자재 그대로 쓰기로 넣으면) 예외를 지운다.
 */
function bomCmOff_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('bom:cmoff') || '{}') || {}; } catch (e) { return {}; } }
function bomCmOffSet_(codes, on) {
  try {
    var m = bomCmOff_(), ch = false;
    (codes || []).forEach(function (c) { c = itemCodeKey_(c); if (!c) return; if (on && m[c]) { delete m[c]; ch = true; } else if (!on && !m[c]) { m[c] = 1; ch = true; } });
    if (ch) PropertiesService.getScriptProperties().setProperty('bom:cmoff', JSON.stringify(m));
  } catch (e) { /* 못 적으면 예전처럼(맞추기가 다시 켤 수 있음) */ }
}
/** 공용 표시 이력 — 품목마다 한 줄(그 품목 BOM 이력에 보이게). byP = { 품목코드: { 자재코드: 줄 수 } } */
function bomCmLog_(ss, byP, want, state) {
  var now = new Date(), who = me_(), tag = Utilities.getUuid().slice(0, 8);
  var rows = Object.keys(byP).map(function (pc, i) {
    var ks = Object.keys(byP[pc]);
    return [now, who, pc, '', '', '공용 표시', '', ks.join(', ').slice(0, 200), ks.join(', ').slice(0, 200), '-',
      ks.map(function (k) { return k + (want[k] ? ' 공용' : ' 공용 아님') + ' ' + byP[pc][k] + '줄'; }).join(' · ').slice(0, 300), '공용 표시', '', state, tag + '-cm' + i, ''];
  });
  if (rows.length) bomLogWrite_(ss, rows);
}
/** 화면: 공용 표시 켜기 · 끄기 — 이 자재코드의 모든 줄(모든 품목) 공용여부 칸을 '공용' / 빈칸으로. 이력에 남긴다 */
function apiBomCommonSet(code, on) {
  requireEditor_();
  code = itemCodeKey_(code);
  if (!code) throw new Error('자재코드가 비었습니다.');
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var n = 0, touched = {};
  try {
    var ss = bomSS_(), sh = bomSheet_(), C = bomCols_(sh), lr = sh.getLastRow();
    if (C.common < 0) throw new Error('BOM 탭에 공용여부 칸이 없습니다.');
    var v = lr > 2 ? sh.getRange(3, 1, lr - 2, C.lc).getValues() : [], put = [];
    v.forEach(function (x, i) {
      if (itemCodeKey_(x[C.code]) !== code) return;
      var want = on ? '공용' : '';
      if (str_(x[C.common]) === want) return;
      put.push([i + 3, want]); n++;
      var tp = str_(x[C.product]).toUpperCase();
      touched[tp] = touched[tp] || {}; touched[tp][code] = (touched[tp][code] || 0) + 1;
    });
    bomSetColRuns_(sh, C.common + 1, put);          // 칸마다 따로 쓰지 않고 이어진 줄끼리 한 번에
    bomCmOffSet_([code], on);                       // 끈 코드는 맞추기가 다시 켜지 않게
    var w1 = {}; w1[code] = on;
    if (n) bomCmLog_(ss, touched, w1, '-');          // 품목마다 한 줄(예전: 품목코드를 이어 붙인 한 줄이라 품목 이력에 안 보였다)
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  bomDropCache_(Object.keys(touched));
  var wu = apiBomWhereUsed(code);
  if (wu && typeof wu === 'object') wu.changed = n;
  return wu;
}
function bomRowsOf_(code) {
  code = str_(code).toUpperCase();
  try { var hit = CacheService.getScriptCache().get('bom4:p:' + code); if (hit) return JSON.parse(hit); } catch (e) { /* 다시 읽는다 */ }
  // 캐시된 품목 목록에 없는 코드(BOM 없음)면 시트를 통째로 다시 읽지 않는다(예전: 열 때마다 2초)
  try { var idx = cacheGet_('bom4:idx'); if (idx && idx.length && !idx.some(function (x) { return x.code === code; })) return []; } catch (e) { /* 다시 읽는다 */ }
  return bomBuildCache_().byP[code] || [];
}
function bomDropCache_(codes) {
  costTableMark_();
  try { cacheDrop_(RB_II_REF); } catch (eR) { /* 넘어간다 */ }
  try { var c = CacheService.getScriptCache(); c.remove('bom4:idx:n'); (codes || []).forEach(function (k) { c.remove('bom4:p:' + k); }); c.put('bom4:gen', String(Date.now()) + Math.random(), 21600); } catch (e) { /* 넘어간다 */ }
}

/**
 * 화면: 품목 검색 — 포함 단어로 품목명 · 품목코드 · 자재코드 · 업체명을 찾는다(띄어쓰기 무시, 대소문자 무시).
 * 업체명이 맞으면 그 업체가 들어간 품목이 다 나온다. why = 어디서 맞았는지(업체 · 자재코드).
 */
function apiBomSearch(q) {
  var norm = function (x) { return str_(x).toUpperCase().replace(/\s+/g, ''); };
  var nq = norm(q);
  var list = bomIndex_();
  if (!nq) return list.slice(0, 50).map(function (it) { return { code: it.code, name: it.name, brand: it.brand, why: '' }; });
  var out = [];
  // 띄어 쓴 낱말은 따로따로(모두 들어 있으면): '아다 스팟' → 아다피노이드 코어 스팟 · '*' 도 낱말 나눔으로
  var words = str_(q).toUpperCase().split(/[\s*]+/).filter(String);
  list.forEach(function (it) {
    var why = '';
    var hay = norm(it.code + ' ' + it.name + ' ' + it.search + ' ' + it.brand);
    var all = norm(it.code + it.name + it.search + it.brand + ' ' + (it.vendors || '') + ' ' + (it.mats || ''));
    if (hay.indexOf(nq) > -1 || (words.length > 1 && words.every(function (w) { return hay.indexOf(w) > -1; }))) why = '';
    else if (words.length > 1 && words.every(function (w) { return all.indexOf(w) > -1; })) why = '여러 칸에서';
    else {
      var vd = String(it.vendors || '').split('|').filter(function (v) { return norm(v).indexOf(nq) > -1; });
      if (vd.length) why = '업체 ' + vd.join(', ');
      else {
        var mt = String(it.mats || '').split(' ').filter(function (m) { return norm(m).indexOf(nq) > -1; });
        if (mt.length) why = '자재 ' + mt.slice(0, 3).join(', ');
        else return;
      }
    }
    out.push({ code: it.code, name: it.name, brand: it.brand, why: why });
  });
  // 반제품 코드(브랜드 + X)로 찾으면 맨 위에 '반제품 보기' — 완제품 BOM 안 구성. 다른 버전(AA3 ↔ AA4)도 찾는다
  var sm = nq.match(/^([A-Z]X\d{4}[A-Z]{2})(\d*)$/);
  if (sm) {
    var used = [], seen = {};
    list.forEach(function (it) { String(it.mats || '').split(' ').forEach(function (m) { if (m.indexOf(sm[1]) === 0 && /^\d+$/.test(m.slice(sm[1].length)) && !seen[m]) { seen[m] = 1; used.push(m); } }); });
    if (used.length) {
      var want = sm[2] ? nq : used.slice().sort().pop();
      out.unshift({ code: want, name: '반제품 ' + want, brand: '', why: '완제품 BOM 안 구성' + (used.indexOf(want) < 0 ? ' · BOM에는 ' + used.join(', ') + ' 로 등록' : '') });
    }
  }
  return out.slice(0, 200);
}

/**
 * 화면: [새 품목코드로 저장] — BOM이 바뀌면서 품목코드도 바뀌어야 할 때(사람이 고른다).
 *   품목코드 생성 규칙대로 같은 번호 · 같은 국가의 다음 버전(M0144AA2 → M0144AA3)을 만들고, 그 코드의 1차 BOM을 쓴다.
 *   items: 그 차수 구성 그대로 — { row, code, start, set: { 칸: 새 값 }, renumber } (기존 줄을 복사) · { kind: 'add', ... } (새 자재)
 *   바꾼 업체 · 사양 · 소요량은 자재코드도 새로 채번(지금 규칙과 같게). 원가반영(F)이 빈 참고 줄은 그대로 빈 채로.
 *   옛 코드 제품 줄 변동사항에 '→ 새 코드' 를 남기고, 신규코드채번 탭 · 품목 DB에 등록. BOM변경이력 '새 품목코드'(되돌리기 가능).
 */
function apiBomSaveNewVersion(product, items, meta) {
  requireEditor_();
  (items || []).forEach(function (it) { if (it && it.kind === 'add') bomNoRawType_(it.type); });      // 원재료는 더 등록하지 않는다(새로 넣는 줄만 — 이어 쓰는 옛 줄은 그대로)
  product = str_(product).toUpperCase();
  meta = meta || {};
  var why = str_(meta.why).slice(0, 200);
  if (!why) throw new Error('새 품목코드로 바꾸는 사유를 적어 주세요.');
  var m0 = product.match(/^([A-Z]X?\d{4}[A-Z]{2})(\d+)$/);
  if (!m0) throw new Error('품목코드 형식이 아니라 새 버전을 만들 수 없습니다: ' + product);
  items = (items || []).filter(function (c) { return c && (c.kind === 'add' || c.row); });
  if (!items.length) throw new Error('새 BOM에 넣을 줄이 없습니다.');
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var newCode = '', prodName = '', brand = '', newRows = [], regs = [], logRow, many = [];
  try {
    var ss = bomSS_(), sh = bomSheet_(), C = bomCols_(sh);
    var lastData = sh.getLastRow();
    var all = sh.getRange(3, 1, lastData - 2, C.lc).getValues();
    var used = bomKnownCodes_();
    all.forEach(function (r) { var c = str_(r[C.code]).toUpperCase(); if (c) used[c] = 1; var q = str_(r[C.product]).toUpperCase(); if (q) used[q] = 1; });
    var nextVer = function (base) {
      var mx = 0;
      Object.keys(used).forEach(function (c) { if (c.indexOf(base) === 0) { var m = c.slice(base.length).match(/^(\d+)$/); if (m) mx = Math.max(mx, Number(m[1])); } });
      var code = base + (mx + 1); used[code] = 1; return { code: code, ver: mx + 1 };
    };
    var tgt = str_(meta.target).toUpperCase();
    if (tgt) {
      var tm = tgt.match(/^([A-Z]X?\d{4}[A-Z]{2})(\d+)$/);
      if (!tm || tm[1] !== m0[1] || tgt === product) throw new Error('새 품목코드 ' + tgt + ' 는 ' + product + ' 의 다음 버전 형식이 아닙니다.');
      if (all.some(function (r) { return str_(r[C.product]).toUpperCase() === tgt || str_(r[C.code]).toUpperCase() === tgt; })) throw new Error(tgt + ' 는 이미 BOM이 있습니다. BOM 보기에서 ' + tgt + ' 를 열어 주세요.');
      newCode = tgt; used[tgt] = 1;
    } else {
      var nv = nextVer(m0[1]);
      newCode = nv.code;
    }
    var mine = [];
    all.forEach(function (r, i) { if (str_(r[C.product]).toUpperCase() === product) mine.push(i + 3); });
    if (!mine.length) throw new Error('BOM 탭에 ' + product + ' 줄이 없습니다.');
    brand = str_(all[mine[0] - 3][C.brand]);
    var oldName = '', prodRow = 0;
    mine.forEach(function (r) { var x = all[r - 3]; if ((str_(x[C.code]).toUpperCase() === product || str_(x[C.type]) === '제품') && !str_(x[C.end])) { oldName = oldName || str_(x[C.name]); prodRow = prodRow || r; } });
    prodName = str_(meta.name) || oldName || product;
    var reg = ss.getSheetByName(RB_BOM_REG), RC = reg ? bomRegCols_(reg) : null;
    var typeCodes = bomTypeCodes_(ss);
    // 한 줄의 여러 칸은 모아서 한 번에(bomWriteRow_) — 줄 끼우기 · 소요원가 읽기 전과 줄을 다 채운 뒤 put
    var pend = {};
    var cell = function (row, k, v) { if (C[k] >= 0) (pend[row] = pend[row] || {})[C[k]] = v; };
    var put = function () { Object.keys(pend).forEach(function (rw) { bomWriteRow_(sh, Number(rw), pend[rw]); }); pend = {}; };
    var val = function (k, v) { return k === 'cur' ? bomCurNorm_(v) : (RB_BOM_NUMERIC[k] ? (str_(v) === '' ? '' : num_(v)) : str_(v)); };
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yy/MM/dd');
    var note = function (extra) { return '1차 새 품목코드 ' + newCode + ' (' + product + ' 에서' + (extra ? ' · ' + extra : '') + ' · ' + why + ') · ' + stamp; };
    var at = lastData, changed = 0;
    var searchOf = prodName.replace(new RegExp('^' + brand + '\\s*'), '');
    var firstNew = lastData + 1, lastIns = lastData;
    var nid = null;
    var hasSetNV = items.some(function (it) { if (it.kind === 'add') return str_(it.type) === '세트'; var y = all[Number(it.row) - 3]; return y && str_(y[C.type]) === '세트'; });
    var regLater = [];                // 품목 DB 등록은 줄을 다 넣은 뒤(넣다 실패해 줄을 걷어내면 등록도 하지 않게)
    var renumMap = {}, rnKeyOf = function (it, x, oc) { var st = it.set || {}; return [oc, st.vendor != null ? str_(st.vendor) : str_(x[C.vendor]), st.spec != null ? str_(st.spec) : (C.spec >= 0 ? str_(x[C.spec]) : ''), st.qty != null ? num_(st.qty) : num_(x[C.qty])].join('|'); };
    // 시트가 그사이 바뀌었는지는 줄을 넣기 전에 모두 본다
    items.forEach(function (it) {
      if (it.kind === 'add') return;
      var x0 = all[Number(it.row) - 3];
      if (!x0 || str_(x0[C.product]).toUpperCase() !== product || str_(x0[C.code]).toUpperCase() !== str_(it.code).toUpperCase() || str_(x0[C.start]) !== str_(it.start) || bomIdDiff_(C, x0, it.id)) {
        throw new Error('BOM 시트가 그사이 바뀌었습니다(' + it.code + '). BOM 보기를 다시 열어 주세요.');
      }
    });
    try {
    items.forEach(function (it) {
      sh.insertRowAfter(at);
      var nr = at + 1, code, extra = '';
      lastIns = nr;
      if (it.kind === 'add') {
        sh.getRange(at, 1, 1, C.lc).copyTo(sh.getRange(nr, 1, 1, C.lc));
        relaxRowValidation_(sh, nr, C.lc);           // 복사가 데이터 확인 규칙도 같이 옮기니 복사 뒤에 푼다
        ['firstAt', 'common', 'place', 'remark', 'oldCode', 'change', 'seq', 'semi'].forEach(function (k) { cell(nr, k, ''); });     // 서식만 빌린 줄 — 반제품 구성 · 줄ID 는 새로
        cell(nr, 'id', (nid = nid || bomIdGen_(sh, C))());
        // 코드 정하기는 차수 저장(apiBomSaveCore_)과 같은 규칙: 세트 구성 완제품(want) · 기존 자재 그대로(reuse · 공용) · 화면에서 고친 새 코드(want) · 반제품(HX…) · 자재(HP…)
        var isProd = str_(it.type) === '제품' || str_(it.type) === '세트', numN = bomNum_(newCode), ver = 1, tcode = '', isComp = false;
        var compCode = isProd ? itemCodeKey_(it.want) : '';
        if (compCode && compCode !== product && compCode !== newCode) {
          if (!/^[A-Z]\d{4}[A-Z]{2}\d+$/.test(compCode)) throw new Error('세트 구성 완제품 코드 형식이 아닙니다: ' + compCode + ' (예: H0007AA1)');
          code = compCode; isComp = true;
        }
        else if (isProd) code = newCode;
        else {
          tcode = typeCodes[str_(it.type)] || 'MS';
          var reuseA = it.reuse ? itemCodeKey_(it.want) : '';
          var wantA = reuseA ? '' : bomWantCode_(it.want, used);
          if (reuseA) { code = reuseA; isComp = true; }
          else if (wantA) { code = wantA; used[code] = 1; ver = Number((code.match(/(\d+)$/) || [0, 1])[1]); }
          else if (str_(it.type) === '반제품') { var nvS = nextVer(newCode.charAt(0) + 'X' + numN + ((newCode.match(/^[A-Z]X?\d{4}([A-Z]{2})/) || [0, 'AA'])[1])); code = nvS.code; ver = nvS.ver; }
          else { var nvm = nextVer(newCode.charAt(0) + 'P' + numN + tcode); code = nvm.code; ver = nvm.ver; }
          if (!isComp) {
            regLater.push({ brand: brand, num: numN, prodName: prodName, type: str_(it.type), tcode: tcode, ver: ver, code: code, name: str_(it.name) || (prodName + ' ' + str_(it.type)) });
            regs.push(code);
          }
        }
        if (it.reuse && !isProd) cell(nr, 'common', '공용');          // 다른 품목 자재를 그대로 쓰면 공용
        cell(nr, 'type', str_(it.type));
        RB_BOM_EDIT.forEach(function (k) { cell(nr, k, val(k, it[k])); });
        if (!str_(it.name)) cell(nr, 'name', isProd ? prodName : (prodName + ' ' + str_(it.type)));
        if (!num_(it.qty)) cell(nr, 'qty', 1);
        var cu0 = bomCurNorm_(it.cur) || '원화'; cell(nr, 'cur', cu0); cell(nr, 'fx', cu0 === '원화' ? 1 : (num_(it.fx) || bomCurFx_(cu0)));
        cell(nr, 'costKey', it.ck === false ? '' : newCode);
        extra = '자재 추가 ' + code; changed++;
        cell(nr, 'code', code);
        put();
        bomFixCost_(sh, C, nr, null);
      } else {
        var r = Number(it.row), x = all[r - 3];
        if (!x || str_(x[C.product]).toUpperCase() !== product || str_(x[C.code]).toUpperCase() !== str_(it.code).toUpperCase() || str_(x[C.start]) !== str_(it.start)) {
          throw new Error('BOM 시트가 그사이 바뀌었습니다(' + it.code + '). BOM 보기를 다시 열어 주세요.');
        }
        sh.getRange(r, 1, 1, C.lc).copyTo(sh.getRange(nr, 1, 1, C.lc));
        relaxRowValidation_(sh, nr, C.lc);           // 복사 뒤에(복사가 규칙을 되살린다)
        ['firstAt', 'oldCode', 'seq'].forEach(function (k) { cell(nr, k, ''); });
        cell(nr, 'id', (nid = nid || bomIdGen_(sh, C))());       // 줄ID 는 새로(같은 ID 둘이면 되돌리기가 엉뚱한 줄에)
        var oc = str_(x[C.code]).toUpperCase();
        // 세트면 제품 줄은 구성 완제품(다른 품목코드) — 세트 코드로 바꾸지 않는다(예전엔 구성품 코드 · 이름이 세트 것으로 덮였다)
        if (oc === product || (str_(x[C.type]) === '제품' && !hasSetNV)) { code = newCode; if (meta.name) cell(nr, 'name', prodName); }
        else if (it.renumber && /^[A-Z]{2}\d{4}[A-Z]{2}\d+$/.test(oc) && renumMap[rnKeyOf(it, x, oc)]) {
          // 같은 자재(같은 코드)를 같은 값으로 바꾼 줄이 여럿이면(반제품마다 한 줄씩 있는 자재) 새 코드도 하나 — 차수 저장과 같게
          code = renumMap[rnKeyOf(it, x, oc)];
          cell(nr, 'oldCode', oc);
          extra = '코드 ' + oc + ' → ' + code;
        }
        else if (it.renumber && /^[A-Z]{2}\d{4}[A-Z]{2}\d+$/.test(oc)) {
          var base = oc.replace(/\d+$/, ''), nvr = nextVer(base);
          code = nvr.code; renumMap[rnKeyOf(it, x, oc)] = code;
          cell(nr, 'oldCode', oc);
          regLater.push({ brand: brand, num: base.substr(2, 4), prodName: prodName, type: str_(x[C.type]), tcode: base.slice(-2), ver: nvr.ver, code: code, name: str_((it.set || {}).name || x[C.name]) });
          regs.push(code);
          extra = '코드 ' + oc + ' → ' + code;
        } else code = oc;
        var set = it.set || {}, parts = [];
        RB_BOM_EDIT.forEach(function (k) {
          if (set[k] === undefined || set[k] === null) return;
          cell(nr, k, val(k, set[k]));
          parts.push((RB_BOM_EDIT_LABEL[k] || k) + ' ' + (str_(x[C[k]]) === '' ? '-' : str_(x[C[k]])) + ' → ' + (str_(set[k]) === '' ? '-' : str_(set[k])));
        });
        if (parts.length) { extra = (extra ? extra + ' · ' : '') + parts.join(' · '); changed++; }
        cell(nr, 'code', code);
        cell(nr, 'costKey', (typeof it.ck === 'boolean' ? it.ck : !!str_(x[C.costKey])) ? newCode : '');      // 참고 줄(원가반영 빈 줄)은 그대로 빈 채로 · 화면에서 원가 체크를 바꿨으면 그 값
        if (set.unit !== undefined || set.qty !== undefined || set.proc !== undefined || set.ship !== undefined || set.fx !== undefined) { put(); bomFixCost_(sh, C, nr, x); }
      }
      cell(nr, 'product', newCode); cell(nr, 'brand', brand); cell(nr, 'search', prodName);      // 제품명 칸 = 제품 전체 이름
      cell(nr, 'start', '1차'); cell(nr, 'end', '');
      cell(nr, 'change', note(extra));
      put();
      newRows.push({ code: code, start: '1차' });
      at = nr;
    });
    SpreadsheetApp.flush();
    } catch (eIns) {
      try { if (lastIns >= firstNew) sh.deleteRows(firstNew, lastIns - firstNew + 1); SpreadsheetApp.flush(); } catch (eDel) { /* 지우기도 실패하면 아래 오류로 알린다 */ }
      throw new Error('새 품목코드 BOM을 저장하지 못해 넣던 줄을 지웠습니다(시트는 그대로): ' + eIns.message);
    }
    SpreadsheetApp.flush();
    bomRegisterMany_(reg, RC, regLater, '신규코드 발급 · 새 품목코드 BOM');
    if (prodRow) {
      var pc = all[prodRow - 3][C.change];
      many.push({ product: product, code: str_(all[prodRow - 3][C.code]), start: str_(all[prodRow - 3][C.start]), id: C.id >= 0 ? str_(all[prodRow - 3][C.id]) : '', prev: { change: pc } });
      cell(prodRow, 'change', (str_(pc) ? str_(pc) + ' / ' : '') + '→ ' + newCode + ' 로 바뀜 (' + why + ') · ' + stamp);
      put();
    }
    var id = Utilities.getUuid().slice(0, 8) + '-nv';
    logRow = [new Date(), me_(), newCode, prodName, '1차', '새 품목코드', '제품', product, newCode, product + ' 구성 ' + items.length + '줄',
      newCode + ' 1차 BOM ' + items.length + '줄 · 바뀐 자재 ' + changed + (regs.length ? ' · 새 자재코드 ' + regs.join(', ') : ''), why,
      str_(meta.orderId) ? ((str_(meta.doc) + ' ' + str_(meta.name)).trim() + ' [' + str_(meta.orderId) + ']') : '', '유효', id, JSON.stringify({ newRefs: newRows, regs: regs.concat([newCode]), many: many })];
    bomLogWrite_(ss, [logRow, [new Date(), me_(), product, oldName, '', '새 품목코드', '제품', product, newCode, '', newCode + ' 로 바뀜', why, '', '참고', id + '-old', '']]);
    SpreadsheetApp.flush();
    // 품목 DB 등록도 잠금 안에서(맨 아래 줄에 붙이므로 다른 저장과 같은 줄을 잡지 않게)
    try { bomRegFromRows_([newCode], '실행판 새 품목코드 (' + product + ' 에서)'); } catch (e0) { /* 아래 */ }      // 제품 줄 업체(제조사) · 사양까지
    try { productCodeRegister_(newCode, prodName, brand, '실행판 새 품목코드 (' + product + ' 에서)'); } catch (e) { /* BOM은 저장됨 — 등록은 다음에 */ }
  } finally {
    lock.releaseLock();
  }
  bomDropCache_([product, newCode]);
  try { appendHist_([{ kind: 'BOM', code: newCode, item: product + ' → ' + newCode + ' 새 품목코드', before: product, after: newCode, reason: why }], 'p'); } catch (e) { /* 넘어간다 */ }
  var res = apiBomGet(newCode);
  res.newCode = newCode; res.from = product; res.made = regs;
  return res;
}

/**
 * 화면: 원가 반영 고르기 — 이 줄을 원가에 넣을지(원가반영 F = 제품코드) 뺄지(F 비움). 이원화 업체 등 사람이 고른다.
 * 원가검색_자동(옛 BOM 시트) · 실행판 발주 단가 모두 F가 있는 줄만 더한다. BOM변경이력에 남고 되돌릴 수 있다.
 */
/**
 * 화면: [이 차수 구성 정정] → 반제품 줄 [구성 고르기] → [반제품 구성으로 넣기].
 * items = [{ row, code, start, semi }] — 반제품 구성 칸에 반제품 코드(빼면 비움). 예전 화면이 보낸 place('업체 (MX… 구성)')도 받는다. 입고지는 건드리지 않는다.
 * 입고지에 반제품 코드를 같이 적어 어느 반제품 구성인지 시트에서도 보이고, 번호 · 위치와 상관없이 묶인다. 한 번에 쓰고 이력 한 줄(되돌리기 가능).
 */
/** 예전(새 양식 전) 입고지 칸의 반제품 구성 표시('업체 (MX0169AA1 구성)') → 반제품 코드 — 옮기기 · 옛 이력 되돌리기에서만 */
function bomSemiTagOf_(place) { var m = str_(place).match(/\(([A-Z]X\d{4}[A-Z]{2}\d+) 구성\)/); return m ? m[1] : ''; }
/**
 * 화면: [구성 고르기] '이 반제품에도 하나 더(공용)' — 다른 반제품 구성에 이미 있는 자재(인박스 · 아웃박스 등)를
 * 이 반제품 구성에도 한 줄 더 넣는다(같은 코드 · 같은 차수 · 반제품 구성 칸 = 그 반제품, 입고지는 원래 줄 그대로). 원래 줄과 새 줄 모두 공용 표시.
 * 반제품마다 하나씩 들어가는 자재라 원가도 반제품마다 하나씩(3개 반제품이면 3줄). 새 줄은 BOM 탭 맨 아래에(입고지 표시로 묶여 줄 순서와 상관없음).
 * semi = { row, code }, items = [{ row, code, start }]
 */
function apiBomSemiShare(product, semi, items, why, noGet) {
  requireEditor_();
  product = str_(product).toUpperCase();
  items = (items || []).slice(0, 50);
  if (!items.length) return apiBomGet(product);
  why = str_(why).slice(0, 200) || '반제품 구성에 공용 자재 같이 넣기';
  var lock = bomLock_();
  var copies = [], made = [], cmPrev = [], logId = Utilities.getUuid().slice(0, 8) + '-sh';
  try {
    var ss = bomSS_(), sh = bomSheet_(), C = bomCols_(sh);
    if (C.semi < 0) throw new Error('BOM 탭에 반제품 구성 칸이 없습니다.');
    var semis = (Array.isArray(semi) ? semi : [semi]).map(function (sm) {
      var hx = sh.getRange(Number(sm && sm.row), 1, 1, C.lc).getValues()[0];
      if (str_(hx[C.product]).toUpperCase() !== product || str_(hx[C.code]).toUpperCase() !== str_(sm && sm.code).toUpperCase() || str_(hx[C.type]) !== '반제품') {
        throw new Error('BOM 탭이 그사이 바뀌었습니다(반제품 ' + str_(sm && sm.code) + '). BOM 보기를 다시 열어 주세요.');
      }
      var c0 = str_(hx[C.code]).toUpperCase();
      return { sc: c0, tag: c0 };
    });
    var sc = semis.map(function (x) { return x.sc; }).join(', ');
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yy/MM/dd');
    var lr0 = sh.getLastRow(), all0 = lr0 > 2 ? sh.getRange(3, 1, lr0 - 2, C.lc).getValues() : [];
    var has = {};                // 이미 그 반제품 구성에 있는 코드(반제품|코드) — 두 번 넣지 않는다
    all0.forEach(function (y) { if (str_(y[C.product]).toUpperCase() === product) { var t0 = str_(y[C.semi]).toUpperCase(); if (t0) has[t0 + '|' + str_(y[C.code]).toUpperCase()] = 1; } });
    var srcs = items.map(function (it) {
      var r = Number(it.row), x = sh.getRange(r, 1, 1, C.lc).getValues()[0];
      if (str_(x[C.product]).toUpperCase() !== product || str_(x[C.code]).toUpperCase() !== str_(it.code).toUpperCase() || str_(x[C.start]) !== str_(it.start)) {
        throw new Error('BOM 탭이 그사이 바뀌었습니다(' + it.code + '). BOM 보기를 다시 열어 주세요.');
      }
      if (/^(제품|세트|반제품)$/.test(str_(x[C.type]))) throw new Error(it.code + ' 는 자재 줄이 아닙니다.');
      return { r: r, x: x };
    });
    var jobs = [];
    semis.forEach(function (sm) { srcs.forEach(function (q) { var k = sm.tag && sm.sc + '|' + str_(q.x[C.code]).toUpperCase(); if (!has[k]) { has[k] = 1; jobs.push({ q: q, sc: sm.sc, tag: sm.tag }); } }); });
    if (!jobs.length) throw new Error('고른 자재가 이미 그 반제품 구성에 모두 들어 있습니다.');
    var nidS = null;
    jobs.forEach(function (jb) {
      var q = jb.q, tag = jb.tag;
      var nr = sh.getLastRow() + 1;
      ensureRows_(sh, nr);
      sh.getRange(q.r, 1, 1, C.lc).copyTo(sh.getRange(nr, 1, 1, C.lc));         // 수식(소요원가) · 값 그대로
      relaxRowValidation_(sh, nr, C.lc);                                        // 복사 뒤에(복사가 데이터 확인 규칙도 옮긴다)
      var w = {};
      w[C.semi] = jb.sc;                                                        // 입고지는 원래 줄 그대로
      if (C.common >= 0) w[C.common] = '공용';
      if (C.firstAt >= 0) w[C.firstAt] = '';
      if (C.oldCode >= 0) w[C.oldCode] = '';
      if (C.id >= 0) w[C.id] = (nidS = nidS || bomIdGen_(sh, C))();
      if (C.change >= 0) w[C.change] = jb.sc + ' 구성에 같이 넣음(공용 · ' + q.r + '행과 같은 자재) · ' + stamp;
      bomWriteRow_(sh, nr, w);
      made.push({ r: nr, code: str_(q.x[C.code]).toUpperCase() });
      if (C.common >= 0 && str_(q.x[C.common]) !== '공용' && !q.done) { sh.getRange(q.r, C.common + 1).setValue('공용'); q.done = 1; cmPrev.push([q.r, q.x[C.common]]); }      // 원래 줄도 공용
      copies.push({ code: str_(q.x[C.code]).toUpperCase(), start: str_(q.x[C.start]), semi: jb.sc, from: q.r, type: str_(q.x[C.type]), common: str_(q.x[C.common]), id: C.id >= 0 ? str_(q.x[C.id]) : '' });
    });
    bomLogWrite_(ss, [[new Date(), me_(), product, '', '', '반제품 구성 공용', '반제품', sc, sc, '-',
      '같이 넣음 ' + copies.map(function (c) { return c.type + ' ' + c.code; }).join(', '), why, '', '유효', logId,
      JSON.stringify({ v2: 1, copyRefs: copies.map(function (c) { return { code: c.code, start: c.start, semi: c.semi }; }),
        many: copies.filter(function (c, i) { return c.common !== '공용' && copies.findIndex(function (d) { return d.code === c.code && d.start === c.start; }) === i; }).map(function (c) { return { product: product, code: c.code, start: c.start, id: c.id, prev: { common: c.common } }; }) })]]);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  bomAfterSave_([product], false);      // 맨 아래에 붙임 — 다른 품목 줄 번호는 그대로
  try { appendHist_([{ kind: 'BOM', code: product, item: product + ' 반제품 구성에 공용 자재 ' + copies.length + '줄', after: copies.map(function (c) { return c.code; }).join(', '), reason: why }], 'p'); } catch (e) { /* 넘어간다 */ }
  if (noGet) return { shared: copies.length, made: made, cmPrev: cmPrev, logId: logId };            // 정정 저장(apiBomFixMany) 안에서 — 화면 데이터는 맨 끝에 한 번만
  var res = apiBomGet(product);
  res.shared = copies.length;
  return res;
}
/**
 * 공용여부를 자재코드 여러 개 한 번에(구성 고르기 · 정정 표의 [공용]) — 그 코드를 쓰는 모든 품목 줄.
 * 예전엔 코드마다 apiBomCommonSet(시트 전체 읽기 + 목록 캐시 통째 다시 만들기)을 불러 코드가 많으면 몇 분 걸려 실패했다.
 * 잠금 한 번 · 코드 · 공용여부 · 제품코드 칸만 읽고 · 이어진 줄끼리 쓰고 · 이력 한 줄 · 바뀐 품목 캐시만 다시.
 */
function bomCommonSetMany_(list) {
  var want = {};
  (list || []).forEach(function (c) { var k = itemCodeKey_(c && c.code); if (k) want[k] = !!c.on; });
  if (!Object.keys(want).length) return 0;
  var lock = bomLock_();
  var put = [], touched = {}, byCode = {};
  try {
    var ss = bomSS_(), sh = bomSheet_(), C = bomCols_(sh), lr = sh.getLastRow();
    if (C.common < 0 || lr < 3) return 0;
    var n = lr - 2, cs = sh.getRange(3, C.code + 1, n, 1).getValues(), cm = sh.getRange(3, C.common + 1, n, 1).getValues(), ps = sh.getRange(3, C.product + 1, n, 1).getValues();
    cs.forEach(function (r, i) {
      var k = itemCodeKey_(r[0]);
      if (!k || want[k] === undefined) return;
      var to = want[k] ? '공용' : '';
      if (str_(cm[i][0]) === to) return;
      var tp = str_(ps[i][0]).toUpperCase();
      put.push([i + 3, to]); touched[tp] = touched[tp] || {}; touched[tp][k] = (touched[tp][k] || 0) + 1; byCode[k] = (byCode[k] || 0) + 1;
    });
    // 끄기 · 켜기 예외는 칸이 이미 그 값이어도 적는다(맞추기가 켰다가 사람이 다시 끈 경우)
    bomCmOffSet_(Object.keys(want).filter(function (k) { return !want[k]; }), false);
    bomCmOffSet_(Object.keys(want).filter(function (k) { return want[k]; }), true);
    if (!put.length) return 0;
    bomSetColRuns_(sh, C.common + 1, put);
    bomCmLog_(ss, touched, want, '참고');            // 품목마다 한 줄
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  bomAfterSave_(Object.keys(touched), false);               // 줄 번호는 그대로 — 바뀐 품목 캐시만
  return put.length;
}
function apiBomSetPlaces(product, items, why) {
  requireEditor_();
  product = str_(product).toUpperCase();
  items = (items || []).slice(0, 200);
  if (!items.length) return apiBomGet(product);
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  try {
    var ss = bomSS_(), sh = bomSheet_(), C = bomCols_(sh);
    if (C.semi < 0) throw new Error('BOM 탭에 반제품 구성 칸이 없습니다.');
    var xs = items.map(function (it) {
      var r = Number(it.row), x = sh.getRange(r, 1, 1, C.lc).getValues()[0];
      if (str_(x[C.product]).toUpperCase() !== product || str_(x[C.code]).toUpperCase() !== str_(it.code).toUpperCase() || str_(x[C.start]) !== str_(it.start)) {
        throw new Error('BOM 탭이 그사이 바뀌었습니다(' + it.code + '). BOM 보기를 다시 열어 주세요.');
      }
      var sv = it.semi !== undefined ? str_(it.semi).toUpperCase() : (/반제품 공용/.test(str_(it.place)) ? '*' : bomSemiTagOf_(it.place));   // 예전 화면은 입고지 표시로 보냈다
      return { r: r, x: x, semi: sv };
    }).filter(function (q) { return str_(q.x[C.semi]).toUpperCase() !== q.semi; });
    if (!xs.length) return apiBomGet(product);
    var many = [], ins = [], outs = [];
    xs.forEach(function (q) {
      sh.getRange(q.r, C.semi + 1).setValue(q.semi);
      many.push({ product: product, code: str_(q.x[C.code]), start: str_(q.x[C.start]), id: C.id >= 0 ? str_(q.x[C.id]) : '', prev: { semi: q.x[C.semi] } });
      (q.semi ? ins : outs).push(str_(q.x[C.code]));
    });
    var m = xs.filter(function (q) { return q.semi; }).map(function (q) { return q.semi === '*' ? '반제품 공용' : q.semi; })[0] || '';
    bomLogWrite_(ss, [[new Date(), me_(), product, '', '', '반제품 구성 고르기', '반제품', m, m,
      outs.length ? '뺌 ' + outs.join(', ') : '-', ins.length ? '넣음 ' + ins.join(', ') : '-', str_(why).slice(0, 200) || '반제품 구성 고르기', '', '유효',
      Utilities.getUuid().slice(0, 8) + '-pl', JSON.stringify({ v2: 1, many: many })]]);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  bomDropCache_([product]);
  return apiBomGet(product);
}
/**
 * 화면: 원가 체크 여러 줄을 한 번에(BOM 저장 · 정정 저장 때 같은 사유로). list = [{ row, code, start, on }]
 * 줄마다 품목 · 자재코드 · 초도를 다시 확인하고, 하나라도 그사이 바뀌었으면 아무것도 쓰지 않는다.
 */
function apiBomCostSetMany(product, list, why) {
  requireEditor_();
  product = str_(product).toUpperCase();
  why = str_(why);
  if (!why) throw new Error('사유를 적어 주세요.');
  list = (list || []).filter(Boolean);
  if (!list.length) return apiBomGet(product);
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  try {
    var ss = bomSS_(), sh = bomSheet_(), C = bomCols_(sh), logs = [], tag = Utilities.getUuid().slice(0, 8), now = new Date(), who = me_();
    var got = list.map(function (j) {
      var r = Number(j.row), x = sh.getRange(r, 1, 1, C.lc).getValues()[0];
      if (str_(x[C.product]).toUpperCase() !== product || str_(x[C.code]).toUpperCase() !== str_(j.code).toUpperCase() || str_(x[C.start]) !== str_(j.start) || bomIdDiff_(C, x, j.id)) {
        throw new Error('BOM 탭이 그사이 바뀌었습니다(' + j.code + '). BOM 보기를 다시 열어 주세요.');
      }
      return { r: r, x: x, want: j.on ? product : '' };
    });
    // 원가로 켜는 줄이 같은 자재의 다른 원가 줄과 겹치면 막는다(서버에서도 — 화면이 옛 것이어도)
    if (got.some(function (g) { return g.want; })) {
      var pv = [];
      sh.getRange(3, 1, sh.getLastRow() - 2, C.lc).getValues().forEach(function (q, i) { if (str_(q[C.product]).toUpperCase() === product) pv.push({ r: i + 3, x: q }); });
      var offC = {}; got.forEach(function (g) { if (!g.want) offC[g.r] = 1; });
      bomCkClash_(pv, C, got.filter(function (g) { return g.want; }).map(function (g) {
        return { r: g.r, type: g.x[C.type], semi: C.semi >= 0 ? g.x[C.semi] : '', code: g.x[C.code], name: g.x[C.name], vendor: g.x[C.vendor], s: bomRnum_(g.x[C.start]) || 1, e: bomRnum_(g.x[C.end]) || 99999 };
      }), offC);
    }
    got.forEach(function (g, i) {
      var x = g.x;
      if (str_(x[C.costKey]).toUpperCase() === g.want) return;
      sh.getRange(g.r, C.costKey + 1).setValue(g.want);
      logs.push([now, who, product, '', '', g.want ? '원가 반영' : '원가 제외', str_(x[C.type]), str_(x[C.code]), str_(x[C.code]),
        '원가반영 ' + (str_(x[C.costKey]) || '-'), '원가반영 ' + (g.want || '-') + ' · ' + str_(x[C.vendor]), why.slice(0, 200), '', '유효',
        tag + '-ck' + i, JSON.stringify({ many: [{ product: product, code: str_(x[C.code]), start: str_(x[C.start]), id: C.id >= 0 ? str_(x[C.id]) : '', prev: { costKey: x[C.costKey] } }] })]);
    });
    if (logs.length) { bomLogWrite_(ss, logs); SpreadsheetApp.flush(); }
  } finally {
    lock.releaseLock();
  }
  bomAfterSave_([product], false);
  return apiBomGet(product);
}

/*
 * ?diag=bomckfill — 끝난 줄(종료 차수 있음)인데 원가 체크(F)가 빈 줄을 그 제품코드로 채운다(한 번).
 *   예전에는 줄을 끝낼 때 F를 지웠다. 이제 원가 체크는 종료와 상관없이 남고, 차수마다 체크된 줄만 원가에 들어간다.
 *   자재코드가 채번 형식인 줄만(참고 줄 · 원재료 X 줄 등은 그대로). apply 없이: 미리 보기.
 */
function bomCkFill_(apply) {
  requireAdmin_();
  // 쓸 때는 읽기부터 잠금 안에서(잠금 밖에서 읽은 열을 통째로 덮으면 그사이 바뀐 값이 사라진다)
  var lock = null;
  if (apply) { lock = LockService.getScriptLock(); waitLock_(lock); }
  try {
    var out = bomCkFillIn_(apply);
  } finally { if (lock) lock.releaseLock(); }
  if (out.상태) { try { var c = CacheService.getScriptCache(); c.remove('bom4:idx:n'); c.remove('bom4:at'); } catch (e) { /* 넘어간다 */ } }
  return out;
}
function bomCkFillIn_(apply) {
  var sh = bomSheet_(), C = bomCols_(sh), lr = sh.getLastRow();
  var v = sh.getRange(3, 1, lr - 2, C.lc).getValues(), col = v.map(function (r) { return [r[C.costKey]]; });
  var okM = /^[A-Z]{2}\d{4}[A-Z]{2}\d+$/, okP = /^[A-Z]X?\d{4}[A-Z]{2}\d+$/, hits = [], skip = 0, both = [];
  // 같은 제품 · 같은 자재(구분 + 코드 앞부분) 줄끼리 차수 범위를 구해, 다른 줄과 같은 차수에 겹치는 줄은 채우지 않는다(원가 이중) — 목록으로 알려 사람이 고른다
  var grp = {};
  v.forEach(function (r, i) {
    var P = str_(r[C.product]).toUpperCase(), code = str_(r[C.code]).toUpperCase();
    if (!P || !code) return;
    var k = P + '|' + str_(r[C.type]) + '|' + code.replace(/\d+$/, '') + '|' + (C.semi >= 0 ? bomSemiKey_(r[C.semi]) : '');
    (grp[k] = grp[k] || []).push({ i: i, s: bomRnum_(r[C.start]) || 1, e: bomRnum_(r[C.end]), dead: str_(r[C.end]) === '단종' });
  });
  var clash = {};
  Object.keys(grp).forEach(function (k) {
    var vs = grp[k].filter(function (x) { return !x.dead; }).sort(function (a, b) { return a.s - b.s; });
    vs.forEach(function (x, j) { var nx = null; for (var q = j + 1; q < vs.length; q++) if (vs[q].s > x.s) { nx = vs[q]; break; } x.e2 = x.e != null ? x.e : (nx ? nx.s - 1 : 1e9); });
    for (var a1 = 0; a1 < vs.length; a1++) for (var b1 = a1 + 1; b1 < vs.length; b1++) {
      if (Math.max(vs[a1].s, vs[b1].s) <= Math.min(vs[a1].e2, vs[b1].e2)) { clash[vs[a1].i] = vs[b1].i + 3; clash[vs[b1].i] = vs[a1].i + 3; }
    }
  });
  v.forEach(function (r, i) {
    var P = str_(r[C.product]).toUpperCase(), code = str_(r[C.code]).toUpperCase(), s0 = bomRnum_(r[C.start]), e0 = bomRnum_(r[C.end]);
    if (!P || !e0 || str_(r[C.costKey])) return;
    if (!(okM.test(code) || (code === P && okP.test(code))) || str_(r[C.type]) === '세트') { skip++; return; }
    if (clash[i]) { both.push((i + 3) + '행 ' + P + ' ' + str_(r[C.type]) + ' ' + code + ' ' + (s0 || '') + '~' + e0 + '차 ↔ ' + clash[i] + '행'); return; }
    col[i] = [P];
    hits.push((i + 3) + '행 ' + P + ' ' + str_(r[C.type]) + ' ' + code + ' ' + (s0 || '') + '~' + e0 + '차');
  });
  var out = { 채울줄: hits.length, 건너뜀_코드형식아님: skip, 건너뜀_같은차수에겹침: both.length, 겹침_직접고를줄: both, 예: hits.slice(0, 20) };
  if (!apply || !hits.length) { if (!apply) out.안내 = '미리 보기입니다. 아래 [적용주소] 를 5분 안에 열면 채웁니다.'; return out; }
  sh.getRange(3, C.costKey + 1, col.length, 1).setValues(col);
  bomLogWrite_(bomSS_(), [[new Date(), me_(), '(전체)', '', '', '원가 체크 채움', '', '', '', '', hits.length + '줄 끝난 줄 원가반영(F) 채움', '끝난 줄도 원가 체크 유지', '', '-', Utilities.getUuid().slice(0, 8) + '-ckf', '']]);
  SpreadsheetApp.flush();
  out.상태 = '채웠습니다';
  return out;
}

/** 품목코드 첫 글자로 브랜드 짐작(하나로 정해지는 것만): H 히디프 · M 메디테라피 */
function bomBrandOf_(code) { return ({ H: '히디프', M: '메디테라피' })[str_(code).toUpperCase().charAt(0)] || ''; }

/** 품목코드의 번호 4자리(브랜드 다음, 반제품이면 X 다음): M0144AA2 → 0144, HX0002AA4 → 0002 */
function bomNum_(code) { return str_(code).toUpperCase().replace(/^[A-Z]X?/, '').slice(0, 4); }

/** 화면: 발주 목록의 'BOM 없음' 표시용 — BOM 시트에 있는 제품코드 · 자재코드 전부(캐시 그대로라 빠르다) */
function apiBomCodes() {
  var p = [], m = {};
  bomIndex_().forEach(function (it) { p.push(it.code); String(it.mats || '').split(' ').forEach(function (c) { if (c) m[c] = 1; }); });
  return { p: p, m: Object.keys(m) };
}

/** 화면: 한 품목의 BOM 줄 전부(차수 계산은 화면에서) */
function apiBomGet(code) {
  code = str_(code).toUpperCase();
  var rows = bomRowsOf_(code);
  var idx = bomIndex_();                 // 품목 목록은 한 번만 꺼낸다(예전엔 최대 세 번 — 캐시에서 풀 때마다 큰 JSON)
  var it = idx.filter(function (x) { return x.code === code; })[0] || {};
  var log = [];
  try { log = bomLogOf_(code); } catch (e) { log = []; }
  var out = { code: code, name: it.name || '', brand: it.brand || '', rows: rows, log: log };
  var pm = !rows.length && code.match(/^([A-Z]X?\d{4}[A-Z]{2})(\d+)$/);
  if (pm) {
    var best = null;
    idx.forEach(function (x) {
      var mm = x.code.match(/^([A-Z]X?\d{4}[A-Z]{2})(\d+)$/);
      if (mm && mm[1] === pm[1] && Number(mm[2]) < Number(pm[2]) && (!best || Number(mm[2]) > best.v)) best = { code: x.code, name: x.name, round: x.round || 0, v: Number(mm[2]) };
    });
    if (best) out.prev = { code: best.code, name: best.name, round: best.round };
  }
  if (!rows.length && /^[A-Z]X\d{4}/.test(code)) {
    // 반제품은 BOM 시트에 자기 줄이 없다 — 완제품 BOM 안에 '반제품' 줄 + 그 뒤 구성 자재로 들어 있다.
    // 같은 반제품의 다른 버전(예: AA4 를 찾는데 BOM엔 AA3)도 찾는다.
    var base = code.replace(/\d+$/, ''), parents = [];
    idx.forEach(function (x) {
      var hit = String(x.mats || '').split(' ').filter(function (m) { return m === code || (m.indexOf(base) === 0 && /^\d+$/.test(m.slice(base.length))); });
      if (hit.length) parents.push({ code: x.code, name: x.name, mat: hit.indexOf(code) > -1 ? code : hit.sort().pop() });
    });
    // 먼저: 그 코드 그대로 쓰는 완제품 → 번호가 같은 완제품(HX0002 ↔ H0002) → 코드 큰 것(최신)
    var no = code.substr(2, 4), same = function (x) { return x.code.substr(1, 4) === no ? 1 : 0; };
    parents.sort(function (a, c) { return (c.mat === code) - (a.mat === code) || same(c) - same(a) || (a.code < c.code ? 1 : -1); });
    if (parents.length) {
      var p0 = parents[0];
      out.semi = { asked: code, parents: parents, mat: p0.mat, parent: { code: p0.code, name: p0.name, rows: bomRowsOf_(p0.code), log: [] } };
      try { out.semi.parent.log = bomLogOf_(p0.code); } catch (e) { /* 넘어간다 */ }
      try { out.semi.parent.links = bomLinksOf_(p0.code); } catch (e) { /* 넘어간다 */ }
    }
  }
  try { out.links = bomLinksOf_(code); } catch (e) { out.links = []; }   // 포장물 사양서 등(BomLinks.js)
  // 세트: 구성 완제품마다 그 완제품 BOM 에 든 자재코드(자재 → 완제품) — 세트 발주 단가에서 빼고(완제품은 따로 발주) 트리에서 그 완제품 아래에 둔다
  if (rows.some(function (v) { return str_(v.type) === '세트'; })) {
    out.compMats = {};
    rows.forEach(function (v) {
      var cc = str_(v.code).toUpperCase();
      if (str_(v.type) !== '제품' || cc === code) return;
      try { bomRowsOf_(cc).forEach(function (m) { var mc = str_(m.code).toUpperCase(); if (mc && mc !== cc && !out.compMats[mc]) out.compMats[mc] = cc; }); } catch (eC) { /* 넘어간다 */ }
    });
  }
  return out;
}

function bomRnum_(t) { var m = String(t || '').match(/(\d+)\s*차/); return m ? Number(m[1]) : null; }

/**
 * 화면: BOM 저장. product = 제품코드, round = N(BOM 차수 = 발주 차수), changes = [
 *   { row, code, start, name?, vendor?, buy?, spec?, moq?, qty?, unit?, proc?, ship?, remove?, extend?, why }  — 한 줄에서 바꾼 것
 *       업체 · 사양(데이터) · 소요량이 바뀌면 같은 분류의 다음 버전 코드로 새로 채번(항상 새 줄 · 기존 줄 종료),
 *       그 밖(단가 · MOQ · 임가공 · 배송비 · 품목명 · 매입정보)은 코드 그대로
 *       extend: 최종 차수에서 닫힌 줄을 새 차수까지 이어 쓴다(종료 칸을 비움 — 차수 추가 때 손대지 않은 자재)
 *   { kind:'add', type, name, vendor, buy, spec, moq, qty, unit, proc, ship, why } ]  — type '제품'이면 코드 = 제품코드
 * meta = { orderId, doc, name, newProduct: { brand, name } } — 신제품이면 BOM 탭 맨 아래에 새로 만든다
 * 바꾼 것마다 BOM 시트의 'BOM변경이력' 탭에 한 줄(되돌리기 정보 포함) · 그 줄의 변동사항 칸 · 실행판 변경이력에 남긴다.
 */
var RB_BOM_EDIT = ['name', 'vendor', 'buy', 'spec', 'moq', 'qty', 'unit', 'cur', 'fx', 'proc', 'ship'];
var RB_BOM_EDIT_LABEL = { name: '품목명', vendor: '업체', buy: '매입정보', spec: '사양', moq: 'MOQ', qty: '소요량', unit: '단가', cur: '통화', fx: '환율', proc: '임가공', ship: '배송비' };
var RB_BOM_NUMERIC = { moq: 1, qty: 1, unit: 1, fx: 1, proc: 1, ship: 1 };
/** 단가 통화: 원화 · 위안 · 달러. 통화 칸이 비었으면 평균환율로 짐작(1 → 원화, 1000 넘으면 달러, 그 밖 → 위안) */
function bomCurNorm_(c) {
  var s = str_(c).toUpperCase();
  if (!s) return '';
  if (/원|KRW/.test(s)) return '원화';
  if (/위안|CNY|RMB/.test(s)) return '위안';
  if (/달러|USD|\$/.test(s)) return '달러';
  return '';
}
function bomCurOf_(cur, fx) { var c = bomCurNorm_(cur); if (c) return c; var f = num_(fx) || 1; return f >= 1000 ? '달러' : (f > 1 ? '위안' : '원화'); }
/*
 * BOM 환율은 설정 환율(fx.CNY · fx.USD)을 따른다 — BOM 탭 평균환율 칸은 통화(위안 · 달러) 줄마다 설정 값으로 맞춘다.
 * apply 없이: 미리 보기(맞출 줄 · 소요원가가 바뀌는 만큼). apply: 평균환율 칸 쓰기 + 손으로 넣은 소요원가는 바뀐 만큼 더하고 뺌
 * (소요원가가 그 줄 단가를 보는 수식이면 시트가 다시 계산). 설정에서 환율을 바꾸면 자동으로 돈다.
 */
function bomFxSync_(apply) {
  // 쓸 때는 읽기부터 잠금 안에서(잠금 밖에서 읽은 환율 열을 통째로 덮으면 그사이 바뀐 값이 사라진다)
  var lock = null;
  if (apply) { lock = LockService.getScriptLock(); waitLock_(lock); }
  try {
    var out = bomFxSyncIn_(apply);
  } finally { if (lock) lock.releaseLock(); }
  if (out.상태) { try { var c = CacheService.getScriptCache(); c.remove('bom4:idx:n'); c.remove('bom4:at'); } catch (e) { /* 넘어간다 */ } }
  return out;
}
function bomFxSyncIn_(apply) {
  var sh = bomSheet_(), C = bomCols_(sh), lr = sh.getLastRow();
  if (C.fx < 0 || lr < 3) return { 줄: 0 };
  var n = lr - 2, v = sh.getRange(3, 1, n, C.lc).getValues(), fm = sh.getRange(3, C.cost + 1, n, 1).getFormulas();
  var want = { 위안: bomCurFx_('위안'), 달러: bomCurFx_('달러'), 원화: 1 };
  var unitCol = colRB_(C.unit + 1), fx = [], hits = [], dCost = 0, costSet = [];
  v.forEach(function (r, i) {
    var cur0 = r[C.fx];
    fx.push([cur0]);
    if (!str_(r[C.product]) && !str_(r[C.code])) return;
    var cu = C.cur >= 0 ? bomCurNorm_(r[C.cur]) : '';
    if (!cu) cu = bomCurOf_('', cur0);
    var w = want[cu], old = num_(cur0) || 1;
    if (cu === '원화' && (str_(cur0) === '' || old === 1)) return;     // 원화 줄은 1(빈칸이면 그대로)
    if (old === w) return;
    fx[i] = [w];
    var qty = str_(r[C.qty]) === '' ? 1 : num_(r[C.qty]), d = num_(r[C.unit]) * (w - old) * qty;
    var f = fm[i][0], byFormula = f && new RegExp(unitCol + '[$]?' + (i + 3) + '(?![0-9])').test(f);
    if (!byFormula && str_(r[C.cost]) !== '') costSet.push([i, (num_(r[C.cost]) || 0) + d]);
    dCost += d;
    hits.push((i + 3) + '행 ' + str_(r[C.product]) + ' ' + str_(r[C.code]) + ' ' + cu + ' ' + old + '→' + w + (d ? ' (원가 ' + (d > 0 ? '+' : '') + Math.round(d * 100) / 100 + ')' : ''));
  });
  var out = { 설정환율: { 위안: want.위안, 달러: want.달러 }, 맞출줄: hits.length, 예: hits.slice(0, 15), 소요원가변화합: Math.round(dCost) };
  if (!apply || !hits.length) return out;
  sh.getRange(3, C.fx + 1, n, 1).setValues(fx);
  // 손으로 넣은 소요원가: 줄마다 따로 쓰지 않고 이어진 줄끼리 한 번에(수식 칸은 애초에 costSet 에 없다)
  bomSetColRuns_(sh, C.cost + 1, costSet.map(function (x) { return [x[0] + 3, Math.round(x[1] * 10000) / 10000]; }));
  bomLogWrite_(bomSS_(), [[new Date(), me_(), '(전체)', '', '', '환율 맞춤', '', '', '', '', hits.length + '줄 평균환율 → 설정 환율(위안 ' + want.위안 + ' · 달러 ' + want.달러 + ')', '설정 환율 따름', '', '-', Utilities.getUuid().slice(0, 8) + '-fx', '']]);
  SpreadsheetApp.flush();
  out.상태 = '맞췄습니다';
  return out;
}
function bomCurFx_(cur) {
  if (cur === '원화') return 1;
  var cfg = {}; try { cfg = readConfig_(); } catch (e) { cfg = {}; }
  return cur === '달러' ? (Number(cfg['fx.USD']) || 1400) : (Number(cfg['fx.CNY']) || 200);
}
/**
 * BOM 에서 품목명을 고친 줄(품목 DB 에 있는 코드 · 코드는 그대로) → { 코드: 새 이름 }. 품목명 기준은 품목 DB 하나라
 * BOM 에서 이름을 고치면 품목 DB 이름을 바꾸고, 그 코드를 쓰는 다른 BOM 줄도 같은 이름으로 맞춘다(bomRenameApply_).
 */
function bomRenamesFrom_(product, list) {
  var rows = {}, db = {}, out = {};
  try { bomRowsOf_(product).forEach(function (r) { rows[r.row] = r; }); } catch (e) { return out; }
  readItems_().forEach(function (it) { db[it.code] = it; });
  (list || []).forEach(function (x) {
    if (!x || x.newCode) return;
    var r = rows[Number(x.row)]; if (!r) return;
    var code = itemCodeKey_(r.code), it = db[code];
    if (!code || !it) return;
    ['name', 'vendor', 'spec'].forEach(function (k) {
      if (x[k] == null) return;
      var want = str_(x[k]).trim();
      if (!want || want === str_(r[k]).trim() || want === str_(it[k])) return;
      (out[code] = out[code] || {})[k] = want;
    });
  });
  return out;
}
/** BOM 에서 고친 품목명(정정이면 업체 · 사양도)을 품목 DB 에 쓰고, 그 코드를 쓰는 다른 BOM 줄도 같은 값으로 */
function bomRenameApply_(ren) {
  var codes = Object.keys(ren || {});
  if (!codes.length) return;
  // 품목 DB 저장(apiItemDbSave)이 품목명 · 업체 · 사양을 바꾸면 그 코드 BOM 줄 맞추기(bomNameSync_)까지 한다 — 예전엔 여기서 한 번 더 해 BOM 탭을 두 번 읽었다.
  // 품목 DB 저장이 실패한 코드만 여기서 맞춘다
  // 바꾸기 전 품목 DB 값을 돌려준다 — 되돌리기 때 품목 DB 도 원래대로(bomLogDbPrev_ 가 이력에 적어 둔다)
  var prev = {}, db = {};
  try { readItems_().forEach(function (it) { db[it.code] = it; }); } catch (eD) { db = {}; }
  codes.forEach(function (c) { var it = db[c]; if (!it) return; prev[c] = {}; Object.keys(ren[c]).forEach(function (k) { prev[c][k] = str_(it[k]); }); });
  var only = {}, n = 0;
  codes.forEach(function (c) { try { apiItemDbSave(0, c, ren[c]); } catch (e) { only[c] = 1; n++; delete prev[c]; } });
  if (n) { try { bomNameSync_(only, true); } catch (e2) { /* 10분 작업이 맞춘다 */ } }
  return prev;
}
/** 이번 저장 이력 줄(같은 묶음) 중 그 코드를 넣은 줄의 되돌리기 기록에 다른 줄 옛 값(many)을 더한다 */
function bomLogUndoAdd_(product, tag, many) {
  if (!tag || !many || !many.length) return;
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  try {
    var lg = bomSS_().getSheetByName(RB_BOM_LOG);
    if (!lg || lg.getLastRow() < 2) return;
    var n = lg.getLastRow() - 1, from = Math.max(0, n - 400), lv = lg.getRange(from + 2, 1, n - from, 16).getValues();
    for (var i = lv.length - 1; i >= 0; i--) {
      if (str_(lv[i][14]).indexOf(tag + '-') !== 0 || str_(lv[i][2]).toUpperCase() !== product || str_(lv[i][13]) !== '유효') continue;
      var code = str_(lv[i][8]).toUpperCase(), add = many.filter(function (m) { return m.code === code; });
      if (!add.length) continue;
      var j = {}; try { j = JSON.parse(str_(lv[i][15]) || '{}'); } catch (eJ) { continue; }
      j.many = (j.many || []).concat(add);
      lg.getRange(from + i + 2, 16).setValue(JSON.stringify(j));
    }
  } finally { lock.releaseLock(); }
}
/** 이번 저장 이력 줄(같은 묶음 번호) 중 그 코드를 고친 줄의 되돌리기 기록에 품목 DB 옛 값을 붙인다 */
function bomLogDbPrev_(product, tag, prev) {
  var codes = Object.keys(prev || {});
  if (!tag || !codes.length) return;
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  try {
    var lg = bomSS_().getSheetByName(RB_BOM_LOG);
    if (!lg || lg.getLastRow() < 2) return;
    var n = lg.getLastRow() - 1, from = Math.max(0, n - 400);          // 방금 쓴 줄 — 끝에서 찾는다
    var lv = lg.getRange(from + 2, 1, n - from, 16).getValues(), left = {};
    codes.forEach(function (c) { left[c] = 1; });
    for (var i = lv.length - 1; i >= 0 && Object.keys(left).length; i--) {
      if (str_(lv[i][14]).indexOf(tag + '-') !== 0 || str_(lv[i][2]).toUpperCase() !== product || str_(lv[i][13]) !== '유효') continue;
      var j = {}; try { j = JSON.parse(str_(lv[i][15]) || '{}'); } catch (eJ) { continue; }
      var mine = {}; [lv[i][7], lv[i][8]].concat((j.many || []).map(function (m) { return m && m.code; })).concat(j.inPlace ? [j.inPlace.code] : []).forEach(function (c) { c = str_(c).toUpperCase(); if (c) mine[c] = 1; });
      var put = {}; Object.keys(left).forEach(function (c) { if (mine[c]) { put[c] = prev[c]; delete left[c]; } });
      if (!Object.keys(put).length) continue;
      j.dbPrev = Object.assign(j.dbPrev || {}, put);
      lg.getRange(from + i + 2, 16).setValue(JSON.stringify(j));
    }
  } finally { lock.releaseLock(); }
}

function apiBomSave(product, round, changes, meta) {
  var tw0 = Date.now();
  // 업체 · 사양 · 소요량도 바뀌는 줄은 새 코드가 생긴다 — 그 이름을 옛 코드(다른 품목 · 지난 차수 줄)에 덮어쓰지 않는다
  var ren = bomRenamesFrom_(str_(product).toUpperCase(), (changes || []).filter(function (c) { return c && c.kind !== 'add' && !c.remove && c.vendor == null && c.spec == null && c.qty == null; }).map(function (c) { return { row: c.row, name: c.name }; }));
  var res = apiBomSaveCore_(product, round, changes, meta);
  var tw1 = Date.now(), tm = res.timing || {};
  try { bomLogDbPrev_(str_(product).toUpperCase(), res.logTag, bomRenameApply_(ren)); } catch (eR0) { /* 이름 맞추기는 10분 작업이 다시 */ }
  tm['이름맞추기'] = Date.now() - tw1; tw1 = Date.now();
  // 기존 코드를 가져다 쓴 줄(공용) — 그 코드를 쓰는 다른 BOM 줄과 공용 표시 · 빈 업체 · 사양을 맞춘다
  var reuse = {}; (changes || []).forEach(function (c) { if (c && c.kind === 'add' && c.want && (c.reuse || c.picked)) reuse[itemCodeKey_(c.want)] = 1; });
  if (Object.keys(reuse).length) {
    bomCmOffSet_(Object.keys(reuse), true);          // 기존 자재를 그대로 가져다 쓰면 공용 — 끄기 예외를 지운다
    // 맞추기 전에 공용이 아니던 줄을 적어 두고 → 되돌리기 때 그 줄 공용 표시도 원래대로(예전엔 가져온 줄만 빠지고 원래 품목 줄은 공용으로 남았다)
    var cmPrev = [];
    try {
      var shC = bomSheet_(), CC = bomCols_(shC), vC = shC.getRange(3, 1, shC.getLastRow() - 2, CC.lc).getValues();
      vC.forEach(function (r) { var k = itemCodeKey_(r[CC.code]); if (reuse[k] && CC.common >= 0 && str_(r[CC.common]) !== '공용' && !(str_(r[CC.product]).toUpperCase() === str_(product).toUpperCase() && str_(r[CC.start]) === Number(round) + '차' && !str_(r[CC.end]))) cmPrev.push({ product: str_(r[CC.product]).toUpperCase(), code: k, start: str_(r[CC.start]), id: CC.id >= 0 ? str_(r[CC.id]) : '', prev: { common: str_(r[CC.common]) } }); });
    } catch (eP) { cmPrev = []; }
    try { if (bomNameSync_(reuse)) { bomDropCache_([str_(product).toUpperCase()]); var tag0 = res.logTag; var g = apiBomGet(str_(product).toUpperCase()); g.made = res.made; g.saved = res.saved; g.logTag = tag0; res = g; } } catch (eS) { /* 10분 작업이 맞춘다 */ }
    try { bomLogUndoAdd_(str_(product).toUpperCase(), res.logTag, cmPrev); } catch (eL) { /* 넘어간다 */ }
  }
  tm['공용맞추기'] = Date.now() - tw1;
  tm.total = Date.now() - tw0;
  res.timing = tm;
  return res;
}
/**
 * BOM 탭 맨 아래에 줄을 덧붙여도 되는지 — 탭 안 수식이 줄 범위를 못 박아(예: $D$3:$D$1950) 가리키면
 * 아래에 붙인 줄이 그 범위 밖이라 계산에서 빠진다(줄을 끼우면 범위가 저절로 늘어난다). 6시간 기억.
 */
/** 맨 아래에 덧붙여도 되는지 — 범위를 못 박은 수식(예: =SUM(R622:R630)*9%)이 '그 품목' 줄에 있으면 그 품목만 예전처럼 끼운다.
 *  예전엔 탭 어디든 하나만 있어도(H0017AA2 한 칸) 모든 품목 저장이 끼우기 → 전체 캐시 버림 · 다시 읽기로 느렸다.
 *  범위 수식이 있는 품목 목록을 캐시(6시간 · 품목코드라 줄이 밀려도 그대로) */
function bomAppendSafe_(sh, product) {
  var ck = 'bom:appendok:v2', list = null;
  try { var c0 = CacheService.getScriptCache().get(ck); if (c0) list = JSON.parse(c0); } catch (e) { list = null; }
  if (!list) {
    try {
      var C = bomCols_(sh), seen = {};
      sh.createTextFinder('[A-Z]+\\$?[0-9]+:\\$?[A-Z]+\\$?[0-9]+').useRegularExpression(true).matchFormulaText(true).findAll().forEach(function (rg) {
        var r = rg.getRow();
        if (r >= 3 && C.product >= 0) seen[str_(sh.getRange(r, C.product + 1).getValue()).toUpperCase() || '?'] = 1;
        else seen['?'] = 1;
      });
      list = Object.keys(seen);
    } catch (e) { return false; }               // 확인을 못 하면 예전처럼 끼운다
    try { CacheService.getScriptCache().put(ck, JSON.stringify(list), 21600); } catch (e) { /* 넘어간다 */ }
  }
  if (list.indexOf('?') > -1) return false;      // 품목을 알 수 없는 줄(머리글 등)에 있으면 예전처럼
  return list.indexOf(str_(product).toUpperCase()) < 0;
}
/** 원재료 구분은 더 등록하지 않는다(2026-10-20 담당자) — 새 줄 · 구분 바꾸기만 막고 이미 있는 줄은 그대로 */
function bomNoRawType_(t) {
  if (str_(t) === '원재료') throw new Error('원재료 구성은 더 등록하지 않습니다 — 다른 구분으로 넣어 주세요.');
}
function apiBomSaveCore_(product, round, changes, meta) {
  requireEditor_();
  product = str_(product).toUpperCase();
  var N = Number(round) || 0, nidA = null;
  if (!/^[A-Z]{1,2}\d{4}[A-Z]{2}\d+$/.test(product) || N < 1) throw new Error('품목코드 · 차수가 올바르지 않습니다.');
  changes = (changes || []).filter(function (c) { return c && (c.kind === 'add' || c.row); });
  changes.forEach(function (c) { if (c.kind === 'add' || c.type != null) bomNoRawType_(c.type); });
  if (!changes.length) throw new Error('저장할 변경이 없습니다.');
  meta = meta || {};
  // 단계별 시간(ms) — 화면이 속도 기록에 같이 남긴다(3초 넘은 저장은 _실행판_속도 탭 '서버 단계별')
  var TM = { n: changes.length }, tmAt = Date.now(), mk = function (k) { var n0 = Date.now(); TM[k] = (TM[k] || 0) + (n0 - tmAt); tmAt = n0; };
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  mk('잠금대기');
  var hist = [], made = [], logs = [];
  var who = me_(), batch = Utilities.getUuid().slice(0, 8);
  var addedRows = [], clearedCodes = [], clearedRows = [], hfRes = null;        // 핸들링피 넣을 새 줄(줄ID) · 지운 줄 코드(품목 DB 맞추기) — BomExtra.gs
  try {
    var ss = bomSS_(), sh = bomSheet_(), C = bomCols_(sh);
    var lastData = sh.getLastRow();
    // 이 품목 줄만 통째로 읽고, 다른 품목은 코드 · 제품코드 칸만(채번 · 겹침 확인용) — 예전: 2천 줄 × 27칸 전부
    var n0 = Math.max(0, lastData - 2);
    var pcol = n0 ? sh.getRange(3, C.product + 1, n0, 1).getValues() : [], ccol = n0 ? sh.getRange(3, C.code + 1, n0, 1).getValues() : [];
    var cc2 = pcol.map(function (r, i) { var o = []; o[C.product] = r[0]; o[C.code] = ccol[i][0]; return o; });
    var all = new Array(n0), mine = [];
    pcol.forEach(function (r, i) { if (str_(r[0]).toUpperCase() === product) mine.push(i + 3); });
    for (var mi = 0; mi < mine.length;) {
      var mj = mi; while (mj + 1 < mine.length && mine[mj + 1] === mine[mj] + 1) mj++;
      sh.getRange(mine[mi], 1, mj - mi + 1, C.lc).getValues().forEach(function (r, k) { all[mine[mi] - 3 + k] = r; });
      mi = mj + 1;
    }
    mk('BOM읽기');
    var isNew = !mine.length;
    if (isNew && !meta.newProduct) throw new Error('BOM 탭에 ' + product + ' 줄이 없습니다.');
    if (!isNew && meta.newProduct) throw new Error('품목코드 ' + product + ' 는 그사이 BOM이 생겼습니다(다른 사람이 같은 코드를 먼저 저장). [만들기]를 다시 눌러 새 코드를 받아 주세요.');
    if (isNew && cc2.some(function (r) { return str_(r[C.code]).toUpperCase() === product; })) throw new Error('품목코드 ' + product + ' 는 이미 다른 품목 BOM에 자재로 쓰이고 있습니다. 코드를 다시 확인해 주세요.');
    if (isNew && changes.some(function (c) { return c.kind !== 'add'; })) throw new Error('신제품 BOM은 자재 추가로만 만들 수 있습니다.');
    var used = {};
    try { used = bomKnownCodes_(); } catch (e) { used = {}; }
    cc2.forEach(function (r) { var c = str_(r[C.code]).toUpperCase(); if (c) used[c] = 1; var q = str_(r[C.product]).toUpperCase(); if (q) used[q] = 1; });
    bomRegCodes_().forEach(function (c0) { var c = c0.toUpperCase(); if (c) used[c] = 1; });
    var reg = ss.getSheetByName(RB_BOM_REG), RC = reg ? bomRegCols_(reg) : null;
    var nextVer = function (base) {
      var mx = 0;
      Object.keys(used).forEach(function (c) { if (c.indexOf(base) === 0) { var m = c.slice(base.length).match(/^(\d+)$/); if (m) mx = Math.max(mx, Number(m[1])); } });
      var code = base + (mx + 1); used[code] = 1; return { code: code, ver: mx + 1 };
    };
    var typeCodes = bomTypeCodes_(ss);
    var brand = isNew ? str_(meta.newProduct.brand) : str_(all[mine[0] - 3][C.brand]);
    var prodName = isNew ? str_(meta.newProduct.name) : '';
    if (!isNew) mine.forEach(function (r) { var x = all[r - 3]; if (str_(x[C.code]).toUpperCase() === product || str_(x[C.type]) === '제품') prodName = prodName || str_(x[C.name]); });
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yy/MM/dd');
    var note = function (txt, why) { return N + '차 ' + txt + (why ? ' (' + why + ')' : '') + ' · ' + stamp; };
    var regList = [];                                       // 품목 DB 등록 — BOM 탭 쓰기가 다 끝난 뒤(예전과 같은 순서로)
    var regRow = function (o) { regList.push(o); };
    var val = function (k, v) { return k === 'cur' ? bomCurNorm_(v) : (RB_BOM_NUMERIC[k] ? (str_(v) === '' ? '' : num_(v)) : str_(v)); };
    var show = function (k, v) { return str_(v) === '' ? '-' : (RB_BOM_NUMERIC[k] ? num_(v) : str_(v)); };

    changes.forEach(function (c) {
      if (c.kind === 'add') return;
      var r = Number(c.row), x = all[r - 3];
      // end: 화면에서 본 종료와 다르면(그사이 다른 사람이 이 줄을 바꿔 닫았으면) 막는다 — 안 막으면 같은 변경이 두 번 들어가 새 줄이 둘(원가 두 번)
      if (!x || str_(x[C.product]).toUpperCase() !== product || str_(x[C.code]).toUpperCase() !== str_(c.code).toUpperCase() || str_(x[C.start]) !== str_(c.start) ||
          (c.end !== undefined && str_(x[C.end]) !== str_(c.end)) || bomIdDiff_(C, x, c.id)) {      // 줄ID 도 — 줄 번호가 밀려 같은 코드 · 초도의 다른 줄(반제품마다 한 줄)을 잡지 않게
        throw new Error('BOM 시트가 그사이 바뀌었습니다(' + c.code + '). BOM 보기를 다시 열어 주세요.');
      }
    });
    // 원가 겹침(같은 자재 두 줄이 같은 차수에 다 원가) — 시트에 쓰기 전에 막는다
    if (!isNew) {
      var ckOff = {}, ckC = [];
      changes.forEach(function (c) {
        if (c.kind === 'add') {
          if (c.ck !== false) ckC.push({ r: 0, type: c.type, semi: '', code: c.reuse ? c.want : '', name: c.name, vendor: c.vendor, s: N, e: 99999 });
          return;
        }
        var r = Number(c.row), x = all[r - 3];
        if (c.remove || c.ck === false) { ckOff[r] = 1; return; }
        if (c.ck === true) {
          var eX = bomRnum_(x[C.end]);
          ckC.push({ r: r, type: x[C.type], semi: C.semi >= 0 ? x[C.semi] : '', code: x[C.code], name: c.name != null ? c.name : x[C.name], vendor: c.vendor != null ? c.vendor : x[C.vendor], s: N, e: eX && eX >= N ? eX : 99999 });
        }
      });
      if (ckC.length) bomCkClash_(mine.map(function (rr) { return { r: rr, x: all[rr - 3] }; }), C, ckC, ckOff);
    }
    // 새 줄 자리: 그 품목 마지막 줄 아래(신제품은 BOM 탭 맨 아래). 줄을 끼우면 아래 행 번호가 밀리므로 아래 줄부터 고친다.
    var lastRow = isNew ? lastData : mine[mine.length - 1];
    var key = function (c) { return c.kind === 'add' ? lastRow + 0.5 : Number(c.row); };
    var adds = changes.filter(function (c) { return c.kind === 'add'; });
    // 추가는 같은 자리(마지막 줄 아래)에 끼우므로 넣은 순서의 거꾸로 끼워야 화면 순서대로 쌓인다. 추가가 가장 아래라 먼저.
    // 덧붙이기: 줄을 품목 사이에 끼우지 않고 BOM 탭 맨 아래에 붙인다(끼우면 아래 1,900여 줄 수식이 모두 밀려 저장이 느렸다).
    // 반제품이 있는 품목은 '반제품 줄 바로 뒤 자재 = 그 반제품 구성'(줄 순서가 뜻)이라 예전처럼 끼운다. 탭 안에 범위를 못 박은 수식이 있어도 끼운다.
    var APP = !isNew && bomAppendSafe_(sh, product);             // 반제품 구성은 '반제품 구성' 칸으로 묶으니(2026-10-17 새 양식) 반제품이 있는 품목도 맨 아래에 붙여도 된다
    TM.app = APP ? 1 : 0;
    var SHIFT = !APP && !isNew;               // 품목 사이에 줄을 끼우면 아래 다른 품목 줄 번호가 밀린다(신제품은 맨 아래라 안 밀림)
    var ordered = (APP ? adds.slice() : adds.slice().reverse()).concat(changes.filter(function (c) { return c.kind !== 'add'; }).sort(function (a, b) { return key(b) - key(a); }));
    // 신제품을 국가별(대만 · 일본 등)로 여러 코드 만들 때: 같은 구성을 그 코드로 한 벌씩 더 만든다(자재코드는 같이 씀)
    var extra = isNew && meta.newProduct && meta.newProduct.extra ? meta.newProduct.extra.map(function (x) { return str_(x).toUpperCase(); }).filter(function (x) { return /^[A-Z]{1,2}\d{4}[A-Z]{2}\d+$/.test(x) && x !== product; }) : [];
    extra.forEach(function (ec) { if (cc2.some(function (r) { return str_(r[C.product]).toUpperCase() === ec || str_(r[C.code]).toUpperCase() === ec; })) throw new Error('국가별 코드 ' + ec + ' 는 그사이 BOM에 쓰였습니다. [만들기]를 다시 눌러 주세요.'); });

    // ① 계획: 코드 정하기 · 검사(오류가 날 수 있는 것)를 시트에 쓰기 전에 모두 끝낸다 — 검사에 걸리면 시트는 하나도 안 바뀐다
    var plan = [], renumMap = {};
    ordered.forEach(function (c) {
      var p = { c: c, why: str_(c.why).slice(0, 200), id: batch + '-' + (plan.length + 1) };
      if (c.kind === 'add') {
        var isProd = str_(c.type) === '제품' || str_(c.type) === '세트', code, ver = 1, tcode = '';
        // 세트 구성 완제품: 제품 줄인데 다른 완제품 코드를 적어 보냈으면 그 코드 그대로(이미 있는 코드라 새 코드 검사 없이)
        var compCode = isProd ? itemCodeKey_(c.want) : '';
        if (compCode && compCode !== product) {
          if (!/^[A-Z]\d{4}[A-Z]{2}\d+$/.test(compCode)) throw new Error('세트 구성 완제품 코드 형식이 아닙니다: ' + compCode + ' (예: H0007AA1)');
          code = compCode;
        }
        else if (isProd) { code = product; used[code] = 1; }
        else {
          tcode = typeCodes[str_(c.type)] || 'MS';
          // 기존 자재 그대로 쓰기(공용): 화면에서 품목 DB 의 코드를 골랐으면 새 코드 검사 없이 그 코드
          var reuseA = c.reuse ? itemCodeKey_(c.want) : '';
          var wantA = reuseA ? '' : bomWantCode_(c.want, used);
          if (reuseA) { code = reuseA; ver = Number((code.match(/(\d+)$/) || [0, 1])[1]); }
          else
          if (wantA) { code = wantA; used[code] = 1; ver = Number((code.match(/(\d+)$/) || [0, 1])[1]); }
          else if (str_(c.type) === '반제품') { var nvS = nextVer(product.charAt(0) + 'X' + bomNum_(product) + ((product.match(/^[A-Z]X?\d{4}([A-Z]{2})/) || [0, 'AA'])[1])); code = nvS.code; ver = nvS.ver; }   // 반제품 = 브랜드 + X + 번호 + 국가 + 버전(HX0080AA1)
          else { var nv = nextVer(product.charAt(0) + 'P' + bomNum_(product) + tcode); code = nv.code; ver = nv.ver; }
        }
        p.add = true; p.isProd = isProd; p.code = code; p.ver = ver; p.tcode = tcode;
        plan.push(p);
        return;
      }
      var x = all[Number(c.row) - 3];
      var oldCode = str_(x[C.code]).toUpperCase();
      var cur = function (k) { return C[k] >= 0 ? x[C[k]] : ''; };
      var setK = {};
      RB_BOM_EDIT.forEach(function (k) {
        if (c[k] === undefined || c[k] === null) return;
        if (RB_BOM_NUMERIC[k] ? (str_(c[k]) !== '' && num_(c[k]) !== num_(cur(k))) : str_(c[k]) !== str_(cur(k))) setK[k] = 1;
      });
      var anySet = Object.keys(setK).length > 0;
      if (!c.remove && !c.extend && !anySet) return;
      // 새 코드: 업체 · 데이터(사양) · 소요량이 바뀔 때만(채번 형식인 코드일 때). 단가 · MOQ 등은 코드 그대로.
      var renumber = !c.remove && (setK.vendor || setK.spec || setK.qty) && /^[A-Z]{2}\d{4}[A-Z]{2}\d+$/.test(oldCode);
      var newCode = oldCode, parts = [], before = [], after = [];
      // 같은 자재(같은 코드)를 같은 값으로 바꾼 줄이 여럿이면(반제품마다 한 줄씩 있는 자재) 새 코드도 하나 — 예전엔 줄마다 새 번호가 따로 나왔다
      var rnKey = renumber ? [oldCode, setK.vendor ? str_(c.vendor) : str_(cur('vendor')), setK.spec ? str_(c.spec) : str_(cur('spec')), setK.qty ? num_(c.qty) : num_(cur('qty')), str_(c.want).toUpperCase()].join('|') : '';
      if (renumber && renumMap[rnKey]) {
        newCode = renumMap[rnKey];
        parts.push('코드 ' + oldCode + ' → ' + newCode);
      } else
      if (renumber) {
        var base = oldCode.replace(/\d+$/, '');
        var wantR = bomWantCode_(c.want, used);
        var nv2 = wantR ? { code: wantR, ver: Number((wantR.match(/(\d+)$/) || [0, 1])[1]) } : nextVer(base);
        if (wantR) { used[wantR] = 1; base = wantR.replace(/\d+$/, ''); }
        newCode = nv2.code; renumMap[rnKey] = newCode;
        p.reg = { brand: brand, num: base.substr(2, 4), prodName: prodName, type: str_(x[C.type]), tcode: base.slice(-2), ver: nv2.ver, code: newCode, name: str_(c.name || x[C.name]) };
        parts.push('코드 ' + oldCode + ' → ' + newCode);
      }
      RB_BOM_EDIT.forEach(function (k) {
        if (!setK[k]) return;
        var a = show(k, cur(k)), b = show(k, c[k]);
        parts.push(RB_BOM_EDIT_LABEL[k] + ' ' + a + ' → ' + b);
        before.push(RB_BOM_EDIT_LABEL[k] + ' ' + a); after.push(RB_BOM_EDIT_LABEL[k] + ' ' + b);
      });
      if (c.remove) { parts = [oldCode + ' 빠짐']; before = ['사용']; after = ['빠짐']; }
      var kind = c.remove ? '빼기' : (c.extend && !anySet ? '이어 씀' : Object.keys(setK).map(function (k) { return RB_BOM_EDIT_LABEL[k]; }).join(' · ') + ' 변경');
      if (c.extend && !anySet) { parts = [x[C.end] + ' 종료 → ' + N + '차부터도 사용']; before = ['종료 ' + x[C.end]]; after = ['계속 사용']; }
      p.x = x; p.cur = cur; p.setK = setK; p.anySet = anySet; p.renumber = renumber; p.oldCode = oldCode; p.newCode = newCode;
      p.parts = parts; p.before = before; p.after = after; p.kind = kind;
      plan.push(p);
    });
    if (!plan.length) throw new Error('바뀐 값이 없습니다.');
    mk('계획');

    // ② 쓰기: 한 줄의 여러 칸은 모아서 한 번에(bomWriteRow_). 줄 끼우기 · 지우기 · 복사 · 소요원가 읽기 전에는 모은 것을 먼저 쓴다(put).
    var pend = {};
    var cell = function (row, k, v) { if (C[k] >= 0) (pend[row] = pend[row] || {})[C[k]] = v; };
    var put = function () { Object.keys(pend).forEach(function (rw) { bomWriteRow_(sh, Number(rw), pend[rw]); }); pend = {}; };
    var logRowOf = function (l) {
      return [new Date(), who, product, prodName, N + '차', l.kind, l.type, l.codeA, l.codeB, l.before, l.after, l.why,
        str_(meta.orderId) ? ((str_(meta.doc) + ' ' + str_(meta.name)).trim() + ' [' + str_(meta.orderId) + ']') : '', '유효', l.id, JSON.stringify(l.undo)];
    };
    try {
      plan.forEach(function (p) {
        var c = p.c, why = p.why, id = p.id;
        if (p.add) {
          var isProd = p.isProd, code = p.code;
          mk('쓰기');
          var nr;
          if (APP) { nr = sh.getLastRow() + 1; ensureRows_(sh, nr); }     // 맨 아래(같은 품목 마지막 줄을 본떠 수식 · 서식을 이어받는다)
          else { sh.insertRowAfter(lastRow); nr = lastRow + 1; }
          mk('줄끼우기');
          sh.getRange(lastRow, 1, 1, C.lc).copyTo(sh.getRange(nr, 1, 1, C.lc));        // 수식 칸(소요원가 등)을 이어받는다
          relaxRowValidation_(sh, nr, C.lc);                                             // 복사 뒤에(복사가 데이터 확인 규칙도 옮긴다)
          mk('줄복사');
          ['firstAt', 'common', 'place', 'remark', 'oldCode', 'change', 'semi', 'ord'].forEach(function (k) { cell(nr, k, ''); });      // 본뜬 줄의 반제품 구성 · 화면 순서는 안 따라오게(새 자재는 맨 아래)
          var addId = (nidA = nidA || bomIdGen_(sh, C))(); cell(nr, 'id', addId);
          if (c.reuse && !isProd) cell(nr, 'common', '공용');          // 다른 품목 자재를 그대로 쓰면 공용
          if (isNew) { cell(nr, 'seq', ''); cell(nr, 'brand', brand); cell(nr, 'product', product); cell(nr, 'search', prodName); }
          cell(nr, 'start', N + '차'); cell(nr, 'end', ''); cell(nr, 'code', code); cell(nr, 'type', str_(c.type));
          RB_BOM_EDIT.forEach(function (k) { cell(nr, k, val(k, c[k])); });
          if (!str_(c.name)) cell(nr, 'name', isProd ? prodName : (prodName + ' ' + str_(c.type)));
          if (!num_(c.qty)) cell(nr, 'qty', 1);
          var cu1 = bomCurNorm_(c.cur) || '원화'; cell(nr, 'cur', cu1); cell(nr, 'fx', cu1 === '원화' ? 1 : (num_(c.fx) || bomCurFx_(cu1)));
          cell(nr, 'costKey', c.ck === false ? '' : product);      // 화면에서 원가 체크를 끈 줄(이원화 둘째 업체 등)은 비움
          cell(nr, 'change', note((isNew ? '신제품 ' : '자재 추가 ') + code, why));
          put();
          bomFixCost_(sh, C, nr, null);
          addedRows.push(addId);                       // 줄 번호는 뒤에 끼우는 줄로 밀릴 수 있어 줄ID 로
          var isComp = (isProd && code !== product) || !!c.reuse;          // 세트 구성 완제품은 이미 있는 코드 — 새 코드로 등록하지 않는다
          if (!isComp) regRow(isProd ? { brand: brand, kind: /^[A-Z]X/.test(product) ? '반제품' : '제품', num: bomNum_(product), prodName: prodName, type: '', tcode: '', ver: Number((product.match(/(\d+)$/) || [0, 1])[1]), code: code, name: prodName }
                        : { brand: brand, num: bomNum_(product), prodName: prodName, type: str_(c.type), tcode: p.tcode, ver: p.ver, code: code, name: str_(c.name) || (prodName + ' ' + str_(c.type)) });
          if (!isComp) made.push(code);          // 가져온 기존 코드는 "새 코드"로 알리지 않는다
          logs.push({ id: id, kind: isNew ? '신제품 BOM' : '자재 추가', type: str_(c.type), codeA: '', codeB: code,
            before: '', after: [str_(c.vendor), num_(c.unit) ? num_(c.unit) + '원' : '', num_(c.moq) ? 'MOQ ' + num_(c.moq) : '', str_(c.spec)].filter(String).join(' · '), why: why,
            undo: { newRef: { code: code, start: N + '차', id: addId }, reg: c.reuse ? '' : (isProd ? (isNew && code === product ? product : '') : code) } });      // 신제품 BOM 을 되돌리면 그 제품코드도 품목 DB 에 미사용     // 이미 있던 코드(공용 자재 등)를 넣은 건 되돌려도 품목 DB 는 그대로
          hist.push({ kind: 'BOM', item: product + ' ' + N + '차 ' + (isNew ? '신제품 BOM' : '자재 추가'), after: code + ' ' + str_(c.type) + ' · ' + str_(c.vendor) + ' · ' + num_(c.unit) + '원', reason: why, where: 'BOM 시트 ' + nr + '행' });
          return;
        }
        var r = Number(c.row), x = p.x, s0 = bomRnum_(x[C.start]), e0 = bomRnum_(x[C.end]);
        var cur = p.cur, setK = p.setK, anySet = p.anySet, renumber = p.renumber, oldCode = p.oldCode, newCode = p.newCode;
        if (p.reg) { regRow(p.reg); made.push(newCode); }
        var undo = {}, target = r;
        var prevAll = { end: x[C.end], costKey: C.costKey >= 0 ? x[C.costKey] : '', code: x[C.code], cost: x[C.cost], change: x[C.change] };
        RB_BOM_EDIT.forEach(function (k) { prevAll[k] = cur(k); });
        if (c.extend && !anySet) {
          // 닫힌 줄을 이어 쓴다: 종료를 비운다(되돌리면 원래 종료)
          undo.inPlace = { code: oldCode, start: str_(x[C.start]), id: C.id >= 0 ? str_(x[C.id]) : '', prev: { end: x[C.end], costKey: prevAll.costKey, change: x[C.change] } };
          cell(r, 'end', '');                          // 원가 체크는 원래 줄 그대로(이원화 둘째 업체 줄이 원가에 끼지 않게)
        } else if (s0 === N && c.remove) {
          // 이 차수에 시작한 줄을 이 차수부터 빼면 한 번도 안 쓰는 줄 — 지운다(되돌리면 같은 자리에 되살림). 예전엔 종료가 초도보다 앞인 죽은 줄이 남았다.
          var rg0 = sh.getRange(r, 1, 1, C.lc), rv0 = rg0.getValues()[0];
          undo.v2 = 1; undo.v3 = 1; undo.restore = { at: r, soft: 1, vals: rv0.map(function (v) { return v instanceof Date ? { d: v.toISOString() } : v; }), fmls: rg0.getFormulasR1C1()[0] };
          rg0.clearContent();                          // 비운 뒤 저장 끝에 줄을 지운다(아래 줄부터 · 빈 줄을 남기지 않게)
          clearedCodes.push(oldCode); clearedRows.push(r);
          target = 0;
        } else if (s0 === N) {
          // 이 차수에 시작한 줄은 그 줄을 고친다(새 코드여도 그 줄 코드를 바꿈 — 되돌리면 원래 코드 · 값으로). 예전엔 새 코드면 이 줄을 종료(초도보다 앞)로 남겼다.
          undo.inPlace = { code: newCode, start: N + '차', id: C.id >= 0 ? str_(x[C.id]) : '', prev: prevAll };
          if (c.extend) cell(r, 'end', '');
        } else {
          undo.oldRef = { code: oldCode, start: str_(x[C.start]), id: C.id >= 0 ? str_(x[C.id]) : '', endNow: (N - 1) + '차', prevEnd: x[C.end], prevF: prevAll.costKey, prevCh: x[C.change] };
          cell(r, 'end', (N - 1) + '차');            // 원가 체크(F)는 그대로 — 끝난 줄도 그 차수까지의 원가에 들어간다
          if (!c.remove) {
            var oc = str_(x[C.change]);
            cell(r, 'change', (oc ? oc + ' / ' : '') + N + '차부터 ' + (renumber ? newCode + ' 로 바뀜' : '새 줄로 바뀜') + (s0 === N ? ' (이 줄은 쓰지 않음)' : ''));
            put();                                      // 원래 줄을 고친 뒤에 복사한다(예전과 같은 순서)
            mk('쓰기');
            if (APP) { target = sh.getLastRow() + 1; ensureRows_(sh, target); }
            else { sh.insertRowAfter(r); target = r + 1; }
            mk('줄끼우기');
            sh.getRange(r, 1, 1, C.lc).copyTo(sh.getRange(target, 1, 1, C.lc));
            relaxRowValidation_(sh, target, C.lc);           // 복사 뒤에(복사가 데이터 확인 규칙도 옮긴다)
            mk('줄복사');
            cell(target, 'start', N + '차');
            cell(target, 'end', !c.extend && e0 && e0 >= N ? x[C.end] : '');      // 원래 줄이 N차에 끝났으면 새 줄도 N차까지(다음 버전과 겹치지 않게)
            cell(target, 'firstAt', '');
            cell(target, 'oldCode', '');             // 원가 체크는 원래 줄에서 복사된 그대로
            var newId = (nidA = nidA || bomIdGen_(sh, C))(); cell(target, 'id', newId);
            undo.newRef = { code: newCode, start: N + '차', id: newId };
          }
        }
        if (target) {
          if (renumber) { cell(target, 'code', newCode); undo.reg = newCode; }
          RB_BOM_EDIT.forEach(function (k) { if (setK[k]) cell(target, k, val(k, c[k])); });
          // 같은 저장에서 원가 체크도 바꾼 줄 — 바뀐 뒤의 줄(이 차수부터 쓰는 줄)에 적는다(예전엔 저장 뒤 원래 줄 번호로 따로 적어 끝난 줄이 바뀌었다)
          if (!c.remove && typeof c.ck === 'boolean' && C.costKey >= 0) cell(target, 'costKey', c.ck ? product : '');
          cell(c.remove ? r : target, 'change', note(p.parts.join(' · '), why));
          put();
          if (!c.remove && (setK.unit || setK.qty || setK.proc || setK.ship || setK.fx)) bomFixCost_(sh, C, target, x);
        }
        put();
        logs.push({ id: id, kind: p.kind, type: str_(x[C.type]), codeA: oldCode, codeB: c.remove ? '' : newCode, before: p.before.join(' · '), after: p.after.join(' · '), why: why, undo: undo });
        hist.push({ kind: 'BOM', item: product + ' ' + N + '차 ' + str_(x[C.type]) + ' ' + p.kind, before: p.before.join(' · '), after: (renumber ? newCode + ' · ' : '') + p.after.join(' · '), reason: why, where: 'BOM 시트 ' + (target ? target + '행' : r + '행(지움)') });
      });
      // 이 제조사에 핸들링피가 정해져 있으면 새 줄 배송비/기타 칸에 수식(국가별 코드 줄은 아래 복사로 같이 따라간다)
      if (addedRows.length) { try { hfRes = hfApplyRows_(sh, C, product, null, null, addedRows); } catch (eHf) { hfRes = { err: String(eHf && eHf.message || eHf).slice(0, 120) }; } }
      var extraLogs = [];
      if (extra.length && adds.length) {
        var k = adds.length, first = lastRow + 1, at = lastRow + k;
        extra.forEach(function (ec) {
          sh.insertRowsAfter(at, k);
          sh.getRange(first, 1, k, C.lc).copyTo(sh.getRange(at + 1, 1, k, C.lc));
          for (var rq = 1; rq <= k; rq++) relaxRowValidation_(sh, at + rq, C.lc);       // 복사 뒤에(복사가 데이터 확인 규칙도 옮긴다)
          var codes0 = sh.getRange(at + 1, C.code + 1, k, 1).getValues(), ck0 = C.costKey >= 0 ? sh.getRange(at + 1, C.costKey + 1, k, 1).getValues() : [];
          var refs = [], colP = [], colK = [], colH = [], colC = [], colI = [];
          for (var i = 1; i <= k; i++) {
            var rr = at + i;
            colP.push([rr, ec]); colK.push([rr, ck0[i - 1] && str_(ck0[i - 1][0]) ? ec : '']);      // 원가 체크를 끈 줄(이원화 둘째 업체)은 그대로 빈 칸
            colI.push([rr, (nidA = nidA || bomIdGen_(sh, C))()]);
            var cc0 = str_(codes0[i - 1][0]).toUpperCase();
            if (cc0 === product) { colC.push([rr, ec]); cc0 = ec; }
            colH.push([rr, note('신제품 ' + ec + ' (' + product + ' 와 같은 구성)', '')]);
            refs.push({ code: cc0, start: N + '차' });
          }
          // 칸마다 쓰지 않고 칸(열)마다 한 번에 — 제품코드 · 원가반영 · 자재코드(제품 줄) · 변동사항
          [['product', colP], ['costKey', colK], ['code', colC], ['change', colH], ['id', colI]].forEach(function (q) { if (C[q[0]] >= 0) bomSetColRuns_(sh, C[q[0]] + 1, q[1]); });
          regRow({ brand: brand, kind: '제품', num: bomNum_(ec), prodName: prodName, type: '', tcode: '', ver: Number((ec.match(/(\d+)$/) || [0, 1])[1]), code: ec, name: prodName });
          made.push(ec);
          extraLogs.push([new Date(), who, ec, prodName, N + '차', '신제품 BOM', '제품', '', ec, '', product + ' 와 같은 구성 ' + k + '줄', '국가별 코드 함께 생성', '', '유효', batch + '-x' + ec, JSON.stringify({ newRefs: refs, regs: [ec] })]);
          bomDropCache_([ec]);
          at += k;
        });
      }
      if (clearedRows.length && bomDropBlankRows_(sh, C, clearedRows)) SHIFT = true;      // 비운 줄을 지운다 — 아래 줄 번호가 밀리니 캐시는 통째로
      mk('쓰기');
      SpreadsheetApp.flush();
      mk('반영1');
    } catch (eW) {
      // 신제품 BOM 은 넣은 줄이 모두 맨 아래라 통째로 걷어낼 수 있다. 기존 품목은 고친 줄이 섞여 있어 알리기만 한다.
      if (isNew) {
        try { var lr1 = sh.getLastRow(); if (lr1 > lastData) sh.deleteRows(lastData + 1, lr1 - lastData); SpreadsheetApp.flush(); } catch (eDel) { /* 지우기도 실패하면 아래 오류로 알린다 */ }
        throw new Error('신제품 BOM을 저장하지 못해 넣던 줄을 지웠습니다(시트는 그대로): ' + eW.message);
      }
      // 이미 쓴 줄(logs 에 든 것)은 변경 이력에 남긴다 — 되돌리기 · 확인이 되게(예전엔 이력 없이 시트만 바뀐 채 남았다)
      var wroteN = 0;
      if (logs.length) { try { bomLogWrite_(ss, logs.map(logRowOf)); SpreadsheetApp.flush(); wroteN = logs.length; } catch (eL) { /* 아래 오류로 알린다 */ } }
      bomDropCache_([product]);
      if (SHIFT) bomDropAllRows_();
      throw new Error('BOM 시트에 쓰다가 멈췄습니다 — 일부만 저장됐을 수 있습니다' + (wroteN ? '(먼저 쓴 ' + wroteN + '건은 BOM변경이력에 남김 · 되돌리기 가능)' : '') + '. 변경 이력에서 확인해 주세요: ' + eW.message);
    }
    SpreadsheetApp.flush();
    bomRegisterMany_(reg, RC, regList, '신규코드 발급 · BOM 저장');
    mk('채번등록');
    if (isNew) {
      try { bomRegFromRows_([product].concat(extra), '실행판 신제품 BOM ' + product); } catch (e0) { /* 아래 */ }      // 제품 줄 업체(제조사)까지
      try { appendItems_([product].concat(extra).map(function (pc) { return { code: pc, name: prodName, brand: brand }; }), '실행판 신제품 BOM ' + product); } catch (e) { /* 넘어간다 */ }
    }
    bomLogWrite_(ss, logs.map(logRowOf).concat(extraLogs));
    mk('변경이력');
    if (clearedCodes.length) { try { made.dropped = itemDbDropOrphans_(clearedCodes, '자재 빼기(이 차수에 넣은 줄)', product); } catch (eDr) { /* 품목 정보 [삭제]로 */ } }
    SpreadsheetApp.flush();
    mk('반영2');
  } finally {
    lock.releaseLock();
  }
  bomAfterSave_([product].concat(extra || []), SHIFT);     // 줄 번호가 안 밀렸으면 이 품목(+국가별 코드)만 다시 읽는다
  mk('캐시');
  try {
    appendHist_(hist.map(function (h) { h.id = str_(meta.orderId); h.doc = str_(meta.doc); h.code = product; h.name = str_(meta.name); return h; }), 'p');
  } catch (e) { /* 이력 실패가 저장을 막지 않는다 */ }
  mk('이력');
  var unitCodes = changes.filter(function (c) { return c.kind !== 'add' && !c.remove && (c.unit != null || c.fx != null || c.cur != null); }).map(function (c) { return c.code; })
    .concat(made);                                       // 새 번호(업체 · 사양 변경 · 자재 추가)는 그 코드로
  if (unitCodes.length) { try { itemDbPriceSync_(unitCodes); } catch (ePs) { /* 넘어간다 */ } }
  mk('품목단가');
  var fresh = apiBomGet(product);
  mk('다시읽기');
  fresh.hf = hfRes;
  fresh.dropped = made.dropped || [];
  fresh.made = made;
  fresh.saved = logs.length;
  fresh.timing = TM;
  fresh.logTag = batch;
  return fresh;
}

/**
 * 화면: [이 차수 구성 정정] — 잘못 넣은 값을 바로잡는다. 변경이 아니라서 코드 · 차수는 그대로, 새 줄도 만들지 않고 그 줄을 고친다.
 *   한 줄은 여러 차수에 걸쳐 쓰이므로(예: 1차~계속) 그 줄이 걸친 차수 전부가 같이 고쳐진다 — 화면이 저장 전에 보여준다.
 *   업체 · 사양 · 품목명(자재 자체 정보)은 같은 품목 안에서 같은 자재코드를 쓰는 다른 줄(단가만 바뀐 이전 줄)도 같이 고친다 — 다른 품목 BOM은 건드리지 않는다
 *   (예전 값이 같은 줄만). 단가 · MOQ · 소요량 · 임가공 · 배송비 · 매입정보 · 구분 · 초도 · 종료는 그 줄만.
 * items = [{ row, code, start, fields: { 칸: 새 값 } }], dry = true 면 쓰지 않고 고쳐질 줄 목록만 돌려준다.
 * BOM변경이력에 줄마다 '정정'(되돌리기 가능 · 같이 고친 줄도 함께 되돌림).
 */
// code = 자재코드 바로잡기(잘못 적힌 코드 → 품목 DB · 신규코드채번에 있는 코드). 새 코드를 만드는 게 아니라 이미 있는 코드로만.
var RB_BOM_FIX = RB_BOM_EDIT.concat(['type', 'start', 'end', 'code', 'semi', 'common']);      // 반제품 구성 = [구성 고르기](정정과 한 번에 저장) · 공용여부는 apiBomFixMany commons 로 모든 품목 줄 같이
var RB_BOM_FIX_LAB = { type: '구분', start: '초도', end: '종료', code: '자재코드', semi: '반제품 구성', common: '공용여부' };
var RB_BOM_MAT = { name: 1, vendor: 1, spec: 1, code: 1 };

/** 자재코드 정정에 쓸 수 있는 코드인지 — 품목 DB(_실행판_품목) 또는 신규코드채번 탭에 있어야 한다 */
function bomCodeRegistered_(code) {
  var k = str_(code).toUpperCase().replace(/\s/g, '');
  if (!k) return false;
  try { if (readItems_().some(function (it) { return it.code === k; })) return true; } catch (e) { /* 아래 */ }
  return bomRegCodes_().some(function (c) { return c.toUpperCase().replace(/\s/g, '') === k; });
}
/**
 * 옛 신규코드채번 탭의 신규코드 칸(글자 그대로) — 한 실행 안에서는 한 번만 읽는다(정정 · 저장 한 번에 줄마다 · 두 번씩 읽던 것).
 * 이 탭에는 더 쓰지 않으므로(코드 등록처는 품목 DB) 실행 도중 바뀌지 않는다. 탭이 없거나 못 읽으면 빈 목록.
 */
var RB_BOM_REG_MEMO = null;
function bomRegCodes_() {
  if (RB_BOM_REG_MEMO) return RB_BOM_REG_MEMO;
  var out = [];
  try {
    var reg = bomSS_().getSheetByName(RB_BOM_REG);
    if (reg && reg.getLastRow() > 2) {
      var RC = bomRegCols_(reg);
      if (RC.code >= 0) out = reg.getRange(3, RC.code + 1, reg.getLastRow() - 2, 1).getValues().map(function (r) { return str_(r[0]); });
    }
  } catch (e) { out = []; }
  RB_BOM_REG_MEMO = out;
  return out;
}
/**
 * 한 품목 줄만 읽는다: 제품코드 칸(1칸)으로 그 품목 줄을 찾고, 이어진 줄끼리 읽어 BOM 탭 줄 번호 자리(0 = 3행)에 넣은 배열(나머지 자리는 비어 있음).
 * 정정 · 원가 체크처럼 한 품목만 고치는 저장이 2천 줄 × 27칸을 통째로 읽지 않게.
 */
function bomReadProduct_(sh, C, product) {
  var lr = sh.getLastRow(), n = Math.max(0, lr - 2), out = new Array(n);
  if (!n) return out;
  var ps = sh.getRange(3, C.product + 1, n, 1).getValues(), rows = [];
  ps.forEach(function (r, i) { if (str_(r[0]).toUpperCase() === product) rows.push(i); });
  for (var i = 0; i < rows.length;) {
    var j = i; while (j + 1 < rows.length && rows[j + 1] === rows[j] + 1) j++;
    sh.getRange(rows[i] + 3, 1, j - i + 1, C.lc).getValues().forEach(function (r, k) { out[rows[i] + k] = r; });
    i = j + 1;
  }
  return out;
}
/** 정정 저장 한 번 = 잠금 한 번(apiBomFixMany 가 잡고 있으면 안쪽 함수는 다시 잡지 않는다) */
var RB_BOM_HELD = false;
function bomLock_() {
  if (RB_BOM_HELD) return { releaseLock: function () {} };
  var l = LockService.getScriptLock(); waitLock_(l); return l;
}
/**
 * [이대로 정정] — 칸 정정(items) · 반제품 공용 한 줄 더(shares) · 공용 표시(commons)를 <b>한 번에 · 전부 아니면 하나도</b>.
 *  · 잠금 한 번 안에서: 먼저 정정을 미리 계산해 막히는지 보고(쓰기 전) → 공용 줄 붙이기(맨 아래) → 칸 정정 → 공용 표시.
 *  · 중간에 실패하면 이미 붙인 공용 줄을 지우고 원래 줄 공용 표시도 되돌린 뒤 '저장하지 않음'으로 알린다.
 */
function apiBomFixMany(product, items, why, dry, shares, commons) {
  items = items || []; shares = (shares || []).slice(0, 20); commons = (commons || []).slice(0, 200);
  product = str_(product).toUpperCase();
  if (dry) return apiBomFixManyCore_(product, items, why, true);
  requireEditor_();
  if (!str_(why)) throw new Error('정정 사유를 적어 주세요.');
  var ren = bomRenamesFrom_(product, items.map(function (it) { var f = (it && it.fields) || {}; return { row: it && it.row, name: f.name, vendor: f.vendor, spec: f.spec, newCode: f.code && itemCodeKey_(f.code) !== itemCodeKey_(it.code) }; }));
  var ts = Date.now(), tm = {}, shared = 0, commonN = 0, res = null, done = [];
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  RB_BOM_HELD = true;
  try {
    if (items.length && shares.length) apiBomFixManyCore_(product, items, why, true);   // 공용 줄을 먼저 붙이니, 막히는 정정이면 붙이기 전에 여기서 멈춘다(공용 줄이 없으면 정정 안에서 쓰기 전에 다 확인한다)
    tm['확인'] = Date.now() - ts;
    var t1 = Date.now();
    shares.forEach(function (sh) {
      try { var r = apiBomSemiShare(product, sh.semi, sh.items, why + ' · 반제품 공용', true); shared += r.shared || 0; done.push(r); }
      catch (eS) { if (!/이미 그 반제품 구성에 모두/.test(String(eS && eS.message || eS))) throw eS; }
    });
    tm['공용 줄 더'] = Date.now() - t1; t1 = Date.now();
    if (items.length) {
      try { res = apiBomFixManyCore_(product, items, why, false); }
      catch (eI) { if (!(/^바뀐 값이 없습니다/.test(String(eI && eI.message)) && (shares.length || commons.length))) throw eI; }   // 칸은 그대로(빈칸 차이 등)이고 공용 줄 · 표시만 있으면 그것만
    }
    tm['정정'] = Date.now() - t1; t1 = Date.now();
    if (commons.length) commonN = bomCommonSetMany_(commons);
    tm['공용 표시'] = Date.now() - t1;
  } catch (e) {
    var em = String((e && e.message) || e || '').replace(/^Error:\s*/, '');
    // 칸 정정까지 시트에 썼으면(공용 표시에서 멈춤) 되돌리지 않고 어디까지 됐는지 알린다 — 예전엔 '저장하지 않았습니다'라고 했지만 정정은 남아 있었다
    if (/일부만 저장됐을 수/.test(em)) throw new Error(em);          // 정정 쓰기 도중 멈춤 — 공용 줄을 걷어내면 더 어긋난다
    if (res) throw new Error(em + ' — 일부만 저장됐을 수 있습니다: 칸 정정 ' + (res.fixed || 0) + '줄' + (shared ? ' · 반제품 공용 ' + shared + '줄' : '') + '은 저장됐고(BOM변경이력에 남음), 공용 표시는 저장하지 못했습니다. 변경 이력에서 확인해 주세요.');
    var back = bomShareRollback_(product, done);
    throw new Error(em + (back ? ' — 저장하지 않았습니다(붙였던 공용 줄 ' + back + '줄도 되돌림).' : ' — 저장하지 않았습니다.'));
  } finally {
    RB_BOM_HELD = false;
    lock.releaseLock();
  }
  var t2 = Date.now();
  try { bomLogDbPrev_(product, res && res.logTag, bomRenameApply_(ren)); } catch (eR) { /* 이름 맞추기는 10분 작업이 다시 */ }
  if (!res || shared || commonN) { var g = apiBomGet(product); if (res) ['fixed', 'deleted', 'others'].forEach(function (k) { g[k] = res[k]; }); else g.fixed = 0; res = g; }
  tm['끝'] = Date.now() - t2; tm.n = items.length;
  res.timing = tm; res.shared = shared; res.commonN = commonN;
  return res;
}
/** 정정 저장이 중간에 막혔을 때: 그 저장에서 붙인 공용 줄(맨 아래)을 지우고 원래 줄 공용 표시 · 이력을 되돌린다 */
function bomShareRollback_(product, done) {
  if (!done || !done.length) return 0;
  var n = 0;
  try {
    var ss = bomSS_(), sh = bomSheet_(), C = bomCols_(sh);
    var rows = [];
    done.forEach(function (d) { (d.made || []).forEach(function (m) { rows.push(m); }); });
    rows.sort(function (a, b) { return b.r - a.r; }).forEach(function (m) {
      var x = sh.getRange(m.r, 1, 1, C.lc).getValues()[0];
      if (str_(x[C.product]).toUpperCase() === product && str_(x[C.code]).toUpperCase() === m.code) { sh.deleteRow(m.r); n++; }
    });
    done.forEach(function (d) { (d.cmPrev || []).forEach(function (p) { if (C.common >= 0) sh.getRange(p[0], C.common + 1).setValue(p[1]); }); });
    var lg = ss.getSheetByName(RB_BOM_LOG);
    if (lg && lg.getLastRow() > 1) {
      var ids = lg.getRange(2, 15, lg.getLastRow() - 1, 1).getValues();
      done.forEach(function (d) { for (var i = ids.length - 1; i >= 0; i--) if (str_(ids[i][0]) === d.logId) { lg.getRange(i + 2, 14).setValue('취소(저장 실패)'); break; } });
    }
    SpreadsheetApp.flush();
  } catch (eB) { try { console.log('공용 줄 되돌리기 실패: ' + eB.message); } catch (e2) { /* 넘어간다 */ } }
  bomAfterSave_([product], true);
  return n;
}
function apiBomFixManyCore_(product, items, why, dry) {
  requireEditor_();
  product = str_(product).toUpperCase();
  why = str_(why).slice(0, 200);
  if (!dry && !why) throw new Error('정정 사유를 적어 주세요.');
  items = items || [];
  if (!items.length) throw new Error('바뀐 값이 없습니다.');
  items.forEach(function (it) { if (it && it.fields && it.fields.type != null) bomNoRawType_(it.fields.type); });      // 원재료는 더 등록하지 않는다
  var lock = dry ? null : bomLock_();
  var plan = [], logs = [], touched = {}, delShift = false;
  try {
    var ss = bomSS_(), sh = bomSheet_(), C = bomCols_(sh);
    var all = bomReadProduct_(sh, C, product);           // 이 품목 줄만(나머지는 빈 자리) — 예전: BOM 탭 전체(2천 줄 × 27칸)를 두 번 읽었다
    var num = function (k) { return RB_BOM_NUMERIC[k]; };
    var same = function (k, a, b) { return num(k) ? (str_(a) === '' || str_(b) === '' ? str_(a) === str_(b) : num_(a) === num_(b)) : str_(a) === str_(b); };
    var lab = function (k) { return RB_BOM_EDIT_LABEL[k] || RB_BOM_FIX_LAB[k] || k; };
    var shown = function (v) { return str_(v) === '' ? '-' : str_(v); };
    var taken = {};
    // 줄 삭제(잘못 들어간 줄): 그 줄은 시트에서 지운다 — 같은 줄의 칸 고치기는 무시
    var delRows = {};
    var delPlan = items.filter(function (it) { return it.del; }).map(function (it) {
      var r = Number(it.row), x = all[r - 3];
      if (!x || str_(x[C.product]).toUpperCase() !== product || str_(x[C.code]).toUpperCase() !== str_(it.code).toUpperCase() || str_(x[C.start]) !== str_(it.start) ||
          (it.end !== undefined && str_(x[C.end]) !== str_(it.end)) || bomIdDiff_(C, x, it.id)) {      // 종료도 — 그사이 다른 사람이 새 차수로 나눴으면 막는다 · 줄ID 가 오면 그것도
        throw new Error('BOM 시트가 그사이 바뀌었습니다(' + it.code + '). BOM 보기를 다시 열어 주세요.');
      }
      delRows[r] = 1;
      return { r: r, code: str_(x[C.code]), start: str_(x[C.start]), end: str_(x[C.end]), type: str_(x[C.type]), vendor: str_(x[C.vendor]) };
    });
    items = items.filter(function (it) { return !it.del && !delRows[Number(it.row)]; });
    var knownFx = null, newCodes = {};
    items.forEach(function (it) {
      var r = Number(it.row), x = all[r - 3];
      if (!x || str_(x[C.product]).toUpperCase() !== product || str_(x[C.code]).toUpperCase() !== str_(it.code).toUpperCase() || str_(x[C.start]) !== str_(it.start) ||
          (it.end !== undefined && str_(x[C.end]) !== str_(it.end)) || bomIdDiff_(C, x, it.id)) {      // 종료도 — 그사이 다른 사람이 새 차수로 나눴으면 막는다 · 줄ID 가 오면 그것도
        throw new Error('BOM 시트가 그사이 바뀌었습니다(' + it.code + '). BOM 보기를 다시 열어 주세요.');
      }
      var f = it.fields || {}, set = {}, pv = it.prev || {};
      // 화면에 보였던 값(prev)과 시트 값이 다르면 — 다른 사람이 그사이 고친 칸. 덮어쓰지 않는다
      Object.keys(pv).forEach(function (k) {
        if (C[k] < 0 || f[k] === undefined || f[k] === null) return;
        if (!same(k, x[C[k]], num(k) ? (str_(pv[k]) === '' ? '' : num_(pv[k])) : pv[k])) throw new Error(it.code + ' ' + lab(k) + ' 칸을 그사이 다른 사람이 고쳤습니다(지금 ' + shown(x[C[k]]) + '). BOM 보기를 다시 열어 확인해 주세요.');
      });
      RB_BOM_FIX.forEach(function (k) {
        if (C[k] < 0 || f[k] === undefined || f[k] === null) return;
        var nv = num(k) ? (str_(f[k]) === '' ? '' : num_(f[k])) : (k === 'cur' ? bomCurNorm_(f[k]) : (k === 'code' ? str_(f[k]).toUpperCase().replace(/\s/g, '') : str_(f[k])));
        if (k === 'cur' && !nv) return;
        if (same(k, x[C[k]], nv)) return;
        if ((k === 'start' || k === 'end') && str_(nv) !== '' && !/^\d+\s*차$|^단종$/.test(str_(nv))) throw new Error(lab(k) + ' 칸은 "5차" 처럼 넣어 주세요.');
        if (k === 'start' && str_(nv) === '') throw new Error('초도 칸은 비울 수 없습니다.');
        if (k === 'code') {
          if (!nv) throw new Error('자재코드는 비울 수 없습니다.');
          if (str_(x[C.type]) === '제품' || str_(x[C.code]).toUpperCase() === product) throw new Error('제품 줄의 코드는 여기서 바꾸지 않습니다(품목코드가 바뀌면 [새 품목코드로 저장]).');
          if (!bomCodeRegistered_(nv)) {
            // 사양 · 업체가 바뀌었는데 번호를 안 올린 줄을 새 번호로(사람이 확인하고 적은 코드). 형식 · 다른 자재와 겹침만 막는다
            if (!/^[A-Z]{1,2}\d{4}[A-Z]{2}\d+$/.test(nv)) throw new Error('자재코드 ' + nv + ' 는 코드 형식이 아닙니다(예: MP0159BL3).');
            if (!knownFx) { try { knownFx = bomKnownCodes_(); } catch (eK) { knownFx = {}; } }
            if (!knownFx[nv]) newCodes[r] = nv;            // 처음 쓰는 번호 → 이 줄만 · 저장 뒤 품목 DB 등록
            else {                                         // 이미 다른 줄이 쓰는 번호 — 같은 자재(구분 · 업체 · 사양 같음)일 때만
              var wantV = norm_(f.vendor != null ? f.vendor : x[C.vendor]), wantS = C.spec >= 0 ? norm_(f.spec != null ? f.spec : x[C.spec]) : '';
              var diff = all.filter(function (y, yi) { return yi !== r - 3 && itemCodeKey_(y[C.code]) === nv && (str_(y[C.type]) !== str_(x[C.type]) || norm_(y[C.vendor]) !== wantV || (C.spec >= 0 && norm_(y[C.spec]) !== wantS)); });
              if (diff.length) throw new Error(nv + ' 는 다른 자재(' + str_(diff[0][C.product]) + ' ' + str_(diff[0][C.type]) + ' · ' + str_(diff[0][C.vendor]) + ')가 쓰는 코드입니다. 같은 자재면 업체 · 사양을 그 줄과 맞추고, 다른 자재면 다른 번호로 해 주세요.');
            }
          }
        }
        set[k] = nv;
      });
      if (!Object.keys(set).length) return;
      var s1 = bomRnum_(set.start !== undefined ? set.start : x[C.start]), e1v = set.end !== undefined ? set.end : x[C.end], e1 = bomRnum_(e1v);
      if ((set.start !== undefined && str_(set.start) && !(s1 >= 1)) || (set.end !== undefined && str_(set.end) && str_(set.end) !== '단종' && e1 !== null && !(e1 >= 1))) throw new Error(it.code + ' 차수는 1차 이상이어야 합니다(0차는 없음).');
      if (s1 && e1 && str_(e1v) !== '단종' && e1 < s1) throw new Error(it.code + ' 종료(' + str_(e1v) + ')가 초도(' + s1 + '차)보다 앞입니다. 이러면 어느 차수에도 안 들어갑니다 — 줄을 빼려면 [빼기]를 써 주세요.');
      if (set.vendor !== undefined && !str_(set.vendor) && str_(x[C.type]) !== '제품') throw new Error(it.code + ' 업체 칸을 비울 수 없습니다.');
      var me = { r: r, product: product, code: str_(x[C.code]), start: str_(x[C.start]), end: str_(x[C.end]), type: str_(x[C.type]), set: set, old: x, own: true, from: '' };
      plan.push(me); taken[r] = 1;
      // 같은 자재코드를 쓰는 다른 줄: 자재 자체 정보만, 예전 값이 같은 줄만
      Object.keys(set).forEach(function (k) {
        if (!RB_BOM_MAT[k]) return;
        if (k === 'code' && newCodes[r]) return;          // 새 번호는 이 줄만(앞 차수 줄은 옛 코드 그대로)
        var sameSpecOnly = k === 'code';                  // 코드 바로잡기는 사양까지 같은 줄만 같이(사양이 다른 앞 · 뒤 차수 줄은 다른 자재)
        for (var i = 0; i < all.length; i++) {
          var y = all[i], rr = i + 3;
          if (!y) continue;
          // 같은 품목 안의 같은 자재코드 줄만(단가만 바뀐 이전 줄 등) — 다른 품목(이전 버전 · 국가별 코드) BOM은 건드리지 않는다
          if (rr === r || str_(y[C.product]).toUpperCase() !== product || str_(y[C.code]).toUpperCase() !== me.code.toUpperCase() || !same(k, y[C[k]], x[C[k]])) continue;
          if (sameSpecOnly && C.spec >= 0 && norm_(y[C.spec]) !== norm_(x[C.spec])) continue;
          var o = plan.filter(function (q) { return q.r === rr; })[0];
          if (o && o.own) continue; // 화면에서 같이 고친 줄이면 화면 값대로
          if (!o) {
            o = { r: rr, product: str_(y[C.product]).toUpperCase(), code: str_(y[C.code]), start: str_(y[C.start]), end: str_(y[C.end]), type: str_(y[C.type]), set: {}, old: y, own: false, from: me.code };
            plan.push(o);
          }
          o.set[k] = set[k];
        }
      });
    });
    // 반제품 줄 코드를 다른 번호로 바로잡으면(줄기가 바뀜) 그 구성 자재의 반제품 구성 칸도 새 코드로 — 예전엔 구성이 끊겨 반제품 단가 · 발주에서 빠졌다
    if (C.semi >= 0) plan.slice().forEach(function (me) {
      if (!me.own || me.type !== '반제품' || me.set.code === undefined) return;
      var oldK = bomSemiKey_(me.code), newC = str_(me.set.code).toUpperCase();
      if (oldK === bomSemiKey_(newC)) return;
      var still = all.some(function (y, yi) { return y && yi + 3 !== me.r && str_(y[C.product]).toUpperCase() === product && str_(y[C.type]) === '반제품' && bomSemiKey_(y[C.code]) === oldK && !plan.some(function (q) { return q.r === yi + 3 && q.set.code !== undefined; }); });
      if (still) return;                                  // 같은 반제품의 다른 버전 줄이 남아 있으면 구성은 그 줄 것
      all.forEach(function (y, yi) {
        var rr = yi + 3;
        if (!y || delRows[rr] || str_(y[C.product]).toUpperCase() !== product || bomSemiKey_(y[C.semi]) !== oldK || str_(y[C.semi]) === '*') return;
        var o = plan.filter(function (q) { return q.r === rr; })[0];
        if (o && o.set.semi !== undefined) return;
        if (!o) { o = { r: rr, product: product, code: str_(y[C.code]), start: str_(y[C.start]), end: str_(y[C.end]), type: str_(y[C.type]), set: {}, old: y, own: false, from: me.code }; plan.push(o); }
        o.set.semi = newC;
      });
    });
    // 품목 DB 에 있는 코드의 품목명 · 업체 · 사양을 고치면 저장 뒤 품목 DB 도 바뀌고(bomRenameApply_) 그 코드를 쓰는 모든 BOM 줄이 같이 맞춰진다(bomNameSync_ · 다른 품목 포함).
    // 그 줄을 미리 계획에 넣어 직접 고친다 — 확인 목록 · BOM변경이력(그 품목 이력에도) · 되돌리기에 보이게. 규칙은 bomNameSync_ 와 같다(품목명은 모든 줄 · 업체 · 사양은 지금 쓰는 줄과 빈 칸만, 제품 자기 줄 빼고)
    var dbIt = null, wide = null;
    plan.slice().forEach(function (me) {
      if (!me.own || me.set.code !== undefined) return;
      var ks = ['name', 'vendor', 'spec'].filter(function (k) { return me.set[k] !== undefined && C[k] >= 0 && str_(me.set[k]).trim(); });
      if (!ks.length) return;
      if (!dbIt) { dbIt = {}; try { readItems_().forEach(function (it) { dbIt[it.code] = it; }); } catch (eDb) { /* 품목 DB 를 못 읽으면 맞추기도 없다 */ } }
      var code = itemCodeKey_(me.code), it = dbIt[code];
      if (!it) return;
      ks = ks.filter(function (k) { return str_(me.set[k]).trim() !== str_(it[k]); });
      if (!ks.length) return;
      if (!wide) { var lrW = sh.getLastRow(); wide = lrW > 2 ? sh.getRange(3, 1, lrW - 2, C.lc).getValues() : []; }
      wide.forEach(function (y, yi) {
        var rr = yi + 3;
        if (rr === me.r || delRows[rr] || itemCodeKey_(y[C.code]) !== code) return;
        var yp = str_(y[C.product]).toUpperCase();
        ks.forEach(function (k) {
          var v = str_(y[C[k]]), want = str_(me.set[k]).trim();
          if (v === want) return;
          if (k !== 'name' && (yp === code || (v && str_(y[C.end]) !== ''))) return;      // 끝난 차수 줄은 그때 기록 그대로(빈 칸만 채움)
          var o = plan.filter(function (q) { return q.r === rr; })[0];
          if (o && (o.own || o.set[k] !== undefined)) return;
          if (!o) { o = { r: rr, product: yp, code: str_(y[C.code]), start: str_(y[C.start]), end: str_(y[C.end]), type: str_(y[C.type]), set: {}, old: yp === product && all[rr - 3] ? all[rr - 3] : y, own: false, from: me.code }; plan.push(o); }
          o.set[k] = want;
        });
      });
    });
    // 화면에서 직접 고친 줄이 다른 줄 덕에 이미 들어갔다면 화면 줄로 합친다(위에서 own 은 건너뜀)
    plan = plan.filter(function (q) { return (q.own || !taken[q.r]) && !delRows[q.r]; });
    if (!plan.length && !delPlan.length) throw new Error('바뀐 값이 없습니다.');
    // 초도 · 종료 · 구분을 고쳐서 같은 자재의 두 버전이 같은 차수에 겹치게 되면 막는다(원래 있던 겹침은 그대로 둠)
    var ovl = function (setOf) {
      var g = {}, out = {};
      all.forEach(function (x, i) {
        var rr = i + 3;
        if (str_(x[C.product]).toUpperCase() !== product || delRows[rr]) return;
        var st = setOf[rr] || {}, get = function (k) { return st[k] !== undefined ? st[k] : x[C[k]]; };
        var code = str_(get('code')).toUpperCase(), k = str_(get('type')) + '|' + code.replace(/\d+$/, '') + '|' + (C.semi >= 0 ? bomSemiKey_(get('semi')) : '');
        (g[k] = g[k] || []).push({ r: rr, code: code, s: bomRnum_(get('start')) || 1, e: bomRnum_(get('end')), dead: str_(get('end')) === '단종' });
      });
      Object.keys(g).forEach(function (k) {
        var vs = g[k].filter(function (v) { return !v.dead; }).sort(function (a, b) { return a.s - b.s; });
        vs.forEach(function (v, i) {
          var nx = null; for (var j = i + 1; j < vs.length; j++) if (vs[j].s > v.s) { nx = vs[j]; break; }
          v.e2 = v.e != null ? v.e : (nx ? nx.s - 1 : 1e9);
        });
        for (var a = 0; a < vs.length; a++) for (var b = a + 1; b < vs.length; b++) {
          var lo = Math.max(vs[a].s, vs[b].s), hi = Math.min(vs[a].e2, vs[b].e2);
          var rg = function (v) { return v.s + '~' + (v.e2 >= 1e9 ? '계속' : v.e2 + '차'); };
          if (lo <= hi) out[k + '|' + vs[a].r + '|' + vs[b].r] = vs[a].code + ' (' + vs[a].r + '행 ' + rg(vs[a]) + ' · ' + vs[b].r + '행 ' + rg(vs[b]) + ' → ' + lo + '차' + (hi >= 1e9 ? '부터' : (hi > lo ? '~' + hi + '차' : '')) + '에 두 줄)';
        }
      });
      return out;
    };
    var setOf = {}; plan.forEach(function (q) { if (q.own && q.product === product) setOf[q.r] = q.set; });
    if (plan.some(function (q) { return q.set.start !== undefined || q.set.end !== undefined || q.set.type !== undefined || q.set.code !== undefined; })) {
      var o0 = ovl({}), o1 = ovl(setOf), fresh = Object.keys(o1).filter(function (k) { return !o0[k]; });
      if (fresh.length) throw new Error('같은 자재가 같은 차수에 두 줄이 돼 원가가 두 번 들어갑니다: ' + fresh.map(function (k) { return o1[k]; }).join(' / ') + ' — 그 차수에 이미 그 자재 줄이 있습니다. 차수 칸에서 그 차수를 골라 확인해 보세요(이어 쓰려면 뒤 줄을 지우고, 아니면 종료는 그대로).');
    }
    var out = plan.map(function (q) {
      return { row: q.r, product: q.product, code: q.code, type: q.type, start: q.start, end: q.end, own: q.own, newCode: newCodes[q.r] || '',
        changes: Object.keys(q.set).map(function (k) { return { k: k, label: lab(k), before: shown(q.old[C[k]]), after: shown(q.set[k]) }; }) };
    });
    delPlan.forEach(function (d) { out.push({ row: d.r, product: product, code: d.code, type: d.type, start: d.start, end: d.end, own: true, del: true, changes: [{ k: 'del', label: '줄 삭제', before: d.type + ' ' + d.code + ' ' + d.vendor, after: '삭제' }] }); });
    if (dry) return { plan: out };

    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yy/MM/dd');
    var who = me_(), batch = Utilities.getUuid().slice(0, 8);
    var byOwn = {}, colPut = {};                 // 칸별로 모아 이어진 줄끼리 한 번에 쓴다(예전: 줄마다 · 칸 덩어리마다 따로 — 같은 코드 줄이 많으면 수십 번)
    plan.forEach(function (q, qi) {
      var prev = { change: q.old[C.change] };
      if (C.cost >= 0) prev.cost = q.old[C.cost];
      var after = [], wv = {};                 // 한 줄의 칸들은 모아서 한 번에 쓴다(예전: 칸마다 따로)
      Object.keys(q.set).forEach(function (k) {
        prev[k] = q.old[C[k]];
        wv[C[k]] = q.set[k];
        after.push(lab(k) + ' ' + shown(q.set[k]));
      });
      var ch = str_(q.old[C.change]);
      wv[C.change] = (ch ? ch + ' / ' : '') + '정정 ' + after.join(' · ') + (q.own ? '' : ' (같은 코드 ' + q.from + ' 정정에 맞춤)') + ' (' + why + ') · ' + stamp;
      q.wv = wv;
      Object.keys(wv).forEach(function (c) { (colPut[c] = colPut[c] || []).push([q.r, wv[c]]); });
      q.undo = { product: q.product, code: q.set.code !== undefined ? str_(q.set.code) : q.code, start: q.set.start !== undefined ? str_(q.set.start) : q.start, id: C.id >= 0 ? str_(q.old[C.id]) : '', prev: prev };
      touched[q.product] = 1;
    });
    try {
    Object.keys(colPut).forEach(function (c) { bomSetColRuns_(sh, Number(c) + 1, colPut[c]); });
    plan.forEach(function (q) {
      if (q.set.unit !== undefined || q.set.qty !== undefined || q.set.proc !== undefined || q.set.ship !== undefined || q.set.fx !== undefined) bomFixCost_(sh, C, q.r, q.old);
      // 읽어 둔 값에도 반영(새 번호 품목 DB 등록이 BOM 을 다시 읽지 않게) — 원가 계산(q.old = 이 배열)이 끝난 뒤에
      var yv = all[q.r - 3]; if (yv) Object.keys(q.wv).forEach(function (c) { yv[Number(c)] = q.wv[c]; });
    });
    plan.forEach(function (q, qi) {
      if (!q.own) return;
      var mates = plan.filter(function (o) { return !o.own && o.from === q.code; });
      var o2 = out[qi];
      logs.push([new Date(), who, product, '', q.start + (q.end ? '~' + q.end : '~'), '정정', q.type, q.code, q.set.code !== undefined ? str_(q.set.code) : q.code,
        o2.changes.map(function (c) { return c.label + ' ' + c.before; }).join(' · '),
        o2.changes.map(function (c) { return c.label + ' ' + c.after; }).join(' · ') + (mates.length ? ' · 같은 코드 ' + mates.length + '줄 같이 고침' : ''),
        why, '', '유효', batch + '-' + qi, JSON.stringify({ many: [q.undo].concat(mates.map(function (m) { return m.undo; })) })]);
      // 다른 품목 줄은 그 품목 이력에도 보이게(되돌리기는 원래 정정에서)
      mates.filter(function (m) { return m.product !== product; }).forEach(function (m) {
        logs.push([new Date(), who, m.product, '', m.start + '~' + m.end, '정정(같은 코드)', m.type, m.code, m.set.code !== undefined ? str_(m.set.code) : m.code,
          Object.keys(m.set).map(function (k) { return lab(k) + ' ' + shown(m.old[C[k]]); }).join(' · '),
          Object.keys(m.set).map(function (k) { return lab(k) + ' ' + shown(m.set[k]); }).join(' · ') + ' (' + product + ' 에서 정정)',
          why, '', '참고', batch + '-' + qi + '-' + m.r, '']);
      });
    });
    // 줄 삭제는 칸 고치기를 다 쓴 뒤 아래 줄부터(위 줄 번호가 밀리지 않게). 되돌리기용으로 줄 전체 값 · 수식(상대 R1C1)을 남긴다
    delPlan.sort(function (a, b) { return b.r - a.r; }).forEach(function (d, di) {
      // 줄을 당기지 않고 비운다(다른 줄 번호 · 캐시가 그대로 — 예전엔 줄 삭제 때마다 시트를 당기고 BOM 캐시를 통째로 다시 만들었다)
      var rg = sh.getRange(d.r, 1, 1, C.lc), vals = all[d.r - 3] ? all[d.r - 3].slice() : rg.getValues()[0], fm = rg.getFormulasR1C1()[0];
      rg.clearContent();                                  // 비운 뒤 아래에서 시트 줄을 지운다(빈 줄을 남기지 않게)
      all[d.r - 3] = undefined;
      touched[product] = 1;
      logs.push([new Date(), who, product, '', d.start + '~' + d.end, '정정 삭제', d.type, d.code, '', d.type + ' ' + d.code + ' ' + d.vendor, '줄 삭제', why, '', '유효', batch + '-d' + di,
        JSON.stringify({ v2: 1, v3: 1, restore: { at: d.r, soft: 1, vals: vals.map(function (v) { return v instanceof Date ? { d: v.toISOString() } : v; }), fmls: fm } })]);
    });
    bomLogWrite_(ss, logs);
    if (delPlan.length) delShift = bomDropBlankRows_(sh, C, delPlan.map(function (d) { return d.r; })) > 0;
    SpreadsheetApp.flush();
    } catch (eW) {
      try { bomDropCache_(Object.keys(touched).concat([product])); } catch (eD) { /* 넘어간다 */ }
      throw new Error('정정을 시트에 쓰다가 멈췄습니다 — 일부만 저장됐을 수 있습니다. 변경 이력에서 확인해 주세요: ' + String((eW && eW.message) || eW).replace(/^Error:\s*/, ''));
    }
    var nc = Object.keys(newCodes).map(function (k) { return newCodes[k]; });
    if (nc.length) { try { bomRegFromRows_(nc, 'BOM 정정 · 새 번호', all); } catch (eR) { /* 등록은 BOM 검사에서 다시 */ } }
    // 지운 줄의 코드가 BOM 어디에도 안 남고 발주 이력도 없으면 품목 DB 에서도 지운다(삭제보관 탭 · 되돌리면 되살림)
    var dropped = [];
    if (delPlan.length) { try { dropped = itemDbDropOrphans_(delPlan.map(function (d) { return d.code; }), why, product); } catch (eDr) { dropped = []; } }
  } finally {
    if (!dry) lock.releaseLock();
  }
  var pcodes = plan.filter(function (q) { return q.set.unit !== undefined || q.set.fx !== undefined || q.set.cur !== undefined || q.set.code !== undefined; })
    .map(function (q) { return q.set.code !== undefined ? str_(q.set.code) : q.code; });
  if (pcodes.length) { try { itemDbPriceSync_(pcodes); } catch (ePs) { /* 넘어간다 */ } }
  bomAfterSave_(Object.keys(touched), delShift);             // 줄을 지웠으면 아래 줄 번호가 밀려 캐시를 통째로
  try { appendHist_([{ kind: 'BOM', code: product, item: product + ' BOM 정정 ' + plan.length + '줄', before: '', after: plan.map(function (q) { return q.code; }).join(', '), reason: why }], 'p'); } catch (e) { /* 넘어간다 */ }
  var res = apiBomGet(product);
  res.fixed = plan.length + delPlan.length;
  res.deleted = delPlan.length;
  res.dropped = dropped;
  res.others = Object.keys(touched).filter(function (c) { return c !== product; });
  res.logTag = batch;
  return res;
}

/**
 * 화면: 신제품 코드 제안 — '품목코드 생성(신규코드채번)' 탭 규칙 그대로:
 *   제품 = 브랜드코드 + 제품번호 4자리 + 국가(국내 AA · 대만 TW · 일본 JP) + 버전
 *   제품번호: 모제품이 있으면 모제품 번호 그대로, 없으면 그 브랜드의 가장 큰 번호 + 1
 *   버전: 같은 브랜드 · 번호 · 국가에서 쓰인 가장 큰 버전 + 1
 * countries = ['AA','TW','JP'] 중 고른 것(여러 개면 국가마다 하나씩)
 */
/** 이미 쓰인 코드 전부: BOM(제품 · 자재) · 신규코드채번 탭 · 품목 DB(새 발주로 등록한 것) */
/**
 * 이 코드를 누가 쓰는지 — BOM 줄(다른 품목 · 다른 사양) · 옛 신규코드채번 탭.
 * skip: { product, row } — 지금 고치는 줄(과 같은 품목 같은 사양 줄)은 빼고 본다.
 * 품목 DB 에 없는 코드를 '등록'하려 할 때 막을지 판단 · 안내에 쓴다.
 */
function bomCodeUsers_(code, skip, v0) {
  code = itemCodeKey_(code);
  var out = { bom: [], reg: [] };
  var sh = bomSheet_(), C = bomCols_(sh), lr = sh.getLastRow();
  var v = v0 || (lr > 2 ? sh.getRange(3, 1, lr - 2, C.lc).getValues() : []);        // v0 = 부르는 쪽이 이미 읽은 BOM 값(같은 탭을 또 읽지 않게)
  var me = skip && skip.row ? v[Number(skip.row) - 3] : null;
  v.forEach(function (r, i) {
    if (itemCodeKey_(r[C.code]) !== code) return;
    if (me && i === Number(skip.row) - 3) return;
    var p = str_(r[C.product]).toUpperCase();
    if (me && p === str_(me[C.product]).toUpperCase() && (C.spec < 0 || norm_(r[C.spec]) === norm_(me[C.spec]))) return;   // 같은 품목 같은 사양 = 같은 자재
    out.bom.push({ product: p, name: str_(r[C.name]), type: str_(r[C.type]), start: str_(r[C.start]), row: i + 3 });
  });
  try {
    var reg = bomSS_().getSheetByName(RB_BOM_REG);
    if (reg && reg.getLastRow() > 2) {
      var RC = bomRegCols_(reg);
      if (RC.code >= 0) reg.getRange(3, 1, reg.getLastRow() - 2, RC.lc).getValues().forEach(function (r) {
        if (itemCodeKey_(r[RC.code]) === code) out.reg.push(str_(RC.prodName >= 0 ? r[RC.prodName] : '') + (RC.type >= 0 && str_(r[RC.type]) ? ' ' + str_(r[RC.type]) : ''));
      });
    }
  } catch (e) { /* 탭이 없으면 그만 */ }
  return out;
}
/** 품목 DB 에 없는 코드를 쓰려 할 때: 다른 BOM 줄이 쓰면 막고 어디서 쓰는지 알려 준다. 옛 신규코드채번 탭에만 있으면(BOM 에서 안 씀) 쓰게 둔다 */
function bomCodeFreeOrThrow_(code, skip, v0) {
  var u = bomCodeUsers_(code, skip, v0);
  if (!u.bom.length) return u;
  throw new Error(code + ' 는 다른 BOM 줄이 이미 쓰는 코드입니다 — ' + u.bom.slice(0, 3).map(function (b) { return b.product + ' ' + (b.name || b.type) + (b.start ? ' (' + b.start + '~)' : ''); }).join(' / ') +
    (u.bom.length > 3 ? ' 외 ' + (u.bom.length - 3) + '줄' : '') + '. 같은 자재면 그 BOM 줄과 맞춰 쓰고, 다른 자재면 다른 번호로 해 주세요.');
}
function bomKnownCodes_() {
  var codes = {};
  var add = function (c) { c = str_(c).toUpperCase().replace(/\s/g, ''); if (c) codes[c] = 1; };
  bomIndex_().forEach(function (it) { add(it.code); String(it.mats || '').split(' ').forEach(add); });
  try { itemDbAllCodes_().forEach(add); } catch (e) { /* 넘어간다 */ }
  // 신규코드채번 탭은 없앨 탭 — 남아 있는 동안만 번호가 겹치지 않게 읽는다(쓰지 않음)
  bomRegCodes_().forEach(add);
  // 발주 DB(_실행판_발주) 품목코드 칸 — 신규코드채번 탭이 없어진 뒤, 발주에만 쓰이고 BOM · 품목 DB 에 없는 코드를 다시 내주지 않게
  try {
    var so = statusSheet_(), SC = sheetCols_(so), cC = colIdx_(SC.idx, ['품목코드']), lrS = so.getLastRow();
    if (cC >= 0 && lrS > SC.hr) so.getRange(SC.hr + 1, cC + 1, lrS - SC.hr, 1).getValues().forEach(function (r) {
      var c = str_(r[0]).toUpperCase().replace(/\s/g, '');
      if (/^[A-Z]{1,2}\d{4}[A-Z]{2}\d+$/.test(c)) add(c);
    });
  } catch (eS) { /* 발주 DB 를 못 읽으면 예전처럼 */ }
  // 지운 품목 · 자재 코드(발주 이력 없음)는 BOM · 품목 DB 어디에도 없으니 다음 신제품 · 새 자재 등록 때 그 번호를 다시 쓴다(2026-10-20 담당자)
  return codes;
}
/** 이 코드를 이미 어디서 쓰는지(BOM · 신규코드채번 · 품목 DB) */
function productCodeTaken_(code) { return !!bomKnownCodes_()[str_(code).toUpperCase().replace(/\s/g, '')]; }
/**
 * 신제품 코드를 한 곳에 등록: 신규코드채번 탭(BOM 시트) + 품목 DB(_실행판_품목). 이미 있으면 건너뛴다.
 * [새 발주] 신제품 · 건 상세 [품목코드 입력] · BOM [신제품 BOM 등록] 이 모두 이걸 쓴다.
 */
function productCodeRegister_(code, name, brand, src) {
  // 코드 등록처는 품목 DB 하나(신규코드채번 탭에는 쓰지 않는다)
  appendItems_([{ code: str_(code).toUpperCase().replace(/\s/g, ''), name: name, brand: brand }], src);
}
function apiBomNextProductCode(brandLetter, parentCode, countries, kind) {
  var b = str_(brandLetter).toUpperCase().charAt(0) || 'M';
  var semi = str_(kind) === '반제품' || str_(kind) === 'semi';
  var codes = bomKnownCodes_();
  var num;
  var pc = str_(parentCode).toUpperCase();
  var pm = pc.match(/^[A-Z]X?(\d{4})/);
  if (pm) num = pm[1];
  else {
    var mx = 0;
    // 제품 · 반제품은 번호를 같이 쓴다(H0065 ↔ HX0065)
    Object.keys(codes).forEach(function (c) { var m = c.match(new RegExp('^' + b + 'X?(\\d{4})[A-Z]{2}\\d+$')); if (m) mx = Math.max(mx, Number(m[1])); });
    num = ('000' + (mx + 1)).slice(-4);
  }
  var list = (countries && countries.length ? countries : ['AA']).map(function (ct) {
    ct = str_(ct).toUpperCase() || 'AA';
    var base = b + (semi ? 'X' : '') + num + ct, v = 0;
    Object.keys(codes).forEach(function (c) { if (c.indexOf(base) === 0) { var m = c.slice(base.length).match(/^(\d+)$/); if (m) v = Math.max(v, Number(m[1])); } });
    return base + (v + 1);
  });
  return { num: num, codes: list, fromParent: !!pm };
}

/* ---------- BOM변경이력 탭(BOM 시트 안) — 한 변경당 한 줄, 되돌리기 정보는 숨긴 칸에 ---------- */
var RB_BOM_LOG = RB_BOM_PFX + 'BOM변경이력';
var RB_BOM_LOG_HEAD = ['일시', '변경자', '제품코드', '제품명', '차수', '변경', '자재구분', '자재코드(전)', '자재코드(후)', '바뀌기 전', '바뀐 뒤', '사유', '발주 건', '상태', '변경ID', '되돌리기 정보'];
function bomLogSheet_(ss) {
  var sh = ss.getSheetByName(RB_BOM_LOG);
  if (!sh) {
    sh = ss.insertSheet(RB_BOM_LOG);
    sh.getRange(1, 1, 1, RB_BOM_LOG_HEAD.length).setValues([RB_BOM_LOG_HEAD]).setFontWeight('bold').setBackground('#d9e1f2');
    sh.setFrozenRows(1);
    sh.setColumnWidth(10, 240); sh.setColumnWidth(11, 240); sh.setColumnWidth(12, 200);
    sh.hideColumns(15, 2);
  }
  return sh;
}
function bomLogWrite_(ss, rows) {
  if (!rows.length) return;
  var sh = bomLogSheet_(ss), r0 = sh.getLastRow() + 1;
  ensureRows_(sh, r0 + rows.length - 1);
  sh.getRange(r0, 1, rows.length, RB_BOM_LOG_HEAD.length).setValues(rows);
}
/** 한 품목의 BOM 변경 이력(최근 것부터 50줄) */
function bomLogOf_(product) {
  var ss = bomSS_(), sh = ss.getSheetByName(RB_BOM_LOG);
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, RB_BOM_LOG_HEAD.length).getValues();
  var out = [];
  v.forEach(function (r) {
    if (str_(r[2]).toUpperCase() !== product) return;
    out.push({ at: r[0] instanceof Date ? Utilities.formatDate(r[0], Session.getScriptTimeZone(), 'yy/MM/dd HH:mm') : str_(r[0]), who: str_(r[1]).split('@')[0],
      round: str_(r[4]), kind: str_(r[5]), type: str_(r[6]), codeA: str_(r[7]), codeB: str_(r[8]), before: str_(r[9]), after: str_(r[10]), why: str_(r[11]),
      order: str_(r[12]), state: str_(r[13]), id: str_(r[14]) });
  });
  return out.reverse().slice(0, 50);
}

/**
 * 화면: 저장한 BOM 변경 되돌리기(변경ID 하나). 새로 넣은 줄은 지우고, 닫았던 줄은 종료 차수 · 원가반영을 원래대로,
 * 그 차수에서 고친 줄은 원래 값으로. 새로 채번한 코드는 신규코드채번 탭 비고에 '실행판 되돌림 · 미사용'(번호는 다시 쓰지 않게 남긴다).
 */
function apiBomUndo(product, id, why) {
  requireEditor_();
  product = str_(product).toUpperCase();
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var done = [];
  try {
    var ss = bomSS_(), lg = ss.getSheetByName(RB_BOM_LOG);
    if (!lg) throw new Error('BOM변경이력 탭이 없습니다.');
    var lv = lg.getRange(2, 1, Math.max(1, lg.getLastRow() - 1), RB_BOM_LOG_HEAD.length).getValues();
    var li = -1;
    for (var i = 0; i < lv.length; i++) if (str_(lv[i][14]) === str_(id) && str_(lv[i][2]).toUpperCase() === product) { li = i; break; }
    if (li < 0) throw new Error('되돌릴 변경을 찾지 못했습니다.');
    if (str_(lv[li][13]) !== '유효') throw new Error('이미 되돌린 변경입니다.');
    var u = JSON.parse(str_(lv[li][15]) || '{}');
    if (!Object.keys(u).length) throw new Error('이 변경은 되돌릴 내용이 기록되지 않았습니다. BOM 화면에서 직접 고쳐 주세요.');
    // 이 뒤에 같은 자재를 또 고친 기록이 남아 있으면 — 그대로 되돌리면 뒤 변경까지 지워진다. 최근 것부터 되돌리게 한다
    // 코드는 코드 칸(H · I)뿐 아니라 되돌리기 기록(JSON) 안의 코드까지 본다 — 검사 수정 · 공용 표시 · 반제품 구성 기록은 코드 칸이 비어 있었다
    var codesOf = function (row) {
      var o = {}, add = function (c) { c = str_(c).toUpperCase(); if (c && c !== '-') o[c] = 1; };
      add(row[7]); add(row[8]);
      var j = {}; try { j = JSON.parse(str_(row[15]) || '{}'); } catch (eJ) { j = {}; }
      (j.many || []).concat(j.copyRefs || []).forEach(function (m) { add(m && m.code); });
      ['inPlace', 'oldRef', 'newRef'].forEach(function (k) { if (j[k]) add(j[k].code); });
      return o;
    };
    var mine = codesOf(lv[li]);
    for (var q0 = li + 1; q0 < lv.length; q0++) {
      if (str_(lv[q0][2]).toUpperCase() !== product || str_(lv[q0][13]) !== '유효') continue;
      var theirs = codesOf(lv[q0]), hitC = Object.keys(theirs).filter(function (c) { return mine[c]; });
      if (hitC.length) throw new Error('이 뒤에 같은 자재(' + hitC.join(', ') + ')를 또 고친 기록이 있습니다. 최근 변경부터 차례로 되돌려 주세요.');
    }
    var sh = bomSheet_(), C = bomCols_(sh);
    // id(줄ID)가 있으면 그 줄 먼저 — 같은 자재가 반제품마다 한 줄씩 있으면 코드 · 초도만으로는 엉뚱한 줄을 되돌렸다
    // ① 먼저 고칠 줄을 모두 찾는다(BOM 탭 한 번 읽기) — 하나라도 못 찾으면 아무것도 쓰지 않는다(예전: 찾으며 쓰다가 중간에 멈추면 반만 되돌아갔다)
    var V = sh.getLastRow() > 2 ? sh.getRange(3, 1, sh.getLastRow() - 2, C.lc).getValues() : [], claimed = {};
    var P = function (k) { return str_(V[k][C.product]).toUpperCase(); }, K = function (k) { return str_(V[k][C.code]).toUpperCase(); };
    // id(줄ID)가 있으면 그 줄 먼저 — 같은 자재가 반제품마다 한 줄씩 있으면 코드 · 초도만으로는 엉뚱한 줄을 되돌렸다
    var find = function (code, start, end, id, prod) {
      var pc = str_(prod || product).toUpperCase(), cc = str_(code).toUpperCase();
      if (id && C.id >= 0) {
        var idHits = [];
        for (var k0 = 0; k0 < V.length; k0++) if (!claimed[k0] && str_(V[k0][C.id]) === str_(id) && P(k0) === pc && (end === undefined || str_(V[k0][C.end]) === str_(end))) idHits.push(k0);
        // 같은 줄ID 가 둘 이상(예전에 복사로 생긴 줄)이면 코드 · 초도까지 맞는 줄로
        var one = idHits.length === 1 ? idHits[0] : idHits.filter(function (k1) { return K(k1) === cc && str_(V[k1][C.start]) === str_(start); })[0];
        if (one !== undefined && (idHits.length > 1 || K(one) === cc || prod)) { claimed[one] = 1; return one + 3; }
      }
      for (var k = 0; k < V.length; k++) {
        if (!claimed[k] && P(k) === pc && K(k) === cc && str_(V[k][C.start]) === str_(start) && (end === undefined || str_(V[k][C.end]) === str_(end))) { claimed[k] = 1; return k + 3; }
      }
      return 0;
    };
    var at0 = { newRef: 0, newRefs: [], copyRefs: [], oldRef: 0, many: [], inPlace: 0 };
    if (u.newRef) at0.newRef = find(u.newRef.code, u.newRef.start, undefined, u.newRef.id);
    (u.newRefs || []).forEach(function (ref) { at0.newRefs.push(find(ref.code, ref.start)); });
    // 공용 자재를 다른 반제품 구성에 하나 더 넣은 줄 — 같은 코드 · 초도 줄이 여럿이라 반제품 구성까지 맞는 줄(아래부터)만
    (u.copyRefs || []).forEach(function (ref) {
      var rs = ref.semi !== undefined ? str_(ref.semi).toUpperCase() : bomSemiTagOf_(ref.place), hitC = 0;          // 새 양식 전 이력은 입고지 표시로 적혀 있다
      for (var k = V.length - 1; k >= 0; k--) {
        if (!claimed[k] && P(k) === product && K(k) === str_(ref.code).toUpperCase() && str_(V[k][C.start]) === str_(ref.start) && str_(V[k][C.semi]).toUpperCase() === rs) { claimed[k] = 1; hitC = k + 3; break; }
      }
      at0.copyRefs.push({ r: hitC, rs: rs });
    });
    if (u.oldRef) {
      at0.oldRef = find(u.oldRef.code, u.oldRef.start, u.oldRef.endNow, u.oldRef.id);
      if (!at0.oldRef) throw new Error('원래 줄(' + u.oldRef.code + ' ' + u.oldRef.start + '~' + u.oldRef.endNow + ')을 찾지 못했습니다. BOM 시트에서 직접 확인해 주세요.');
    }
    (u.many || []).slice().reverse().forEach(function (m) {
      var hit = find(m.code, m.start, undefined, m.id, m.product || product);
      if (!hit) throw new Error('정정한 줄(' + m.product + ' ' + m.code + ' ' + m.start + '~)을 찾지 못했습니다. BOM 시트에서 직접 확인해 주세요.');
      at0.many.push({ m: m, r: hit });
    });
    if (u.inPlace) {
      at0.inPlace = find(u.inPlace.code, u.inPlace.start, undefined, u.inPlace.id, product);
      if (!at0.inPlace) throw new Error('고친 줄(' + u.inPlace.code + ')을 찾지 못했습니다.');
    }
    var insAt = 0, sf = function (r) { return r && insAt && r >= insAt ? r + 1 : r; };      // 옛 이력(지운 줄을 당겨 지움)을 되살리며 줄을 끼우면 그 아래 줄 번호가 하나 밀린다
    var undoClr = [], fixRows = {}, costSet = {}, unitColU = C.unit >= 0 ? colRB_(C.unit + 1) : 'T';
    var cell = function (row, k, val) {
      if (C[k] < 0) return;
      if (k === 'cost') {
        var cr = sh.getRange(row, C.cost + 1), fm = cr.getFormula();
        // 단가 칸을 보는 계산식이면 그대로(스스로 다시 계산) · 손으로 넣은 식(=100+120+70)이나 숫자면 기록해 둔 옛 값 그대로 되살린다
        if (fm && new RegExp(unitColU + '[$]?' + row + '(?![0-9])').test(fm)) return;
        if (/^=/.test(String(val))) cr.setFormula(String(val)); else cr.setValue(val);
        costSet[row] = 1;
        return;
      }
      sh.getRange(row, C[k] + 1).setValue(val);
      if (k === 'unit' || k === 'qty' || k === 'proc' || k === 'ship' || k === 'fx') fixRows[row] = 1;
    };
    // ② 쓰기
    if (at0.newRef) { sh.getRange(at0.newRef, 1, 1, C.lc).clearContent(); undoClr.push(at0.newRef); done.push('새 줄(' + u.newRef.code + ' ' + u.newRef.start + '~) 지움'); }      // 당기지 않고 비운다(다른 품목 줄 번호가 밀리지 않게)
    if (u.restore) {
      var at = Number(u.restore.at), lr0 = sh.getLastRow();
      if (u.restore.soft) {                                  // 비운 줄: 그 자리가 아직 비어 있으면 그대로, 아니면 맨 아래에
        var cur0 = at <= lr0 ? sh.getRange(at, 1, 1, C.lc).getValues()[0] : [];
        if (at > lr0 || cur0.some(function (x) { return str_(x) !== ''; })) { at = lr0 + 1; ensureRows_(sh, at); }
      } else if (at > lr0) { sh.insertRowAfter(lr0); at = lr0 + 1; } else { sh.insertRowBefore(at); insAt = at; }
      var rv = (u.restore.vals || []).map(function (v) { return v && typeof v === 'object' && v.d ? new Date(v.d) : v; });
      // 양식을 옮기기 전에 지운 줄 — 칸 위치가 달라 머리글 이름으로 옮겨 적는다(수식은 소요원가만 다시). v3 = 지금 양식(2026-10-20~)
      var v1 = !u.v3 && rv.length > 0;
      if (v1) {
        if (!u.v2 && rv.length !== RB_BOM_V2_HEAD.length) { var rv2 = bomV1RowToV2_(rv); if (!rv2) throw new Error('새 양식 전에 지운 줄이라 되살릴 칸을 맞추지 못했습니다. BOM 시트에서 직접 확인해 주세요.'); rv = rv2; }
        rv = bomV2RowToV3_(rv, sh, C);
      }
      if (rv.length) sh.getRange(at, 1, 1, rv.length).setValues([rv]);
      if (v1) bomFixCost_(sh, C, at);
      else (u.restore.fmls || []).forEach(function (f, j) { if (f) sh.getRange(at, j + 1).setFormulaR1C1(f); });
      done.push(at + '행 지운 줄 되살림');
      try { var rc0 = C.code >= 0 ? itemCodeKey_(sh.getRange(at, C.code + 1).getValue()) : ''; if (rc0 && itemDbRestore_(rc0)) done.push('품목 DB ' + rc0 + ' 되살림'); } catch (eIr) { /* 품목 정보에서 직접 */ }
      if (insAt) bomDropAllRows_();                 // 줄을 끼웠다 — 다른 품목 줄 캐시도 줄 번호가 밀렸다
    }
    (u.newRefs || []).forEach(function (ref, i) {
      var r2 = sf(at0.newRefs[i]);
      if (r2) { sh.getRange(r2, 1, 1, C.lc).clearContent(); undoClr.push(r2); done.push(ref.code + ' 줄 지움'); }
    });
    (u.copyRefs || []).forEach(function (ref, i) {
      var q = at0.copyRefs[i];
      if (q.r) { sh.getRange(sf(q.r), 1, 1, C.lc).clearContent(); undoClr.push(sf(q.r)); done.push(ref.code + ' (' + q.rs + ' 구성) 줄 지움'); }
    });
    if (u.oldRef) {
      var orow = sf(at0.oldRef);
      cell(orow, 'end', u.oldRef.prevEnd || ''); cell(orow, 'costKey', u.oldRef.prevF || ''); if (u.oldRef.prevCh !== undefined) cell(orow, 'change', u.oldRef.prevCh);
      done.push(u.oldRef.code + ' 종료 ' + u.oldRef.endNow + ' → ' + (u.oldRef.prevEnd || '없음(계속 사용)'));
    }
    at0.many.forEach(function (q) {
      var m = q.m, hit = sf(q.r);
      Object.keys(m.prev).forEach(function (k) {
        if (k === 'place' && !u.v2) {                // 새 양식 전 [구성 고르기] 이력: 입고지 표시 ‘업체 (MX… 구성)’ → 반제품 구성 칸 · 입고지
          var pv = str_(m.prev[k]); cell(hit, 'semi', /반제품 공용/.test(pv) ? '*' : bomSemiTagOf_(pv));
          cell(hit, 'place', pv.replace(/\s*\((?:[A-Z]X\d{4}[A-Z]{2}\d+ 구성|반제품 공용)\)\s*$/, '').trim());
          return;
        }
        cell(hit, k, m.prev[k]);
      });
      done.push((m.product !== product ? m.product + ' ' : '') + m.code + ' 원래 값으로');
      if (m.product !== product) bomDropCache_([m.product]);
      if (m.prev && m.prev.product) bomDropCache_([str_(m.prev.product).toUpperCase()]);      // 제품코드 바꾸기를 되돌림 — 옛 코드 품목도 다시
    });
    if (u.inPlace) {
      var ir = sf(at0.inPlace);
      Object.keys(u.inPlace.prev).forEach(function (k) { cell(ir, k, u.inPlace.prev[k]); });
      done.push(u.inPlace.code + ' 원래 값으로');
    }
    Object.keys(fixRows).forEach(function (r0) { if (costSet[r0]) return; try { bomFixCost_(sh, C, Number(r0), null); } catch (eF) { /* 넘어간다 */ } });
    // 자재 추가를 되돌린 뒤에도 BOM 어딘가(다른 품목 포함)에서 쓰는 코드는 품목 DB 에서 미사용으로 바꾸지 않는다(공용 자재가 검색에서 사라지던 것)
    var usedNow = {};
    try { var cvU = sh.getRange(3, C.code + 1, Math.max(1, sh.getLastRow() - 2), 1).getValues(); cvU.forEach(function (r0) { var k0 = str_(r0[0]).toUpperCase(); if (k0) usedNow[k0] = 1; }); } catch (eQ) { /* 넘어간다 */ }
    if (u.reg && usedNow[str_(u.reg).toUpperCase()]) u.reg = '';
    u.regs = (u.regs || []).filter(function (rc) { return !usedNow[str_(rc).toUpperCase()]; });      // 다른 BOM 에서 아직 쓰는 코드는 미사용으로 안 바꾼다
    // 되돌린 새 코드: 어디에도 안 쓰이고 발주 이력도 없으면 품목 DB 에서 지운다(그 번호는 다음 등록 때 다시 씀)
    try { var gone0 = itemDbDropOrphans_((u.regs || []).concat(u.reg ? [u.reg] : []), '되돌리기', product); if (gone0.length) done.push('품목 DB 에서 지움 ' + gone0.join(', ')); } catch (eU) { /* 넘어간다 */ }
    (u.regs || []).forEach(function (rc) {
      var reg2 = ss.getSheetByName(RB_BOM_REG);
      if (!reg2) return;
      var RC2 = bomRegCols_(reg2), cv2 = reg2.getRange(3, RC2.code + 1, Math.max(1, reg2.getLastRow() - 2), 1).getValues();
      var head2 = reg2.getRange(2, 1, 1, Math.min(reg2.getLastColumn(), 20)).getDisplayValues()[0], bi2 = head2.indexOf('비고');
      for (var j2 = cv2.length - 1; j2 >= 0; j2--) if (str_(cv2[j2][0]).toUpperCase() === str_(rc).toUpperCase()) { if (bi2 >= 0) reg2.getRange(j2 + 3, bi2 + 1).setValue('실행판 되돌림 · 미사용'); break; }
    });
    if (u.recodeFrom) done.push('옛 제품코드 ' + u.recodeFrom + ' 가 품목 DB 에 미사용이면 품목 정보에서 직접 되살려 주세요');
    if (u.reg) {
      var reg = ss.getSheetByName(RB_BOM_REG);
      if (reg) {
        var RC = bomRegCols_(reg), cv = reg.getRange(3, RC.code + 1, Math.max(1, reg.getLastRow() - 2), 1).getValues();
        var lc = Math.min(reg.getLastColumn(), 20), head = reg.getRange(2, 1, 1, lc).getDisplayValues()[0], bi = head.indexOf('비고');
        for (var j = cv.length - 1; j >= 0; j--) if (str_(cv[j][0]).toUpperCase() === str_(u.reg).toUpperCase()) {
          if (bi >= 0) reg.getRange(j + 3, bi + 1).setValue('실행판 되돌림 · 미사용');
          break;
        }
      }
    }
    if (undoClr.length && bomDropBlankRows_(sh, C, undoClr)) bomDropAllRows_();      // 비운 줄은 시트에서 지운다(줄 번호가 밀려 다른 품목 캐시도)
    lg.getRange(li + 2, 14).setValue('되돌림');
    for (var q = 0; q < lv.length; q++) if (str_(lv[q][13]) === '참고' && str_(lv[q][14]).indexOf(str_(id) + '-') === 0) lg.getRange(q + 2, 14).setValue('되돌림');
    bomLogWrite_(ss, [[new Date(), me_(), product, str_(lv[li][3]), str_(lv[li][4]), '되돌림', str_(lv[li][6]), str_(lv[li][8]), str_(lv[li][7]),
      str_(lv[li][10]), str_(lv[li][9]), str_(why) || done.join(' · '), str_(lv[li][12]), '-', str_(id) + '-되돌림', '']]);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  // 정정 · 이름 변경 때 같이 바꾼 품목 DB(품목명 · 업체 · 사양)도 원래대로 — 그 코드를 쓰는 다른 BOM 줄도 같이 맞춰진다
  if (u.dbPrev) Object.keys(u.dbPrev).forEach(function (c) {
    try { apiItemDbSave(0, c, u.dbPrev[c]); done.push('품목 DB ' + c + ' 원래대로'); } catch (eDb) { done.push('품목 DB ' + c + ' 는 직접 확인 필요(' + String(eDb && eDb.message || eDb).slice(0, 60) + ')'); }
  });
  bomDropCache_([product]);
  try { CacheService.getScriptCache().remove('bom4:idx:n'); } catch (e) { /* 넘어간다 */ }
  try { appendHist_([{ kind: 'BOM', code: product, item: product + ' BOM 변경 되돌림', after: done.join(' · '), reason: str_(why) }], 'p'); } catch (e) { /* 넘어간다 */ }
  var fresh = apiBomGet(product);
  fresh.undone = done;
  return fresh;
}

/** 신규코드채번 탭 칸(2행 머리글) */
function bomRegCols_(reg) {
  var lc = Math.min(reg.getLastColumn(), 20);
  var head = reg.getRange(2, 1, 1, lc).getDisplayValues()[0].map(function (s) { return String(s).replace(/\s+/g, ' ').trim(); });
  var f = function (n) { return head.indexOf(n); };
  return { lc: lc, brand: f('브랜드명'), kind: f('구분'), num: f('제품코드'), prodName: f('모제품명'), type: f('부자재구분'), tcode: f('분류코드'), ver: f('버전'), code: f('신규코드'), name: f('품목명') };
}
/** 신규코드채번 탭 맨 아래(신규코드가 비어 있는 첫 줄)에 한 줄 등록 */
/** 그 줄의 데이터 확인(드롭다운) 규칙이 목록 밖 값을 거부하면 쓰기가 통째로 실패한다 — 규칙은 두고 '경고만'으로 바꾼다 */
function relaxRowValidation_(sh, row, lc) {
  try {
    var rg = sh.getRange(row, 1, 1, lc), dv = rg.getDataValidations()[0], ch = false;
    var names = {};
    try { sh.getParent().getSheets().forEach(function (x) { names[x.getName()] = 1; }); } catch (e0) { names = null; }
    var out = dv.map(function (r) {
      if (!r) return r;
      // 지운 탭(예: 옛 _실행판_신규채번_도움)을 가리키는 규칙은 값을 쓸 때 '데이터 확인 규칙 인수가 잘못' 으로 멈춘다 — '경고만' 규칙이어도. 그 칸 규칙은 없앤다
      try {
        var bad = r.getCriteriaValues().some(function (x) {
          if (x && typeof x.getSheet === 'function') return false;                 // 범위 값이면 살아 있는 탭
          var m = String(x == null ? '' : x).match(/'?([^'!=(),]+)'?!/);
          return !!(m && names && !names[m[1].trim()]);
        });
        if (bad) { ch = true; return null; }
      } catch (e1) { ch = true; return null; }
      if (r.getAllowInvalid()) return r;
      ch = true;
      try { return r.copy().setAllowInvalid(true).build(); } catch (e2) { return null; }
    });
    if (ch) {
      try { rg.setDataValidations([out]); }
      catch (e3) { rg.clearDataValidations(); }      // 한 칸이라도 못 쓰면 그 줄 규칙을 통째로 비운다
    }
  } catch (e) { try { sh.getRange(row, 1, 1, lc).clearDataValidations(); } catch (e4) { /* 넘어간다 */ } }
}
/** 한 열에 [[행, 값], …] 쓰기 — 이어진 행끼리 묶어 한 번에(칸마다 setValue 하지 않게). 결과는 칸마다 쓴 것과 같다 */
function bomSetColRuns_(sh, col1, pairs) {
  var ps = (pairs || []).slice().sort(function (a, b) { return a[0] - b[0]; });
  for (var i = 0; i < ps.length;) {
    var j = i, vals = [[ps[i][1]]];
    while (j + 1 < ps.length && ps[j + 1][0] === ps[j][0] + 1) { j++; vals.push([ps[j][1]]); }
    sh.getRange(ps[i][0], col1, vals.length, 1).setValues(vals);
    i = j + 1;
  }
}
/**
 * BOM 한 줄의 여러 칸을 한 번에 쓴다. vals = { 칸번호(0부터): 값 }.
 * 칸마다 setValue 하던 것과 결과가 같게: 쓰는 칸 사이에 낀 칸은 비어 있고 수식이 없을 때만 빈칸으로 같이 쓰고(바뀌는 것 없음),
 * 값 · 수식이 있는 칸은 건너뛰어 덩어리를 나눈다(수식 · 손으로 넣은 값을 덮지 않는다). 묶어 쓰다 막히면 예전처럼 칸마다 쓴다.
 */
function bomWriteRow_(sh, row, vals) {
  var cols = Object.keys(vals).map(Number).sort(function (a, b) { return a - b; });
  if (!cols.length) return;
  var lo = cols[0], hi = cols[cols.length - 1], cur = null, fm = null;
  if (hi - lo + 1 > cols.length) { var rg = sh.getRange(row, lo + 1, 1, hi - lo + 1); cur = rg.getValues()[0]; fm = rg.getFormulas()[0]; }
  var runs = [], run = null;
  for (var c = lo; c <= hi; c++) {
    var own = Object.prototype.hasOwnProperty.call(vals, c);
    if (!own && !(cur && cur[c - lo] === '' && !fm[c - lo])) { run = null; continue; }
    if (!run) { run = { c: c, v: [] }; runs.push(run); }   // 덩어리는 늘 쓰는 칸에서 시작(lo 또는 건너뛴 칸 다음 — 빈칸이면 그대로 빈칸)
    run.v.push(own ? vals[c] : '');
  }
  try {
    runs.forEach(function (r) { sh.getRange(row, r.c + 1, 1, r.v.length).setValues([r.v]); });
  } catch (e) {
    cols.forEach(function (k) { sh.getRange(row, k + 1).setValue(vals[k]); });
  }
}
/** 새로 받은 코드를 품목 DB 에 — BOM 줄의 품목명 · 브랜드 · 업체 · 사양 그대로(예전엔 이름 · 브랜드만 들어가 업체 · 사양이 빈 채로 등록됐다). 줄에서 못 찾은 코드만 예전처럼 */
function bomRegisterMany_(reg, RC, list, src) {
  var codes = (list || []).map(function (o) { return str_(o && o.code).toUpperCase(); }).filter(String);
  if (!codes.length) return;
  var done = {};
  try { bomRegFromRows_(codes, src).forEach(function (c) { done[c] = 1; }); } catch (e) { /* 아래에서 이름만이라도 */ }
  (list || []).forEach(function (o) { if (!done[str_(o && o.code).toUpperCase()]) bomRegister_(reg, RC, o); });
}
function bomRegister_(reg, RC, o) {
  // 2026-10-08: 코드 등록처는 품목 DB(_실행판_품목) 하나. 신규코드채번 탭은 없앨 탭이라 쓰지 않는다(reg · RC 는 예전 호출 모양 그대로 받기만).
  var code = str_((o || {}).code).toUpperCase();
  if (!code) return 0;
  var src = '신규코드 발급 · ' + (str_(o.kind) || (o.type ? '부자재' : '')) + (o.type ? ' ' + str_(o.type) : '') + (o.tcode ? ' ' + str_(o.tcode) : '') + (o.ver ? ' v' + o.ver : '');
  try { appendItems_([{ code: code, name: str_(o.name) || str_(o.prodName) || code, brand: str_(o.brand) }], src); } catch (eA) { /* 넘어간다 */ }
  return 0;
}
/** 분류명 → 분류코드: 기본표 + 스크립트 속성 bom:types(옛 신규채번_도움 탭 D:E에서 옮긴 것) + (아직 있으면) 그 탭 */
function bomTypeCodes_(ss) {
  var map = { '용기': 'BO', '상용기': 'BT', '하용기': 'BB', '튜브+캡': 'TB', '펌프': 'PU', '캡': 'CP', '펌프+캡': 'PC', '파우치': 'PH', '스포이드': 'SP', '단상자': 'CA',
    '싸바리': 'PA', '간지': 'IN', '아웃박스': 'OB', '인박스': 'IB', '기타라벨': 'OL', '용기라벨': 'BL', '봉합라벨': 'SL', '수출라벨': 'EL', '유저가이드': 'UG',
    '충전케이블': 'CC', '리드': 'LD', '스파츌러': 'ST', '집게': 'AP', 'OPP': 'OP', '실링지': 'IS', '디바이스': 'DV', '원재료': 'XX', '기타': 'MS' };
  try { var pt = JSON.parse(PropertiesService.getScriptProperties().getProperty('bom:types') || '{}'); Object.keys(pt).forEach(function (k) { map[k] = pt[k]; }); } catch (e) { /* 기본표 */ }
  try {
    var t = ss.getSheetByName(RB_BOM_TYPES);
    if (t) t.getRange(2, 4, Math.max(1, t.getLastRow() - 1), 2).getValues().forEach(function (r) { if (str_(r[0]) && str_(r[1])) map[str_(r[0])] = str_(r[1]); });
  } catch (e) { /* 기본표 */ }
  return map;
}
/** 화면: 구분(분류명) → 약호 표 전부 — 자재 추가 목록 · 채번 규칙 팝업 */
function apiBomTypes() {
  return bomTypeCodes_(bomSS_());
}
/**
 * 화면: 새 구분 추가(자재 추가의 '+ 새 구분'). 약호는 영문 대문자 2글자.
 * 이름 · 약호가 이미 있거나, 그 약호가 기존 자재코드에 이미 쓰였으면 막는다. 저장은 스크립트 속성 bom:types(시트 탭 없음).
 * 이미 코드에 쓰인 약호는 바꾸거나 지우지 않는다(만든 자재코드와 어긋나므로) — 추가만.
 */
function apiBomAddType(name, code) {
  requireEditor_();
  name = str_(name).replace(/\s+/g, ' ').slice(0, 20);
  code = str_(code).toUpperCase();
  if (!name) throw new Error('구분 이름을 넣어 주세요.');
  if (!/^[A-Z]{2}$/.test(code)) throw new Error('약호는 영문 대문자 2글자로 넣어 주세요(예: CS).');
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  try {
    var ss = bomSS_(), map = bomTypeCodes_(ss);
    if (map[name]) throw new Error('"' + name + '" 구분은 이미 있습니다(약호 ' + map[name] + ').');
    var byCode = Object.keys(map).filter(function (k) { return map[k] === code; });
    if (byCode.length) throw new Error('약호 ' + code + ' 는 이미 "' + byCode.join(', ') + '" 에 쓰고 있습니다.');
    var used = Object.keys(bomKnownCodes_()).filter(function (c) { var m = c.match(/^[A-Z]P\d{4}([A-Z]{2})\d+$/); return m && m[1] === code; });
    if (used.length) throw new Error('약호 ' + code + ' 는 이미 자재코드에 쓰였습니다(' + used.slice(0, 3).join(', ') + '). 다른 약호를 넣어 주세요.');
    var props = PropertiesService.getScriptProperties(), pt = {};
    try { pt = JSON.parse(props.getProperty('bom:types') || '{}'); } catch (e) { pt = {}; }
    pt[name] = code;
    props.setProperty('bom:types', JSON.stringify(pt));
    bomLogWrite_(ss, [[new Date(), me_(), '', '', '', '구분 추가', name, '', '', '', name + ' = ' + code, '자재 구분 새로 추가', '', '-', Utilities.getUuid().slice(0, 8) + '-ty', '']]);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return bomTypeCodes_(bomSS_());
}

/*
 * BOM 탭 직접 수정 감시(BOM 전용 편집 트리거) — _실행판_BOM 탭을 시트에서 고치면 BOM 캐시를 낡은 것으로 표시하고,
 * 10분 작업(warmCaches → warmBom_)이 곧 다시 읽는다(예전 최대 1시간). 트리거는 1분 작업이 없으면 스스로 만든다(실행판 소유자 권한).
 */
var RB_BOM_EDIT_TRIGGER = 'onBomEditRB';
function onBomEditRB(e) {
  try {
    if (!e || !e.range || e.range.getSheet().getName() !== RB_BOM_TAB) return;          // 보관 탭(BOM2)은 보지 않는다
    CacheService.getScriptCache().remove('bom4:at');
  } catch (err) { /* 넘어간다 */ }
}
function bomEditTriggerEnsure_() {
  var c = CacheService.getScriptCache();
  if (c.get('bomtrig:ok')) return;
  // 작업 둘이 겹치면 둘 다 '없음'을 보고 하나씩 만들었다 — 잠금 안에서 확인 · 만들기, 이미 여럿이면 하나만 남긴다
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;                 // 다른 실행이 잡고 있으면 다음 10분 작업에서
  try {
    var mine = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === RB_BOM_EDIT_TRIGGER; });
    mine.slice(1).forEach(function (t) { try { ScriptApp.deleteTrigger(t); } catch (e) { /* 넘어간다 */ } });
    if (!mine.length) ScriptApp.newTrigger(RB_BOM_EDIT_TRIGGER).forSpreadsheet(RB.SS_ID).onEdit().create();
    c.put('bomtrig:ok', '1', 21600);
  } finally {
    lock.releaseLock();
  }
}

/** 10분 작업(warmCaches)에서 부른다: BOM 캐시가 비었거나 1시간 지났으면(또는 시트에서 BOM 탭을 고쳤으면) 다시 채운다 */
function warmBom_() {
  try { bomEditTriggerEnsure_(); } catch (e0) { try { console.log('BOM 편집 트리거 만들기 실패: ' + e0.message); } catch (e1) { /* 넘어간다 */ } }
  try {
    var c = CacheService.getScriptCache();
    var at = Number(c.get('bom4:at') || 0);
    if (c.get('bom4:idx:n') && at && Date.now() - at < 3600000) return;
    var t0 = Date.now();
    bomBuildCache_();
    costTableMark_();                                  // 시트에서 직접 고친 것도 원가표에(다음 1분 작업)
    console.log('warmBom ' + (Date.now() - t0) + 'ms');
  } catch (e) { try { console.log('warmBom 실패: ' + e.message); } catch (e2) { /* 넘어간다 */ } }
}

/**
 * 소요원가 칸 맞추기. 그 줄 단가를 보는 수식이면(=((T5*Z5)+U5+V5)*S5) 시트가 계산하니 두고,
 * 손으로 넣은 값 · 숫자만 든 수식(=290)이면: 계산식((단가 × 환율) + 임가공 + 배송비) × 소요량 이 바뀐 만큼만 더하고 빼서
 * 손으로 넣은 나머지(인쇄비 등)는 지킨다. oldRow 가 없으면(자재 추가) 계산식으로 새로 넣는다.
 */
function bomFixCost_(sh, C, row, oldRow) {
  if (C.cost < 0) return;
  var cc = sh.getRange(row, C.cost + 1);
  var f = cc.getFormula();
  var unitCol = C.unit >= 0 ? colRB_(C.unit + 1) : 'T';
  if (f && new RegExp(unitCol + '[$]?' + row + '(?![0-9])').test(f)) return;
  var calc = function (v) {
    var n = function (k) { return C[k] >= 0 ? (Number(String(v[C[k]]).replace(/,/g, '')) || 0) : 0; };
    var qty = C.qty >= 0 && String(v[C.qty]) !== '' ? n('qty') : 1;
    return ((n('unit') * (n('fx') || 1)) + n('proc') + n('ship')) * qty;
  };
  var now = sh.getRange(row, 1, 1, C.lc).getValues()[0];
  if (oldRow) {
    var d = calc(now) - calc(oldRow);
    if (d) cc.setValue((Number(String(now[C.cost]).replace(/,/g, '')) || 0) + d);
    return;
  }
  cc.setValue(calc(now));
}


/* ============================================================
 * BOM 검사 · 한 건씩 고치기 (BOM 보기 [BOM 검사])
 * ------------------------------------------------------------
 *  · bomAuditItems_: BOM 탭 전체를 검사해 건마다 { id, kind, product, rows, text, acts:[{k,label}] } — 고칠 수 있으면 제안(acts)
 *  · apiBomReviewList: 그대로 두기로 한 건(_실행판_BOM검사 탭)은 빼고 돌려준다
 *  · apiBomReviewFix(id, act): 그 건을 다시 검사해 아직 같으면 고친다(행이 바뀌었으면 멈춤) → BOM변경이력 '검사 수정'(되돌리기 가능)
 * ============================================================ */
function bomAuditItems_() {
  var sh = bomSheet_(), C = bomCols_(sh), lr = sh.getLastRow();
  var v = sh.getRange(3, 1, lr - 2, C.lc).getValues();
  var fCost = C.cost >= 0 ? sh.getRange(3, C.cost + 1, lr - 2, 1).getFormulas() : [];
  var S = function (x) { return String(x == null ? '' : x).trim(); }, U = function (x) { return S(x).toUpperCase(); };
  var N = function (x) { var n = Number(String(x).replace(/,/g, '')); return isFinite(n) ? n : 0; };
  var R = function (t) { var m = S(t).match(/^(\d+)\s*차$/); return m ? Number(m[1]) : null; };
  var codeOk = /^[A-Z]{1,2}\d{4}[A-Z]{2}\d+$/, prodOk = /^[A-Z]X?\d{4}[A-Z]{2}\d+$/;
  var items = [], byP = {}, rows = [];
  var pnames = {};
  var add = function (kind, P, rs, text, acts, sig) { items.push({ id: kind + '|' + P + '|' + rs.join(','), kind: kind, product: P, pname: pnames[P] || '', rows: rs, text: text, acts: acts || [], sig: sig || '' }); };
  v.forEach(function (r, i) {
    var o = { row: i + 3, p: U(r[C.product]), code: U(r[C.code]), type: S(r[C.type]), start: S(r[C.start]), end: S(r[C.end]), ck: U(r[C.costKey]), vendor: S(r[C.vendor]), semi: C.semi >= 0 ? U(r[C.semi]) : '',
      brand: C.brand >= 0 ? S(r[C.brand]) : '-', spec: C.spec >= 0 ? S(r[C.spec]) : '', buy: C.buy >= 0 ? S(r[C.buy]) : '', qty: r[C.qty], unit: r[C.unit], proc: C.proc >= 0 ? r[C.proc] : '', ship: C.ship >= 0 ? r[C.ship] : '', cost: r[C.cost], fx: C.fx >= 0 ? r[C.fx] : 1, name: S(r[C.name]), f: fCost[i] ? fCost[i][0] : '', semi: C.semi >= 0 ? bomSemiKey_(r[C.semi]) : '', semiTag: C.semi >= 0 ? S(r[C.semi]).toUpperCase() : '' };
    if (!o.p && !o.code && !o.type) return;
    rows.push(o); (byP[o.p] = byP[o.p] || []).push(o);
    if (o.p && (o.type === '제품' || o.type === '세트') && o.code === o.p && !pnames[o.p]) pnames[o.p] = o.name;
  });
  Object.keys(byP).forEach(function (P) { if (P && !pnames[P]) { var f0 = byP[P].filter(function (o) { return o.type === '제품' || o.type === '세트'; })[0]; if (f0) pnames[P] = f0.name; } });
  var desc = function (o) { return o.row + '행 ' + o.type + ' ' + (o.code || '(코드 없음)') + (o.vendor ? ' · ' + o.vendor : '') + ' · ' + (o.start || '?') + '~' + o.end; };
  // 제품코드 빈 줄: 같은 빈 덩어리에서 바로 위 제품/세트 줄 코드를 제안
  var blank = byP[''] || [], cur = '', inSet = false, grp = null;
  var flush = function () {
    if (!grp) return;
    var rs = grp.rows.map(function (o) { return o.row; }), head = grp.rows.filter(function (o) { return o.type === '세트' || o.type === '제품'; })[0];
    items.push({ id: '제품코드(D열) 빈 줄||' + rs.join(','), kind: '제품코드(D열) 빈 줄', product: grp.cur, pname: head ? head.name : '', rows: rs,
      text: rs[0] + '~' + rs[rs.length - 1] + '행 ' + rs.length + '줄 — ' + grp.rows.map(function (o) { return o.type + ' ' + (o.code || '(코드 없음)'); }).join(', ') +
        (grp.cur ? '' : ' · 위에 코드 있는 제품/세트 줄이 없어 어느 품목인지 제안할 수 없음(BOM 시트에서 직접 확인)'),
      acts: grp.cur ? [{ k: 'setP:' + grp.cur, label: rs.length + '줄 D열을 ' + grp.cur + ' 로' }] : [], sig: grp.rows.map(function (o) { return o.code; }).join(',') });
    grp = null;
  };
  blank.forEach(function (o, k) {
    if (k && blank[k - 1].row !== o.row - 1) { flush(); cur = ''; inSet = false; }
    // 세트 줄 아래는 세트 구성(다른 제품 줄도 세트 코드로) — 세트가 없을 때만 제품 줄 코드로
    if (o.type === '세트' && prodOk.test(o.code)) { cur = o.code; inSet = true; }
    else if (o.type === '제품' && prodOk.test(o.code) && !inSet) cur = o.code;
    if (!grp || grp.cur !== cur) { flush(); grp = { cur: cur, rows: [] }; }
    grp.rows.push(o);
  });
  flush();
  var dbByName = null, knownP = null;
  Object.keys(byP).forEach(function (P) {
    if (!P) return;
    var list = byP[P];
    if (!prodOk.test(P)) add('제품코드 형식 아님', P, [list[0].row], P + ' · ' + list.length + '줄 (' + list[0].row + '행~) — BOM 보기에서 직접 확인', [], P);
    var prods = list.filter(function (o) { return o.type === '제품'; });
    var isSet = list.some(function (o) { return o.type === '세트'; });
    if (!prods.length && !isSet) add('제품 줄 없음', P, [list[0].row], P + ' · ' + list.length + '줄 (' + list[0].row + '행~) — 제품 줄을 [+ 자재 추가]로', [], P);
    prods.forEach(function (o) {
      if (isSet || o.code === P || !prodOk.test(o.code)) return;     // 세트는 구성 완제품 · 그 자재가 같이 들어가는 게 정상(담당자 확인 10/18 — 세트 원가 = 전부 합침)
      var nextRow = 1e9;
      prods.forEach(function (q) { if (q.row > o.row && q.row < nextRow) nextRow = q.row; });
      var blk = list.filter(function (q) { return q.row >= o.row && q.row < nextRow; });
      var rs = blk.map(function (q) { return q.row; });
      add('다른 제품 구성 섞임', P, rs, P + ' 안 ' + rs[0] + '~' + rs[rs.length - 1] + '행 ' + blk.length + '줄의 제품 줄이 ' + o.code + (isSet ? ' (이 품목에 세트 줄 있음 — 세트 구성이면 그대로)' : '') + (byP[o.code] ? ' · ' + o.code + ' 자기 줄도 ' + byP[o.code].length + '개 있음' : ' · ' + o.code + ' 자기 BOM 없음'),
        [{ k: 'setP:' + o.code, label: rs.length + '줄 제품코드(D) · 원가반영(F)을 ' + o.code + ' 로' }], blk.map(function (q) { return q.code; }).join(','));
    });
    // 한 제품코드에 다른 제품이 섞임: 제품 줄 코드는 같은데(D · E 모두 P) 이름이 다른 제품 줄이 또 있음
    // (예: M0171AA1 아래에 '…20ml RNL' 제품 줄 + 그 자재 — RNL 은 M0171AA2 여야 함) → 그 줄부터 다음 제품 줄 전까지를 다른 코드로 분리
    var sameP = prods.filter(function (o) { return o.code === P; }).sort(function (a, b) { return a.row - b.row; });
    if (sameP.length > 1) {
      var n0 = norm_(sameP[0].name);
      sameP.slice(1).forEach(function (o) {
        if (norm_(o.name) === n0) return;                    // 같은 이름(차수만 다른 제품 줄)은 그대로
        var nextRow = 1e9;
        prods.forEach(function (q) { if (q.row > o.row && q.row < nextRow) nextRow = q.row; });
        var blk = list.filter(function (q) { return q.row >= o.row && q.row < nextRow; });
        if (!dbByName) { dbByName = {}; try { readItems_().forEach(function (it) { dbByName[norm_(it.name)] = it.code; }); } catch (eN) { /* 이름 맞대기 없이 */ } }
        var to = dbByName[norm_(o.name)] || '';
        if (!to || to === P) {
          if (!knownP) { try { knownP = bomKnownCodes_(); } catch (eK) { knownP = {}; } }
          var stem = P.replace(/\d+$/, ''), mx = 0;
          Object.keys(knownP).forEach(function (c) { if (c.indexOf(stem) === 0) { var q = c.slice(stem.length).match(/^(\d+)$/); if (q) mx = Math.max(mx, Number(q[1])); } });
          to = stem + (mx + 1);
        }
        var rs = blk.map(function (q) { return q.row; });
        add('한 제품코드에 다른 제품이 섞임', P, rs, P + ' 안 ' + rs[0] + '~' + rs[rs.length - 1] + '행 ' + blk.length + '줄은 다른 제품 "' + o.name.slice(0, 40) + '"(' + P + ' 는 "' + sameP[0].name.slice(0, 30) + '") — ' + to + (dbByName[norm_(o.name)] ? ' 는 품목 DB 에 같은 이름' : ' 는 새 번호'),
          [{ k: 'split:' + rs.join(',') + '@' + to, label: rs.length + '줄을 ' + to + ' 로 분리(제품코드 D · 원가반영 F · 제품 줄 코드)' }], o.row + '>' + to);
      });
    }
    var openProd = prods.filter(function (o) { return o.code === P && o.ck && !R(o.end); });
    if (openProd.length > 1) add('제품 줄 중복(원가 이중)', P, openProd.map(function (o) { return o.row; }), openProd.map(function (o) { return desc(o) + ' · 소요원가 ' + N(o.cost); }).join(' / '),
      openProd.map(function (o) { return { k: 'ckOff:' + o.row, label: o.row + '행(' + N(o.cost) + ') 원가반영 빼기' }; }), openProd.map(function (o) { return o.row; }).join(','));
    var noStart = list.filter(function (o) { return !o.start; });
    if (noStart.length) add('초도 빈 줄', P, noStart.map(function (o) { return o.row; }), P + ' · ' + noStart.length + '줄 초도가 비어 있음 (' + noStart.slice(0, 4).map(function (o) { return o.row + '행 ' + o.type; }).join(', ') + (noStart.length > 4 ? ' …' : '') + ')',
      [{ k: 'start1', label: noStart.length + '줄 모두 1차로' }], noStart.length + '');
    // 브랜드(B) 빈 줄: 같은 품목 다른 줄의 브랜드 → 없으면 코드 첫 글자(H 히디프 · M 메디테라피)
    var noBrand = list.filter(function (o) { return o.brand === ''; });
    if (noBrand.length) {
      var bGuess = (list.filter(function (o) { return o.brand && o.brand !== '-'; })[0] || {}).brand || bomBrandOf_(P);
      add('브랜드 빈 줄', P, noBrand.map(function (o) { return o.row; }), P + ' · ' + noBrand.length + '줄 브랜드(B)가 비어 있음' + (bGuess ? '' : ' — 코드로 브랜드를 알 수 없어 시트에서 직접'),
        bGuess ? [{ k: 'brand:' + bGuess, label: noBrand.length + '줄 브랜드 ' + bGuess + ' 로' }] : [], noBrand.length + '');
    }
    // 반제품 구성 칸이 이 제품 BOM 에 없는 반제품을 가리킴(반제품 코드를 다른 번호로 고쳤거나 반제품 줄을 뺌) — 그 자재가 반제품 단가 · 발주에서 빠진다
    var semiHd = {}; list.forEach(function (o) { if (o.type === '반제품') semiHd[bomSemiKey_(o.code)] = 1; });
    var lost = list.filter(function (o) { return o.semi && o.semi !== '*' && o.end !== '단종' && !semiHd[o.semi]; });
    if (lost.length) add('반제품 구성이 없는 반제품을 가리킴', P, lost.map(function (o) { return o.row; }), P + ' · ' + lost.map(function (o) { return o.row + '행 ' + o.type + ' ' + o.code + ' → ' + o.semiTag; }).join(', ') + ' — [이 차수 구성 정정]에서 반제품 줄 [구성 고르기]로 다시 골라 주세요',
      [], lost.map(function (o) { return o.row + o.semiTag; }).join(','));
    var noBuy = list.filter(function (o) { return !o.buy && !/^(제품|세트|반제품|구성제품)$/.test(o.type); });          // 제품 · 반제품 줄은 매입정보가 없는 게 맞다
    if (noBuy.length) add('매입정보(턴키/사급) 빈 줄', P, noBuy.map(function (o) { return o.row; }), P + ' · ' + noBuy.map(function (o) { return o.row + '행 ' + o.type + ' ' + o.code; }).join(', '),
      [{ k: 'buy:턴키', label: noBuy.length + '줄 모두 턴키' }, { k: 'buy:사급', label: noBuy.length + '줄 모두 사급' }], noBuy.length + '');
    list.forEach(function (o) {
      if (!o.code) add('자재코드 빈 줄', P, [o.row], desc(o) + ' · ' + o.name.slice(0, 30) + ' — 코드는 BOM 보기에서 빼고 [+ 자재 추가]로 다시', [], '');
      else if (!codeOk.test(o.code)) add('자재코드 형식 아님', P, [o.row], desc(o) + (o.ck ? ' · 원가반영 있음' : ' · 원가반영 없음(참고 줄)'), o.ck ? [{ k: 'ckOff:' + o.row, label: '원가반영 빼기(참고 줄로)' }] : [], o.code);
      if (o.start && !R(o.start)) add('초도 칸 이상', P, [o.row], desc(o) + ' · 초도 "' + o.start + '"', [{ k: 'start1', label: '초도 1차로' }], o.start);
      if (o.end && !R(o.end) && o.end !== '단종') add('종료 칸 이상', P, [o.row], desc(o) + ' · 종료 "' + o.end + '" — 종료 차수를 정해 [이 차수 구성 정정]에서', [{ k: 'endClear', label: '종료 비우기(계속 사용)' }], o.end);
      if (R(o.end) && R(o.start) && R(o.end) < R(o.start)) add('종료가 초도보다 앞', P, [o.row], desc(o), [{ k: 'endClear', label: '종료 비우기' }], o.start + o.end);
      // 같은 구분 · 같은 반제품의 지금 줄이 원가에 들어가 있으면 이원화 — 원가는 하나만(담당자 10/18)
      if (!o.end && !o.ck && codeOk.test(o.code) && o.type !== '세트' && !list.some(function (q) { return q !== o && !q.end && q.ck && q.type === o.type && q.semi === o.semi; })) add('지금 줄인데 원가반영 없음', P, [o.row], desc(o), [{ k: 'ckOn', label: '원가반영 ' + P + ' 넣기' }], o.code);
      if (o.ck && o.ck !== P && o.ck !== '-') add('원가반영 값이 제품코드와 다름', P, [o.row], desc(o) + ' · F=' + o.ck, [{ k: 'ckOn', label: 'F를 ' + P + ' 로' }, { k: 'ckOff:' + o.row, label: 'F 지우기' }], o.ck);
      var calc = ((N(o.unit) * (N(o.fx) || 1)) + N(o.proc) + N(o.ship)) * (S(o.qty) === '' ? 1 : N(o.qty));
      if (!o.f && S(o.cost) !== '' && Math.abs(calc - N(o.cost)) > 1) add('소요원가 손입력이 계산과 다름', P, [o.row], desc(o) + ' · 계산 ' + Math.round(calc * 100) / 100 + ' / 칸 ' + N(o.cost), [{ k: 'costCalc', label: '계산값 ' + Math.round(calc * 100) / 100 + ' 로(수식)' }], N(o.cost) + '');
    });
    var g = {};
    list.forEach(function (o) { if (codeOk.test(o.code) && !o.end) { var k = o.type + '|' + o.code.replace(/\d+$/, '') + '|' + norm_(o.name) + '|' + (o.semi || ''); (g[k] = g[k] || []).push(o); } });      // 반제품이 다르면 다른 자재(공용 자재는 반제품마다 한 줄)
    Object.keys(g).forEach(function (k) {
      var a = g[k]; if (a.length < 2 || !a.some(function (o) { return o.code !== a[0].code; })) return;
      // 같은 자재가 동시에 둘 이상 열림 = 이원화(업체 둘) 또는 옛 버전을 안 닫음. 원가반영이 둘 이상이면 원가가 겹친다 — 하나만 원가 기준으로
      if (a.filter(function (o) { return o.ck; }).length < 2) return;
      // 초도가 서로 다르면 '옛 버전 줄이 안 닫힘'(옛 줄 종료)으로 처리 — 같은 건을 두 종류로 띄우지 않는다. 초도가 같은 두 줄(이원화)만 여기서
      if (a.some(function (o) { return R(o.start) !== R(a[0].start); })) return;
      add('같은 자재 원가 겹침', P, a.map(function (o) { return o.row; }), a.map(desc).join(' / '),
        a.map(function (o) { return { k: 'pick:' + o.row, label: o.code + (o.vendor ? ' ' + o.vendor : '') + ' 만 원가에' }; }), a.map(function (o) { return o.code + o.ck; }).join(','));
    });
    // 같은 코드인데 차수마다 사양이 다름 — 사양이 바뀌면 새 번호여야 하는데(채번 규칙) 안 올렸을 수 있다. 사람이 하나씩 확인
    var sg = {};
    list.forEach(function (o) { if (codeOk.test(o.code) && o.type !== '제품' && o.type !== '세트' && o.type !== '반제품' && o.end !== '단종' && o.spec) (sg[o.code] = sg[o.code] || []).push(o); });
    Object.keys(sg).forEach(function (c) {
      var a = sg[c].slice().sort(function (x, y) { return (R(x.start) || 0) - (R(y.start) || 0); });
      var ns = function (t) { return norm_(t).replace(/[·,/]/g, ''); }, first = ns(a[0].spec);
      var later = a.filter(function (o) { return ns(o.spec) !== first; });
      if (!later.length) return;
      var specs = {}; a.forEach(function (o) { specs[ns(o.spec)] = o.spec; });
      add('같은 코드인데 사양이 바뀜', P, a.map(function (o) { return o.row; }),
        c + ' · ' + a[0].type + ' · ' + a.map(function (o) { return o.start + '~' + (o.end || '') + ' "' + o.spec.slice(0, 30) + '"'; }).join(' / '),
        [], c + '|' + Object.keys(specs).join('|'));
    });
    // 옛 버전 줄이 안 닫힘: 같은 구분 · 같은 코드 줄기(예: MP0159BL2 → BL3)에서 새 버전이 N차부터 들어왔는데 옛 줄이 N차 이후까지 열려 있음
    // (예: 용기라벨 3차까지 에이치씨 BL2, 4차부터 삼영특수인쇄 BL3 → BL2 종료 3차). 초도가 같은 두 줄(이원화)은 건드리지 않는다.
    var vg = {};
    list.forEach(function (o) { if (codeOk.test(o.code) && o.end !== '단종' && R(o.start)) { var k = o.type + '|' + o.code.replace(/\d+$/, '') + '|' + (o.semi || ''); (vg[k] = vg[k] || []).push(o); } });
    Object.keys(vg).forEach(function (k) {
      var a = vg[k].slice().sort(function (x, y) { return R(x.start) - R(y.start) || x.row - y.row; });
      if (a.length < 2) return;
      var plan = [];
      a.forEach(function (o, i) {
        var nx = a.slice(i + 1).filter(function (q) { return R(q.start) > R(o.start) && q.code !== o.code; })[0];
        if (!nx) return;
        var want = R(nx.start) - 1, cur = R(o.end);
        if (cur && cur <= want) return;                       // 이미 새 버전 앞에서 닫힘
        plan.push({ o: o, nx: nx, want: want });
      });
      if (!plan.length) return;
      add('옛 버전 줄이 안 닫힘', P, plan.map(function (p) { return p.o.row; }),
        plan.map(function (p) { return p.o.code + (p.o.vendor ? ' ' + p.o.vendor : '') + ' ' + p.o.start + '~' + (p.o.end || '') + ' → ' + p.nx.code + (p.nx.vendor ? ' ' + p.nx.vendor : '') + ' ' + p.nx.start + '부터'; }).join(' / '),
        [{ k: 'close:' + plan.map(function (p) { return p.o.row + '@' + p.want; }).join(','), label: plan.map(function (p) { return p.o.code + ' 종료 ' + p.want + '차'; }).join(' · ') }],
        plan.map(function (p) { return p.o.code + '@' + p.want; }).join(','));
    });
  });
  // 자재코드를 품목 DB(_실행판_품목) · 신규코드채번 탭과 맞대기
  //  · 코드가 'X' · 빈칸처럼 코드가 아니면: 품목명(브랜드 · 반제품/미품 같은 말 · 띄어쓰기 무시)이 같은 코드, 반제품이면 같은 제품 번호의 반제품 코드(예: M0050AA1 → MX0050…)를 제안
  //  · 코드가 있는데 품목명이 같은 등록 코드와 다르면(예: 튜브+캡 TU1 ↔ TB1) 그 코드로 — 같은 (지금 코드 → 등록 코드) 묶음은 한 건
  var codeFix = {};       // 줄 번호 → 제안 코드 목록(형식 아님 건에 붙인다)
  try {
    var nk = function (s) {
      var t = norm_(s);
      RB_BRANDS.forEach(function (b) { var bb = norm_(b); if (bb && t.indexOf(bb) === 0) t = t.slice(bb.length); });
      return t.replace(/반제품|미품|벌크|bulk/g, '');
    };
    // byName = 품목 DB + 신규코드채번(X 줄 제안용), byItem = 품목 DB 만(코드가 다른지 맞대기 — 품목 시트 기준)
    var known = {}, byName = {}, byItem = {};
    var addK = function (code, name, map) {
      var c = U(code).replace(/\s/g, ''); if (!codeOk.test(c)) return;
      known[c] = 1;
      var k = nk(name); if (k) { (map[k] = map[k] || []); if (map[k].indexOf(c) < 0) map[k].push(c); }
    };
    readItems_().forEach(function (it) { addK(it.code, it.name, byName); addK(it.code, it.name, byItem); });
    try {
      var regS = bomSS_().getSheetByName(RB_BOM_REG);
      if (regS && regS.getLastRow() > 2) {
        var RCq = bomRegCols_(regS);
        if (RCq.code >= 0) regS.getRange(3, 1, regS.getLastRow() - 2, RCq.lc).getValues().forEach(function (r) { addK(r[RCq.code], RCq.name >= 0 ? r[RCq.name] : '', byName); });
      }
    } catch (eReg) { /* 채번 탭을 못 읽으면 품목 DB 로만 */ }
    var knownList = Object.keys(known);
    var mis = {};
    rows.forEach(function (o) {
      if (o.type === '제품' || o.type === '세트' || (o.code && o.code === o.p)) return;
      var byN = (byName[nk(o.name)] || []).slice(), byI = (byItem[nk(o.name)] || []).slice();
      if (!codeOk.test(o.code)) {
        // 코드가 아님(X · 빈칸 등): 이름이 같은 코드 + 반제품이면 같은 제품 번호의 반제품 코드
        var cand = byN.slice();
        var pm = o.p.match(/^([A-Z])X?(\d{4})/);
        if (o.type === '반제품' && pm) {
          knownList.forEach(function (c) { if (c.indexOf(pm[1] + 'X' + pm[2]) === 0 && cand.indexOf(c) < 0) cand.push(c); });
        }
        if (cand.length) codeFix[o.row] = cand.slice(0, 6);
        return;
      }
      if (!byI.length || byI.indexOf(o.code) > -1) return;           // 품목 DB(품목 시트)에 같은 이름 · 같은 코드가 있으면 그대로
      // 같은 줄기(브랜드 · 번호 · 구분 약호가 같고 버전만 다름, 예: MP0136TB1 ↔ TB2)는 다른 버전 — 바꾸라 하지 않는다(2026-10-09 지적)
      var stem = function (c) { return String(c).replace(/\d+$/, ''); };
      byI = byI.filter(function (c) { return stem(c) !== stem(o.code); });
      if (!byI.length) return;
      var key = o.code + '>' + byI.join('|');
      (mis[key] = mis[key] || { from: o.code, to: byI, list: [] }).list.push(o);
    });
    // 구분과 코드의 분류코드가 다름(예: 구분 튜브+캡 = TB 인데 코드는 MP0178TU1) — 품목 마스터에 같은 이름 코드가 둘 있어도 잡힌다
    var tmap = bomTypeCodes_(bomSS_()), bad = {}, badRow = {};
    rows.forEach(function (o) {
      var mm = o.code.match(/^([A-Z])P(\d{4})([A-Z]{2})(\d+)$/), want = tmap[o.type];
      if (!mm || !want || want === 'XX' || mm[3] === want) return;
      var base = mm[1] + 'P' + mm[2] + want;
      var cand = knownList.filter(function (c) { return c.indexOf(base) === 0 && /^\d+$/.test(c.slice(base.length)); }).sort();
      badRow[o.row] = 1;
      var key = o.p + '|' + o.code + '>' + base;       // 품목마다 한 건(다른 품목 BOM 까지 한 번에 바뀌지 않게)
      (bad[key] = bad[key] || { from: o.code, base: base, want: want, cand: cand, list: [] }).list.push(o);
    });
    Object.keys(bad).forEach(function (key) {
      var b = bad[key], ps = [];
      b.list.forEach(function (o) { if (ps.indexOf(o.p) < 0) ps.push(o.p); });
      add('자재코드 분류가 구분과 다름', ps.length === 1 ? ps[0] : '', b.list.map(function (o) { return o.row; }).slice(0, 60),
        b.from + ' · 구분 ' + b.list[0].type + ' = 분류코드 ' + b.want + ' 인데 코드는 ' + b.from.match(/[A-Z]{2}(?=\d+$)/)[0] + ' · ' + b.list.length + '줄 · 품목 ' + ps.join(', ') +
          (b.cand.length ? ' · 등록된 코드: ' + b.cand.join(', ') : ' · 규칙대로면 ' + b.base + '… (품목 마스터에 없음 — [이 차수 구성 정정]에서 코드 확인)'),
        b.cand.map(function (c) { return { k: 'code:' + c, label: b.list.length + '줄 자재코드를 ' + c + ' 로' }; }).concat((function () {
          var mx = 0; knownList.forEach(function (c) { if (c.indexOf(b.base) === 0) { var q = c.slice(b.base.length).match(/^(\d+)$/); if (q) mx = Math.max(mx, Number(q[1])); } });
          return [{ k: 'newcode:' + b.base + (mx + 1), label: '규칙대로 ' + b.base + (mx + 1) + ' 로 새로 채번' }];
        })()), key);
    });
    Object.keys(mis).forEach(function (key) {
      var m = mis[key], ps = [];
      if (m.list.every(function (o) { return badRow[o.row]; })) return;   // 분류 검사에 이미 나온 줄
      m.list.forEach(function (o) { if (ps.indexOf(o.p) < 0) ps.push(o.p); });
      add('자재코드가 품목 DB와 다름', ps.length === 1 ? ps[0] : '', m.list.map(function (o) { return o.row; }).slice(0, 60),
        m.from + ' → 등록 코드 ' + m.to.join(' / ') + ' (품목명 "' + m.list[0].name.slice(0, 40) + '") · ' + m.list.length + '줄 · 품목 ' + ps.join(', '),
        m.to.map(function (c) { return { k: 'code:' + c, label: m.list.length + '줄 자재코드를 ' + c + ' 로' }; }), key);
    });
  } catch (eIt) { /* 품목 DB 를 못 읽으면 이 검사만 건너뛴다 */ }
  // '자재코드 형식 아님'(X · 빈칸) 건에 등록 코드 제안을 붙인다 — 앞에서 만든 건에 고치기 단추를 더한다
  items.forEach(function (it) {
    if (it.kind !== '자재코드 형식 아님' && it.kind !== '자재코드 빈 줄') return;
    var c = codeFix[it.rows[0]];
    if (!c || !c.length) { it.text += ' · 품목 DB 에서 같은 이름' + (/반제품/.test(it.text) ? ' · 같은 번호 반제품' : '') + ' 코드를 찾지 못함'; return; }
    it.text += ' · 등록된 코드 후보: ' + c.join(', ');
    it.acts = c.map(function (x) { return { k: 'code:' + x, label: '자재코드를 ' + x + ' 로' }; }).concat(it.acts || []);
  });
  // 품목 DB 에 없는 구성(자재 · 반제품 · 제품 코드) — 품목 DB 가 기준. 알림만(고치기 단추 없음): 코드가 맞으면 품목 DB 에 등록, 틀리면 [이 차수 구성 정정]
  try {
    var inDb = {};
    readItems_().forEach(function (it) { inDb[it.code] = 1; });
    var miss = {}, dbCodes = Object.keys(inDb), tmapDb = bomTypeCodes_(bomSS_()), known = null;
    rows.forEach(function (o) {
      if (!codeOk.test(o.code) || inDb[o.code] || o.end === '단종') return;
      (miss[o.code] = miss[o.code] || []).push(o);
    });
    Object.keys(miss).forEach(function (c) {
      var L = miss[c], ps = [];
      L.forEach(function (o) { if (ps.indexOf(o.p) < 0) ps.push(o.p); });
      var where = c + ' · ' + L[0].type + ' · ' + L[0].buy + ' · ' + L[0].name.slice(0, 40) + ' · ' + L.length + '줄 · 품목 ' + ps.slice(0, 6).join(', ') + (ps.length > 6 ? ' 외 ' + (ps.length - 6) : '');
      if (bomRuleOk_(c, L[0].type, tmapDb)) {
        // 채번 규칙에 맞는 코드 — 품목 DB 에 등록만 하면 된다(한꺼번에 등록 단추)
        add('품목코드 생성 필요', ps.length === 1 ? ps[0] : '', L.map(function (o) { return o.row; }).slice(0, 60), where, [{ k: 'reg', label: c + ' 품목 DB 에 등록' }], c);
        return;
      }
      // 규칙과 다른 코드(예: 튜브+캡인데 TU) — 사람이 확인: 품목 DB 코드(사급) · 규칙대로 새 코드 · 직접 입력
      if (typeof badRow !== 'undefined' && L.every(function (o) { return badRow[o.row]; })) return;     // '자재코드 분류가 구분과 다름'에 이미 나온 코드
      if (!known) { try { known = bomKnownCodes_(); } catch (eK) { known = {}; } }
      var cand = L.some(function (o) { return bomIsSa_(o.buy); }) ? bomDbCands_(c, L[0].type, dbCodes, tmapDb) : [];
      var nx = bomRuleNext_(c, L[0].type, tmapDb, known);
      var acts = cand.slice(0, 3).map(function (x) { return { k: 'code:' + x, label: '자재코드를 ' + x + ' 로(품목 DB)' }; });
      if (nx) acts.push({ k: 'newcode:' + nx, label: '규칙대로 ' + nx + ' 로 새로 채번' });
      add('자재코드가 채번 규칙과 다름', ps.length === 1 ? ps[0] : '', L.map(function (o) { return o.row; }).slice(0, 60),
        where + ' · 구분 ' + L[0].type + ' 약호 ' + (tmapDb[L[0].type] || '?') + (cand.length ? ' · 품목 DB: ' + cand.join(', ') : ''), acts, c);
    });
  } catch (eDb) { /* 품목 DB 를 못 읽으면 이 검사만 건너뛴다 */ }
  var byC = {};
  rows.forEach(function (o) { if (codeOk.test(o.code) && o.type !== '제품' && o.type !== '반제품') (byC[o.code] = byC[o.code] || []).push(o); });
  Object.keys(byC).forEach(function (c) {
    var vd = {}; byC[c].forEach(function (o) { var k = o.vendor.replace(/\s|\(주\)|주식회사|㈜/g, ''); if (k) (vd[k] = vd[k] || []).push(o.row); });
    if (Object.keys(vd).length > 1) add('같은 자재코드에 업체가 여럿', '', byC[c].map(function (o) { return o.row; }).slice(0, 40), c + ' · ' + Object.keys(vd).map(function (k) { return k + '(' + vd[k].slice(0, 4).join(',') + '행)'; }).join(' / ') + ' — 업체가 바뀐 거면 새 코드였어야 함(확인용)', [], Object.keys(vd).sort().join(','));
  });
  return items;
}
/** [그대로 두기]로 한 건 — 따로 탭 없이 BOM변경이력의 '검사 그대로' 줄(변경ID = 검사ID, 되돌리기 정보 = 서명)에서 읽는다 */
function bomReviewSkips_() {
  var m = {}, lg = bomSS_().getSheetByName(RB_BOM_LOG);
  if (lg && lg.getLastRow() > 1) lg.getRange(2, 1, lg.getLastRow() - 1, RB_BOM_LOG_HEAD.length).getValues().forEach(function (r) { if (str_(r[5]) === '검사 그대로') m[str_(r[14]) + '#' + str_(r[15])] = 1; });
  return m;
}
/** 화면: 검사 목록(그대로 두기로 한 건 빼고) */
function apiBomReviewList() {
  requireEditor_();
  var skip = bomReviewSkips_();
  var items = bomAuditItems_().filter(function (it) { return !skip[it.id + '#' + it.sig]; });
  var cnt = {}; items.forEach(function (it) { cnt[it.kind] = (cnt[it.kind] || 0) + 1; });
  return { items: items.slice(0, 1500), count: cnt, total: items.length };
}
/** 화면: 한 건 고치기 · 그대로 두기. act = 'skip' 이면 기록만 */
function apiBomReviewFix(id, act, why) {
  requireEditor_();
  why = str_(why).slice(0, 200) || 'BOM 검사';
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var res;
  try {
    var it = bomAuditItems_().filter(function (x) { return x.id === id; })[0];
    if (!it) throw new Error('그 건이 이미 없습니다(누가 고쳤거나 행이 바뀜). 목록을 새로 불러 주세요.');
    if (act === 'skip') {
      bomLogWrite_(bomSS_(), [[new Date(), me_(), it.product || '', it.pname || '', '', '검사 그대로', it.kind, '', '', it.text.slice(0, 300), '그대로 둠', why, '', '그대로', it.id, it.sig]]);
      return { ok: true, skipped: true };
    }
    // 직접 입력(newcode:)은 '자재코드가 채번 규칙과 다름' 건에서만, 형식 · 중복을 서버가 확인
    var codeKind = it.kind === '품목코드 생성 필요' || it.kind === '자재코드가 채번 규칙과 다름' || it.kind === '자재코드 분류가 구분과 다름';
    var typed = codeKind && (/^newcode:/.test(act) || act === 'reg');
    if (!typed && !it.acts.some(function (a) { return a.k === act; })) throw new Error('이 건에 없는 고치기입니다.');
    var itCode = it.kind === '자재코드 분류가 구분과 다름' ? String(it.sig).split('|').pop().split('>')[0] : it.sig;   // 분류 건의 열쇠는 '품목|코드>약호'
    if (act === 'newcode:' + itCode) act = 'reg';     // 추천 칸을 고치지 않았으면 지금 코드 그대로 등록
    if (act === 'reg') {
      var rr = bomRegFromRows_([itCode], 'BOM 검사에서 확인 후 등록');
      if (!rr.length) throw new Error('등록하지 못했습니다(이미 있거나 이름이 비었음).');
      bomLogWrite_(bomSS_(), [[new Date(), me_(), it.product || '', it.pname || '', '', '검사 수정', it.kind, '', it.sig, it.text.slice(0, 300), '품목 DB 등록 ' + rr.join(', '), why, '', '유효', Utilities.getUuid().slice(0, 8) + '-rv', JSON.stringify({ regs: rr })]]);
      return { ok: true, changed: ['품목 DB 등록 ' + rr.join(', ')], product: it.product || '' };
    }
    var newCode = '';
    if (/^newcode:/.test(act)) {
      newCode = itemCodeKey_(act.slice(8));
      if (!/^[A-Z]{1,2}\d{4}[A-Z]{2}\d+$/.test(newCode)) throw new Error('코드 형식이 아닙니다: ' + newCode + ' (예: MP0178TB2)');
      if (newCode !== it.sig && itemDbAllCodes_().indexOf(newCode) < 0) bomCodeFreeOrThrow_(newCode, { product: it.product, row: (it.rows || [])[0] });
      act = 'code:' + newCode;
    }
    var ss = bomSS_(), sh = bomSheet_(), C = bomCols_(sh);
    var targets = it.rows.slice();
    var m = act.match(/^ckOff:(\d+)$/); if (m) targets = [Number(m[1])];
    var splitTo = '';
    if (/^split:/.test(act)) { var sp = act.slice(6).split('@'); splitTo = itemCodeKey_(sp[1]); targets = sp[0].split(',').map(Number).filter(function (n) { return n > 2; }); }
    var many = [], changed = [];
    targets.forEach(function (r) {
      var x = sh.getRange(r, 1, 1, C.lc).getValues()[0];
      var prev = {}, set = {};
      var P = str_(x[C.product]).toUpperCase();
      if (/^setP:/.test(act)) { var np = act.slice(5); set.product = np; if (str_(x[C.costKey])) set.costKey = np; }
      else if (splitTo) {
        set.product = splitTo; if (str_(x[C.costKey])) set.costKey = splitTo;
        if (str_(x[C.type]) === '제품' && str_(x[C.code]).toUpperCase() === P) set.code = splitTo;     // 제품 줄 코드(E)도
      }
      else if (act === 'start1') { if (!str_(x[C.start]) || !/^\d+\s*차$/.test(str_(x[C.start]))) set.start = '1차'; }
      else if (act === 'endClear') set.end = '';
      else if (/^close:/.test(act)) {      // 옛 버전 줄 종료: 'close:행@차수,행@차수'
        act.slice(6).split(',').forEach(function (p) { var q = p.split('@'); if (Number(q[0]) === r && Number(q[1]) > 0) set.end = Number(q[1]) + '차'; });
      }
      else if (/^ckOff:/.test(act)) set.costKey = '';
      else if (/^pick:/.test(act)) { var want = r === Number(act.slice(5)) ? P : ''; if (str_(x[C.costKey]).toUpperCase() !== want) set.costKey = want; }
      else if (act === 'ckOn') set.costKey = P;
      else if (/^code:/.test(act)) { var nc = act.slice(5); if (str_(x[C.code]).toUpperCase() !== nc) set.code = nc; }
      else if (/^buy:/.test(act)) { if (!str_(x[C.buy])) set.buy = act.slice(4); }
      else if (/^brand:/.test(act)) { if (C.brand >= 0 && !str_(x[C.brand])) set.brand = act.slice(6); }
      else if (act === 'costCalc') {
        prev.cost = x[C.cost];
        var cc = colRB_(C.cost + 1), T = colRB_(C.unit + 1), Z = C.fx >= 0 ? colRB_(C.fx + 1) : '', UU = C.proc >= 0 ? colRB_(C.proc + 1) : '', V = C.ship >= 0 ? colRB_(C.ship + 1) : '', SS = colRB_(C.qty + 1);
        sh.getRange(r, C.cost + 1).setFormula('=((' + T + r + (Z ? '*' + Z + r : '') + ')' + (UU ? '+' + UU + r : '') + (V ? '+' + V + r : '') + ')*' + SS + r);
        changed.push(r + '행 소요원가 수식');
      }
      Object.keys(set).forEach(function (k) { if (C[k] < 0) return; prev[k] = x[C[k]]; sh.getRange(r, C[k] + 1).setValue(set[k]); });
      if (Object.keys(set).length) changed.push(r + '행 ' + Object.keys(set).map(function (k) { return (RB_BOM_HEAD[k] || k) + ' ' + (str_(x[C[k]]) || '-') + '→' + (str_(set[k]) || '-'); }).join(' · '));
      if (Object.keys(prev).length) many.push({ product: set.product || P, code: set.code !== undefined ? set.code : str_(x[C.code]), start: set.start !== undefined ? set.start : str_(x[C.start]), prev: prev });
    });
    if (!changed.length) throw new Error('바꿀 것이 없습니다.');
    var regs = newCode && itemDbAllCodes_().indexOf(newCode) < 0 ? bomRegFromRows_([newCode], 'BOM 검사 · 코드 새로 채번') : [];
    if (regs.length) changed.push('품목 DB 등록 ' + regs.join(', '));
    var label = (it.acts.filter(function (a) { return a.k === act; })[0] || {}).label || (newCode ? '자재코드를 ' + newCode + ' 로(직접 입력)' : act);
    var logId = Utilities.getUuid().slice(0, 8) + '-rv';
    bomLogWrite_(ss, [[new Date(), me_(), it.product || '', '', '', '검사 수정', it.kind, '', '', it.text.slice(0, 300), label + ' · ' + changed.join(' / ').slice(0, 300), why, '', '유효',
      logId, JSON.stringify({ many: many })]]);
    SpreadsheetApp.flush();
    res = { ok: true, changed: changed, logId: logId, product: it.product || '' };
  } finally {
    lock.releaseLock();
  }
  try { CacheService.getScriptCache().remove('bom4:idx:n'); bomBuildCache_(); } catch (e) { /* 다음에 */ }
  return res;
}

/**
 * BOM 줄 내용으로 품목 DB 등록: 코드마다 지금 쓰는 줄(종료 없는 줄 · 초도 늦은 줄)의 품목명 · 브랜드 · 업체 · 사양. 이미 있으면 건너뜀.
 */
/** 사용자가 고친 새 코드: 형식 맞고 아직 안 쓰인 코드면 그대로, 비었으면 '' (규칙 추천 번호를 쓴다), 이미 쓰인 코드면 막는다 */
/**
 * 화면: BOM 보기 '품목코드 생성 필요' 줄에서 코드 확정 — 규칙 추천 코드를 칸에서 고칠 수 있다.
 *  · newCode 가 지금 코드와 같으면: 지금 코드를 품목 DB 에 등록(품목명 · 브랜드 · 업체 · 사양은 BOM 줄 그대로)
 *  · 다르면: 이 품목에서 같은 코드 · 같은 사양 줄의 자재코드를 newCode 로 바꾸고, 품목 DB 에 없으면 등록(이력 · 되돌리기)
 * 다른 자재가 이미 쓰는 BOM 코드(품목 DB 에 없는)로는 바꾸지 않는다.
 */
function apiBomCodeSet(product, row, oldCode, newCode, why) {
  requireEditor_();
  product = str_(product).toUpperCase(); oldCode = itemCodeKey_(oldCode); newCode = itemCodeKey_(newCode);
  // 제품 줄(자재코드 = 제품코드): 이 품목 BOM 의 제품코드 자체를 바꾼다(예: 규칙에 안 맞는 HP00721 → H0072AA1)
  if (oldCode === product) return bomProductRecode_(product, newCode, why);
  if (!/^[A-Z]{1,2}\d{4}[A-Z]{2}\d+$/.test(newCode)) throw new Error('코드 형식이 아닙니다: ' + newCode + ' (예: MP0178TB2)');
  why = str_(why).slice(0, 200) || 'BOM 보기 · 품목코드 확정';
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var changed = [], regs = [];
  try {
    var ss = bomSS_(), sh = bomSheet_(), C = bomCols_(sh), lr = sh.getLastRow();
    var all = lr > 2 ? sh.getRange(3, 1, lr - 2, C.lc).getValues() : [];
    var x = all[Number(row) - 3];
    if (!x || str_(x[C.product]).toUpperCase() !== product || itemCodeKey_(x[C.code]) !== oldCode) throw new Error('BOM 시트가 그사이 바뀌었습니다. BOM 보기를 다시 열어 주세요.');
    var dbCodes = itemDbAllCodes_();             // 품목 DB 코드는 한 번만 읽는다(예전: 두세 번)
    if (newCode === oldCode) {
      regs = bomRegFromRows_([oldCode], 'BOM 보기에서 확인 후 등록', all, dbCodes);
      if (regs.length) changed.push('품목 DB 등록 ' + oldCode);
      else if (dbCodes.indexOf(oldCode) > -1) changed.push(oldCode + ' 는 이미 품목 DB 에 있습니다(표시를 고쳤습니다)');
      else throw new Error(oldCode + ' 를 등록하지 못했습니다(품목명이 비었을 수 있습니다).');
    } else {
      var inDb = dbCodes.indexOf(newCode) > -1;
      if (!inDb) bomCodeFreeOrThrow_(newCode, { product: product, row: row }, all);     // 옛 신규코드채번 탭에만 있던 번호는 막지도 알리지도 않는다
      var many = [], wr = {};
      all.forEach(function (y, i) {
        var rr = i + 3;
        if (str_(y[C.product]).toUpperCase() !== product || itemCodeKey_(y[C.code]) !== oldCode) return;
        if (rr !== Number(row) && C.spec >= 0 && norm_(y[C.spec]) !== norm_(x[C.spec])) return;     // 사양이 다른 줄은 다른 자재 — 그대로
        var w = wr[rr] = {}, ch = str_(y[C.change]);
        w[C.code] = newCode;
        if (C.change >= 0) w[C.change] = (ch ? ch + ' / ' : '') + '코드 ' + oldCode + ' → ' + newCode + ' (' + why + ')';
        many.push({ product: product, code: newCode, start: str_(y[C.start]), id: C.id >= 0 ? str_(y[C.id]) : '', prev: { code: y[C.code], change: y[C.change] } });
        if (changed.indexOf(oldCode + ' → ' + newCode) < 0) changed.push(oldCode + ' → ' + newCode);
      });
      // 반제품 코드를 다른 번호로 바로잡으면 그 구성 자재의 반제품 구성 칸도 새 코드로(같은 반제품의 다른 버전 줄이 남아 있으면 그대로)
      var oldK = bomSemiKey_(oldCode);
      if (C.semi >= 0 && str_(x[C.type]) === '반제품' && oldK !== bomSemiKey_(newCode) &&
          !all.some(function (y, i) { return !wr[i + 3] && str_(y[C.product]).toUpperCase() === product && str_(y[C.type]) === '반제품' && bomSemiKey_(y[C.code]) === oldK; })) {
        all.forEach(function (y, i) {
          var rr = i + 3;
          if (str_(y[C.product]).toUpperCase() !== product || str_(y[C.semi]) === '*' || bomSemiKey_(y[C.semi]) !== oldK || wr[rr]) return;
          var w = wr[rr] = {}, ch = str_(y[C.change]);
          w[C.semi] = newCode;
          if (C.change >= 0) w[C.change] = (ch ? ch + ' / ' : '') + '반제품 구성 ' + str_(y[C.semi]) + ' → ' + newCode + ' (' + why + ')';
          many.push({ product: product, code: str_(y[C.code]), start: str_(y[C.start]), id: C.id >= 0 ? str_(y[C.id]) : '', prev: { semi: y[C.semi], change: y[C.change] } });
        });
      }
      // 줄마다 코드 · 변동사항 칸을 한 번에 쓰고, 읽어 둔 값에도 반영(아래 품목 DB 등록이 BOM 을 다시 읽지 않게)
      Object.keys(wr).forEach(function (rr) { bomWriteRow_(sh, Number(rr), wr[rr]); var y = all[Number(rr) - 3]; Object.keys(wr[rr]).forEach(function (c) { y[Number(c)] = wr[rr][c]; }); });
      SpreadsheetApp.flush();
      if (!inDb) { regs = bomRegFromRows_([newCode], 'BOM 보기 · 새 코드', all, dbCodes); if (regs.length) changed.push('품목 DB 에 등록했습니다'); }
      bomLogWrite_(ss, [[new Date(), me_(), product, '', '', '정정', str_(x[C.type]), oldCode, newCode, '자재코드 ' + oldCode, '자재코드 ' + newCode + ' · ' + many.length + '줄', why, '', '유효',
        Utilities.getUuid().slice(0, 8) + '-cs', JSON.stringify({ many: many })]]);
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  bomAfterSave_([product], false);          // 칸만 바뀜(줄 번호 그대로) — 그 품목만 다시 읽는다
  var res = apiBomGet(product);
  res.changed = changed; res.regs = regs;
  return res;
}
/**
 * 제품코드 바꾸기 — 이 품목 BOM 줄 전부의 제품코드(D) · 제품 줄 자재코드(J) · 원가반영(F, 옛 코드였던 칸)을 새 코드로.
 * 같은 코드면(규칙에 맞을 때만) 품목 DB 에 등록만. 새 코드가 다른 BOM 품목이면 막는다. 줄 수 · 줄 번호는 그대로.
 */
function bomProductRecode_(product, newCode, why) {
  why = str_(why).slice(0, 200) || 'BOM 보기 · 제품코드 확정';
  var rule = /^[A-Z]X?\d{4}[A-Z]{2}\d+$/;
  if (!rule.test(newCode)) {
    var m = product.match(/^([A-Z])P?(\d{4})/);
    throw new Error(newCode + ' 는 제품 품목코드 규칙에 맞지 않습니다(브랜드 1글자 + 번호 4자리 + 2글자 + 버전, 예: ' + (m ? m[1] + m[2] + 'AA1' : 'H0072AA1') + '). 맞는 코드를 칸에 적고 [등록]하면 이 품목 BOM 의 제품코드가 그 코드로 바뀝니다.');
  }
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var changed = [], regs = [], n = 0, ss, sh, C;
  try {
    ss = bomSS_(); sh = bomSheet_(); C = bomCols_(sh);
    var lr = sh.getLastRow(), all = lr > 2 ? sh.getRange(3, 1, lr - 2, C.lc).getValues() : [];
    var dbCodes = itemDbAllCodes_();
    if (newCode !== product) {
      if (all.some(function (y) { return str_(y[C.product]).toUpperCase() === newCode; })) throw new Error(newCode + ' 는 이미 다른 BOM 품목입니다(BOM 보기에서 ' + newCode + ' 를 찾아 보세요).');
      if (all.some(function (y) { return itemCodeKey_(y[C.code]) === newCode && str_(y[C.product]).toUpperCase() !== product; })) throw new Error(newCode + ' 는 다른 품목 BOM 에 자재로 쓰이는 코드입니다.');
      // 품목 DB 에 이미 있는 코드면 같은 품목(이름이 같음)일 때만 — 다른 품목 코드로 바꾸면 그 품목 발주 · 단가 · 이력과 섞인다
      if (dbCodes.indexOf(newCode) > -1) {
        var pn = '', dbN = '', nk = function (t) { return str_(t).replace(/\s|\(주\)|주식회사|㈜/g, '').toUpperCase(); };
        all.forEach(function (y) { if (!pn && str_(y[C.product]).toUpperCase() === product && itemCodeKey_(y[C.code]) === product) pn = str_(y[C.name]) || str_(y[C.search]); });
        try { readItems_().some(function (it) { if (it.code === newCode) { dbN = it.name; return true; } return false; }); } catch (eI) { dbN = ''; }
        if (!dbN) throw new Error(newCode + ' 는 품목 DB 에 미사용(되돌림 · 지움)으로 남은 코드입니다 — 다시 쓰지 않습니다. 다른 번호로 해 주세요.');
        if (pn && nk(dbN).indexOf(nk(pn)) < 0 && nk(pn).indexOf(nk(dbN)) < 0) throw new Error(newCode + ' 는 품목 DB 에 다른 품목(' + dbN + ')으로 있는 코드입니다. 이 품목(' + pn + ')이 맞으면 품목 DB 이름을 먼저 맞추고, 아니면 다른 번호로 해 주세요.');
      }
      var many = [];
      all.forEach(function (y, i) {
        if (str_(y[C.product]).toUpperCase() !== product) return;
        var w = {}, rr = i + 3;
        w[C.product] = newCode;
        if (itemCodeKey_(y[C.code]) === product) w[C.code] = newCode;
        if (C.costKey >= 0 && str_(y[C.costKey]).toUpperCase() === product) w[C.costKey] = newCode;
        if (C.change >= 0 && itemCodeKey_(y[C.code]) === product) { var ch = str_(y[C.change]); w[C.change] = (ch ? ch + ' / ' : '') + '제품코드 ' + product + ' → ' + newCode + ' (' + why + ')'; }
        // 되돌리기 기록(apiBomUndo many): 바뀐 뒤 값으로 줄을 찾고(제품코드 = 새 코드) 원래 제품코드 · 자재코드 · 원가반영 · 변동사항으로
        var pv = { product: y[C.product] };
        if (w[C.code] !== undefined) pv.code = y[C.code];
        if (C.costKey >= 0 && w[C.costKey] !== undefined) pv.costKey = y[C.costKey];
        if (C.change >= 0 && w[C.change] !== undefined) pv.change = y[C.change];
        many.push({ product: newCode, code: w[C.code] !== undefined ? newCode : str_(y[C.code]).toUpperCase(), start: str_(y[C.start]), id: C.id >= 0 ? str_(y[C.id]) : '', prev: pv });
        bomWriteRow_(sh, rr, w);
        Object.keys(w).forEach(function (c) { y[Number(c)] = w[c]; });
        n++;
      });
      if (!n) throw new Error('BOM 탭에 ' + product + ' 줄이 없습니다. BOM 보기를 다시 열어 주세요.');
      SpreadsheetApp.flush();
      changed.push('제품코드 ' + product + ' → ' + newCode + ' (' + n + '줄)');
    }
    if (dbCodes.indexOf(newCode) < 0) { regs = bomRegFromRows_([newCode], 'BOM 보기 · 제품코드', all, dbCodes); if (regs.length) changed.push('품목 DB 에 등록했습니다'); }
    if (newCode !== product) {
      // 되돌릴 수 있게(예전엔 상태 '-' · 기록 없음이라 [되돌리기]가 없었다). 새로 등록한 코드는 되돌리면 품목 DB 에 미사용
      bomLogWrite_(ss, [[new Date(), me_(), newCode, '', '', '정정', '제품', product, newCode, '제품코드 ' + product, '제품코드 ' + newCode + ' · ' + n + '줄', why, '', '유효',
        Utilities.getUuid().slice(0, 8) + '-pc', JSON.stringify({ many: many, reg: regs.indexOf(newCode) > -1 ? newCode : '', recodeFrom: product })]]);
      SpreadsheetApp.flush();
    }
    // 옛 제품코드: 이제 어느 BOM 에도 안 쓰이면 품목 DB 에 '미사용'(검색 · 새 발주에서 안 보이게 — 지우지는 않음)
    if (!all.some(function (y) { return str_(y[C.product]).toUpperCase() === product || itemCodeKey_(y[C.code]) === product; })) { try { if (itemDbMarkUnused_(product, '제품코드 ' + newCode + ' 로 바뀜 · 미사용')) changed.push('옛 코드 ' + product + ' 는 품목 DB 에 미사용 표시'); } catch (eU) { /* 넘어간다 */ } }
    else changed.push(newCode + ' 는 이미 품목 DB 에 있습니다');
  } finally {
    lock.releaseLock();
  }
  bomAfterSave_([product, newCode], false);       // 줄 번호는 그대로 — 두 코드만 다시 읽는다(옛 코드는 목록에서 빠진다)
  try { appendHist_([{ kind: 'BOM', code: newCode, item: '제품코드 ' + product + ' → ' + newCode, before: product, after: newCode, reason: why }], 'p'); } catch (e) { /* 넘어간다 */ }
  var res = apiBomGet(newCode);
  res.changed = changed; res.regs = regs; res.recoded = newCode !== product ? { from: product, to: newCode } : null;
  return res;
}
function bomWantCode_(want, used) {
  var c = itemCodeKey_(want);
  if (!c) return '';
  if (!/^[A-Z]{1,2}\d{4}[A-Z]{2}\d+$/.test(c)) throw new Error('새 코드 형식이 아닙니다: ' + c + ' (예: MP0178TB2)');
  if (used[c]) throw new Error(c + ' 는 이미 쓰인 코드입니다(BOM · 품목 DB). 다른 번호로 해 주세요.');
  return c;
}
function bomRegFromRows_(codes, src, v0, have0) {
  var want = {}; (codes || []).forEach(function (c) { c = itemCodeKey_(c); if (c) want[c] = 1; });
  if (!Object.keys(want).length) return [];
  var sh = bomSheet_(), C = bomCols_(sh), lr = sh.getLastRow();
  var v = v0 || (lr > 2 ? sh.getRange(3, 1, lr - 2, C.lc).getValues() : []);        // v0 = 방금 고친 값까지 반영해 둔 BOM 값(다시 읽지 않게)
  var best = {};
  v.forEach(function (r) {
    var c = itemCodeKey_(r[C.code]);
    if (!want[c]) return;
    var live = str_(r[C.end]) === '' ? 1 : 0, st = bomRnum_(r[C.start]) || 0, b = best[c];
    if (!b || live > b.live || (live === b.live && st >= b.st)) best[c] = { live: live, st: st, it: { code: c, name: str_(r[C.name]) || c, brand: C.brand >= 0 ? str_(r[C.brand]) : '', vendor: str_(r[C.vendor]), spec: C.spec >= 0 ? str_(r[C.spec]) : '' } };
  });
  var have = {}; (have0 || itemDbAllCodes_()).forEach(function (c) { have[c] = 1; });
  var list = Object.keys(best).filter(function (c) { return !have[c]; }).map(function (c) { return best[c].it; });
  if (!list.length) return [];
  appendItems_(list, src);
  return list.map(function (x) { return x.code; });
}
/**
 * 화면: [BOM 검사] '품목코드 생성 필요'(채번 규칙에 맞는 코드) 전부 품목 DB 에 등록 — 품목명 · 브랜드 · 업체 · 사양은 BOM 줄 그대로.
 * skipIds: [그대로 두기] 한 건 빼고. 규칙과 다른 코드는 여기서 등록하지 않는다(사람이 확인).
 */
function apiBomReviewRegAll(skipIds, why) {
  requireEditor_();
  var skip = {}; (skipIds || []).forEach(function (x) { skip[x] = 1; });
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var done = [];
  try {
    var items = bomAuditItems_().filter(function (x) { return x.kind === '품목코드 생성 필요' && !skip[x.id]; });
    var regs = bomRegFromRows_(items.map(function (x) { return x.sig; }), '자동 등록 · BOM 채번 규칙 맞음');
    var got = {}; regs.forEach(function (c) { got[c] = 1; });
    items.forEach(function (x) { if (got[x.sig]) done.push({ id: x.id, changed: ['품목 DB 등록 ' + x.sig], product: x.product || '' }); });
    if (regs.length) bomLogWrite_(bomSS_(), [[new Date(), me_(), '', '', '', '검사 수정', '품목코드 생성 필요', '', '', regs.length + '개 코드', '품목 DB 한꺼번에 등록: ' + regs.slice(0, 40).join(', ') + (regs.length > 40 ? ' 외' : ''), str_(why) || 'BOM 검사', '', '유효', Utilities.getUuid().slice(0, 8) + '-rv', JSON.stringify({ regs: regs })]]);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return { done: done, count: done.length };
}

/**
 * 화면: [BOM 검사] '옛 버전 줄이 안 닫힘' 전부 한 번에 — 검사는 한 번만 돌리고, 건마다 옛 줄 종료를 넣고 이력(검사 수정 · 되돌리기 가능)을 남긴다.
 * skipIds: 화면에서 [그대로 두기] 한 건은 빼고.
 */
function apiBomReviewCloseAll(skipIds, why) {
  requireEditor_();
  why = str_(why).slice(0, 200) || 'BOM 검사 · 옛 버전 줄 한꺼번에 닫기';
  var skip = {}; (skipIds || []).forEach(function (x) { skip[x] = 1; });
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var done = [], logs = [];
  try {
    var items = bomAuditItems_().filter(function (x) { return x.kind === '옛 버전 줄이 안 닫힘' && !skip[x.id]; });
    var ss = bomSS_(), sh = bomSheet_(), C = bomCols_(sh);
    items.forEach(function (it) {
      var act = (it.acts[0] || {}).k || '';
      if (!/^close:/.test(act)) return;
      var many = [], changed = [];
      act.slice(6).split(',').forEach(function (p) {
        var q = p.split('@'), r = Number(q[0]), n = Number(q[1]);
        if (!(r > 2) || !(n > 0)) return;
        var x = sh.getRange(r, 1, 1, C.lc).getValues()[0];
        sh.getRange(r, C.end + 1).setValue(n + '차');
        changed.push(r + '행 ' + str_(x[C.code]) + ' 종료 ' + (str_(x[C.end]) || '-') + '→' + n + '차');
        many.push({ product: str_(x[C.product]).toUpperCase(), code: str_(x[C.code]), start: str_(x[C.start]), id: C.id >= 0 ? str_(x[C.id]) : '', prev: { end: x[C.end] } });
      });
      if (!changed.length) return;
      var logId = Utilities.getUuid().slice(0, 8) + '-rv';
      logs.push([new Date(), me_(), it.product || '', '', '', '검사 수정', it.kind, '', '', it.text.slice(0, 300), (it.acts[0].label || '') + ' · ' + changed.join(' / ').slice(0, 300), why, '', '유효', logId, JSON.stringify({ many: many })]);
      done.push({ id: it.id, changed: changed, logId: logId, product: it.product || '' });
    });
    if (logs.length) bomLogWrite_(ss, logs);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  try { CacheService.getScriptCache().remove('bom4:idx:n'); bomBuildCache_(); } catch (e) { /* 다음에 */ }
  return { done: done };
}

/**
 * 화면: 두 품목 BOM 비교(BOM 보기 목록에서 두 개 골라 [비교]) — 각 최신 차수 구성을 자재끼리 맞대어 원가 차이를 보여 준다.
 * 맞대기: 같은 자재코드 → 같은 구분 + 품목명 끝(제품명 뺀 부분) → 같은 구분이 양쪽에 하나씩 남으면 그것끼리. 남은 줄은 한쪽에만.
 * 합계는 원가반영(F) 체크된 줄만(목록 합계와 같게).
 */
function apiBomCompare(codeA, codeB) {
  var side = function (code) {
    code = str_(code).toUpperCase();
    var rows = bomRowsOf_(code), it = bomIndex_().filter(function (x) { return x.code === code; })[0] || {};
    var max = 0;
    rows.forEach(function (r) { var s = bomRnum_(r.start), e = bomRnum_(r.end); if (s > max) max = s; if (e && e > max) max = e; });
    var on = rows.filter(function (r) { var s = bomRnum_(r.start) || 1, e = bomRnum_(r.end); return str_(r.end) !== '단종' && (!max || (s <= max && (!e || e >= max))); });
    var pname = str_(it.name);
    var list = on.map(function (r) {
      var nm = str_(r.name), tail = pname && nm.indexOf(pname) === 0 ? nm.slice(pname.length).trim() : nm;
      var cost = Number(String(r.cost == null ? '' : r.cost).replace(/,/g, '')) || 0;
      return { row: r.row, type: str_(r.type), code: str_(r.code).toUpperCase(), name: nm, tail: tail, vendor: str_(r.vendor), buy: str_(r.buy), spec: str_(r.spec),
        qty: r.qty, unit: r.unit, fx: r.fx, cur: r.cur || '', proc: r.proc, ship: r.ship, cost: cost, ck: !!str_(r.costKey), start: str_(r.start), end: str_(r.end) };
    });
    return { code: code, name: pname, round: max, rows: list, sum: Math.round(list.reduce(function (a, x) { return a + (x.ck ? x.cost : 0); }, 0) * 100) / 100 };
  };
  var A = side(codeA), B = side(codeB), out = [], usedB = {};
  var pair = function (fn) {
    A.rows.forEach(function (a) {
      if (a._m) return;
      var hits = B.rows.filter(function (b, j) { return !usedB[j] && fn(a, b); });
      if (hits.length !== 1 && fn !== byCode) return;            // 이름 · 품목이 여럿 겹치면 짝짓지 않는다(엉뚱한 짝 대신 추가/빠짐으로 보이게)
      var b = hits[0]; if (!b) return;
      var j = B.rows.indexOf(b); usedB[j] = 1; a._m = 1; out.push({ a: a, b: b });
    });
  };
  var byCode = function (a, b) { return a.code && a.code === b.code; };
  var isProd = function (x, P) { return x.code === P.code || x.type === '제품'; };
  pair(byCode);
  pair(function (a, b) { return isProd(a, A) && isProd(b, B); });
  pair(function (a, b) { return a.type === b.type && a.tail && a.tail === b.tail; });
  // 같은 구분이 양쪽에 하나씩만 남았으면 그것끼리
  A.rows.forEach(function (a) {
    if (a._m) return;
    var la = A.rows.filter(function (x) { return !x._m && x.type === a.type; });
    var lb = B.rows.filter(function (b, j) { return !usedB[j] && b.type === a.type; });
    if (la.length === 1 && lb.length === 1) { usedB[B.rows.indexOf(lb[0])] = 1; a._m = 1; out.push({ a: a, b: lb[0] }); }
  });
  A.rows.forEach(function (a) { if (!a._m) out.push({ a: a, b: null }); });
  B.rows.forEach(function (b, j) { if (!usedB[j]) out.push({ a: null, b: b }); });
  var order = function (p) { var x = p.a || p.b; return (p.a ? A.rows.indexOf(p.a) : 1000 + B.rows.indexOf(p.b)); };
  out.sort(function (p, q) { return order(p) - order(q); });
  out.forEach(function (p) {
    var ca = p.a && p.a.ck ? p.a.cost : 0, cb = p.b && p.b.ck ? p.b.cost : 0;
    p.diff = Math.round((cb - ca) * 100) / 100;
    var why = [];
    if (!p.a) why.push('A에 없음'); else if (!p.b) why.push('B에 없음');
    else {
      if (p.a.ck !== p.b.ck) why.push('원가 체크 ' + (p.a.ck ? 'A만' : 'B만'));
      [['vendor', '업체'], ['qty', '소요량'], ['unit', '단가'], ['fx', '환율'], ['proc', '임가공'], ['ship', '배송비']].forEach(function (k) {
        var sv = function (x) { var t = str_(x); if (t === '' || isNaN(Number(t))) return t || '-'; return String(Math.round(Number(t) * 10000) / 10000); };
        if (str_(p.a[k[0]]) !== str_(p.b[k[0]]) && !(Number(p.a[k[0]]) === Number(p.b[k[0]]) && str_(p.a[k[0]]) !== '' && str_(p.b[k[0]]) !== '')) why.push(k[1] + ' ' + sv(p.a[k[0]]) + ' / ' + sv(p.b[k[0]]));
      });
      if (!why.length && Math.abs(p.a.cost - p.b.cost) > 0.5) why.push('소요원가 칸 값이 다름(손입력)');
    }
    p.why = why.join(' · ');
    if (p.a) delete p.a._m;
  });
  return { a: { code: A.code, name: A.name, round: A.round, sum: A.sum }, b: { code: B.code, name: B.name, round: B.round, sum: B.sum }, rows: out };
}

/**
 * 품목명 맞추기(2026-10-17): 품목명의 기준은 품목 DB(_실행판_품목). BOM 줄의 품목명이 그 코드의 품목 DB 이름과 다르면 품목 DB 이름으로 바꾼다.
 * onlyCodes({코드:1}) 를 주면 그 코드만(품목 정보에서 이름을 고친 때). 다른 게 없으면 잠금 없이 끝난다. 바꾼 줄 수를 돌려준다.
 */
function bomNameSync_(onlyCodes, force) {
  // 같은 자재코드 = 같은 자재 — 품목명 · 업체명 · 사양 · 공용 표시는 그 코드를 쓰는 모든 BOM 줄이 같아야 한다.
  //  · 품목명: 품목 DB 이름으로 맞춘다(기준은 품목 DB 하나).
  //  · 업체명 · 사양: 품목 DB 칸이 비었으면 BOM(지금 쓰는 줄 · 가장 늦은 초도)에서 채우고, BOM 빈 칸은 품목 DB 값으로 채운다.
  //    값이 서로 다르면 함부로 덮지 않는다 — force[코드](정정 · 품목 DB 에서 직접 고친 코드)일 때만 품목 DB 값으로 덮는다.
  //  · 공용: 두 품목코드 이상이 같이 쓰거나, 그 코드 줄 하나라도 '공용'이면 모든 줄 '공용'(끄기는 apiBomCommonSet 이 모든 줄을 같이 끈다).
  var only = onlyCodes || null, frc = force ? (force === true ? (only || {}) : force) : {};
  var cmOff = bomCmOff_();                  // 사람이 공용을 끈 코드는 다시 켜지 않는다
  var sh = bomSheet_(), B = bomCols_(sh);
  var F = [{ k: 'vendor', col: B.vendor }, { k: 'spec', col: B.spec }].filter(function (f) { return f.col >= 0; });
  var plan = function () {
    var db = {};
    readItems_().forEach(function (it) { db[it.code] = it; });
    var lr = sh.getLastRow(); if (lr < 3) return { cells: [], dbFill: [] };
    var n = lr - 2, allV = sh.getRange(3, 1, n, B.lc).getValues();          // 한 번에 읽고 칸만 나눈다(예전: 칸마다 따로 8번 읽기)
    var col = function (c) { return c >= 0 ? allV.map(function (r) { return [r[c]]; }) : null; };
    var cs = col(B.code), ns = col(B.name), ps = col(B.product), st = col(B.start), en = col(B.end), cm = col(B.common);
    var tp = col(B.type), sr = col(B.search);
    var byP = {}; if (sr) for (var ip = 0; ip < n; ip++) { var pk = itemCodeKey_(ps[ip][0]); if (pk) (byP[pk] = byP[pk] || []).push(ip); }
    var fv = {}; F.forEach(function (f) { fv[f.k] = col(f.col); });
    var by = {};
    for (var i = 0; i < n; i++) {
      var c = itemCodeKey_(cs[i][0]);
      if (!c || (only && !only[c])) continue;
      (by[c] = by[c] || []).push(i);
    }
    var cells = [], dbFill = [];
    Object.keys(by).forEach(function (c) {
      var at = by[c], it = db[c];
      var prodOf = function (i) { return itemCodeKey_(ps[i][0]); };
      var mine = at.filter(function (i) { return prodOf(i) !== c; });          // 제품 자기 줄(제품코드 = 자재코드)은 공용 · 업체 맞추기에서 뺀다
      if (it && it.name) at.forEach(function (i) { if (str_(ns[i][0]) !== it.name) cells.push({ f: 'name', col: B.name, row: i + 3, value: asText_(it.name), was: str_(ns[i][0]), code: c, product: prodOf(i) }); });
      if (it && it.name && sr && byP[c]) byP[c].forEach(function (i) { if (str_(sr[i][0]) !== it.name) cells.push({ f: 'search', col: B.search, row: i + 3, value: asText_(it.name), was: str_(sr[i][0]), code: c, product: c }); });   // 제품명 칸 = 품목 DB 제품 이름
      if (it) F.forEach(function (f) {
        var vals = fv[f.k], want = str_(it[f.k]);
        if (!want) {                                                            // 품목 DB 가 비었으면 BOM 에서(지금 쓰는 줄 · 가장 늦은 초도 먼저)
          var best = null;
          mine.forEach(function (i) {
            var v = str_(vals[i][0]); if (!v) return;
            var live = str_(en[i][0]) === '' ? 1 : 0, s0 = bomRnum_(st[i][0]) || 0;
            if (!best || live > best.live || (live === best.live && s0 >= best.s)) best = { v: v, live: live, s: s0 };
          });
          if (best) { want = best.v; dbFill.push({ code: c, k: f.k, value: want }); }
        }
        if (!want) return;
        mine.forEach(function (i) {
          var v = str_(vals[i][0]);
          if (v === want || (v && (!frc[c] || str_(en[i][0]) !== ''))) return;     // 덮어쓰기(정정 · 품목 DB 직접 수정)는 지금 쓰는 줄만 — 끝난 차수 줄은 그때 기록 그대로
          cells.push({ f: f.k, col: f.col, row: i + 3, value: asText_(want), was: v, code: c, product: prodOf(i) });
        });
      });
      // 공용(담당자 기준 10/19): 두 품목코드 이상이 같이 쓰면 공용 · 하나라도 '공용'이면 전부 공용. 한 품목만 쓰는데 손으로 단 공용은 그대로 둔다
      var matI = mine.filter(function (i) { return !tp || !/^(제품|세트|반제품|구성제품)$/.test(str_(tp[i][0])); });
      var prods = {}; matI.forEach(function (i) { prods[prodOf(i)] = 1; });
      if (cm && B.common >= 0 && /^[A-Z]{1,2}\d{4}/.test(c) && !cmOff[c] && (Object.keys(prods).length > 1 || matI.some(function (i) { return /공용/.test(str_(cm[i][0])); })))
        matI.forEach(function (i) { if (!/공용/.test(str_(cm[i][0]))) cells.push({ f: 'common', col: B.common, row: i + 3, value: '공용', was: str_(cm[i][0]), code: c, product: prodOf(i) }); });
    });
    return { cells: cells, dbFill: dbFill };
  };
  var P = plan();
  if (!P.cells.length && !P.dbFill.length) return 0;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return 0;
  try {
    P = plan();                                           // 잠금 안에서 다시(그사이 BOM 저장이 줄을 옮겼을 수 있다)
    if (P.dbFill.length) {                                // 품목 DB 빈 업체 · 사양 칸 채우기
      var ish = sheet_(RB_ITEM.TAB);
      if (ish && ish.getLastRow() >= 2) {
        var rowOf = {};
        ish.getRange(2, 1, ish.getLastRow() - 1, 1).getValues().forEach(function (r, i) { var c = itemCodeKey_(r[0]); if (c && !rowOf[c]) rowOf[c] = i + 2; });
        ['vendor', 'spec'].forEach(function (k) {
          var put = P.dbFill.filter(function (d) { return d.k === k && rowOf[d.code]; }).map(function (d) { return { row: rowOf[d.code], value: asText_(d.value) }; });
          if (put.length) setCellsGrouped_(ish, put, RB_ITEM_EDIT[k]);
        });
        cacheDrop_(RB_ITEM.CACHE); cacheDrop_(RB_II_CACHE);
      }
    }
    var cols = {}; P.cells.forEach(function (x) { (cols[x.col] = cols[x.col] || []).push(x); });
    Object.keys(cols).forEach(function (k) { setCellsGrouped_(sh, cols[k], Number(k)); });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  var fix = P.cells;
  if (fix.length) {
    var ps2 = {}; fix.forEach(function (f) { if (f.product) ps2[f.product] = 1; });
    bomDropCache_(Object.keys(ps2));
    var lab = { name: '품목명', vendor: '업체명', spec: '사양', common: '공용', search: '제품명' };
    try {
      appendHist_(fix.slice(0, 200).map(function (f) { return { kind: 'BOM', code: f.code, item: lab[f.f] + '(같은 자재코드끼리 맞춤)', before: f.was, after: String(f.value).replace(/^'/, ''), where: RB_BOM_TAB + ' ' + f.row + '행' }; }));
    } catch (eH) { /* 넘어간다 */ }
  }
  if (P.dbFill.length) {
    try { appendHist_(P.dbFill.slice(0, 200).map(function (d) { return { kind: '품목 DB', code: d.code, item: (d.k === 'vendor' ? '업체' : '사양') + '(BOM 에서 채움)', before: '', after: d.value }; })); } catch (eH2) { /* 넘어간다 */ }
  }
  return fix.length + P.dbFill.length;
}
