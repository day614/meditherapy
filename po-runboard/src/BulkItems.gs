/**
 * 단계 항목 일괄 처리 — 목록에서 고른 여러 건(품의번호가 달라도)의 항목을 한 번에 완료 · 생략 · 해제.
 * items: [{ id, meta }]
 * ops:   [{ key, act: 'done' | 'skip' | 'clear', chg: 'Y' | 'N' | '', dateField: 'submitted' | 'approved' | 'req:…' | '', date: 'yyyy-MM-dd' }]
 * 돌려주는 undo 로 [되돌리기] 한다(바꾸기 전 값을 건마다 남김).
 */
function apiBulkItems(items, ops, mode) {
  mode = mode === 'sample' ? 'sample' : 'po';
  ops = (ops || []).filter(function (o) { return o && o.key && ['done', 'skip', 'clear'].indexOf(o.act) > -1; });
  if (!ops.length) throw new Error('처리할 항목을 고르세요.');
  var M = metaFast_(mode);
  var byKey = {};
  M.steps.forEach(function (st) {
    byKey['_hold_' + st.id] = { t: st.title + ' 보류', hold: true };
    (st.items || []).forEach(function (it, i) { byKey[itemKey_(st, i)] = it; });
  });
  ops.forEach(function (o) {
    if (!byKey[o.key]) throw new Error('단계 설정이 바뀌었습니다. 새로고침 후 다시 해 주세요.');
    if (o.dateField && !/^(submitted|approved|req:[A-Za-z0-9_-]{1,60})$/.test(o.dateField)) throw new Error('알 수 없는 날짜 칸입니다.');
    if (o.date && !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) throw new Error('날짜는 달력에서 골라주세요.');
  });
  var me = me_(), logRows = [], undo = [], skipped = [], done = 0, bump = {};
  var n = bulkEditProgress_(items, mode, function (st, it) {
    var c = st.checks, d = st.dates;
    var prevC = {}, prevD = {}, changed = false;
    var keep = function (k) { if (!(k in prevC)) prevC[k] = (k in c) ? c[k] : null; };
    var keepD = function (f) { if (!(f in prevD)) prevD[f] = (f in d) ? d[f] : null; };
    ops.forEach(function (o) {
      var k = o.key, item = byKey[k];
      [k, 'sk:' + k, 'cy:' + k].forEach(keep);
      if (item.hold) {                                     // 단계 보류 / 보류 풀기
        if (o.act === 'done') c[k] = 1; else delete c[k];
        changed = true;
        return;
      }
      if (o.act === 'done') {
        if (item.chg && (o.chg === 'Y' || o.chg === 'N')) c['cy:' + k] = o.chg;
        if (item.chg && !chgDec_(c, k)) { skipped.push((it.meta && it.meta.name || it.id) + ' · ' + item.t + ' — 변경 여부를 안 정함'); return; }
        c[k] = 1; delete c['sk:' + k];
        if (o.dateField) {
          keepD(o.dateField);
          if (o.date) {
            d[o.dateField] = o.date;
            if (RB_DATE_STATE[o.dateField]) (bump[o.dateField] = bump[o.dateField] || []).push(it);
          }
        }
      } else if (o.act === 'skip') {
        if (item.chg && (o.chg === 'Y' || o.chg === 'N')) c['cy:' + k] = o.chg;
        if (itemRequired_(item, c, k)) { skipped.push((it.meta && it.meta.name || it.id) + ' · ' + item.t + ' — 필수 항목이라 생략 불가'); return; }
        c['sk:' + k] = 1; delete c[k];
      } else {
        delete c[k]; delete c['sk:' + k];
      }
      changed = true;
    });
    if (!changed) return false;
    undo.push({ id: it.id, meta: it.meta || {}, c: prevC, d: prevD });
    done++;
    logRows = logRows.concat(stepLogRows_(mode, it.id, it.meta || {}, stampSteps_(c, d, M.steps), d, M.steps, me));
  }, function () {
    if (logRows.length) logSteps_(mode, logRows);
    // 요약 줄도 잠금 안에서 쓴다(잠금 밖에서 [마지막 행 + 1]에 쓰면 동시에 쓴 다른 이력 줄을 덮을 수 있었다)
    appendHist_([{ kind: '단계', mode: mode, item: '항목 일괄 처리',
      after: done + '건 · ' + ops.map(function (o) { return (byKey[o.key].t || o.key) + ' ' + (byKey[o.key].hold ? (o.act === 'done' ? '' : '풀기') : ({ done: '체크', skip: '생략', clear: '해제' })[o.act]); }).join(', ').slice(0, 400),
      note: skipped.length ? '건너뜀 ' + skipped.length + '건' : '' }], 'p');
  });
  // 상신일 · 승인일을 넣었으면 진행상태도 올린다(apiBulkDate 와 같게) — 예전엔 날짜 · 체크만 들어가고 계획으로 남았다
  if (mode === 'po') {
    ['submitted', 'approved'].forEach(function (f) {
      if (!bump[f] || !bump[f].length) return;
      try {
        bumpStates_(bump[f].map(function (it) {
          var m = it.meta || {};
          if (!m.id) m.id = it.id;
          return { statusRow: it.statusRow || 0, expect: m };
        }), RB_DATE_STATE[f]);
      } catch (e) { /* 상태 올리기가 실패해도 날짜는 저장됐다 */ }
    });
  }
  return { n: n, undo: undo, skipped: skipped };
}

/** [되돌리기]: apiBulkItems 가 돌려준 undo 그대로 */
function apiBulkItemsUndo(undo, mode) {
  mode = mode === 'sample' ? 'sample' : 'po';
  var byId = {};
  (undo || []).forEach(function (u) { if (u && u.id) byId[u.id] = u; });
  var items = Object.keys(byId).map(function (id) { return { id: id, meta: byId[id].meta || {} }; });
  var M = metaFast_(mode), me = me_(), logRows = [];
  var n = bulkEditProgress_(items, mode, function (st, it) {
    var u = byId[it.id];
    Object.keys(u.c || {}).forEach(function (k) { if (u.c[k] === null) delete st.checks[k]; else st.checks[k] = u.c[k]; });
    Object.keys(u.d || {}).forEach(function (f) { if (u.d[f] === null) delete st.dates[f]; else st.dates[f] = u.d[f]; });
    logRows = logRows.concat(stepLogRows_(mode, it.id, it.meta || {}, stampSteps_(st.checks, st.dates, M.steps), st.dates, M.steps, me));
  }, function () {
    if (logRows.length) logSteps_(mode, logRows);
    appendHist_([{ kind: '단계', mode: mode, item: '항목 일괄 처리 되돌리기', after: items.length + '건' }], 'p');
  });
  return { n: n };
}
