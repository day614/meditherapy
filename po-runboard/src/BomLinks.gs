/**
 * ============================================================
 * 품목 링크 (_실행판_품목링크) — BOM 보기에서 품목마다 포장물 사양서 같은 문서 링크를 걸어 둔다
 * ------------------------------------------------------------
 * 한 줄 = 품목코드 하나의 링크 하나. BOM 보기(발주건에서 열든 메인에서 열든 같은 화면) 위쪽에 단추로 보인다.
 * 그 코드에 링크가 없으면 같은 품목의 다른 버전(H0080AA1 ↔ AA2) 링크를 '이전 버전'으로 보여 준다.
 * ============================================================
 */
var RB_BLINK = { TAB: '_실행판_품목링크', HEAD: ['품목코드', '이름', '링크', '등록일', '등록자'] };

function bomLinkSheet_() { return tab_(RB_BLINK.TAB, RB_BLINK.HEAD); }

/** 코드 → [{ label, url, code, other }] */
function bomLinksOf_(code) {
  code = itemCodeKey_(code);
  if (!code) return [];
  var sh = sheet_(RB_BLINK.TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  // 다른 버전 링크는 채번 규칙 코드(H0080AA1 · HP0031BO1 · HX0002AA3)끼리만 — 규칙 밖 코드는 앞부분이 너무 짧아 엉뚱한 품목이 걸렸다
  var stem = /^[A-Z][XP]?\d{4}[A-Z]{2}\d+$/.test(code) ? code.replace(/\d+$/, '') : '';
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues(), mine = [], others = [];
  v.forEach(function (r) {
    var c = itemCodeKey_(r[0]), url = str_(r[2]);
    if (!c || !/^https?:\/\//i.test(url)) return;
    var x = { label: str_(r[1]) || '링크', url: url, code: c };
    if (c === code) mine.push(x);
    else if (stem && c.replace(/\d+$/, '') === stem && stem !== c) { x.other = 1; others.push(x); }
  });
  return mine.length ? mine : others;
}

/** 화면: 링크 추가 */
function apiBomLinkAdd(code, label, url) {
  requireEditor_();
  code = itemCodeKey_(code);
  url = str_(url);
  label = str_(label).slice(0, 40) || '포장물 사양서';
  if (!code) throw new Error('품목코드가 비었습니다.');
  if (!/^https?:\/\/\S+$/i.test(url)) throw new Error('https:// 로 시작하는 주소를 넣어 주세요.');
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  try {
    var sh = bomLinkSheet_();
    ensureRows_(sh, sh.getLastRow() + 1);
    sh.getRange(sh.getLastRow() + 1, 1, 1, RB_BLINK.HEAD.length).setValues([[asText_(code), asText_(label), asText_(url.slice(0, 2000)), new Date(), me_()]]);
  } finally { lock.releaseLock(); }
  try { appendHist_([{ kind: '품목 링크', code: code, item: label, before: '', after: url, where: RB_BLINK.TAB }]); } catch (e) { /* 넘어간다 */ }
  return { links: bomLinksOf_(code) };
}

/** 화면: 링크 지우기(그 코드 · 그 주소 줄) */
function apiBomLinkDel(code, url) {
  requireEditor_();
  code = itemCodeKey_(code);
  url = str_(url);
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  var n = 0;
  try {
    var sh = sheet_(RB_BLINK.TAB);
    if (sh && sh.getLastRow() >= 2) {
      var v = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
      for (var i = v.length - 1; i >= 0; i--) {
        if (itemCodeKey_(v[i][0]) === code && str_(v[i][2]) === url) { sh.deleteRow(i + 2); n++; }
      }
    }
  } finally { lock.releaseLock(); }
  if (n) { try { appendHist_([{ kind: '품목 링크', code: code, item: '링크 지움', before: url, after: '', where: RB_BLINK.TAB }]); } catch (e) { /* 넘어간다 */ } }
  return { links: bomLinksOf_(code), n: n };
}

/**
 * 화면(건 상세 단계 항목 '포장물 사양서'): 그 발주 품목의 문서 링크. 그 코드에 링크가 없으면(자재 · 사급 발주)
 * 그 자재를 쓰는 제품 BOM 의 링크를 보여 준다(제품 코드를 함께 표시).
 */
function apiItemLinks(code) {
  code = itemCodeKey_(code);
  if (!code) return [];
  var own = bomLinksOf_(code);
  if (own.length) return own;
  var out = [];
  try {
    bomIndex_().forEach(function (x) {
      if (out.length >= 6) return;
      var mats = Array.isArray(x.mats) ? x.mats : String(x.mats || '').split(' ');
      if (mats.indexOf(code) < 0) return;
      bomLinksOf_(x.code).forEach(function (l) { if (!l.other) { l.other = 1; l.from = x.code; out.push(l); } });
    });
  } catch (e) { /* 링크 없이 */ }
  return out;
}
