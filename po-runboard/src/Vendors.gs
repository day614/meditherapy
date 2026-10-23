/**
 * ============================================================
 * 업체 목록(2026-10-20) — 업체명을 손으로 아무렇게나 쓰지 않게 '찾아서 고르기'로.
 * ------------------------------------------------------------
 *  · 목록 = BOM 업체명 + 발주 DB 업체명 + 품목 DB 업체 + 설정 list.vendor(화면에서 새로 추가한 업체). 많이 쓴 순.
 *  · 화면: 업체 칸에 적으면 목록에서 찾아 고르고, 목록에 없는 이름이면 '새 업체로 추가할까요?' — 추가하면 list.vendor 에 들어간다.
 *  · 표기만 다른 업체(공백 · (주) · 앤/엔 · 스/쓰 · 내/네)는 apiVendors().similar 로 알려 준다(합치기는 사람이 확인).
 * ============================================================
 */
var RB_VENDOR_KEY = 'list.vendor', RB_VENDOR_CACHE = 'vendors:v1';

function vendorNorm_(s) { return str_(s).replace(/\(주\)|㈜|주식회사|\s/g, '').toUpperCase(); }
/** 비슷한 표기 판단용(앤↔엔 · 스↔쓰 · 내↔네 · 코리아 꼬리) */
function vendorLoose_(s) { return vendorNorm_(s).replace(/앤/g, '엔').replace(/쓰/g, '스').replace(/네/g, '내').replace(/[.,·\-]/g, '').replace(/코리아$/, ''); }

function vendorList_() {
  var hit = cacheGet_(RB_VENDOR_CACHE);
  if (hit) return hit;
  var cnt = {}, add = function (v, n) { v = str_(v); if (!v || v === '-' || v.length > 80) return; cnt[v] = (cnt[v] || 0) + (n || 1); };
  try { var bs = bomSheet_(), B = bomCols_(bs), lr = bs.getLastRow(); if (lr > 2 && B.vendor >= 0) bs.getRange(3, B.vendor + 1, lr - 2, 1).getValues().forEach(function (r) { add(r[0]); }); } catch (e) { /* 넘어간다 */ }
  try { var sh = statusSheet_(), C = sheetCols_(sh), S = statusFieldCols_(C); if (S && S.vendor >= 0 && sh.getLastRow() > C.hr) sh.getRange(C.hr + 1, S.vendor + 1, sh.getLastRow() - C.hr, 1).getValues().forEach(function (r) { add(r[0]); }); } catch (e) { /* 넘어간다 */ }
  try { readItems_().forEach(function (it) { add(it.vendor); }); } catch (e) { /* 넘어간다 */ }
  try { splitList_(readConfig_()[RB_VENDOR_KEY]).forEach(function (v) { add(v, 0.5); }); } catch (e) { /* 넘어간다 */ }
  var list = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a] || (a < b ? -1 : 1); });
  cachePut_(RB_VENDOR_CACHE, list, 1800);
  return list;
}
/** 화면: 업체 목록 { list: [이름…](많이 쓴 순), similar: [[이름, 이름…]] } */
function apiVendors() {
  var list = vendorList_(), g = {};
  list.forEach(function (v) { var k = vendorLoose_(v); (g[k] = g[k] || []).push(v); });
  return { list: list, similar: Object.keys(g).filter(function (k) { return g[k].length > 1; }).map(function (k) { return g[k]; }) };
}
/** 화면: 새 업체 추가(목록에 없는 이름을 고르기로 확인했을 때) → 새 목록 */
function apiVendorAdd(name) {
  requireEditor_();
  name = str_(name).replace(/\s+/g, ' ').slice(0, 80);
  if (!name) throw new Error('업체명이 비었습니다.');
  var list = vendorList_();
  var same = list.filter(function (v) { return vendorNorm_(v) === vendorNorm_(name); })[0];
  if (same) return { list: list, name: same };                // 표기만 다른 같은 업체 — 있는 이름으로
  var lock = LockService.getScriptLock(); waitLock_(lock);
  try {
    var cur = splitList_(readConfig_()[RB_VENDOR_KEY]);
    if (cur.indexOf(name) < 0) cur.push(name);
    var patch = {}; patch[RB_VENDOR_KEY] = cur.join(', ');
    writeConfigNoLock_(patch);
  } finally { lock.releaseLock(); }
  cacheDrop_(RB_VENDOR_CACHE);
  try { appendHist_([{ kind: '설정', item: '업체 목록', before: '', after: name + ' 추가', where: '_실행판_설정 ' + RB_VENDOR_KEY }]); } catch (e) { /* 넘어간다 */ }
  return { list: vendorList_(), name: name };
}

/** 같은 업체 · 다른 표기 통일(담당자 확인 10/20 「앞에 거로」) — 왼쪽 이름 → 오른쪽 이름 */
var RB_VENDOR_UNIFY = {
  '아람피엔아이': '아람피앤아이', '에쓰씨인터네셔널': '에스씨인터내셔널', '에스씨인터네셔널': '에스씨인터내셔널', '혁진디엔피': '혁진디앤피',
  '펌텍': '펌텍코리아', '신원피앤피': '신원피엔피', '씨앤씨': '씨엔씨', '한국씨엔비': '한국씨앤비',
  '중국Guangdong OuxinmayPack Tech Co. , Ltd': '중국 Guangdong OuxinmayPack Tech Co.,Ltd',
  '중국GUANGZHOU MEIYINGLUN PACKAGING PRODUCTS CO.,LTD': '중국 GUANGZHOU MEIYINGLUN PACKAGING PRODUCTS CO.,LTD'
};
/**
 * 1회: 운영 탭(BOM · 품목 DB · 발주 DB · 샘플)의 업체 칸에서 RB_VENDOR_UNIFY 이름을 바꾼다(칸 값이 정확히 같을 때만).
 * 보관 탭(_실행판_BOM · BOM2) · 이력 · 다른 팀 탭은 그대로. 반환: '탭 n칸 …'
 */
function vendorUnify_() {
  var lock = LockService.getScriptLock(); waitLock_(lock);
  var out = [], hist = [];
  try {
    var ss = ss_();
    [[RB_BOM_TAB, ['업체명']], [RB_ITEM.TAB, ['업체']], [RB.STATUS_TAB, ['업체명', '매입처']], [RB.SAMPLE_TAB, ['업체명', '업체']]].forEach(function (t) {
      var sh = ss.getSheetByName(t[0]);
      if (!sh || sh.getLastRow() < 2) return;
      var lc = sh.getLastColumn(), hr = 0, col = -1;
      var head = sh.getRange(1, 1, Math.min(3, sh.getLastRow()), lc).getDisplayValues();
      for (var h = 0; h < head.length && col < 0; h++) for (var k = 0; k < t[1].length && col < 0; k++) { var i = head[h].map(function (x) { return str_(x); }).indexOf(t[1][k]); if (i > -1) { col = i; hr = h + 1; } }
      if (col < 0) return;
      var n = sh.getLastRow() - hr, vals = sh.getRange(hr + 1, col + 1, n, 1).getValues(), cells = {}, c = 0;
      vals.forEach(function (r, i) {
        var to = RB_VENDOR_UNIFY[str_(r[0])];
        if (!to) return;
        cells[hr + 1 + i] = to; c++;
        if (hist.length < 200) hist.push({ kind: '업체 통일', item: '업체명', before: str_(r[0]), after: to, where: t[0] + ' ' + (hr + 1 + i) + '행', reason: '같은 업체 다른 표기 통일(10/20)' });
      });
      if (c) { setColCells_(sh, col + 1, cells); out.push(t[0] + ' ' + c + '칸'); }
    });
    SpreadsheetApp.flush();
  } finally { lock.releaseLock(); }
  try { if (hist.length) appendHist_(hist); } catch (e) { /* 넘어간다 */ }
  cacheDrop_(RB_VENDOR_CACHE); cacheDrop_(RB_ITEM.CACHE); cacheDrop_(RB_II_CACHE); cacheDrop_(RB_II_REF);
  try { cacheDrop_(rowsCacheKey_('po')); cacheDrop_(rowsCacheKey_('sample')); } catch (e) { /* 넘어간다 */ }
  try { bomDropCache_([]); bomDropAllRows_(); } catch (e) { /* 넘어간다 */ }
  return out.join(' · ');
}
