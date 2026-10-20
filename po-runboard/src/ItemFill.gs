/**
 * ?diag=itemspec — 품목 DB 에 이미 있는 코드의 사양(M열)이 비어 있으면 실행판 BOM 탭의 그 자재 사양으로 채운다.
 *  같은 코드 줄이 여러 개면 지금 쓰는 줄(단종 · 종료 아닌 줄) 중 초도 차수가 가장 늦은 줄의 사양. 쓰는 줄끼리 사양이 다르면 미리보기에 따로 보여 준다.
 *  이미 사양이 있는 칸은 건드리지 않는다. 기본 미리보기, &apply=1 이면 쓴다.
 */
function itemSpecFill_(apply) {
  requireAdmin_();
  // 쓸 때는 읽기부터 잠금 안에서(잠금 밖에서 읽은 사양 칸을 통째로 덮으면 그사이 고친 사양이 사라진다)
  var lock = null;
  if (apply) { lock = LockService.getScriptLock(); waitLock_(lock); }
  try {
    var plan = itemSpecFillIn_(apply);
  } finally { if (lock) lock.releaseLock(); }
  if (plan.결과) { cacheDrop_(RB_ITEM.CACHE); cacheDrop_(RB_II_CACHE); }
  return plan;
}
function itemSpecFillIn_(apply) {
  var sh = sheet_(RB_ITEM.TAB);
  if (!sh) throw new Error('품목 DB 탭이 없습니다.');
  itemDbHead_(sh);
  var n = Math.max(0, sh.getLastRow() - 1), SC = RB_ITEM.HEAD.indexOf('사양');
  var v = n ? sh.getRange(2, 1, n, RB_ITEM.HEAD.length).getValues() : [];
  // BOM: 코드 → 사양 후보
  var bs = bomSheet_(), C = bomCols_(bs), lr = bs.getLastRow();
  var bv = lr > 2 ? bs.getRange(3, 1, lr - 2, C.lc).getValues() : [];
  var best = {}, diff = {};
  bv.forEach(function (r) {
    var o = bomRowObj_(r, C, 0), c = itemCodeKey_(o.code), sp = str_(o.spec);
    if (!c || !sp) return;
    var live = str_(o.end) === '' ? 1 : 0, st = bomRnum_(o.start) || 0;
    var b = best[c];
    if (!b || live > b.live || (live === b.live && st >= b.st)) best[c] = { sp: sp, live: live, st: st };
    if (live) { (diff[c] = diff[c] || {})[sp] = 1; }
  });
  var put = [], conflict = [];
  v.forEach(function (r, i) {
    var c = itemCodeKey_(r[0]);
    if (!c || str_(r[SC]) || !best[c]) return;
    put.push({ row: i + 2, code: c, spec: best[c].sp });
    if (diff[c] && Object.keys(diff[c]).length > 1) conflict.push(c + ' → ' + Object.keys(diff[c]).join(' / '));
  });
  var plan = { 채울줄: put.length, 사양이여럿인코드: conflict.length, 안내: apply ? '' : '미리보기입니다(시트는 그대로). 맞으면 아래 [적용주소] 를 5분 안에 여세요',
    채울목록: put.slice(0, 300).map(function (x) { return x.code + ' · ' + x.spec; }), 사양이여럿: conflict.slice(0, 100) };
  if (!apply) return plan;
  // 줄마다 따로 쓰지 않고 사양 칸 한 번에(이미 있는 값은 그대로)
  var colV = v.map(function (r) { return [r[SC]]; });
  put.forEach(function (x) { colV[x.row - 2] = [x.spec]; });
  if (colV.length) { var rg = sh.getRange(2, SC + 1, colV.length, 1); imRelaxRange_(rg); rg.setValues(colV); }
  SpreadsheetApp.flush();
  plan.결과 = '품목 DB 사양 ' + put.length + '줄을 BOM 사양으로 채웠습니다.';
  return plan;
}
