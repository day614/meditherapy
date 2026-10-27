/**
 * ============================================================
 * 샘플 — 새 프로젝트 등록 · 회차 줄 고치기 · 프로젝트 담당자/브랜드 · 진행 메모를 시트 비고에도
 * ------------------------------------------------------------
 * 모두 _실행판_샘플 시트에 바로 쓰고, 바꾼 칸은 _실행판_변경이력에 남긴다.
 * 날짜 칸(요청일 · 전달예정일 · 전달일 · 견적수신일)은 날짜로 읽히면 날짜로, 아니면('확인 중' 등) 글자 그대로 넣는다.
 * ============================================================
 */

var RB_SAMPLE_F = { owner: '담당자', reqAt: '요청일', brand: '브랜드', make: '구성', spec: '사양', kind: '구분', vendor: '업체명',
  qty: '수량', planAt: '전달예정일', doneAt: '전달일', quoteAt: '견적수신일', note: '비고/피드백', status: '상태', link: '링크' };
var RB_SAMPLE_DATEF = { reqAt: 1, planAt: 1, doneAt: 1, quoteAt: 1 };

/** 화면에서 받은 값 → 시트에 넣을 값 */
function sampleCellVal_(f, v) {
  var s = str_(v);
  if (s === '') return '';
  if (RB_SAMPLE_DATEF[f] && /^[0-9]{8}$/.test(s)) s = s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6);   // 20261028 → 날짜(예전엔 글자 '20261028'로 들어갔다)
  if (RB_SAMPLE_DATEF[f]) { var d = toDate_(s); return d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()) : asText_(s.slice(0, 40)); }
  if (f === 'qty') return cellValue_(s);
  if (f === 'status') {
    if (RB_SAMPLE_STATUS.indexOf(s) < 0) throw new Error('알 수 없는 상태입니다: ' + s);
    return s;
  }
  return asText_(s.slice(0, f === 'note' ? 45000 : (f === 'link' ? 2000 : 200)));
}
/** 구성 · 사양 · 구분: 목록을 정해 두었으면 목록 값만(2026-10-15). 목록이 비어 있는 항목은 막지 않는다 */
function sampleListCheck_(p) {
  if (!p) return;
  var ch = null, bad = [];
  [['make', 'smake', '구성'], ['spec', 'sspec', '사양'], ['kind', 'skind', '구분']].forEach(function (x) {
    var v = str_(p[x[0]]);
    if (!v) return;
    ch = ch || choicesOf_();
    var L = ch[x[1]] || [];
    if (L.length && L.indexOf(v) < 0) bad.push(x[2] + ' "' + v + '"');
  });
  if (bad.length) throw new Error(bad.join(' · ') + ' 은(는) 목록에 없는 값입니다. 목록에서 골라 주세요(목록은 [목록 설정]에서 바꿉니다).');
}
function sampleShow_(v) { return v instanceof Date ? fmtDate_(v) : str_(v).replace(/^'/, ''); }

/** 화면: 새 샘플 프로젝트 — 시트 맨 아래에 첫 줄을 붙인다. p: { name(필수), code, brand, owner, reqAt, make, spec, kind, vendor, qty, planAt, note } */
function apiSampleNew(p) {
  requireEditor_();
  p = p || {};
  if (!str_(p.name)) throw new Error('품목명(프로젝트명)을 넣어 주세요.');
  if (!str_(p.planAt)) throw new Error('전달예정일을 넣어 주세요(필수).');
  sampleListCheck_(p);
  var sh = sheet_(RB.SAMPLE_TAB);
  if (!sh) throw new Error('_실행판_샘플 탭을 찾을 수 없습니다.');
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var out;
  try {
    var C = sampleCols_(sh, true), K = C.K, width = C.lc;
    Object.keys(K).forEach(function (k) { if (K[k] >= 0) width = Math.max(width, K[k] + 1); });
    var line = [];
    for (var i = 0; i < width; i++) line.push('');
    var put = function (f, v) { if (K[f] >= 0) line[K[f]] = v; };
    put('name', asText_(str_(p.name).slice(0, 200)));
    put('code', str_(p.code) ? asText_(str_(p.code).toUpperCase().slice(0, 40)) : '');
    Object.keys(RB_SAMPLE_F).forEach(function (f) { if (f !== 'status' && f !== 'link' && p[f] != null) put(f, sampleCellVal_(f, p[f])); });   // 링크는 프로젝트 링크(진행 기록)로 — 아래
    if (!str_(p.reqAt)) { var t = new Date(); put('reqAt', new Date(t.getFullYear(), t.getMonth(), t.getDate())); }
    put('status', '진행중');
    var newSid = newSampleId_();
    put('sid', newSid);
    // 프로젝트ID: 같은 품목코드/이름의 프로젝트가 이미 있으면 그 ID(그 프로젝트에 업체 추가), 없으면 새로
    var oldK = sampleKey_(str_(p.code), str_(p.name)), pid = '', joined = false;
    if (K.pid >= 0 && sh.getLastRow() > C.hr) {
      var w0 = Math.max(K.name, K.code, K.pid) + 1, vv = sh.getRange(C.hr + 1, 1, sh.getLastRow() - C.hr, w0).getValues();
      for (var vi = 0; vi < vv.length && !pid; vi++) {
        if (str_(vv[vi][K.name]) && str_(vv[vi][K.pid]) && sampleKey_(K.code >= 0 ? str_(vv[vi][K.code]) : '', str_(vv[vi][K.name])) === oldK) pid = str_(vv[vi][K.pid]);
      }
    }
    joined = !!pid;
    if (K.pid >= 0 && !pid) pid = newSampleProjId_();
    put('pid', pid ? asText_(pid) : '');
    var newRow = sh.getLastRow() + 1;
    ensureRows_(sh, newRow);                          // 시트 줄이 꽉 찼으면 늘린다
    sh.getRange(newRow, 1, 1, width).setValues([line]);
    writeAudit_(RB.SAMPLE_TAB, newRow, 1, '샘플 프로젝트 등록', '', str_(p.name) + ' / ' + str_(p.vendor));
    var key = pid || oldK;
    newRow -= sampleCompact_(sh, C, newRow);         // 중간에 비어 있는 줄(내용만 지운 줄)은 없애 위로 붙인다
    out = { ok: true, row: newRow, projKey: key, id: 'p:' + key };
  } finally {
    lock.releaseLock();
  }
  // 완료 · 드롭한 프로젝트와 같은 이름으로 새 샘플을 넣으면 그 프로젝트를 다시 연다(예전엔 완료 프로젝트에 붙어 진행 중 목록에서 사라졌다)
  if (joined) {
    try {
      editProgress_(out.id, { id: out.id, name: str_(p.name), brand: str_(p.brand), code: str_(p.code), owner: str_(p.owner) }, 'sample', function (st) {
        st.checks = st.checks || {};
        if (st.checks._done) { out.reopened = str_(st.checks._drop ? '드롭' : '완료'); delete st.checks._done; delete st.checks._drop; }
      });
    } catch (eR) { /* 넘어간다 */ }
  }
  dropSampleCache_();
  // 등록 창의 링크 = 프로젝트 링크(업체 줄 링크 칸이 아니라 프로젝트 진행 기록에 — 업체 카드에 섞여 보이지 않게)
  if (str_(p.link)) {
    var L0 = sampleLinksClean_(p.link);
    try { sampleProjLinksSave_(out.id, { id: out.id, name: str_(p.name), brand: str_(p.brand), code: str_(p.code), owner: str_(p.owner) }, L0, true); }
    catch (eL) {
      // 잠금 밖이라 그사이 줄이 밀렸을 수 있다 — 잠금 안에서 샘플ID 로 그 줄을 다시 찾아 쓴다(못 찾으면 쓰지 않는다)
      try {
        var lockL = LockService.getScriptLock();
        waitLock_(lockL);
        try {
          var C2 = sampleCols_(sh, false);
          if (C2.K.link >= 0) { var rL = checkSampleRow_(sh, C2.K, out.row, out.projKey, { sid: newSid }); sh.getRange(rL, C2.K.link + 1).setValue(sampleCellVal_('link', p.link)); }
        } finally { lockL.releaseLock(); }
      } catch (eL2) { /* 넘어간다 */ }
    }
  }
  return out;
}

/** 링크 글 · 목록 → 주소 목록(http 로 시작하는 것만 · 겹침 없이 · 20개까지) */
function sampleLinksClean_(a) {
  var out = [];
  (Array.isArray(a) ? a : str_(a).split(/[\s,]+/)).forEach(function (u) { u = str_(u); if (/^https?:\/\//i.test(u) && out.indexOf(u) < 0) out.push(u.slice(0, 500)); });
  return out.slice(0, 20);
}
/** 프로젝트 링크(진행 기록 notes.plinks) 저장. add = 있던 것에 덧붙이기 */
function sampleProjLinksSave_(id, meta, list, add) {
  return editProgress_(id, meta || { id: id }, 'sample', function (st) {
    st.notes = st.notes || {};
    var cur = [];
    if (add) { try { cur = JSON.parse(st.notes.plinks || '[]'); } catch (e) { cur = []; } }
    list.forEach(function (u) { if (cur.indexOf(u) < 0) cur.push(u); });
    st.notes.plinks = JSON.stringify(cur);
  });
}

/**
 * 화면: 샘플 프로젝트 수정(발주 수정처럼 한 창) — f: { name, code, brand, links: [주소…] } 중 바뀐 것만.
 * 프로젝트명 · 품목코드 · 브랜드는 그 프로젝트 모든 업체 줄에, 링크는 프로젝트 링크로.
 */
function apiSampleProjEdit(projKey, meta, f) {
  requireEditor_();
  f = f || {};
  var out = { projKey: str_(projKey), id: 'p:' + str_(projKey), n: 0 };
  // 이름 바꾸기(프로젝트 열쇠가 바뀔 수 있음)는 맨 끝에 — 앞에서 바꾼 뒤 브랜드 · 링크 저장이 실패하면 화면이 옛 열쇠로 되돌아가 새 열쇠와 어긋났다
  var pf = {};
  ['brand', 'code'].forEach(function (k) { if (f[k] != null) pf[k] = f[k]; });
  if (Object.keys(pf).length) out.n += apiSampleProject(out.projKey, pf).n || 0;
  if (f.links != null) {
    out.links = sampleLinksClean_(f.links);
    var m = meta || {}; m.id = out.id;
    sampleProjLinksSave_(out.id, m, out.links, false);
    out.n += 1;
  }
  if (f.name != null && str_(f.name)) {
    var r = apiSampleRename(out.projKey, f.name);
    out.n += r.n || 0;
    if (r.projKey) { out.projKey = r.projKey; out.id = r.id; }
  }
  return out;
}

/**
 * 화면: 회차 줄 하나 고치기. fields: RB_SAMPLE_F 의 열쇠 중 바꿀 것만.
 * 업체명을 바꿔 옛 업체 줄이 이 프로젝트에 하나도 안 남으면, 그 업체 카드 진행 메모도 새 이름으로 옮긴다.
 */
function apiSampleEditRow(sheetRow, projKey, fields, meta, exp) {
  requireEditor_();
  var row = Number(sheetRow) || 0;
  if (row < 2) throw new Error('시트 행을 찾을 수 없습니다.');
  fields = fields || {};
  if (fields.planAt != null && !str_(fields.planAt)) throw new Error('전달예정일은 비울 수 없습니다(필수).');
  sampleListCheck_(fields);
  var sh = sheet_(RB.SAMPLE_TAB);
  if (!sh) throw new Error('_실행판_샘플 탭을 찾을 수 없습니다.');
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var audits = [], oldVendor = '', newVendor = '', vendorGone = false;
  try {
    var C = sampleCols_(sh, true), K = C.K;
    row = checkSampleRow_(sh, K, row, projKey, exp);
    var width = C.lc;
    Object.keys(K).forEach(function (k) { if (K[k] >= 0) width = Math.max(width, K[k] + 1); });
    var cur = sh.getRange(row, 1, 1, width).getValues()[0];
    // [업체 추가]가 '업체 미정' 줄을 채우는 경우 — 그 사이 업체가 들어간 줄(다른 창 · 회차 고치기)은 덮지 않는다
    if (exp && exp.blankV && K.vendor >= 0 && str_(cur[K.vendor]) && norm_(cur[K.vendor]) !== norm_('업체 미정')) {
      throw new Error('그 줄에는 이미 업체 [' + str_(cur[K.vendor]) + '] 가 들어 있습니다. 새로고침 후 [업체 추가]를 다시 해 주세요.');
    }
    // 수신일을 지우면(수신 취소) 상태도 진행중으로 — 안 그러면 기한이 끝난 것으로 남는다
    if (fields.doneAt != null && str_(fields.doneAt) === '' && fields.status == null && K.status >= 0 && str_(cur[K.status]) === '수신') fields.status = '진행중';
    // 화면이 본 값(exp.old)과 지금 시트 값이 다르면 그사이 다른 사람(진행 메모 덧붙이기 등)이 고친 것 — 덮지 않고 알린다
    // 날짜 칸은 표시 형식이 달라('26/10/28' · '2026-10-28' · 날짜 값) 날짜로 읽어 견준다. 상태는 시트가 빈칸(예전 줄)이면 넘어간다
    if (exp && exp.old) {
      var nz = function (x) { return String(x == null ? '' : x).replace(/^'/, '').replace(/\s+/g, ' ').trim(); };
      var dz = function (x) { var dd = toDate_(x instanceof Date ? x : nz(x)); return dd ? fmtDate_(dd) : nz(x); };
      var bad = Object.keys(exp.old).filter(function (f) {
        if (!RB_SAMPLE_F[f] || K[f] < 0 || fields[f] == null) return false;
        if (RB_SAMPLE_DATEF[f]) {
          // 시트 날짜 칸에 날짜가 아닌 글자('중단' 등)가 있으면 화면엔 빈칸으로 보인다 — 화면이 빈칸을 봤으면 충돌이 아니다
          var raw = cur[K[f]]; if (!(raw instanceof Date) && nz(raw) && !toDate_(nz(raw)) && !dz(exp.old[f])) return false;
          var dn = dz(raw); return dn !== dz(exp.old[f]) && dn !== dz(fields[f]);
        }
        var now = sampleShow_(cur[K[f]]), saw = exp.old[f];
        if (f === 'status' && !nz(now)) return false;
        // 업체: 시트가 빈칸(업체 미정)이면 충돌이 아니다 — [업체 추가]로 막 넣은 업체가 아직 시트에 안 써졌을 때(호출 순서가 뒤바뀜) · '업체 미정' 줄을 채울 때 잘못 막았다
        if (f === 'vendor' && (!nz(now) || nz(now) === '업체 미정' || nz(saw) === '업체 미정' && !nz(now))) return false;
        if (f === 'qty' && num_(now) === num_(saw) && (nz(now) !== '') === (nz(saw) !== '')) return false;
        return nz(now) !== nz(saw) && nz(now) !== nz(fields[f]);
      });
      if (bad.length) throw new Error('그사이 다른 사람이 ' + bad.map(function (f) { return RB_SAMPLE_F[f] + '(지금: ' + sampleShow_(cur[K[f]]).slice(-60) + ')'; }).join(' · ') + ' 을(를) 고쳤습니다. 덮어쓰지 않았습니다 — 새로고침 후 다시 고쳐 주세요.');
    }
    var wants = {};                                    // 먼저 전부 검사(틀린 칸이 있으면 아무 칸도 쓰지 않는다)
    Object.keys(fields).forEach(function (f) { if (RB_SAMPLE_F[f] && K[f] >= 0) wants[f] = sampleCellVal_(f, fields[f]); });
    Object.keys(fields).forEach(function (f) {
      if (!RB_SAMPLE_F[f] || K[f] < 0) return;
      var want = wants[f], was = cur[K[f]];
      if (sampleShow_(want) === sampleShow_(was)) return;
      sh.getRange(row, K[f] + 1).setValue(want);
      audits.push({ tab: RB.SAMPLE_TAB, row: row, col: K[f] + 1, what: '샘플 ' + RB_SAMPLE_F[f], before: sampleShow_(was), after: sampleShow_(want), item: str_(cur[K.name]) });
      if (f === 'vendor') { oldVendor = str_(was) || '업체 미정'; newVendor = str_(fields[f]); }   // 업체 없이 등록한 줄이면 '업체 미정' 카드의 메모를 옮긴다
    });
    if (oldVendor && newVendor && norm_(oldVendor) !== norm_(newVendor)) {
      var n = sh.getLastRow() - C.hr;
      var v = n > 0 ? sh.getRange(C.hr + 1, 1, n, width).getValues() : [];
      vendorGone = !v.some(function (r) {
        return sampleRowKey_(r, K) === String(projKey) && norm_(str_(r[K.vendor]) || '업체 미정') === norm_(oldVendor);
      });
    }
  } finally {
    lock.releaseLock();
    dropSampleCache_();
  }
  if (audits.length) { try { writeAudits_(audits); } catch (e) { /* 이력은 넘어간다 */ } }
  var moved = false;
  if (vendorGone && meta) {
    try {
      var vk = function (s) { return 'tl:' + String(s || '').replace(/[\s()]/g, '').toLowerCase().slice(0, 60); };
      editProgress_('p:' + projKey, meta, 'sample', function (st) {
        st.notes = st.notes || {};
        var a = st.notes[vk(oldVendor)];
        if (!a) return;
        var b = [];
        try { b = JSON.parse(st.notes[vk(newVendor)] || '[]'); } catch (x) { b = []; }
        var merged = b.concat(JSON.parse(a)).sort(function (x, y) { return String(x.at) < String(y.at) ? -1 : 1; });
        st.notes[vk(newVendor)] = JSON.stringify(merged.slice(-200));
        delete st.notes[vk(oldVendor)];
        moved = true;
      });
    } catch (e) { /* 메모 옮기기는 실패해도 시트는 바뀌었다 */ }
  }
  return { ok: true, row: row, changed: audits.length, movedNotes: moved };
}

/** 화면: 프로젝트 전체 줄(vendor 를 주면 그 업체 줄만)의 담당자 · 브랜드를 한 번에. fields: { owner, brand } */
function apiSampleProject(projKey, fields, vendor) {
  requireEditor_();
  fields = fields || {};
  var sh = sheet_(RB.SAMPLE_TAB);
  if (!sh) throw new Error('_실행판_샘플 탭을 찾을 수 없습니다.');
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var audits = [];
  try {
    var C = sampleCols_(sh, false), K = C.K;
    var n = sh.getLastRow() - C.hr;
    if (n < 1) return { n: 0 };
    var vals = sh.getRange(C.hr + 1, 1, n, C.lc).getValues();
    var hits = [];
    var vk = str_(vendor) ? norm_(vendor) : '';
    vals.forEach(function (r, i) {
      if (!str_(r[K.name]) || sampleRowKey_(r, K) !== String(projKey)) return;
      if (vk && norm_(str_(r[K.vendor]) || '업체 미정') !== vk) return;
      hits.push(i);
    });
    if (!hits.length) throw new Error('_실행판_샘플 시트에서 이 프로젝트 줄을 찾지 못했습니다. 새로고침 후 다시 해 주세요.');
    ['owner', 'brand', 'code'].forEach(function (f) {
      if (fields[f] == null || K[f] < 0) return;
      var want = f === 'code' ? str_(fields[f]).toUpperCase().replace(/\s/g, '').slice(0, 40) : str_(fields[f]);
      var rows = hits.filter(function (i) { return str_(vals[i][K[f]]) !== want; });
      if (!rows.length) return;
      var colL = colLetterRB_(K[f] + 1);
      sh.getRangeList(rows.map(function (i) { return colL + (C.hr + 1 + i); })).setValue(want ? asText_(want) : '');
      rows.forEach(function (i) { audits.push({ tab: RB.SAMPLE_TAB, row: C.hr + 1 + i, col: K[f] + 1, what: '샘플 ' + (RB_SAMPLE_F[f] || (f === 'code' ? '품목코드' : f)), before: str_(vals[i][K[f]]), after: want, item: str_(vals[i][K.name]) }); });
    });
  } finally {
    lock.releaseLock();
  }
  if (audits.length) { try { writeAudits_(audits); } catch (e) { /* 넘어간다 */ } }
  dropSampleCache_();
  return { ok: true, n: audits.length };
}

/** 진행 메모 한 줄을 그 업체 마지막 회차 줄 [비고/피드백] 끝에 덧붙인다('10.14 내용'). 실패하면 사유 글을 돌려준다. */
function sampleNoteToSheet_(sheetRow, projKey, e, exp) {
  var row = Number(sheetRow) || 0;
  if (row < 2 || !e || !str_(e.text)) return '';
  try {
    var sh = sheet_(RB.SAMPLE_TAB);
    if (!sh) return '_실행판_샘플 탭 없음';
    var lock = LockService.getScriptLock();
    waitLock_(lock);
    try {
      var C = sampleCols_(sh, false), K = C.K;
      if (K.note < 0) return '[비고/피드백] 열 없음';
      row = checkSampleRow_(sh, K, row, projKey, exp);
      var cell = sh.getRange(row, K.note + 1), was = str_(cell.getValue());
      var add = String(e.at || '').slice(5).replace('-', '.') + ' ' + str_(e.text) + (e.st ? ' [' + e.st + ']' : '');
      var now = (was ? was + ' / ' : '') + add;
      if (now.length > 45000) throw new Error('비고 칸이 너무 길어(4만 자 넘음) 더 붙이지 않았습니다. 시트에서 정리해 주세요.');
      cell.setValue(asText_(now));
      writeAudit_(RB.SAMPLE_TAB, row, K.note + 1, '샘플 비고(진행 메모)', was, now);
    } finally { lock.releaseLock(); }
    dropSampleCache_();
    return '';
  } catch (err) { return err.message; }
}

/**
 * 진행 메모에 기한을 적으면 그 업체 마지막 회차 줄의 [전달예정일]도 그 날짜로 바꾼다(2026-10-15).
 * 한 회차에서 일정이 바뀌면 예전 기한은 없어지고 마지막 기한이 표 · 시트에 보이게.
 */
function sampleDueToSheet_(sheetRow, projKey, due, exp) {
  var row = Number(sheetRow) || 0, m = String(due || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (row < 2 || !m) return '';
  try {
    var sh = sheet_(RB.SAMPLE_TAB);
    if (!sh) return '_실행판_샘플 탭 없음';
    var lock = LockService.getScriptLock();
    waitLock_(lock);
    try {
      var C = sampleCols_(sh, false), K = C.K;
      if (K.planAt < 0) return '[전달예정일] 열 없음';
      row = checkSampleRow_(sh, K, row, projKey, exp);
      var cell = sh.getRange(row, K.planAt + 1), was = cell.getValue();
      var want = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (was instanceof Date && was.getFullYear() === want.getFullYear() && was.getMonth() === want.getMonth() && was.getDate() === want.getDate()) return '';
      cell.setValue(want);
      writeAudit_(RB.SAMPLE_TAB, row, K.planAt + 1, '샘플 전달예정일(진행 메모 기한)', was, want);
    } finally { lock.releaseLock(); }
    dropSampleCache_();
    return '';
  } catch (err) { return err.message; }
}

/**
 * 화면: 여러 회차 줄 상태를 한 번에(2026-10-15) — 프로젝트 드롭 · 채택 뒤 나머지 탈락 · 업체 일괄 수신/드롭.
 * items: [{ row, projKey }], status: 진행중 · 수신 · 채택 · 탈락 · 드롭, date: 'yyyy-MM-dd'(수신이면 비어 있는 전달일에), why: 비고에 덧붙일 사유.
 * 비고/피드백 끝에 'MM.DD 상태 — 사유'를 덧붙인다. 줄마다 확인(프로젝트 열쇠)하고, 안 맞는 줄은 건너뛰어 돌려준다.
 */
function apiSampleBulkSet(items, status, date, why) {
  requireEditor_();
  status = str_(status);
  if (RB_SAMPLE_STATUS.indexOf(status) < 0) throw new Error('알 수 없는 상태입니다: ' + status);
  items = (items || []).filter(function (x) { return x && Number(x.row) >= 2; });
  if (!items.length) throw new Error('고른 줄이 없습니다.');
  var sh = sheet_(RB.SAMPLE_TAB);
  if (!sh) throw new Error('_실행판_샘플 탭을 찾을 수 없습니다.');
  var d = toDate_(str_(date)) || new Date();
  var day = new Date(d.getFullYear(), d.getMonth(), d.getDate());          // 비고 날짜도 고른 날(일괄 수신의 수신일) — 예전엔 늘 오늘이었다
  var tag = Utilities.formatDate(day, Session.getScriptTimeZone(), 'MM.dd') + ' ' + status + (str_(why) ? ' — ' + str_(why).slice(0, 200) : '');
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var audits = [], done = [], skip = [];
  try {
    var C = sampleCols_(sh, true), K = C.K;
    items.forEach(function (it) {
      var row = Number(it.row);
      try { row = checkSampleRow_(sh, K, row, it.projKey, it.exp); } catch (e) { skip.push({ row: row, why: e.message }); return; }
      var set = function (f, want, what) {
        if (K[f] < 0) return;
        var cell = sh.getRange(row, K[f] + 1), was = cell.getValue();
        if (sampleShow_(was) === sampleShow_(want)) return;
        cell.setValue(want);
        audits.push({ tab: RB.SAMPLE_TAB, row: row, col: K[f] + 1, what: what, before: sampleShow_(was), after: sampleShow_(want), item: '' });
      };
      set('status', status, '샘플 상태(일괄)');
      if (status === '수신' && K.doneAt >= 0 && !str_(sh.getRange(row, K.doneAt + 1).getValue())) set('doneAt', day, '샘플 전달일(일괄 수신)');
      if (K.note >= 0) {
        var was = str_(sh.getRange(row, K.note + 1).getValue()), now = (was ? was + ' / ' : '') + tag;
        if (now.length <= 45000) set('note', asText_(now), '샘플 비고(일괄)');
      }
      done.push(row);
    });
  } finally {
    lock.releaseLock();
  }
  if (audits.length) { try { writeAudits_(audits); } catch (e) { /* 이력은 넘어간다 */ } }
  dropSampleCache_();
  return { ok: true, n: done.length, rows: done, skipped: skip, doneAt: status === '수신' ? fmtDate_(day) : '' };
}

/**
 * 화면: 시트에 이미 적힌 구성 · 사양 · 구분 값 정리(2026-10-15) — 목록 밖 값을 목록 값으로 바꿔 쓴다.
 * maps: { make: { '옛 값': '새 값' }, spec: {...}, kind: {...} }. 새 값이 빈칸이면 그대로 둔다. 바꾼 칸 수를 돌려준다.
 */
function apiSampleRemap(maps) {
  requireEditor_();
  maps = maps || {};
  var sh = sheet_(RB.SAMPLE_TAB);
  if (!sh) throw new Error('_실행판_샘플 탭을 찾을 수 없습니다.');
  var lock = LockService.getScriptLock();
  waitLock_(lock, 40000);           // 다른 저장이 오래 잡고 있으면 40초 뒤 알린다(다시 눌러도 안전 — 이미 바뀐 칸은 건너뜀)
  var hist = [], total = 0;
  try {
    var C = sampleCols_(sh, false), K = C.K, n = sh.getLastRow() - C.hr;
    if (n < 1) return { n: 0 };
    ['make', 'spec', 'kind'].forEach(function (f) {
      var m = maps[f];
      if (!m || K[f] < 0) return;
      var col = sh.getRange(C.hr + 1, K[f] + 1, n, 1).getValues(), byNew = {};
      col.forEach(function (r, i) {
        var was = str_(r[0]), want = m[was] != null ? str_(m[was]) : '';
        if (!was || !want || want === was) return;
        (byNew[want] = byNew[want] || []).push(i);
      });
      var colL = colLetterRB_(K[f] + 1);
      Object.keys(byNew).forEach(function (want) {
        var rows = byNew[want];
        for (var i = 0; i < rows.length; i += 400) sh.getRangeList(rows.slice(i, i + 400).map(function (k) { return colL + (C.hr + 1 + k); })).setValue(asText_(want));
        total += rows.length;
      });
      Object.keys(m).forEach(function (was) {
        var want = str_(m[was]);
        if (!want || want === was) return;
        var cnt = col.filter(function (r) { return str_(r[0]) === was; }).length;
        if (cnt) hist.push({ kind: '설정', item: '샘플 ' + RB_SAMPLE_F[f] + ' 값 정리', before: was, after: want + ' (' + cnt + '칸)', where: RB.SAMPLE_TAB });
      });
    });
  } finally {
    lock.releaseLock();
  }
  if (hist.length) { try { appendHist_(hist); } catch (e) { /* 넘어간다 */ } }
  dropSampleCache_();
  return { ok: true, n: total };
}

/**
 * 화면: 회차 줄 지우기(2026-10-15) — 시트 줄을 지우고 원래 값은 숨김 탭 _실행판_삭제보관에 남긴다(되살릴 때 쓴다).
 */
function apiSampleDeleteRow(sheetRow, projKey, exp) {
  requireEditor_();
  var row = Number(sheetRow) || 0;
  if (row < 2) throw new Error('시트 행을 찾을 수 없습니다.');
  var sh = sheet_(RB.SAMPLE_TAB);
  if (!sh) throw new Error('_실행판_샘플 탭을 찾을 수 없습니다.');
  var lock = LockService.getScriptLock();
  waitLock_(lock, 40000);
  var info = '';
  try {
    var C = sampleCols_(sh, false), K = C.K;
    if (!projKey) throw new Error('프로젝트를 알 수 없어 지우지 않았습니다. 새로고침 후 다시 해 주세요.');
    row = checkSampleRow_(sh, K, row, projKey, exp);
    var v = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
    info = str_(v[K.name]) + ' / ' + (K.vendor >= 0 ? str_(v[K.vendor]) : '') + ' / ' + (K.make >= 0 ? str_(v[K.make]) : '');
    var bk = tab_(RB_DEL_TAB, RB_DEL_HEAD);
    var r0 = bk.getLastRow() + 1;
    ensureRows_(bk, r0);
    bk.getRange(r0, 1, 1, RB_DEL_HEAD.length).setValues([[new Date(), me_(), '샘플 회차 ' + info, RB.SAMPLE_TAB, row, '', JSON.stringify(v.map(function (x) { return x instanceof Date ? fmtDate_(x) : x; }))]]);
    try { if (!bk.isSheetHidden()) bk.hideSheet(); } catch (eH) { /* 넘어간다 */ }
    sh.deleteRow(row);
    writeAudit_(RB.SAMPLE_TAB, row, 1, '샘플 회차 삭제', info, '삭제(' + RB_DEL_TAB + '에 보관)');
  } finally {
    lock.releaseLock();
  }
  dropSampleCache_();
  return { ok: true, row: row };
}

/**
 * _실행판_샘플 시트 중간의 완전히 빈 줄(내용만 지운 줄)을 지운다(2026-10-15). 새 줄을 붙인 뒤 부른다 — 지운 줄 중 newRow 위에 있던 수를 돌려준다.
 * 시트 맨 아래 빈 줄 · 머리글은 건드리지 않는다. 잠금 안에서 부른다.
 */
function sampleCompact_(sh, C, newRow) {
  try {
    var last = sh.getLastRow(), n = last - C.hr;
    if (n < 2) return 0;
    var v = sh.getRange(C.hr + 1, 1, n, Math.max(C.lc, sh.getLastColumn())).getValues(), blank = [];   // 오른쪽 칸만 쓴 줄도 지우지 않게 전체 폭
    v.forEach(function (r, i) { if (r.every(function (x, j) { return j === C.K.sid || j === C.K.pid || x === null || String(x).trim() === ''; })) blank.push(C.hr + 1 + i); });   // 샘플ID 만 남은 줄도 빈 줄
    if (!blank.length) return 0;
    deleteRowsDesc_(sh, blank);
    try { writeAudit_(RB.SAMPLE_TAB, blank[0], 1, '샘플 빈 줄 정리', blank.length + '줄 비어 있음', '지움(' + blank.join(',').slice(0, 200) + ')'); } catch (eA) { /* 넘어간다 */ }
    return blank.filter(function (r) { return r < newRow; }).length;
  } catch (e) { return 0; }
}

/**
 * 업체 상태 = 회차들로 정한다(2026-10-15 — 회차마다 샘플 드롭이 생겨서 '마지막 줄 상태'로는 업체 드롭과 구분이 안 됨).
 * 채택 회차가 있으면 채택 · [업체 드롭]/[프로젝트 드롭]으로 닫혔으면 드롭 · 아직 안 받은 회차가 있으면 그 회차 상태(보통 진행중)
 * · 모두 드롭/탈락이면 드롭(탈락) · 그 밖엔 수신
 * 화면(sampleVStatus)과 규칙이 같아야 한다.
 */
/** 회차 비고의 마지막 기록이 업체 드롭 · 프로젝트 드롭인지('… / 10.16 드롭 — 업체 드롭: 사유') */
function sampleVendorDropNote_(note) {
  var parts = String(note == null ? '' : note).split(' / ');
  return /(업체|프로젝트) 드롭(?! 취소)/.test(parts[parts.length - 1]);
}

function sampleVendorStatus_(reqs) {
  var off = { '드롭': 1, '탈락': 1 }, open = null, allOff = true;
  if (reqs.some(function (q) { return str_(q.status) === '채택'; })) return '채택';
  // 업체 드롭: 앞 회차를 이미 받았으면(수신) '모두 드롭'이 될 수 없어, 업체를 드롭해도 수신으로 남아 아래로 안 내려가고
  // 누를 때마다 마지막 회차에 '업체 드롭' 메모만 쌓였다(2026-10-16). 마지막 회차가 업체 · 프로젝트 드롭으로 닫혔으면 업체 드롭이다.
  var last = reqs[reqs.length - 1];
  if (last && off[str_(last.status)] && sampleVendorDropNote_(last.note)) return str_(last.status);
  reqs.forEach(function (q) {
    var st = str_(q.status);
    if (!off[st]) allOff = false;
    if (!str_(q.doneAt) && !off[st] && st !== '수신') open = q;
  });
  if (open) return str_(open.status) || '진행중';
  if (allOff && reqs.length) return str_(reqs[reqs.length - 1].status);
  return '수신';
}

/**
 * 화면: 샘플 프로젝트 비고(2026-10-23) — 업체와 상관없는 프로젝트 전체 메모(일정 · 요청 사항 · 결정 등).
 * 진행 기록 notes.pmemo = [{ t, at, by }] (최근 것이 뒤). op = { add: 글 } | { del: 순번, at: 그 줄 시각(확인용) }
 */
function apiSampleProjMemo(projKey, meta, op) {
  requireEditor_();
  op = op || {};
  var id = 'p:' + str_(projKey), m = meta || {}, list = [];
  m.id = id;
  editProgress_(id, m, 'sample', function (st) {
    st.notes = st.notes || {};
    try { list = JSON.parse(st.notes.pmemo || '[]'); } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    if (op.add != null) {
      var t = str_(op.add).slice(0, 500);
      if (!t) throw new Error('메모를 적어 주세요.');
      var it = { t: t, at: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yy/MM/dd HH:mm'), by: me_().split('@')[0] };
      if (str_(op.wait)) it.wait = str_(op.wait).slice(0, 20);                       // 역요청 대기(요청부서 · 디자인팀 회신 …)
      if (/^\d{4}-\d{2}-\d{2}$/.test(str_(op.due))) it.due = str_(op.due);
      list.push(it);
    } else if (op.waitDone != null) {                                                 // [회신 받음] / 되돌리기
      var wi = Number(op.waitDone);
      if (!(wi >= 0 && wi < list.length) || (op.at && list[wi].at !== op.at)) throw new Error('그사이 메모가 바뀌었습니다 — 새로고침해 주세요.');
      if (op.undo) { delete list[wi].waitDone; delete list[wi].waitBy; delete list[wi].waitReply; }
      else { list[wi].waitDone = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); list[wi].waitBy = me_().split('@')[0]; if (str_(op.reply)) list[wi].waitReply = str_(op.reply).slice(0, 500); }
    } else if (op.edit != null) {                                                     // 비고 고치기(2026-10-27) — 내용만, 적은 시각 · 사람은 그대로
      var ei = Number(op.edit), nt = str_(op.t).slice(0, 500);
      if (!(ei >= 0 && ei < list.length) || (op.at && list[ei].at !== op.at)) throw new Error('그사이 메모가 바뀌었습니다 — 새로고침해 주세요.');
      if (!nt) throw new Error('메모를 적어 주세요(지우려면 ×).');
      list[ei].t = nt; list[ei].edited = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yy/MM/dd HH:mm') + ' ' + me_().split('@')[0];
    } else if (op.del != null) {
      var i = Number(op.del);
      if (!(i >= 0 && i < list.length) || (op.at && list[i].at !== op.at)) throw new Error('그사이 메모가 바뀌었습니다 — 새로고침해 주세요.');
      list.splice(i, 1);
    }
    list = list.slice(-100);
    st.notes.pmemo = JSON.stringify(list);
  });
  return list;
}

/**
 * 샘플 프로젝트 정보(GWP 방식, 2026-10-26) — notes['i:'+key] JSON 하나에 칸(sub)별로 합쳐 넣는다.
 *  key: req = 요청 정보(요청부서 · 목적 · 희망 일정 · 목표 단가 · 사양 …), qt = 업체 견적 비교(sub = 업체키, val = 그 업체 견적 칸들),
 *       rv = 회차 검토 결과(sub = 샘플ID 또는 r+시트행, val = { res, note, at, by })
 *  sets = [{ sub, val }] — val 이 null · 빈칸이면 그 칸을 지운다. 칸별로 합치므로 둘이 다른 칸을 고쳐도 서로 덮지 않는다.
 */
function apiSampleProjInfo(projKey, meta, key, sets) {
  requireEditor_();
  if (['req', 'qt', 'rv', 'po'].indexOf(String(key)) < 0) throw new Error('알 수 없는 칸입니다: ' + key);
  var id = 'p:' + str_(projKey), m = meta || {}, obj = {}, who = me_().split('@')[0], notesNow = {}, logNow = null;
  var at = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  m.id = id;
  editProgress_(id, m, 'sample', function (st) {
    st.notes = st.notes || {};
    try { obj = JSON.parse(st.notes['i:' + key] || '{}'); } catch (e) { obj = {}; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) obj = {};
    // 요청 정보 변경 이력(2026-10-27) — 이미 있던 값을 바꾸거나 지운 것만(처음 적는 건 이력 아님). notes['i:reqlog'] = [{ at, by, f, a(이전), b(새) }]
    var logL = [];
    if (key === 'req') { try { logL = JSON.parse(st.notes['i:reqlog'] || '[]'); } catch (eL) { logL = []; } if (!Array.isArray(logL)) logL = []; }
    (sets || []).forEach(function (s) {
      var k = str_(s && s.sub).slice(0, 80);
      if (!k) return;
      var v = s.val;
      if (key === 'req' && k.charAt(0) !== '_') {
        var before = obj[k] == null ? '' : str_(obj[k]), after = (v == null || v === '') ? '' : str_(v).slice(0, 2000);
        if (before !== '' && before !== after) logL.push({ at: at, by: who, f: k, a: before.slice(0, 200), b: after.slice(0, 200) });
      }
      if (v == null || v === '') { delete obj[k]; return; }
      if (typeof v === 'object') {
        var o = {};
        Object.keys(v).slice(0, 60).forEach(function (f) { var x = v[f]; if (x != null && x !== '') o[str_(f).slice(0, 40)] = str_(x).slice(0, 1000); });
        o._at = at; o._by = who;
        obj[k] = o;
      } else obj[k] = str_(v).slice(0, 2000);
    });
    if (key === 'req') { obj._at = at; obj._by = who; logL = logL.slice(-300); st.notes['i:reqlog'] = JSON.stringify(logL); logNow = logL; }
    var j = JSON.stringify(obj);
    if (j.length > 40000) throw new Error('내용이 너무 깁니다 — 줄여 주세요.');
    st.notes['i:' + key] = j;
    notesNow = st.notes;
  });
  // 시트에서도 바로 보이게 — 요청서 · 견적 보기 탭을 맞춘다(실패해도 저장은 된 것)
  if (key !== 'rv') { try { sampleViewsSync_([{ projKey: str_(projKey), name: str_(m.name), brand: str_(m.brand), notes: notesNow }]); } catch (eV) { /* 넘어간다 */ } }
  if (logNow) { var out = JSON.parse(JSON.stringify(obj)); out.__log = logNow; return out; }       // 화면이 이력도 바로 그리게(저장 값에는 안 들어감)
  return obj;
}

/* ------------------------------------------------------------------
   샘플 요청서 · 견적 보기 탭(2026-10-26) — 실행판에 적은 요청 정보 · 업체 견적을 사람이 보는 표로.
   원본은 _실행판_샘플진행 의 메모JSON(i:req · i:qt · i:po). 이 탭은 저장할 때마다 다시 쓰는 사본이라 여기서 고쳐도 실행판에 안 들어간다.
   ------------------------------------------------------------------ */
var RB_SREQ_TAB = '_실행판_샘플요청서', RB_SQT_TAB = '_실행판_샘플견적';
var RB_SREQ_F = [['dept', '요청부서'], ['reqBy', '요청 담당자'], ['reqAt', '요청일'], ['purpose', '제작 목적 · 행사'],
  ['tqty', '목표 수량'], ['_mk', '구성별 사양 · 목표 단가'],
  ['launch', '출시 예정일'], ['massLead', '양산 리드타임(일)'], ['prepDays', '입고→출시 준비(일)'], ['_poDue', '발주 마감(역산)'], ['_inDue', '입고 마감(역산)'],
  ['wantPo', '희망 발주일'], ['wantMass', '양산 완료 희망일'], ['wantIn', '희망 납품일'], ['pickBy', '업체 선정 목표일'], ['etc', '기타 요청사항']];
var RB_SQT_F = [['st', '상태'], ['country', '국가 · 생산지'], ['contact', '업체 담당자'], ['round', '견적 차수'], ['moq', 'MOQ'], ['qty', '견적 수량'], ['price', '단가'], ['cur', '통화'], ['rate', '환율(원)'],
  ['_krw', '단가(원화)'], ['vat', 'VAT'], ['shipIn', '운송비 포함'], ['fSample', '샘플비'], ['fMold', '금형비'], ['fPlate', '판비'], ['fShip', '운송비'], ['_total', '총액(원화)'],
  ['dSample', '샘플 제작기간(일)'], ['dLead', '양산 소요기간(일)'], ['avail', '납품 가능일'], ['pay', '결제조건'], ['inco', '인코텀즈'], ['mat', '주요 소재'], ['qual', '품질 · 기술 특이사항'], ['opin', '구매팀 검토의견'], ['file', '견적서 링크']];
function sampleBack_(R) {
  var d = /^\d{4}-\d{2}-\d{2}$/.test(str_(R.launch)) ? new Date(str_(R.launch) + 'T00:00:00') : null, out = {};
  if (!d) return out;
  var n = function (v) { var x = Number(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return String(v == null ? '' : v).trim() === '' || isNaN(x) ? null : x; };
  var sub = function (dt, k) { var t = new Date(dt.getTime()); t.setDate(t.getDate() - k); return t; };
  var f = function (dt) { return Utilities.formatDate(dt, Session.getScriptTimeZone(), 'yyyy-MM-dd'); };
  var inD = sub(d, n(R.prepDays) || 0); out._inDue = f(inD);
  if (n(R.massLead) != null) out._poDue = f(sub(inD, n(R.massLead)));
  return out;
}
/** list = [{ projKey, name, brand, notes }] — 그 프로젝트 줄만 바꿔 쓴다(요청서: 1줄, 견적: 업체마다 1줄) */
function sampleViewsSync_(list) {
  var hR = ['프로젝트키', '브랜드', '제품명'].concat(RB_SREQ_F.map(function (x) { return x[1]; })).concat(['연결 발주', '수정 시각', '수정자']);
  var hQ = ['프로젝트키', '브랜드', '제품명', '구성', '업체'].concat(RB_SQT_F.map(function (x) { return x[1]; })).concat(['수정 시각', '수정자']);
  var shR = sampleViewTab_(RB_SREQ_TAB, hR), shQ = sampleViewTab_(RB_SQT_TAB, hQ);
  var P = function (o, k) { try { var v = JSON.parse((o || {})[k] || '{}'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } };
  var keys = {}; list.forEach(function (x) { keys[str_(x.projKey)] = 1; });
  var dropRows = function (sh) {
    var n = sh.getLastRow() - 1; if (n < 1) return;
    var ids = sh.getRange(2, 1, n, 1).getValues();
    for (var i = ids.length - 1; i >= 0; i--) if (keys[str_(ids[i][0])]) sh.deleteRow(i + 2);
  };
  dropRows(shR); dropRows(shQ);
  var outR = [], outQ = [];
  list.forEach(function (x) {
    var R = P(x.notes, 'i:req'), Q = P(x.notes, 'i:qt'), PO = P(x.notes, 'i:po'), B = sampleBack_(R);
    if (Object.keys(R).length || Object.keys(PO).length) {
      // 구성별 사양: 'size@용기' 같은 칸을 구성마다 한 줄로(예전 구성 없는 칸은 '기본')
      var MKL = [['size', '규격'], ['material', '소재'], ['color', '색상'], ['pack', '포장'], ['tprice', '목표 단가'], ['designSt', '디자인'], ['designAt', '디자인 확정 예정'], ['spec', '사양']], byMk = {}, mkOrder = [];
      Object.keys(R).forEach(function (k) {
        var i = k.indexOf('@'), base = i > 0 ? k.slice(0, i) : k, mk = i > 0 ? k.slice(i + 1) : '기본';
        if (!MKL.some(function (m) { return m[0] === base; }) || !str_(R[k])) return;
        if (!byMk[mk]) { byMk[mk] = {}; mkOrder.push(mk); } byMk[mk][base] = str_(R[k]);
      });
      R._mk = mkOrder.map(function (mk) { return '[' + mk + '] ' + MKL.filter(function (m) { return byMk[mk][m[0]]; }).map(function (m) { return m[1] + ' ' + byMk[mk][m[0]]; }).join(' · '); }).join('\n');
      outR.push([asText_(x.projKey), x.brand || '', x.name || ''].concat(RB_SREQ_F.map(function (f) { return f[0] === '_mk' ? R._mk : f[0].charAt(0) === '_' ? (B[f[0]] || '') : str_(R[f[0]]); }))
        .concat([Object.keys(PO).map(function (k) { var o = PO[k] || {}; return [o.doc, o.name, o.batch].filter(String).join(' '); }).join(' / '), str_(R._at), str_(R._by)]));
    }
    Object.keys(Q).forEach(function (vk) {
      var q = Q[vk] || {}, num = function (v) { var n = Number(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return String(v == null ? '' : v).trim() === '' || isNaN(n) ? null : n; };
      var cur = q.cur || 'KRW', rate = cur === 'KRW' ? 1 : num(q.rate), krw = num(q.price) != null && rate != null ? num(q.price) * rate : null;
      var fees = ['fSample', 'fMold', 'fPlate', 'fShip'].reduce(function (a, f) { return a + (num(q[f]) || 0); }, 0);
      var total = krw != null && num(q.qty) != null ? krw * num(q.qty) + fees * (rate || 1) : null;
      var ci = vk.indexOf('::');
      outQ.push([asText_(x.projKey), x.brand || '', x.name || '', ci > 0 ? vk.slice(0, ci) : str_(q.make), q.name || (ci > 0 ? vk.slice(ci + 2) : vk)].concat(RB_SQT_F.map(function (f) {
        if (f[0] === '_krw') return krw == null ? '' : Math.round(krw);
        if (f[0] === '_total') return total == null ? '' : Math.round(total);
        return str_(q[f[0]]);
      })).concat([str_(q._at), str_(q._by)]));
    });
  });
  if (outR.length) shR.getRange(shR.getLastRow() + 1, 1, outR.length, hR.length).setValues(outR);
  if (outQ.length) shQ.getRange(shQ.getLastRow() + 1, 1, outQ.length, hQ.length).setValues(outQ);
}
function sampleViewTab_(name, head) {
  var sh = sheet_(name);
  if (!sh) {
    sh = ss_().insertSheet(name);
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#e8eef5');
    sh.setFrozenRows(1); sh.setFrozenColumns(3);
    RB_SHEETS[name] = sh;
  } else {
    var cur = sh.getRange(1, 1, 1, head.length).getValues()[0];
    if (cur.join('|') !== head.join('|')) { sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), head.length)).clearContent(); sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold'); }
  }
  return sh;
}
/** 관리자: 요청서 · 견적 보기 탭을 처음부터 다시 만든다(지금까지 적은 것 모두) */
function apiSampleViewsRebuild() {
  requireEditor_();
  var sh = sheet_(RB.T_SPROGRESS); if (!sh || sh.getLastRow() < 2) return { n: 0 };
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, RB.PROGRESS_HEAD.length).getValues(), list = [];
  v.forEach(function (r) {
    var id = str_(r[0]); if (id.indexOf('p:') !== 0) return;
    var notes = {}; try { notes = JSON.parse(r[7] || '{}') || {}; } catch (e) { notes = {}; }
    if (!notes['i:req'] && !notes['i:qt'] && !notes['i:po']) return;
    list.push({ projKey: id.slice(2), name: str_(r[2]), brand: str_(r[4]), notes: notes });
  });
  [RB_SREQ_TAB, RB_SQT_TAB].forEach(function (n) { var t = sheet_(n); if (t && t.getLastRow() > 1) t.deleteRows(2, t.getLastRow() - 1); });
  if (list.length) sampleViewsSync_(list);
  return { n: list.length };
}

/**
 * 일일보고: 회신 대기 → 회신 받음(회신 내용과 함께). w = { pj, vk(업체키 · 빈칸이면 프로젝트 비고), at, text, name, brand }
 * 화면 상세의 [회신 받음]과 같은 기록을 남긴다 — 대기 기록은 시각 · 내용으로 찾는다
 */
function apiWaitReply(w, reply) {
  w = w || {};
  var pj = str_(w.pj); if (!pj) throw new Error('회신 대기 건을 찾을 수 없습니다.');
  var id = /^n:/.test(pj) ? 'p:' + pj : pj, today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'), who = me_().split('@')[0];
  editProgress_(id, { id: id, name: str_(w.name), brand: str_(w.brand) }, 'sample', function (st) {
    st.notes = st.notes || {};
    var k = w.vk ? 'tl:' + str_(w.vk).slice(0, 60) : 'pmemo', list = [];
    try { list = JSON.parse(st.notes[k] || '[]'); } catch (e) { list = []; }
    var o = list.filter(function (x) { return x && x.wait && String(x.at) === String(w.at) && String(w.vk ? x.text || '' : x.t || '') === String(w.text || ''); })[0];
    if (!o) throw new Error('그 대기 기록이 바뀌었거나 지워졌습니다. 보고서를 새로고침해 주세요.');
    o.waitDone = today; o.waitBy = who; if (str_(reply)) o.waitReply = str_(reply).slice(0, 500);
    st.notes[k] = JSON.stringify(list);
  });
  return { ok: true, waitDone: today, waitBy: who };
}
