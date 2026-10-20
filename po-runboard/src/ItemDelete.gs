/**
 * ============================================================
 * 품목 삭제 (품목 정보 창 [삭제]) — 2026-10-15
 * ------------------------------------------------------------
 *  · 발주 · 입고 이력이 있는 품목(발주 DB 에 그 코드 줄이 있음)은 지우지 않는다.
 *  · 다른 제품 BOM 에 들어간 자재(공용)를 직접 지우려 하면 막는다(그 BOM 이 깨진다).
 *  · 제품(BOM 이 있는 코드)을 지우면 그 제품 BOM 줄 전부를 지우고, 그 BOM 에만 쓰던 자재도 품목 DB 에서 지운다.
 *    단, 공용 자재(공용여부 표시 · 다른 제품 BOM 에도 있음) · 발주/입고 이력이 있는 자재 · 자기 BOM 이 따로 있는 반제품은 남긴다.
 *  · 지운 줄은 숨김 탭 '_실행판_삭제보관'에 원래 값 그대로 남긴다(되살릴 때 쓴다). 변경이력 · BOM변경이력에도 남긴다.
 * ============================================================
 */
var RB_DEL_TAB = '_실행판_삭제보관';
var RB_DEL_HEAD = ['일시', '삭제자', '삭제한 품목', '탭', '원래 행', '코드', '값(JSON)'];

/** 발주 DB 에 줄이 있는 코드(취소 건 포함 — 이력이 있으면 남긴다) */
function itemOrderCodes_() {
  var out = {};
  var sh = sheet_(RB.STATUS_TAB);
  var C = sh && sheetCols_(sh), S = C && statusFieldCols_(C);
  if (!S || S.code < 0 || sh.getLastRow() <= C.hr) return out;
  sh.getRange(C.hr + 1, S.code + 1, sh.getLastRow() - C.hr, 1).getValues().forEach(function (r) { var c = itemCodeKey_(r[0]); if (c) out[c] = (out[c] || 0) + 1; });
  return out;
}

/** 무엇을 지우고 무엇을 남기는지 계산(시트는 고치지 않음) */
function itemDeletePlan_(code) {
  var bs = bomSheet_(), B = bomCols_(bs), lr = bs.getLastRow();
  var bv = lr > 2 ? bs.getRange(3, 1, lr - 2, B.lc).getValues() : [];
  var ordered = itemOrderCodes_();
  var ish = sheet_(RB_ITEM.TAB);
  var iv = ish && ish.getLastRow() >= 2 ? ish.getRange(2, 1, ish.getLastRow() - 1, RB_ITEM.HEAD.length).getValues() : [];
  var nameOf = {};
  iv.forEach(function (r) { var c = itemCodeKey_(r[0]); if (c && !nameOf[c]) nameOf[c] = str_(r[1]); });
  var prods = {};                                   // BOM 이 따로 있는 코드(제품 · 세트 · 반제품)
  bv.forEach(function (r) { var p = itemCodeKey_(r[B.product]); if (p) prods[p] = 1; });

  var plan = { code: code, name: nameOf[code] || '', block: '', isProduct: !!prods[code], bomRows: [], del: [], keep: [], itemRows: [] };
  if (ordered[code]) { plan.block = '발주/입고 이력이 있는 품목입니다(발주 DB ' + ordered[code] + '줄). 지울 수 없습니다.'; return plan; }
  var inOthers = {};
  bv.forEach(function (r) {
    var p = itemCodeKey_(r[B.product]), c = itemCodeKey_(r[B.code]);
    if (c === code && p && p !== code) inOthers[p] = 1;
  });
  if (Object.keys(inOthers).length) {
    var ps = Object.keys(inOthers);
    plan.block = '다른 제품 BOM 에 들어 있는 코드입니다(' + ps.slice(0, 5).join(', ') + (ps.length > 5 ? ' 외 ' + (ps.length - 5) : '') + '). 그 BOM 에서 먼저 빼야 지울 수 있습니다.';
    return plan;
  }
  var mats = {};
  bv.forEach(function (r, i) {
    if (itemCodeKey_(r[B.product]) !== code) return;
    plan.bomRows.push(i + 3);
    var c = itemCodeKey_(r[B.code]);
    if (c === code && !plan.name) plan.name = str_(r[B.name]);
    if (c && c !== code) {
      var m = mats[c] || (mats[c] = { code: c, name: str_(r[B.name]) || nameOf[c] || '', common: false });
      if (B.common >= 0 && /공용/.test(str_(r[B.common]))) m.common = true;
    }
  });
  Object.keys(mats).forEach(function (c) {
    var m = mats[c], why = [];
    if (m.common) why.push('공용 표시');
    var others = {};
    bv.forEach(function (r) { var p = itemCodeKey_(r[B.product]); if (p !== code && itemCodeKey_(r[B.code]) === c) others[p] = 1; });
    if (Object.keys(others).length) why.push('다른 제품 BOM 에도 있음(' + Object.keys(others).slice(0, 3).join(', ') + (Object.keys(others).length > 3 ? ' 외' : '') + ')');
    if (ordered[c]) why.push('발주/입고 이력 ' + ordered[c] + '건');
    if (prods[c]) why.push('자기 BOM 이 따로 있음');
    if (why.length) plan.keep.push({ code: c, name: m.name, why: why.join(' · ') });
    else plan.del.push({ code: c, name: m.name });
  });
  var delSet = {}; delSet[code] = 1; plan.del.forEach(function (d) { delSet[d.code] = 1; });
  iv.forEach(function (r, i) { if (delSet[itemCodeKey_(r[0])]) plan.itemRows.push(i + 2); });
  plan.inDb = iv.some(function (r) { return itemCodeKey_(r[0]) === code; });
  return plan;
}

/** 시트 행들을 아래부터 이어진 묶음째 지운다 */
function deleteRowsDesc_(sh, rows) {
  var rs = rows.slice().sort(function (a, b) { return b - a; });
  var i = 0;
  while (i < rs.length) {
    var hi = rs[i], lo = hi;
    while (i + 1 < rs.length && rs[i + 1] === lo - 1) { i++; lo = rs[i]; }
    sh.deleteRows(lo, hi - lo + 1);
    i++;
  }
}

/**
 * 화면: 품목 삭제. apply 가 아니면 미리보기만(무엇을 지우고 남기는지). apply 면 지운다.
 * 반환: { code, name, block, isProduct, bomN, del:[{code,name}], keep:[{code,name,why}], done? }
 */
function apiItemDelete(code, apply, why) {
  requireEditor_();
  code = itemCodeKey_(code);
  if (!code) throw new Error('품목코드가 비었습니다.');
  var view = function (p) { return { code: p.code, name: p.name, block: p.block, isProduct: p.isProduct, bomN: p.bomRows.length, del: p.del, keep: p.keep, inDb: p.inDb }; };
  if (!apply) return view(itemDeletePlan_(code));
  if (!str_(why)) throw new Error('지우는 이유를 적어 주세요(삭제 기록에 남습니다).');
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var plan, out;
  try {
    plan = itemDeletePlan_(code);                     // 잠금 안에서 다시 계산(그사이 바뀐 것 반영)
    if (plan.block) throw new Error(plan.block);
    if (!plan.bomRows.length && !plan.itemRows.length) throw new Error(code + ' 는 품목 DB · BOM 어디에도 없습니다.');
    var ss = ss_(), now = new Date(), who = me_();
    var bk = tab_(RB_DEL_TAB, RB_DEL_HEAD), back = [];
    var bs = bomSheet_(), B = bomCols_(bs);
    if (plan.bomRows.length) {
      var lc = B.lc;
      plan.bomRows.forEach(function (r) {
        var v = bs.getRange(r, 1, 1, lc).getValues()[0];
        back.push([now, who, code, RB_BOM_TAB, r, itemCodeKey_(v[B.code]), JSON.stringify(v.map(function (x) { return x instanceof Date ? fmtDate_(x) : x; }))]);
      });
    }
    var ish = sheet_(RB_ITEM.TAB);
    if (plan.itemRows.length) {
      plan.itemRows.forEach(function (r) {
        var v = ish.getRange(r, 1, 1, RB_ITEM.HEAD.length).getValues()[0];
        back.push([now, who, code, RB_ITEM.TAB, r, itemCodeKey_(v[0]), JSON.stringify(v.map(function (x) { return x instanceof Date ? fmtDate_(x) : x; }))]);
      });
    }
    if (back.length) {
      var r0 = bk.getLastRow() + 1;
      ensureRows_(bk, r0 + back.length - 1);
      bk.getRange(r0, 1, back.length, RB_DEL_HEAD.length).setValues(back);
      try { if (!bk.isSheetHidden()) bk.hideSheet(); } catch (eH) { /* 넘어간다 */ }
    }
    if (plan.bomRows.length) deleteRowsDesc_(bs, plan.bomRows);
    if (plan.itemRows.length) deleteRowsDesc_(ish, plan.itemRows);
    var summary = (plan.bomRows.length ? 'BOM ' + plan.bomRows.length + '줄' : '') + (plan.del.length ? ' · 자재 ' + plan.del.length + '개(' + plan.del.map(function (d) { return d.code; }).join(', ').slice(0, 300) + ')' : '') +
      (plan.keep.length ? ' · 남긴 자재 ' + plan.keep.length + '개' : '');
    if (plan.bomRows.length) bomLogWrite_(ss, [[now, who, code, plan.name, '', '품목 삭제', '', code, '', 'BOM ' + plan.bomRows.length + '줄', '삭제', str_(why) || summary, '', '-', Utilities.getUuid().slice(0, 8) + '-del', '']]);
    SpreadsheetApp.flush();
    out = view(plan);
    out.done = summary.replace(/^ · /, '') || '품목 DB 1줄';
    try {
      appendHist_([{ kind: '품목 삭제', code: code, name: plan.name, item: '품목 삭제', before: plan.name, after: '삭제 — ' + out.done, reason: str_(why), where: RB_DEL_TAB + '에 원래 값 보관' }]);
    } catch (eL) { /* 이력은 넘어간다 */ }
  } finally {
    lock.releaseLock();
  }
  cacheDrop_(RB_ITEM.CACHE); cacheDrop_(RB_II_CACHE); cacheDrop_(RB_II_REF);
  bomDropCache_([code]);
  try { bomBuildCache_(); } catch (eC) { /* 다음에 다시 읽는다 */ }
  return out;
}
