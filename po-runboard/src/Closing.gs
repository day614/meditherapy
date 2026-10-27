/**
 * ============================================================
 * 마감(2026-10-16) — 국내(ODM · GWP · 부자재 · 임가공 · 비용) · 수입(중국) 월 마감 내역
 * ------------------------------------------------------------
 *  · 실행판 [마감] 탭에서 표로 입력 · 고침 → 숨김 탭 _실행판_마감 한 곳에 한 줄씩(국내 · 수입 함께, '양식' 칸으로 나눔).
 *  · 국내: 부가세 = 공급가액 10%(고칠 수 있음), 합계 = 공급가액 + 부가세, 실지급액 = 합계 − 선금.
 *  · 수입: 제품금액 = 선금 + 잔금, 합계(총액, 부가세 포함) = ①제품 ②해운 ③관세 ④부가가치세 ⑤통관(포함) ⑦내륙(포함),
 *          정산 금액(부가세 제외) = 잔금 + 해운운임 + 관세 + 통관 등(제외) + 내륙(제외) (고칠 수 있음).
 *  · 예전 따로 쓰던 _실행판_마감국내 · _실행판_마감수입 은 처음 읽을 때 한 번 _실행판_마감 으로 옮기고 지운다.
 * ============================================================
 */
var RB_CLOSE_TAB = '_실행판_마감';
var RB_CLOSE_HEAD = ['ID', '양식', '마감월', '구분', '업체', '품목·비고', '수량', '공급가액', '부가세', '합계(국내: 공급가액+부가세 / 수입: 총액)', '선금', '선금일자',
  '잔금', '잔금일자', '실지급액', '제품금액', '해운운임', '관세', '부가가치세', '통관수수료 등(부가세 포함)', '통관수수료 등(부가세 제외)',
  '내륙운송료(부가세 포함)', '내륙운송료(부가세 제외)', '정산 금액(부가세 제외)', '지급예정일', '지급여부', '링크', '등록', '수정'];
var RB_CLOSE_KEYS = ['id', 'kind', 'month', 'cat', 'vendor', 'note', 'qty', 'supply', 'vat', 'total', 'pre', 'preAt',
  'bal', 'balAt', 'pay', 'goods', 'freight', 'duty', 'ivat', 'customsIn', 'customs',
  'inlandIn', 'inland', 'settle', 'payAt', 'paid', 'link', 'created', 'updated'];
var RB_CLOSE_KIND = { dom: '국내', imp: '수입' };
var RB_CLOSE_NUM = { qty: 1, supply: 1, vat: 1, total: 1, pre: 1, pay: 1, bal: 1, goods: 1, freight: 1, duty: 1, ivat: 1, customsIn: 1, customs: 1, inlandIn: 1, inland: 1, settle: 1 };
var RB_CLOSE_CACHE = 'close:v2';
/* 예전 양식(국내 · 수입 따로) — 옮기기에만 쓴다 */
var RB_CLOSE_OLD = {
  dom: { tab: '_실행판_마감국내', keys: ['id', 'month', 'cat', 'vendor', 'note', 'qty', 'supply', 'vat', 'total', 'pre', 'pay', 'payAt', 'paid', 'created', 'updated'] },
  imp: { tab: '_실행판_마감수입', keys: ['id', 'month', 'vendor', 'note', 'qty', 'pre', 'preAt', 'bal', 'balAt', 'goods', 'freight', 'duty', 'ivat', 'customsIn', 'customs', 'inlandIn', 'inland', 'total', 'settle', 'payAt', 'link', 'created', 'updated'] }
};

/** _실행판_마감 탭(없으면 만들고, 예전 두 탭이 있으면 그 값을 옮긴 뒤 지운다) */
function closeSheet_() {
  var ss = ss_(), sh = ss.getSheetByName(RB_CLOSE_TAB);
  if (sh && !ss.getSheetByName(RB_CLOSE_OLD.dom.tab) && !ss.getSheetByName(RB_CLOSE_OLD.imp.tab)) return sh;
  var lock = LockService.getScriptLock();
  waitLock_(lock, 40000);
  try {
    sh = ss.getSheetByName(RB_CLOSE_TAB);
    if (!sh) {
      sh = ss.insertSheet(RB_CLOSE_TAB);
      sh.getRange(1, 1, 1, RB_CLOSE_HEAD.length).setValues([RB_CLOSE_HEAD]).setFontWeight('bold').setBackground('#d9e1f2').setWrap(true);
      sh.setFrozenRows(1);
      sh.getRange('C:C').setNumberFormat('@');                     // 마감월은 글자(2026-10 이 날짜로 바뀌지 않게)
      sh.getRange('G:X').setNumberFormat('#,##0');
      sh.getRange('Y:Y').setNumberFormat('yyyy-mm-dd');
      sh.hideSheet();
    }
    ['dom', 'imp'].forEach(function (kind) {
      var o = RB_CLOSE_OLD[kind], old = ss.getSheetByName(o.tab);
      if (!old) return;
      var n = old.getLastRow() - 1, lines = [];
      if (n > 0) old.getRange(2, 1, n, o.keys.length).getValues().forEach(function (r) {
        if (!String(r[0] || '')) return;
        var m = {}; o.keys.forEach(function (k, j) { m[k] = r[j]; });
        m.kind = RB_CLOSE_KIND[kind];
        if (kind === 'imp') m.cat = '수입';
        lines.push(RB_CLOSE_KEYS.map(function (k) { return m[k] === undefined ? '' : (k === 'month' && m[k] instanceof Date ? Utilities.formatDate(m[k], Session.getScriptTimeZone(), 'yyyy-MM') : m[k]); }));
      });
      if (lines.length) {
        closeHeadCheck_(sh);
        var r0 = sh.getLastRow() + 1;
        ensureRows_(sh, r0 + lines.length - 1);
        sh.getRange(r0, 3, lines.length, 1).setNumberFormat('@');
        sh.getRange(r0, 1, lines.length, RB_CLOSE_HEAD.length).setValues(lines);
        SpreadsheetApp.flush();
      }
      ss.deleteSheet(old);                                           // 옮겼으면 예전 탭은 지운다
      try { appendHist_([{ kind: '마감', item: o.tab + ' → ' + RB_CLOSE_TAB, after: lines.length + '줄 옮김 · 예전 탭 지움' }]); } catch (e) { /* 넘어간다 */ }
    });
  } finally {
    lock.releaseLock();
  }
  cacheDrop_(RB_CLOSE_CACHE);
  return sh;
}

/** 쓰기 전에 머리글(1행)이 RB_CLOSE_HEAD 와 같은지 본다 — 열이 바뀐 탭에 엉뚱한 칸으로 쓰지 않게 */
function closeHeadCheck_(sh) {
  var h = sh.getRange(1, 1, 1, RB_CLOSE_HEAD.length).getValues()[0].map(function (x) { return String(x == null ? '' : x).trim(); });
  if (h.join('|') !== RB_CLOSE_HEAD.join('|')) {
    throw new Error(RB_CLOSE_TAB + ' 탭의 머리글(1행)이 예상과 달라 저장하지 않았습니다. 관리자에게 알려 주세요.' +
      ' (예상: ' + RB_CLOSE_HEAD.join(', ') + ' / 지금: ' + h.join(', ') + ')');
  }
}

function closeReadAll_() {
  var sh = closeSheet_(), n = sh.getLastRow() - 1;
  if (n < 1) return [];
  var tz = Session.getScriptTimeZone();
  return sh.getRange(2, 1, n, RB_CLOSE_HEAD.length).getValues().map(function (r, i) {
    var o = { row: i + 2 };
    RB_CLOSE_KEYS.forEach(function (k, j) {
      var v = r[j];
      if (v instanceof Date) v = Utilities.formatDate(v, tz, k === 'month' ? 'yyyy-MM' : (k === 'created' || k === 'updated' ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd'));
      o[k] = v === '' || v == null ? '' : (RB_CLOSE_NUM[k] ? num_(v) : String(v));
    });
    o.paid = /^(true|o|ㅇ|y|완료|지급완료)$/i.test(String(o.paid || '').trim()) ? 1 : 0;
    return o;
  }).filter(function (o) { return o.id; });
}

/** 화면: 마감 내역 전부 { dom: [...], imp: [...] } */
function apiCloseList() {
  var hit = cacheGet_(RB_CLOSE_CACHE);
  if (hit) return hit;
  var all = closeReadAll_(), out = { dom: [], imp: [] };
  all.forEach(function (o) { (o.kind === '수입' ? out.imp : out.dom).push(o); });
  cachePut_(RB_CLOSE_CACHE, out, 3600);      // 저장 · 지우기 때 버린다 — 1시간(열 때마다 시트를 읽어 느렸다)
  return out;
}

function closeMonthOk_(m) { return /^\d{4}-\d{2}$/.test(String(m || '')); }

/** 수입 총액(①~⑤+⑦) · 정산 금액(잔금 + ② + ③ + ⑥ + ⑧) 식 */
function closeImpTotal_(o) { var n = function (k) { return num_(o[k]) || 0; }; return n('pre') + n('bal') + n('freight') + n('duty') + n('ivat') + n('customsIn') + n('inlandIn'); }
function closeImpSettle_(o) { var n = function (k) { return num_(o[k]) || 0; }; return n('bal') + n('freight') + n('duty') + n('customs') + n('inland'); }

/**
 * 계산 칸을 서버에서 다시 맞춘다(화면이 보낸 합계는 믿지 않는다 — 그사이 다른 사람이 고친 칸이 빠진 옛 값일 수 있다).
 * 수입 총액 · 정산 금액은 손으로 고친 값(화면 표시 o.man.total · o.man.settle)만 그대로 둔다.
 * 표시가 없으면(예전 화면) 시트 값이 식과 달랐고(손으로 고친 값) 이번에 그 식의 칸을 안 고쳤을 때만 그대로 둔다.
 * prev = 고치기 전 시트 줄(새 줄이면 null), sent = 화면이 보낸 칸.
 */
function closeCalc_(kind, o, prev, sent) {
  var n = function (k) { return num_(o[k]) || 0; };
  if (kind === 'dom') {
    if (o.vat === '' || o.vat == null) o.vat = Math.round(n('supply') * 0.1);
    o.total = n('supply') + n('vat');
    o.pay = o.total - n('pre');
  } else {
    o.goods = n('pre') + n('bal');
    if ((o.customs === '' || o.customs == null) && n('customsIn')) o.customs = Math.round(n('customsIn') / 1.1);
    if ((o.inland === '' || o.inland == null) && n('inlandIn')) o.inland = Math.round(n('inlandIn') / 1.1);
    var man = (o.man && typeof o.man === 'object') ? o.man : null;
    var touched = function (ks) { return !!sent && ks.some(function (k) { return sent[k] !== undefined; }); };
    var wasMan = function (k, f) { return !!prev && prev[k] !== '' && prev[k] != null && Math.round(num_(prev[k])) !== Math.round(f(prev)); };
    var any = ['pre', 'bal', 'freight', 'duty', 'ivat', 'customsIn', 'inlandIn'].some(function (k) { return o[k] !== '' && o[k] != null; });
    var keepT = man ? !!man.total : wasMan('total', closeImpTotal_) && !touched(['pre', 'bal', 'freight', 'duty', 'ivat', 'customsIn', 'inlandIn']);
    var keepS = man ? !!man.settle : wasMan('settle', closeImpSettle_) && !touched(['bal', 'freight', 'duty', 'customs', 'inland', 'customsIn', 'inlandIn', 'settle']);
    if (!keepT || o.total === '' || o.total == null) o.total = any ? closeImpTotal_(o) : '';
    if (!keepS || o.settle === '' || o.settle == null) o.settle = any ? closeImpSettle_(o) : '';
  }
  return o;
}

/**
 * 화면: 마감 줄 저장. kind = 'dom' | 'imp', rows: [{ id?(있으면 고침), month, … }]. 업체가 빈 줄은 건너뜀.
 * 돌려줌: 저장 뒤 전체 목록(apiCloseList 와 같은 모양)
 */
function apiCloseSave(kind, rows) {
  requireEditor_();
  if (!RB_CLOSE_KIND[kind]) throw new Error('알 수 없는 양식입니다.');
  var sh = closeSheet_();
  var lock = LockService.getScriptLock();
  waitLock_(lock, 40000);
  var hist = [];
  try {
    closeHeadCheck_(sh);
    var n = sh.getLastRow() - 1;
    var ids = n > 0 ? sh.getRange(2, 1, n, 1).getValues().map(function (r) { return String(r[0]); }) : [];
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') + ' ' + me_().split('@')[0];
    var adds = [];
    // 먼저 전부 검사 — 중간 줄이 틀려 앞 줄만 써지는 일이 없게
    (rows || []).forEach(function (o) {
      if (!o || !String(o.vendor || '').trim()) return;
      if (!closeMonthOk_(o.month)) throw new Error('마감월이 비었거나 형식이 틀립니다(예: 2026-10): ' + o.vendor);
      if (kind === 'dom' && ['ODM', 'GWP', '부자재', '임가공', '비용'].indexOf(String(o.cat || '')) < 0) throw new Error('구분을 골라 주세요(ODM · GWP · 부자재 · 임가공 · 비용): ' + o.vendor);
    });
    (rows || []).forEach(function (o) {
      if (!o || !String(o.vendor || '').trim()) return;
      var at = o.id ? ids.indexOf(String(o.id)) : -1, prev = null, sent = o;
      if (at > -1) {
        // 있는 줄: 화면은 바뀐 칸만 보낸다 — 지금 시트 값 위에 얹어 계산한다(다른 사람이 그사이 고친 칸을 되돌리지 않게)
        var cur0 = sh.getRange(at + 2, 1, 1, RB_CLOSE_HEAD.length).getValues()[0], m = {};
        RB_CLOSE_KEYS.forEach(function (k, j) { m[k] = cur0[j]; });
        m.paid = /^(true|o|ㅇ|y|완료|지급완료)$/i.test(String(m.paid || '').trim()) ? 1 : 0;
        prev = {}; Object.keys(m).forEach(function (k) { prev[k] = m[k]; });
        Object.keys(o).forEach(function (k) { if (o[k] !== undefined) m[k] = o[k]; });
        o = m;
      }
      if (kind === 'imp') o.cat = '수입';
      o.kind = RB_CLOSE_KIND[kind];
      closeCalc_(kind, o, prev, sent);
      var line = RB_CLOSE_KEYS.map(function (k) {
        if (k === 'id') return o.id || ('C' + Utilities.getUuid().slice(0, 8));
        if (k === 'created') return at > -1 ? undefined : stamp;
        if (k === 'updated') return at > -1 ? stamp : '';
        if (k === 'paid') return o.paid === undefined ? (at > -1 ? undefined : '') : (o.paid ? 'ㅇ' : '');
        var v = o[k];
        if (v === undefined) return at > -1 ? undefined : '';          // 화면에 없는 칸(예: 국내의 링크)은 그대로 둔다
        if (v === '' || v == null) return '';
        if (v instanceof Date) return v;
        if (RB_CLOSE_NUM[k]) return Number(String(v).replace(/,/g, '')) || 0;
        if (k === 'payAt' && /^\d{4}-\d{2}-\d{2}$/.test(String(v))) { var p = String(v).split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
        return asText_(String(v).slice(0, 500));
      });
      var label = o.kind + ' ' + o.month + ' ' + o.vendor;
      if (at > -1) {
        var r = at + 2, cur = sh.getRange(r, 1, 1, RB_CLOSE_HEAD.length).getValues()[0];
        line = line.map(function (v, j) { return v === undefined ? cur[j] : v; });
        sh.getRange(r, 1, 1, RB_CLOSE_HEAD.length).setValues([line]);
        hist.push({ kind: '마감', item: label, after: '고침', where: RB_CLOSE_TAB + ' ' + r + '행' });
      } else {
        adds.push(line.map(function (v) { return v === undefined ? '' : v; }));
        hist.push({ kind: '마감', item: label, after: '추가', where: RB_CLOSE_TAB });
      }
    });
    if (adds.length) {
      var r0 = sh.getLastRow() + 1;
      ensureRows_(sh, r0 + adds.length - 1);
      sh.getRange(r0, 3, adds.length, 1).setNumberFormat('@');
      sh.getRange(r0, 1, adds.length, RB_CLOSE_HEAD.length).setValues(adds);
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
    cacheDrop_(RB_CLOSE_CACHE);
  }
  if (hist.length) { try { appendHist_(hist.slice(0, 50)); } catch (e) { /* 넘어간다 */ } }
  return apiCloseList();
}

/** 화면: 마감 줄 지우기(ID 로) */
function apiCloseDelete(kind, id) {
  requireEditor_();
  var sh = closeSheet_();
  var lock = LockService.getScriptLock();
  waitLock_(lock, 40000);
  try {
    closeHeadCheck_(sh);
    var n = sh.getLastRow() - 1;
    var ids = n > 0 ? sh.getRange(2, 1, n, 1).getValues().map(function (r) { return String(r[0]); }) : [];
    var at = ids.indexOf(String(id));
    if (at < 0) throw new Error('지울 줄을 찾지 못했습니다. 새로 불러온 뒤 다시 해 주세요.');
    var v = sh.getRange(at + 2, 1, 1, RB_CLOSE_HEAD.length).getValues()[0];
    sh.deleteRow(at + 2);
    try { appendHist_([{ kind: '마감', item: v[1] + ' ' + v[2] + ' ' + v[4], before: JSON.stringify(v).slice(0, 400), after: '삭제', where: RB_CLOSE_TAB }]); } catch (e) { /* 넘어간다 */ }
  } finally {
    lock.releaseLock();
  }
  cacheDrop_(RB_CLOSE_CACHE);
  return apiCloseList();
}
