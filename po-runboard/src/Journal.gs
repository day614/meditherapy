/**
 * ============================================================
 * 진행 기록 저장 장부(먼저 받아 적고, 시트에는 모아서 쓴다)
 * ------------------------------------------------------------
 * 체크 · 날짜 · 메모 · 변경 여부 · 통화 저장은 스크립트 속성에 변경 한 줄만 적고 바로 끝난다.
 * 잠금도 시트 쓰기도 없어서 저장끼리 줄을 서지 않는다(예전: 저장마다 잠금 1.5~2.3초).
 * 1분마다 트리거(journalDrain)가 잠금을 한 번 잡고, 모인 변경을 적힌 순서대로 시트에 한꺼번에 쓴다
 * (첫 화면 · BOM · 재고 캐시 채우기는 10분 트리거 warmCaches 가 따로 한다)
 * (측정: 쓰기 10번 + 반영 1번 0.49초 / 쓰기마다 반영 7.7초).
 * 진행 기록을 읽는 곳(첫 화면 · 다른 사람 새로고침)은 아직 시트에 안 들어간 변경을 겹쳐 보여 준다.
 * 진행 기록 탭을 잠금 안에서 직접 고치는 곳(editProgress_ · bulkEditProgress_ · reconcile · 건ID 옮기기)은
 * 고치기 전에 장부부터 비운다 — 순서가 뒤집히지 않게.
 * ============================================================
 */

var RB_J = 'j1:';
var RB_J_TRIGGER = 'journalDrain';
var RB_J_MAX = 400;          // 이만큼 쌓여 있으면(트리거가 멈췄다는 뜻) 예전처럼 바로 시트에 쓴다
var RB_W_TRIGGER = 'warmCaches';
// 스크립트 속성은 모두 합쳐 500KB 까지다. 장부(j1: · h1:)가 이만큼 넘게 쌓이면 장부에 적지 않고
// 예전처럼 바로 시트에 쓴다 — 공지(rb.notice) · 품의번호 대기(rb.docq) 같은 다른 속성 저장이 막히지 않게.
var RB_J_BYTES = 300000;
var RB_ACT = null;
var RB_J_SEQ = 0;            // 한 실행 안에서 장부 줄 순번(같은 시각 줄의 순서 유지)           // 장부 한 줄을 적용하는 동안 { at: Date } — 단계 완료 시각을 저장한 시각으로 찍으려고

/** 장부(j1: 진행 · h1: 이력)가 차지한 글자 수. all 이 없으면 속성을 읽는다. */
function journalBytes_(all) {
  all = all || PropertiesService.getScriptProperties().getProperties();
  var n = 0;
  Object.keys(all).forEach(function (k) {
    if (k.indexOf(RB_J) === 0 || k.indexOf(RB_H) === 0) n += k.length + String(all[k] || '').length;
  });
  return n;
}

/** 장부에 더 적어도 되는지(총량 한도 아래인지). 못 읽으면 false(바로 쓰기로). */
function journalRoom_(all, add) {
  try { return journalBytes_(all) + (add || 0) < RB_J_BYTES; } catch (e) { return false; }
}

/** 장부 전체(적힌 순서대로) */
function journalList_(all) {
  all = all || PropertiesService.getScriptProperties().getProperties();
  return Object.keys(all).filter(function (k) { return k.indexOf(RB_J) === 0; }).sort().map(function (k) {
    var op = null;
    try { op = JSON.parse(all[k]); } catch (e) { op = null; }
    return { key: k, op: op };
  }).filter(function (x) { return x.op && x.op.id; });
}

/** 변경 한 줄 적기. 못 적으면 false(부르는 쪽이 예전 방식으로 저장한다). all = 방금 읽은 속성 전체(없으면 읽는다) */
function journalAdd_(op, all) {
  op.v = 1;
  op.at = op.at || Date.now();
  op.who = op.who || me_();
  var s = JSON.stringify(op);
  if (s.length > 8000) return false;                           // 속성 한 칸은 9KB 까지
  if (!journalRoom_(all, s.length + 40)) return false;        // 장부가 너무 커졌으면 바로 시트에(부르는 쪽 예전 방식)
  // 같은 1/1000초에 적힌 줄은 꼬리(무작위)로 정렬돼 순서가 뒤집힐 수 있었다 — 한 실행 안에서는 순번을 붙여 적은 순서대로
  RB_J_SEQ = (RB_J_SEQ + 1) % 10000;
  var key = RB_J + op.at + ':' + ('000' + RB_J_SEQ).slice(-4) + Utilities.getUuid().slice(0, 4);
  var props = PropertiesService.getScriptProperties();
  props.setProperty(key, s);
  if (props.getProperty(key) !== s) return false;              // 정말 적혔는지 확인
  journalTriggerEnsure_();
  // 다른 사람 화면이 '진행 기록 바뀜'을 알아채게(시트 반영 전이라도 겹쳐 보여 준다)
  try { CacheService.getScriptCache().put('rb:ver:p', String(Date.now()) + ':' + op.who, 21600); } catch (e) { /* 넘어간다 */ }
  return key;
}

/**
 * 1분 트리거(장부 옮기기) · 10분 트리거(캐시 채우기)가 없으면 만든다(캐시 표시로 트리거 목록 조회를 아낀다).
 * noLock: 바깥에서 스크립트 잠금을 쥐고 있을 수 있는 곳(이력 장부 등)에서 부를 때 — 잠금 없이 만들고 중복만 정리한다.
 */
function journalTriggerEnsure_(noLock) {
  var c = null;
  try { c = CacheService.getScriptCache(); if (c.get('j:trig2')) return; } catch (e) { c = null; }
  if (!triggerEnsure_(RB_J_TRIGGER, function () { ScriptApp.newTrigger(RB_J_TRIGGER).timeBased().everyMinutes(1).create(); }, !noLock)) return;
  if (!triggerEnsure_(RB_W_TRIGGER, function () { ScriptApp.newTrigger(RB_W_TRIGGER).timeBased().everyMinutes(10).create(); }, !noLock)) return;
  try { if (c) c.put('j:trig2', '1', 21600); } catch (e) { /* 넘어간다 */ }
}

/**
 * 트리거 '확인 후 생성'. 두 실행이 동시에 확인하면 둘 다 만들어 중복이 생기므로
 * useLock 이면 스크립트 잠금을 짧게(1초) 잡고 확인 · 생성한다. 만든 뒤(또는 이미 여럿이면) 중복을 정리해 하나만 남긴다
 * — 고유 번호가 가장 작은 것을 남기므로 두 실행이 동시에 정리해도 같은 하나가 남는다.
 * 같은 실행 안에서 이미 스크립트 잠금을 쥐고 있을 수 있는 곳은 useLock=false(잠금을 다시 잡았다 놓으면 바깥 잠금까지 풀린다).
 * 잠금을 못 잡으면 만들지 않고 false(다음 호출에 다시 본다).
 */
function triggerEnsure_(handler, create, useLock) {
  var lock = null;
  if (useLock) {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(1000)) return false;
  }
  try {
    var mine = function () { return ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === handler; }); };
    var ts = mine();
    if (!ts.length) { create(); ts = mine(); }
    if (ts.length > 1) {
      ts.sort(function (a, b) { var x = String(a.getUniqueId()), y = String(b.getUniqueId()); return x < y ? -1 : (x > y ? 1 : 0); });
      ts.slice(1).forEach(function (t) { try { ScriptApp.deleteTrigger(t); } catch (e) { /* 다른 실행이 이미 지웠다 */ } });
    }
    return true;
  } finally {
    if (lock) lock.releaseLock();
  }
}

/** 장부를 적용할 때 쓰는 단계 · 설정(필요할 때 한 번만 읽는다) */
function journalCtx_(mode, log) {
  var steps, meta;
  return {
    log: !!log,
    steps: function () { if (steps === undefined) { try { steps = stepsFast_(mode); } catch (e) { steps = null; } } return steps; },
    meta: function () { if (meta === undefined) { try { meta = metaFast_(mode); } catch (e) { meta = null; } } return meta; }
  };
}

/**
 * 변경 한 줄을 진행 상태(st = { checks, notes, dates, ownerSet })에 적용한다.
 * 예전 apiSetChecks · apiSetNote · apiSetChange · apiSetDate · apiSetCur 가 잠금 안에서 하던 것과 같다.
 * ctx.log 면 남길 이력 줄을 돌려준다(시트에 옮길 때만).
 */
function applyOp_(st, op, ctx) {
  var mode = op.mode, hist = [], changed = [], stepsUsed = null;
  var stamp = function (list) {
    if (!list) return;
    stepsUsed = list;
    try { changed = stampSteps_(st.checks, st.dates, list); } catch (e) { changed = []; }
  };
  RB_ACT = { at: new Date(op.at || Date.now()) };
  try {
    if (op.kind === 'checks') {
      var ks = Object.keys(op.changes || {});
      ks.forEach(function (k) { if (op.changes[k]) st.checks[k] = 1; else delete st.checks[k]; });
      var steps = ctx.steps();
      stamp(steps);
      if (ctx.log && steps) {
        ks.forEach(function (k) {
          var f = findItemByKey_(steps, k);
          if (f && f.it.chg) { var h = changeHist_(mode, op.id, op.meta, f.st, f.it, k, st); if (h) hist.push(h); }
        });
      }
    } else if (op.kind === 'note') {
      if (op.text) st.notes[op.stepId] = String(op.text).slice(0, 2000); else delete st.notes[op.stepId];
    } else if (op.kind === 'change') {
      var steps2 = ctx.steps() || [];
      var sst = steps2.filter(function (x) { return x.id === op.stepId; })[0];
      var it = sst && (sst.items || [])[Number(op.idx)];
      if (sst && it) {
        var key = itemKey_(sst, Number(op.idx)), c = st.checks, patch = op.patch || {};
        if (patch.dec !== undefined) {
          if (patch.dec === 'Y' || patch.dec === 'N') c['cy:' + key] = patch.dec; else delete c['cy:' + key];
          if (patch.dec !== 'Y') { delete c['cs:' + key]; delete st.notes['c:' + key]; }
        }
        if (patch.types !== undefined) {
          var t = (patch.types || []).map(function (x) { return String(x).trim(); }).filter(String).join(', ');
          if (t) c['cs:' + key] = t; else delete c['cs:' + key];
        }
        if (patch.memo !== undefined) {
          var m = String(patch.memo || '').slice(0, 1000);
          if (m.trim()) st.notes['c:' + key] = m; else delete st.notes['c:' + key];
        }
        stamp(steps2);
        if (ctx.log) { var h2 = changeHist_(mode, op.id, op.meta, sst, it, key, st); if (h2) hist.push(h2); }
      }
    } else if (op.kind === 'date') {
      var field = op.field, v = String(op.value || '').trim();
      var had = !!st.dates[field];
      if (v) st.dates[field] = v.slice(0, 10); else delete st.dates[field];
      var on = v ? true : (had ? false : null);
      var M = /^(req|dv):|^need$/.test(field) ? null : ctx.meta();
      if (M && on !== null && checkByDate_(st.checks, dateSlots_(M.steps, M.cfg, mode), field, on).length) stamp(M.steps);
    } else if (op.kind === 'cur') {
      st.checks._cur = op.cur;
    }
    if (ctx.log && changed.length && stepsUsed) {
      hist = stepLogRows_(mode, op.id, op.meta, changed, st.dates, stepsUsed, op.who).map(stepRowToHist_).concat(hist);
    }
  } finally {
    RB_ACT = null;
  }
  hist.forEach(function (h) { h.who = h.who || op.who; h.at = h.at || new Date(op.at); });
  return hist;
}

/** 시트(그 건 한 줄) + 아직 안 옮긴 장부 = 지금 보이는 상태. 잠금 없이 읽는다. */
function progView_(mode, id, list) {
  var p = readProgressOne_(mode, id);
  var rec = findProg_(p, id);
  var st = progState_(rec);
  var ctx = journalCtx_(mode, false);
  (list || journalList_()).forEach(function (x) {
    if (x.op.mode === mode && x.op.id === id) applyOp_(st, x.op, ctx);
  });
  return st;
}

/** 여러 건 지도(map[id] = { checks, notes, dates, ownerSet })에 아직 안 옮긴 장부를 겹친다. */
function journalOverlay_(map, mode, list) {
  list = (list || journalList_()).filter(function (x) { return x.op.mode === mode; });
  if (!list.length || !map) return 0;
  var ctx = journalCtx_(mode, false);
  list.forEach(function (x) {
    var o = map[x.op.id];
    if (!o) o = map[x.op.id] = { checks: {}, notes: {}, dates: {}, ownerSet: '' };
    o.checks = o.checks || {}; o.notes = o.notes || {}; o.dates = o.dates || {};
    applyOp_(o, x.op, ctx);
  });
  return list.length;
}

/**
 * 장부 저장 — 적고, 지금 상태를 돌려준다. 못 적으면(장부가 너무 쌓임 · 속성 오류) fallback()(예전 방식).
 * shape(st) 가 화면에 돌려줄 모양을 만든다.
 */
function journalSave_(op, shape, fallback) {
  requireEditor_();
  if (!op.id) throw new Error('건ID가 비어 있습니다.');
  op.mode = op.mode === 'sample' ? 'sample' : 'po';
  op.id = sampleProgIdFix_(op.id, op.mode);
  var list, all;
  try { all = PropertiesService.getScriptProperties().getProperties(); list = journalList_(all); } catch (e) { return fallback(); }
  if (list.length >= RB_J_MAX) return fallback();          // 총량(RB_J_BYTES)은 journalAdd_ 가 본다
  var key;
  try { key = journalAdd_(op, all); } catch (e) { key = false; }
  if (!key) return fallback();
  list.push({ key: key, op: op });
  return shape(progView_(op.mode, op.id, list));
}

/**
 * 장부를 시트로 옮긴다. 잠금은 부르는 쪽이 쥔다. 옮긴 줄 수를 돌려준다.
 * 진행 기록 탭을 직접 고치는 모든 곳이 고치기 전에 부른다.
 */
var RB_J_KINDS = { checks: 1, note: 1, change: 1, date: 1, cur: 1 };   // applyOp_ 가 아는 변경 종류
function drainJournal_() {
  var props = PropertiesService.getScriptProperties();
  var list = journalList_(props.getProperties());
  // 모르는 종류(새 판 코드가 적은 줄 등)는 옮기지도 지우지도 않고 남긴다 — 지우면 그 변경이 말없이 사라졌다
  list = list.filter(function (x) {
    if (RB_J_KINDS[x.op.kind]) return true;
    try { console.warn('장부 모르는 종류 — 남겨 둠(' + x.key + '): ' + x.op.kind); } catch (eW) { /* 넘어간다 */ }
    return false;
  });
  if (!list.length) return 0;
  var outer = deferVer_(), stAll = {}, gone = {};
  // 그 모드를 시트에 다 쓴 직후 그 모드 장부만 지운다 — 다음 모드에서 실패해도 이미 쓴 줄이 다시 옮겨지지 않게
  var dropKeys = function (L) {
    SpreadsheetApp.flush();               // 시트에 확실히 들어간 뒤에 장부를 지운다
    L.forEach(function (x) { gone[x.key] = 1; try { props.deleteProperty(x.key); } catch (e) { /* 다음에 다시 옮겨도 결과는 같다 */ } });
  };
  try {
    ['po', 'sample'].forEach(function (mode) {
      var L = list.filter(function (x) { return x.op.mode === mode; });
      if (!L.length) return;
      var p = readProgress_(mode);
      var ctx = journalCtx_(mode, true);
      var states = {}, metas = {}, last = {}, changed = {}, appends = [], appendIdx = {}, hist = [];
      stAll[mode] = states;
      L.forEach(function (x) {
        var op = x.op, id = op.id;
        var rec = findProg_(p, id);
        var st = states[id] || (states[id] = progState_(rec));
        try { hist = hist.concat(applyOp_(st, op, ctx)); } catch (e) { try { console.warn('장부 한 줄 적용 실패(' + x.key + '): ' + e.message); } catch (eW) { /* 넘어간다 */ } }   // 한 줄이 깨져도 나머지는 옮긴다
        metas[id] = op.meta || metas[id] || {};
        last[id] = op;
        var vals = progRowValues_(id, metas[id], st, op.who, new Date(op.at));
        if (rec) changed[rec.row] = vals;
        else if (appendIdx[id] !== undefined) appends[appendIdx[id]] = vals;
        else { appendIdx[id] = appends.length; appends.push(vals); }
      });
      // 이력부터(쓰기 전이라 마지막 행 찾기가 재계산을 기다리지 않는다) → 진행 줄 → 새 줄
      if (hist.length) { try { appendHistRows_(hist); } catch (e) { try { console.warn('장부 이력 쓰기 실패: ' + e.message); } catch (eW) { /* 넘어간다 */ } } }   // 이력 실패가 저장을 막지 않는다
      writeProgRows_(p, changed);
      if (appends.length) {
        var r0 = p.sh.getLastRow() + 1;
        ensureRows_(p.sh, r0 + appends.length - 1);
        p.sh.getRange(r0, 1, appends.length, RB.PROGRESS_HEAD.length).setValues(appends);
        try {
          var hn = cacheGet_(progHintKey_(mode)) || {};
          Object.keys(appendIdx).forEach(function (id) { hn[id] = r0 + appendIdx[id]; });
          cachePut_(progHintKey_(mode), hn, RB_TTL);
        } catch (e) { /* 넘어간다 */ }
      }
      // 첫 화면 캐시도 맞춘다(잠금 안이라 다른 저장과 겹치지 않는다)
      try {
        var ck = 'prog:v2:' + mode, cm = cacheGet_(ck);
        if (cm) {
          Object.keys(states).forEach(function (id) {
            var s = states[id];
            cm[id] = { checks: s.checks, notes: s.notes, dates: s.dates, ownerSet: s.ownerSet || '', updatedBy: last[id].who };
          });
          cachePut_(ck, cm, RB_TTL);
        }
      } catch (e) { /* 넘어간다 */ }
      dropKeys(L);
    });
    // 상신일 · 승인일 장부에 같이 적힌 '진행상태 올리기'(apiSetDate) — 잠금 안이라 여기서 한꺼번에(앞으로만 올린다)
    var bumps = {};
    list.forEach(function (x) {
      // 같은 장부 안에서 뒤에 그 날짜를 지웠거나 바꿨으면(상신일 지움 · 품의 취소) 올리지 않는다
      if (x.op.mode === 'po' && x.op.bump && x.op.meta) {
        var sB = (stAll.po || {})[x.op.id];
        if (sB && sB.dates && String(sB.dates[x.op.field] || '').slice(0, 10) !== String(x.op.value || '').slice(0, 10)) return;
        (bumps[x.op.bump] = bumps[x.op.bump] || []).push({ statusRow: 0, expect: x.op.meta });
      }
    });
    var bumped = 0;
    RB_STATE_ORDER.forEach(function (to) {
      if (!bumps[to]) return;
      try { bumped += bumpStatesLocked_(bumps[to], to); } catch (eB) { try { console.log('상태 올리기 실패: ' + eB.message); } catch (e5) { /* 넘어간다 */ } }
    });
    if (bumped) { cacheDrop_(rowsCacheKey_('po')); try { apRefreshSoon_(); } catch (eAp) { /* 20시에 */ } bumpVer_('r'); }
    bumpVer_('p');
  } finally {
    try { endVer_(outer); } catch (e) { /* 넘어간다 */ }
  }
  SpreadsheetApp.flush();                 // 시트에 확실히 들어간 뒤에 남은 장부(모드가 po · sample 이 아닌 줄)를 지운다
  list.forEach(function (x) { if (gone[x.key]) return; try { props.deleteProperty(x.key); } catch (e) { /* 다음에 다시 옮겨도 결과는 같다 */ } });
  return list.length;
}

/**
 * 트리거: 1분마다 — 장부(진행 기록 · 이력)를 시트로 옮긴다(장부가 비었으면 잠금도 잡지 않는다).
 * 캐시 채우기(첫 화면 · BOM · 재고)는 10분 트리거 warmCaches 로 나눴다 — 1분마다 하면 실행 시간 한도를 많이 먹었다.
 */
function journalDrain(e) {
  requireTriggerOrAdmin_(e, RB_J_TRIGGER);
  // 판 번호 표시(buildMark_)는 doGet 만 — 트리거는 배포 안 된 코드(HEAD)로 돌 수 있다
  var allKeys = PropertiesService.getScriptProperties().getKeys();
  // 데이터를 옮기는 정리 묶음(BOM 양식 · fix · 품의 되돌림)은 이 코드가 배포판과 같을 때만 — 올리기만 하고 배포 전인 코드가 시트를 고치지 않게
  var depOk = deployedBuildOk_();
  // BOM 새 양식(2026-10-17): 아직 안 옮겼으면 먼저(한 번) · 원가표는 BOM 저장 뒤 표시가 있으면 다시 쓴다
  if (depOk && allKeys.indexOf('rb.bomv3') < 0 && allKeys.indexOf('rb.bomv2') > -1 && !ss_().getSheetByName(RB_BOM_TAB)) { try { bomMigrateV3Run_(); } catch (eV3) { /* 넘어간다 */ } }      // 운영 양식(BOM3)으로 옮기기 — 아래 정리 묶음과 따로
  if (!depOk) { try { costTableRefresh_(); } catch (eC0) { try { console.log('원가표 실패: ' + eC0.message); } catch (eC1) { /* 넘어간다 */ } } }   // 배포 전 코드 — 원가표만(평소 길)
  else if (allKeys.indexOf('rb.bomv2') < 0) { try { bomMigrateV2_(); bomDropCache_([]); costTableRefresh_(true); } catch (eM) { try { console.log('BOM 새 양식 옮기기 실패: ' + eM.message); } catch (eM2) { /* 넘어간다 */ } } }
  else if (allKeys.indexOf('rb.fix1017') < 0) { try { RB_EDITOR_OK = true; var fx = bomFix1017_(); console.log('M0166AA1 정리 ' + fx); costTableRefresh_(true); } catch (eF) { try { PropertiesService.getScriptProperties().setProperty('rb.fix1017', 'fail ' + String(eF.message).slice(0, 200)); console.log('M0166AA1 정리 실패: ' + eF.message); } catch (eF2) { /* 넘어간다 */ } } }
  else if (allKeys.indexOf('rb.fix1019') < 0) { try { RB_EDITOR_OK = true; var fy = bomFix1019_(); console.log('품목 DB · BOM 정리 ' + fy); costTableRefresh_(true); } catch (eY) { try { PropertiesService.getScriptProperties().setProperty('rb.fix1019', 'fail ' + String(eY.message).slice(0, 200)); console.log('품목 DB · BOM 정리 실패: ' + eY.message); } catch (eY2) { /* 넘어간다 */ } } }
  else if (allKeys.indexOf('rb.fix1019b') < 0) { try { RB_EDITOR_OK = true; var fz = bomFix1019b_(); console.log('X BOM 삭제 ' + fz); costTableRefresh_(true); } catch (eZ) { try { PropertiesService.getScriptProperties().setProperty('rb.fix1019b', 'fail ' + String(eZ.message).slice(0, 200)); console.log('X BOM 삭제 실패: ' + eZ.message); } catch (eZ2) { /* 넘어간다 */ } } }
  else if (allKeys.indexOf('rb.fix1019c') < 0) { try { RB_EDITOR_OK = true; var fw = bomFix1019c_(); console.log('미품 자재 이름 · 공용 ' + fw); costTableRefresh_(true); } catch (eW) { try { PropertiesService.getScriptProperties().setProperty('rb.fix1019c', 'fail ' + String(eW.message).slice(0, 200)); console.log('미품 자재 정리 실패: ' + eW.message); } catch (eW2) { /* 넘어간다 */ } } }
  else if (allKeys.indexOf('rb.fix1019d') < 0) { try { RB_EDITOR_OK = true; var fv = bomFix1019d_(); console.log('스쿠알란 용기 정리 ' + fv); costTableRefresh_(true); } catch (eV) { try { PropertiesService.getScriptProperties().setProperty('rb.fix1019d', 'fail ' + String(eV.message).slice(0, 200)); console.log('스쿠알란 용기 정리 실패: ' + eV.message); } catch (eV2) { /* 넘어간다 */ } } }
  else if (allKeys.indexOf('rb.fix1019e') < 0) { try { RB_EDITOR_OK = true; var fu = bomFix1019e_(); console.log('공백 칸 정리 ' + fu); costTableRefresh_(true); } catch (eU) { try { PropertiesService.getScriptProperties().setProperty('rb.fix1019e', 'fail ' + String(eU.message).slice(0, 200)); } catch (eU2) { /* 넘어간다 */ } } }
  else if (allKeys.indexOf('rb.fix1019f') < 0) { try { RB_EDITOR_OK = true; var ft = bomFix1019f_(); console.log('일본 6품목 정리 ' + ft); costTableRefresh_(true); } catch (eT) { try { PropertiesService.getScriptProperties().setProperty('rb.fix1019f', 'fail ' + String(eT.message).slice(0, 200)); } catch (eT2) { /* 넘어간다 */ } } }
  else if (allKeys.indexOf('rb.fix1019g') < 0) { try { RB_EDITOR_OK = true; var fs = bomFix1019g_(); console.log('레티날 덧방 라벨 · 스쿠알란 일본 이름 ' + fs); costTableRefresh_(true); } catch (eS) { try { PropertiesService.getScriptProperties().setProperty('rb.fix1019g', 'fail ' + String(eS.message).slice(0, 200)); } catch (eS2) { /* 넘어간다 */ } } }
  else if (allKeys.indexOf('rb.fix1019h') < 0) { try { RB_EDITOR_OK = true; var fr = bomFix1019h_(); console.log('레티날 덧방 BL7 되살림 ' + fr); costTableRefresh_(true); } catch (eR) { try { PropertiesService.getScriptProperties().setProperty('rb.fix1019h', 'fail ' + String(eR.message).slice(0, 200)); } catch (eR2) { /* 넘어간다 */ } } }
  else if (allKeys.indexOf('rb.fix1019i') < 0) { try { RB_EDITOR_OK = true; var fq = bomFix1019i_(); console.log('레티날 덧방 BL7 삭제 ' + fq); costTableRefresh_(true); } catch (eQ) { try { PropertiesService.getScriptProperties().setProperty('rb.fix1019i', 'fail ' + String(eQ.message).slice(0, 200)); } catch (eQ2) { /* 넘어간다 */ } } }
  else if (allKeys.indexOf('rb.undoDoc1019') < 0) { try { RB_EDITOR_OK = true; var fd = undoDoc1019_(); PropertiesService.getScriptProperties().setProperty('rb.undoDoc1019', 'done ' + new Date().toISOString() + ' ' + fd); console.log('품의 되돌림 ' + fd); } catch (eD) { try { PropertiesService.getScriptProperties().setProperty('rb.undoDoc1019', 'fail ' + String(eD.message).slice(0, 200)); } catch (eD2) { /* 넘어간다 */ } } }
  else if (allKeys.indexOf('rb.undoDoc1019b') < 0) { try { RB_EDITOR_OK = true; var fd = undoDoc1019_(); PropertiesService.getScriptProperties().setProperty('rb.undoDoc1019b', 'done ' + new Date().toISOString() + ' ' + fd); console.log('품의 되돌림 ' + fd); } catch (eD) { try { PropertiesService.getScriptProperties().setProperty('rb.undoDoc1019b', 'fail ' + String(eD.message).slice(0, 200)); } catch (eD2) { /* 넘어간다 */ } } }
  else if (allKeys.indexOf('rb.redoDoc1019') < 0) { try { RB_EDITOR_OK = true; var fe = redoDoc1019_(); PropertiesService.getScriptProperties().setProperty('rb.redoDoc1019', 'done ' + new Date().toISOString() + ' ' + fe); } catch (eE) { try { PropertiesService.getScriptProperties().setProperty('rb.redoDoc1019', 'fail ' + String(eE.message).slice(0, 200)); } catch (eE2) { /* 넘어간다 */ } } }
  else if (allKeys.indexOf('rb.fix1020po') < 0) { try { RB_EDITOR_OK = true; var f20 = dataFix1020po_(); PropertiesService.getScriptProperties().setProperty('rb.fix1020po', 'done ' + new Date().toISOString() + ' ' + f20); console.log('발주 · 지급 줄 정리 ' + f20); } catch (e20) { try { PropertiesService.getScriptProperties().setProperty('rb.fix1020po', 'fail ' + String(e20 && e20.message).slice(0, 200)); } catch (e21) { /* 넘어간다 */ } } }
  else if (allKeys.indexOf('rb.compact1020') < 0) { try { RB_EDITOR_OK = true; var fc = bomCompactAll_(); PropertiesService.getScriptProperties().setProperty('rb.compact1020', 'done ' + new Date().toISOString() + ' ' + fc); console.log('BOM 빈 줄 지움 ' + fc); costTableRefresh_(true); } catch (eCp) { try { PropertiesService.getScriptProperties().setProperty('rb.compact1020', 'fail ' + String(eCp.message).slice(0, 200)); } catch (eCp2) { /* 넘어간다 */ } } }
  else if (allKeys.indexOf('rb.hfseed1020') < 0) { try { var fh = hfSeedFromSheet_(); PropertiesService.getScriptProperties().setProperty('rb.hfseed1020', 'done ' + new Date().toISOString() + ' ' + String(fh).slice(0, 300)); console.log('핸들링피 설정 읽음 ' + fh); } catch (eHs) { try { PropertiesService.getScriptProperties().setProperty('rb.hfseed1020', 'fail ' + String(eHs.message).slice(0, 200)); } catch (eHs2) { /* 넘어간다 */ } } }
  else if (allKeys.indexOf('rb.hfnone1020') < 0) { try { var fn = hfDropNone_(), fz = hfFreezeNone_(); PropertiesService.getScriptProperties().setProperty('rb.hfnone1020', 'done ' + new Date().toISOString() + ' 설정 지움 ' + fn + ' · 배송비 값으로 ' + fz + '줄'); costTableRefresh_(true); } catch (eHn) { try { PropertiesService.getScriptProperties().setProperty('rb.hfnone1020', 'fail ' + String(eHn.message).slice(0, 200)); } catch (eHn2) { /* 넘어간다 */ } } }
  else if (allKeys.indexOf('rb.regmiss1020') < 0) { try { RB_EDITOR_OK = true; var fm = bomRegMissingAll_(); PropertiesService.getScriptProperties().setProperty('rb.regmiss1020', 'done ' + new Date().toISOString() + ' ' + fm.length + ' ' + fm.join(',').slice(0, 300)); } catch (eRm) { try { PropertiesService.getScriptProperties().setProperty('rb.regmiss1020', 'fail ' + String(eRm.message).slice(0, 200)); } catch (eRm2) { /* 넘어간다 */ } } }
  else if (allKeys.indexOf('rb.vunify1020') < 0) { try { RB_EDITOR_OK = true; var fv2 = vendorUnify_(); PropertiesService.getScriptProperties().setProperty('rb.vunify1020', 'done ' + new Date().toISOString() + ' ' + fv2); costTableRefresh_(true); } catch (eVu) { try { PropertiesService.getScriptProperties().setProperty('rb.vunify1020', 'fail ' + String(eVu.message).slice(0, 200)); } catch (eVu2) { /* 넘어간다 */ } } }
  else if (allKeys.indexOf('rb.sdate1020') < 0) { try { RB_EDITOR_OK = true; var fsd = sampleDateFix_(); PropertiesService.getScriptProperties().setProperty('rb.sdate1020', 'done ' + new Date().toISOString() + ' ' + fsd); } catch (eSd) { try { PropertiesService.getScriptProperties().setProperty('rb.sdate1020', 'fail ' + String(eSd.message).slice(0, 200)); } catch (eSd2) { /* 넘어간다 */ } } }
  else if (allKeys.indexOf('rb.price1020') < 0) { try { RB_EDITOR_OK = true; var fp = itemDbPriceSync_(null); PropertiesService.getScriptProperties().setProperty('rb.price1020', 'done ' + new Date().toISOString() + ' ' + fp); console.log('품목 DB 단가 채움 ' + fp); } catch (ePr) { try { PropertiesService.getScriptProperties().setProperty('rb.price1020', 'fail ' + String(ePr.message).slice(0, 200)); } catch (ePr2) { /* 넘어간다 */ } } }
  else if (allKeys.indexOf('rb.ordfix1021') < 0) { try { var fo = ordRestore1021_(); PropertiesService.getScriptProperties().setProperty('rb.ordfix1021', 'done ' + new Date().toISOString() + ' ' + fo); } catch (eOf) { try { PropertiesService.getScriptProperties().setProperty('rb.ordfix1021', 'fail ' + String(eOf.message).slice(0, 200)); } catch (eOf2) { /* 넘어간다 */ } } }
  else if (allKeys.indexOf('rb.ftest1021') < 0) { try { var ft2 = ordFilterTest1021_(); PropertiesService.getScriptProperties().setProperty('rb.ftest1021', 'done ' + new Date().toISOString() + ' ' + ft2); } catch (eFt) { try { PropertiesService.getScriptProperties().setProperty('rb.ftest1021', 'fail ' + String(eFt.message).slice(0, 200)); } catch (eFt2) { /* 넘어간다 */ } } }
  else if (RB_FIX_BATCHES.some(function (b) { return allKeys.indexOf(b.key) < 0; })) { try { RB_EDITOR_OK = true; bomFixBatchNext_(); costTableRefresh_(true); } catch (eB) { try { console.log('BOM 정리 묶음 실패: ' + eB.message); } catch (eB2) { /* 넘어간다 */ } } }
  else { try { costTableRefresh_(); } catch (eC) { try { console.log('원가표 실패: ' + eC.message); } catch (eC2) { /* 넘어간다 */ } } }
  try { bomLaterDrain_(); } catch (eBl) { try { console.log('BOM 미룬 일 실패: ' + eBl.message); } catch (eBl2) { /* 넘어간다 */ } }
  try { ordFilterOff_(); } catch (eFo) { try { console.log('발주 DB 필터 풀기 실패: ' + eFo.message); } catch (eFo2) { /* 넘어간다 */ } }
  try { if (allKeys.indexOf(RB_ORDG_PROP) > -1) ordGuardCheck_(); } catch (eOg) { try { console.log('발주일 지킴 실패: ' + eOg.message); } catch (eOg2) { /* 넘어간다 */ } }
  var keys = allKeys.filter(function (k) { return k.indexOf(RB_J) === 0; });
  if (allKeys.some(function (k) { return k.indexOf(RB_H) === 0; })) {
    var lockH = LockService.getScriptLock();
    if (lockH.tryLock(60000)) {
      var tH = Date.now(), nH = 0;
      try { nH = drainHist_(); } catch (eH) { try { console.log('이력 장부 옮기기 실패: ' + eH.message); } catch (e3) { /* 넘어간다 */ } } finally { lockH.releaseLock(); }
      try { console.log('drainHist ' + nH + '줄 ' + (Date.now() - tH) + 'ms'); } catch (e4) { /* 넘어간다 */ }
    }
  }
  if (keys.length) {
    var lock = LockService.getScriptLock();
    if (lock.tryLock(60000)) {
      var t0 = Date.now(), n = 0;
      try { n = drainJournal_(); } finally { lock.releaseLock(); }
      try { console.log('journalDrain ' + n + '줄 ' + (Date.now() - t0) + 'ms'); } catch (e2) { /* 넘어간다 */ }
    }
  }
}

/**
 * 트리거: 10분마다
 *  ① 발주 첫 화면 캐시가 비어 있으면 미리 채워 둔다. 지급 줄 저장 · 입고 · 발주 수정 때마다 목록 캐시를 버리고,
 *     6시간 쓰지 않으면 캐시가 사라져서, 다음에 여는 사람이 '최신 값을 불러오는 중'으로 5~8초 기다렸다.
 *  ② BOM · 재고시트 입고예정 캐시도 채운다.
 *  ③ 두 트리거가 겹쳐 만들어졌으면 하나만 남긴다.
 */
function warmCaches(e) {
  requireTriggerOrAdmin_(e, RB_W_TRIGGER);
  // 시트를 고치는 정리는 이 코드(HEAD)가 배포판과 같을 때만 — 다르면 캐시 채우기(읽기)만 한다
  var depOk = deployedBuildOk_();
  if (depOk) RB_EDITOR_OK = true;                         // 트리거 · 관리자 — 첫 화면 정리(진행 기록 옮기기 등)까지 한다
  try { CacheService.getScriptCache().remove('j:trig2'); journalTriggerEnsure_(); } catch (eT) { try { console.warn('트리거 확인 실패: ' + eT.message); } catch (e0) { /* 넘어간다 */ } }
  warmBoot_();
  if (depOk) {
    try { var shS = sheet_(RB.SAMPLE_TAB); if (shS) { sampleIdsEnsure_(shS); sampleProgMergeSplits_(); } } catch (eS) { /* 다음에 */ }   // 시트에 손으로 적은 샘플 줄 · 빈 줄 정리(캐시가 살아 있어도)
    try { statusIdsEnsure_(statusSheet_()); } catch (eO) { /* 다음에 */ }
    try { bomNameSync_(); } catch (eN) { /* 다음에 */ }        // BOM 품목명을 품목 DB 이름으로(10분마다 — 다른 게 없으면 읽기만)
    try { bomStampIds_(); } catch (eI) { /* 다음에 */ }
  }
  if (typeof warmBom_ === 'function') warmBom_();
  if (typeof warmStock_ === 'function') warmStock_();     // 재고시트 입고예정(25분마다)
}

/** 첫 화면 캐시(설정 · 발주 목록 · 진행 기록)가 비었으면 시트를 읽어 채운다. 있는지 보기는 캐시 칸 수만(풀지 않는다). */
function warmBoot_() {
  var mode = 'po';
  try {
    var c = CacheService.getScriptCache();
    var meta = cacheGet_(metaKey_(mode));
    if (meta && meta.cfg) {
      var have = c.getAll([rowsCacheKey_(mode, meta.cfg) + ':n', 'prog:v2:' + mode + ':n']);
      if (Object.keys(have).length === 2) return;
    }
    var t0 = Date.now();
    apiBootstrap(false, mode);
    console.log('warmBoot ' + mode + ' ' + (Date.now() - t0) + 'ms');
  } catch (err) { try { console.log('warmBoot 실패: ' + err.message); } catch (e3) { /* 넘어간다 */ } }
}
