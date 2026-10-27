/**
 * ============================================================
 * 주간보고(2026-10-19) — 담당자가 정한 양식(1~5) 그대로, 실행판 기록으로 채울 수 있는 칸만 채운다.
 * 기간 기본 = 지난 금요일 ~ 이번 목요일(금요일 오전 보고). 다음 주 = 보고일(금) ~ 다음 목요일.
 * 화면은 받은 표를 그대로 그리고 [엑셀 받기](ExcelJS)로 내려받는다 — 실행판에 없는 칸(노란 줄)은 담당자가 엑셀에서 직접 쓴다.
 * 샘플 드롭 · 탈락은 보고서에 넣지 않는다(담당자 10/19).
 * ============================================================
 */
var RB_WK_TEAM = [['Day', '구매업무 총괄 및 주요 일정·이슈 관리'], ['Jayden', '담당 제조사별 신제품 및 기존제품 구매 진행'],
  ['Nova', '담당 제조사별 신제품 및 기존제품 구매 진행'], ['Becca', '중국 부자재 및 GWP 소싱·구매 진행']];
var RB_WK_NAME = { day: 'Day', jayden: 'Jayden', nova: 'Nova', becca: 'Becca', '데이': 'Day', '제이든': 'Jayden', '노바': 'Nova', '베카': 'Becca' };

function wkDay_(x) {
  if (Object.prototype.toString.call(x) === '[object Date]') return isNaN(x.getTime()) ? null : new Date(x.getFullYear(), x.getMonth(), x.getDate());
  var m = String(x == null ? '' : x).trim().match(/^(\d{2,4})[-\/.]\s*(\d{1,2})[-\/.]\s*(\d{1,2})/);
  if (!m) return null;
  var y = Number(m[1]); if (y < 100) y += 2000;
  var d = new Date(y, Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}
function wkKey_(x) { var d = wkDay_(x); return d ? String(d.getTime() + 1e13) : str_(x); }
function wkMd_(x) { var d = wkDay_(x); return d ? ('0' + (d.getMonth() + 1)).slice(-2) + '/' + ('0' + d.getDate()).slice(-2) : str_(x); }
function wkWho_(x) {
  var s = str_(x), k = s.split('@')[0].trim().toLowerCase();
  return RB_WK_NAME[k] || RB_WK_NAME[s] || (s ? s.split('@')[0] : '-');
}
function wkQty_(x) { var n = Number(String(x == null ? '' : x).replace(/,/g, '')); return String(x).trim() !== '' && isFinite(n) ? Math.round(n).toLocaleString('en-US') : str_(x); }
function wkTab_(name) {
  var sh = sheet_(name); if (!sh || sh.getLastRow() < 2) return { i: {}, rows: [] };
  var v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues(), i = {};
  v[0].forEach(function (h, k) { h = str_(h); if (h && !(h in i)) i[h] = k; });
  return { i: i, rows: v.slice(1) };
}

/** 화면: 주간보고 데이터. from · to = 'yyyy-MM-dd'(없으면 지난 금 ~ 이번 목) */
function apiWeeklyReport(from, to) {
  var now = new Date(), t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var d1 = wkDay_(to), d0 = wkDay_(from);
  if (!d1) { d1 = new Date(t0); d1.setDate(d1.getDate() - 1); while (d1.getDay() !== 4) d1.setDate(d1.getDate() - 1); }   // 어제까지 중 가장 최근 목요일
  if (!d0) { d0 = new Date(d1); d0.setDate(d0.getDate() - 6); }
  var TODAY = new Date(d1); TODAY.setDate(TODAY.getDate() + 1);
  var n0 = new Date(TODAY), n1 = new Date(TODAY); n1.setDate(n1.getDate() + 6);
  var inwk = function (x) { var d = wkDay_(x); return !!d && d >= d0 && d <= d1; };
  var innx = function (x) { var d = wkDay_(x); return !!d && d >= n0 && d <= n1; };
  var ymd = function (d) { return Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd'); };

  var P = wkTab_(RB.STATUS_TAB), pi = P.i, PO = P.rows.filter(function (r) { return str_(r[pi['품목명']]); });
  var poById = {}; PO.forEach(function (r) { var k = str_(r[pi['실행판ID']]).toLowerCase(); if (k) poById[k] = r; });
  var H = wkTab_(RB.T_AUDIT), hi = H.i;
  var SM = wkTab_(RB.SAMPLE_TAB), si = SM.i, SMP = SM.rows.filter(function (r) { return str_(r[si['품목명']]); });
  var Y = wkTab_(RB_LINE.TAB), yi = Y.i, PAY = Y.rows;
  var G = wkTab_(RB.T_SPROGRESS), gi = G.i;
  var g = function (r, i, k) { return i[k] == null ? '' : r[i[k]]; };
  var isnew = function (p) { var b = str_(g(p, pi, '발주차수')).replace(/\D/g, ''); return b === '' || b === '1'; };
  var poOfHist = function (r) {
    var p = poById[str_(g(r, hi, '실행판ID')).split('|')[0].toLowerCase()] || poById[str_(g(r, hi, '실행판ID')).toLowerCase()];
    if (p) return p;
    var doc = str_(g(r, hi, '품의번호')), code = str_(g(r, hi, '품목코드'));
    return PO.filter(function (x) { return str_(x[pi['품의번호']]) === doc && str_(x[pi['품목코드']]) === code; })[0] || null;
  };

  // 샘플 진행 메모 — 시트 줄과는 프로젝트(진행 기록 건ID 'p:프로젝트ID')와 업체 열쇠(띄어쓰기 · 괄호 빼고 소문자 — 화면 sampleVKey 와 같게)로 잇는다.
  // 예전엔 품목명 · 업체명 글자 그대로 비교해 GF테크 · 중국(옥시메이) 같은 업체, 이름을 바꾼 프로젝트의 메모가 빠졌다.
  var vk = function (v) { return String(v || '').replace(/[\s()]/g, '').toLowerCase().slice(0, 60); };
  var pjOf = function (r) { var pid = si['프로젝트ID'] == null ? '' : str_(r[si['프로젝트ID']]); return pid ? 'p:' + pid : 'n:' + str_(r[si['품목명']]); };
  var vName = {}, pjName = {}; SMP.forEach(function (r) { var v = str_(r[si['업체명']]) || '미정'; vName[pjOf(r) + '|' + vk(v)] = v; pjName[pjOf(r)] = str_(r[si['품목명']]); });
  var MEMO = [], PDONE = {}, PPICK = {}, WAITS = [], QTS = [];
  G.rows.forEach(function (r) {
    var gid = str_(g(r, gi, '건ID')), pj = /^p:n:/.test(gid) || !gid ? 'n:' + str_(g(r, gi, '품목명')) : gid;
    var ck = {}; try { ck = JSON.parse(str_(g(r, gi, '진행JSON')) || '{}'); } catch (e0) { ck = {}; }
    if (ck && ck._done) PDONE[pj] = 1;
    var m = {}; try { m = JSON.parse(str_(g(r, gi, '메모JSON')) || '{}'); } catch (e) { m = {}; }
    Object.keys(m).forEach(function (k) {
      if (k.indexOf('tl:') !== 0) return;
      var L = []; try { L = JSON.parse(m[k]); } catch (e2) { L = []; }
      var vkey = vk(k.slice(3));
      L.forEach(function (e) { MEMO.push({ at: str_(e.at), pj: pj, proj: pjName[pj] || str_(g(r, gi, '품목명')), vk: vkey, vendor: vName[pj + '|' + vkey] || k.slice(3), text: str_(e.text), st: str_(e.st), due: str_(e.due), who: wkWho_(e.who), wait: str_(e.wait), waitDone: str_(e.waitDone) }); });
    });
    // 견적 비교(구매 소싱 관리 [견적 비교] — 테스트판 · 개인판에만 있음): 업체 · 구성별 단가
    var QJ = {}; try { QJ = JSON.parse(m['i:qt'] || '{}'); } catch (eQ) { QJ = {}; }
    Object.keys(QJ || {}).forEach(function (qk) {
      var q = QJ[qk] || {}; if (!str_(q.price)) return;
      var ci = qk.indexOf('::'), mk = ci > 0 ? qk.slice(0, ci) : str_(q.make), qv = ci > 0 ? qk.slice(ci + 2) : qk;
      QTS.push({ at: str_(q._at).slice(0, 10), pj: pj, proj: pjName[pj] || str_(g(r, gi, '품목명')), vk: qv, vendor: str_(q.name) || vName[pj + '|' + qv] || qv, make: mk, price: str_(q.price), cur: str_(q.cur) || 'KRW', qty: str_(q.qty), by: wkWho_(q._by) });
    });
    // 프로젝트 비고의 역요청 대기(업체와 상관없는 것)
    var PM = []; try { PM = JSON.parse(m.pmemo || '[]'); } catch (eP) { PM = []; }
    (Array.isArray(PM) ? PM : []).forEach(function (x) { if (x && x.wait) WAITS.push({ at: str_(x.at), pj: pj, proj: pjName[pj] || str_(g(r, gi, '품목명')), vendor: '', text: str_(x.t), wait: str_(x.wait), due: str_(x.due), waitDone: str_(x.waitDone), who: wkWho_(x.by) }); });
  });
  var memoOf = function (r) { var pj = pjOf(r), v = vk(str_(r[si['업체명']]) || '미정'); return MEMO.filter(function (m) { return m.pj === pj && m.vk === v; }); };
  // 업체별 마지막 회차 · 프로젝트 채택 여부(받았는데 안 정한 샘플 · 기한 지난 샘플은 업체 단위로 본다)
  var lastOf = {}; SMP.forEach(function (r) { var k = pjOf(r) + '|' + vk(str_(r[si['업체명']]) || '미정'), q = wkDay_(r[si['요청일']]); if (!lastOf[k] || (q && (!lastOf[k].q || q >= lastOf[k].q))) lastOf[k] = { r: r, q: q }; if (str_(r[si['상태']]) === '채택') PPICK[pjOf(r)] = 1; });
  var isLastQ = function (r) { var x = lastOf[pjOf(r) + '|' + vk(str_(r[si['업체명']]) || '미정')]; return !!x && x.r === r; };
  var projLive = function (r) { return !PDONE[pjOf(r)]; };
  var drop = function (m) { return m.st === '드롭' || m.st === '탈락' || m.text.indexOf('드롭') > -1; };
  var memoWk = MEMO.filter(function (m) { return inwk(m.at) && !drop(m); });
  var QUOTE = /견적|단가|MOQ|가격|위안|\$|USD|CNY|\d+\s*원|네고|인상|인하|조건|결제|선금|리드타임/;
  var PRICE = /([\d,.]+\s*(원|위안|元|USD|\$|CNY|RMB))|((원|위안|\$|USD)\s*[\d,.]+)/;
  var dmd = function (s) { return s ? s.slice(5).replace('-', '/') : ''; };
  var byAt = function (k, i) { return function (a, b) { var x = wkKey_(a[i[k]]), y = wkKey_(b[i[k]]); return x < y ? -1 : x > y ? 1 : 0; }; };
  var poDesc = function (x) { return str_(x[pi['발주차수']]) + ' · ' + wkQty_(x[pi['발주수량']]) + '개 · ' + str_(x[pi['진행상태']]); };

  // ----- 1. 이번 주 -----
  var S_OFF = function (r) { return /드롭|탈락/.test(str_(r[si['상태']])); };
  var S_REQ = SMP.filter(function (r) { return inwk(r[si['요청일']]); }).sort(byAt('요청일', si));
  // 드롭 · 탈락 사유: 그 업체 진행 메모 중 드롭/탈락 메모(마지막) → 없으면 시트 비고의 '… 드롭 — 사유'
  var offWhy = function (r) {
    var L = memoOf(r).filter(function (m) { return m.st === '드롭' || m.st === '탈락' || /드롭|탈락/.test(m.text); });
    var t = L.length ? L[L.length - 1].text : '';
    if (!t) { var nt = str_(r[si['비고/피드백']]).split(' / ').filter(function (x) { return /드롭|탈락/.test(x); }); t = nt.length ? nt[nt.length - 1] : ''; }
    t = t.replace(/^\d{2}\.\d{2}\s*/, '').replace(/^(샘플\s*)?(드롭|탈락)\s*(취소)?\s*[—\-:·]?\s*/, '').replace(/^(샘플\s*)?(드롭|탈락)$/, '').trim();
    return t || '사유 안 적힘';
  };
  // 드롭 · 탈락한 날: 그 업체 드롭/탈락 메모 → 없으면 시트 비고의 'MM.DD 드롭 —' · 'MM.DD 탈락 —' 표시(프로젝트 드롭 · 채택 뒤 탈락 · 샘플 드롭은 메모 없이 비고에만 남는다)
  var offAt = function (r) {
    var L = memoOf(r).filter(function (m) { return m.st === '드롭' || m.st === '탈락'; });
    if (L.length) return L[L.length - 1].at;
    var tg = str_(r[si['비고/피드백']]).split(' / ').filter(function (x) { return /^\d{2}\.\d{2}\s*(드롭|탈락)/.test(x.trim()); });
    if (!tg.length) return '';
    var mm = tg[tg.length - 1].trim().match(/^(\d{2})\.(\d{2})/), y = d1.getFullYear();
    var dt = new Date(y, Number(mm[1]) - 1, Number(mm[2]));
    if (dt > TODAY) dt = new Date(y - 1, Number(mm[1]) - 1, Number(mm[2]));      // 연말 · 연초 경계
    return ymd(dt);
  };
  var stTxt = function (r) { var st = str_(r[si['상태']]) || '진행중'; return S_OFF(r) ? st + ' — ' + offWhy(r) : st; };
  // 이 주 전에 요청했지만 아직 진행 중이고 기한(전달예정)이 이 주 시작 이후인 샘플 — 기한까지 매주 보이게
  var S_OPEN = SMP.filter(function (r) {
    var q = wkDay_(r[si['요청일']]);
    if (!q || q >= d0) return false;
    if (S_OFF(r)) return inwk(offAt(r));                   // 앞 주 요청인데 이번 주에 드롭 · 탈락된 것(사유와 같이)
    if (str_(r[si['상태']]) !== '진행중' || str_(r[si['전달일']])) return false;
    var d = wkDay_(r[si['전달예정일']]);
    return !d || d >= d0;
  }).sort(byAt('전달예정일', si));
  var S_RCV = SMP.filter(function (r) { return inwk(r[si['전달일']]); }).sort(byAt('전달일', si));
  var S_SPEC = memoWk.filter(function (m) { return m.text && !QUOTE.test(m.text); }).sort(function (a, b) { return a.at < b.at ? -1 : 1; });
  var inbound = function (pred) {
    var out = [];
    PAY.forEach(function (r) {
      if (str_(r[yi['종류']]) !== '입고' || !inwk(r[yi['입고일']])) return;
      var p = poById[str_(r[yi['실행판ID']]).toLowerCase()]; if (p && pred(p)) out.push([r, p]);
    });
    return out.sort(function (a, b) { return wkDay_(a[0][yi['입고일']]) - wkDay_(b[0][yi['입고일']]); });
  };
  var schg = function (pred) {
    return H.rows.filter(function (r) { return inwk(r[hi['시각']]) && str_(r[hi['종류']]) === '입고일정'; })
      .map(function (r) { return [r, poOfHist(r)]; }).filter(function (x) { return pred(x[1]); });
  };
  var chgTxt = function (a) { return str_(a[hi['이전값']]) + ' → ' + str_(a[hi['새값']]) + (str_(a[hi['사유']]) ? ' (' + str_(a[hi['사유']]) + ')' : ''); };
  // 발주 표에는 실제 발주만 — 취소 · 계획 · 상신(승인 전) 건은 뺀다
  var poLive = function (r) { return ['취소', '계획', '상신'].indexOf(str_(r[pi['진행상태']])) < 0; };
  var NEW_PO = PO.filter(function (r) { return inwk(r[pi['작성일']]) && isnew(r) && poLive(r); }).sort(byAt('작성일', pi));
  var OLD_PO = PO.filter(function (r) { return inwk(r[pi['작성일']]) && !isnew(r) && poLive(r); }).sort(byAt('작성일', pi));
  var NEW_IN = inbound(isnew), OLD_IN = inbound(function (p) { return !isnew(p); });
  var NEW_CHG = schg(function (p) { return !!p && isnew(p); }), OLD_CHG = schg(function (p) { return !p || !isnew(p); });
  var PROD = H.rows.filter(function (r) { return inwk(r[hi['시각']]) && str_(r[hi['종류']]) === '단계' && str_(r[hi['항목']]).indexOf('생산') > -1; });

  // 업체를 처음 본 날(샘플 요청일 · 발주 작성일)
  var seen = {};
  var see = function (v, d) { if (v && d && (!seen[v] || d < seen[v])) seen[v] = d; };
  SMP.forEach(function (r) { see(str_(r[si['업체명']]), wkDay_(r[si['요청일']])); });
  PO.forEach(function (r) { see(str_(r[pi['업체명']]), wkDay_(r[pi['작성일']]) || wkDay_(r[pi['발주일']])); });
  var CN = function (r) { return str_(r[si['업체명']]).indexOf('중국') > -1 || str_(r[si['구성']]).toLowerCase() === 'gwp' || wkWho_(r[si['담당자']]) === 'Becca'; };
  var OFF = function (r) { var s = str_(r[si['상태']]); return s === '드롭' || s === '탈락'; };
  var vMemo = function (r) { var pj = pjOf(r), v = vk(str_(r[si['업체명']]) || '미정'); return memoWk.filter(function (m) { return m.pj === pj && m.vk === v && m.text; }); };
  var touched = function (r) { return inwk(r[si['요청일']]) || inwk(r[si['견적수신일']]) || vMemo(r).length > 0; };
  var oldV = function (r) { var s = seen[str_(r[si['업체명']])]; return !!s && s < d0; };
  var projCol = function (r) { var pj = str_(r[si['품목명']]), mk = str_(r[si['구성']]); return pj + (mk && pj.replace(/\s/g, '').slice(-mk.replace(/\s/g, '').length) !== mk.replace(/\s/g, '') ? ' · ' + mk : ''); };
  var vrow = function (r, tag) {
    var ms = vMemo(r), price = ms.filter(function (m) { return PRICE.test(m.text); }).map(function (m) { return m.text; }).join(' / ');
    var note = ms.map(function (m) { return dmd(m.at) + ' ' + m.text; }).join(' / ');
    if (inwk(r[si['견적수신일']])) note = wkMd_(r[si['견적수신일']]) + ' 견적 수신' + (note ? ' / ' + note : '');
    var when = inwk(r[si['요청일']]) ? wkMd_(r[si['요청일']]) : (ms.length ? dmd(ms[0].at) : wkMd_(r[si['견적수신일']]));
    return [when, tag, projCol(r), str_(r[si['업체명']]) || '미정', price, wkMd_(r[si['전달예정일']]), note, wkWho_(r[si['담당자']])];
  };
  var V_OLD = SMP.filter(function (r) {
    return !OFF(r) && touched(r) && oldV(r) && !CN(r) && (inwk(r[si['견적수신일']]) || vMemo(r).some(function (m) { return QUOTE.test(m.text); }));
  }).sort(byAt('품목명', si));
  var grp = {};
  SMP.forEach(function (r) { if (!OFF(r) && touched(r)) { var k = str_(r[si['품목명']]) + '|' + str_(r[si['구성']]); grp[k] = (grp[k] || 0) + 1; } });
  var V_NEW = [];
  SMP.slice().sort(function (a, b) { var x = str_(a[si['품목명']]), y = str_(b[si['품목명']]); return x < y ? -1 : x > y ? 1 : 0; }).forEach(function (r) {
    if (OFF(r) || V_OLD.indexOf(r) > -1 || !touched(r)) return;
    var tags = [], v = str_(r[si['업체명']]);
    if (CN(r)) tags.push('중국 · GWP');
    if (v && v !== '미정' && v !== '업체미정' && !oldV(r)) tags.push('신규 업체');
    if (grp[str_(r[si['품목명']]) + '|' + str_(r[si['구성']])] > 1) tags.push('견적 비교');
    if (tags.length) V_NEW.push(vrow(r, tags.join(' · ')));
  });
  var CN_PO = PO.filter(function (r) { return inwk(r[pi['작성일']]) && poLive(r) && (str_(r[pi['업체명']]).indexOf('중국') > -1 || wkWho_(r[pi['구매담당자']]) === 'Becca'); }).sort(byAt('작성일', pi));

  // ----- 2 · 3 -----
  var lastMemo = function (r) { var L = memoOf(r).filter(function (m) { return m.text && !drop(m); }); return L.length ? dmd(L[L.length - 1].at) + ' ' + L[L.length - 1].text : ''; };
  // 완료 · 드롭한 프로젝트는 빼고, 업체마다 마지막 회차로 본다(받았는데 안 정한 샘플은 채택한 업체가 있는 프로젝트도 뺀다)
  var NX_SMP = SMP.filter(function (r) { return innx(r[si['전달예정일']]) && str_(r[si['상태']]) === '진행중' && !str_(r[si['전달일']]) && projLive(r); }).sort(byAt('전달예정일', si));
  var NX_DEC = SMP.filter(function (r) { return str_(r[si['상태']]) === '수신' && isLastQ(r) && projLive(r) && !PPICK[pjOf(r)]; }).sort(byAt('전달일', si));
  var NX_IN = [];
  PAY.forEach(function (r) {
    if (str_(r[yi['종류']]) !== '예정' || !innx(r[yi['입고일']])) return;
    var p = poById[str_(r[yi['실행판ID']]).toLowerCase()];
    if (p && ['취소', '종결'].indexOf(str_(p[pi['진행상태']])) < 0) NX_IN.push([r, p]);
  });
  NX_IN.sort(function (a, b) { return wkDay_(a[0][yi['입고일']]) - wkDay_(b[0][yi['입고일']]); });
  var LATE = {}, lateK = [];
  PAY.forEach(function (r) {
    if (str_(r[yi['종류']]) !== '예정') return;
    var t = wkDay_(r[yi['입고일']]); if (!t || t >= TODAY) return;
    var k = str_(r[yi['실행판ID']]).toLowerCase(), p = poById[k];
    if (!p || ['취소', '종결'].indexOf(str_(p[pi['진행상태']])) > -1) return;
    if (!LATE[k]) { LATE[k] = { p: p, t: t, q: 0 }; lateK.push(k); }
    if (t < LATE[k].t) LATE[k].t = t;
    LATE[k].q += Number(String(r[yi['수량']]).replace(/,/g, '')) || 0;
  });
  var late = lateK.map(function (k) { return LATE[k]; }).sort(function (a, b) { return a.t - b.t; });
  var days = function (t) { return Math.round((TODAY - t) / 864e5); };
  var S_LATE = SMP.filter(function (r) { var d = wkDay_(r[si['전달예정일']]); return d && d < TODAY && str_(r[si['상태']]) === '진행중' && !str_(r[si['전달일']]) && projLive(r); }).sort(byAt('전달예정일', si));
  var first = function (s) { return wkDay_(String(s).split(',')[0]); };
  var PUSHED = OLD_CHG.concat(NEW_CHG).filter(function (x) { var a = first(str_(x[0][hi['새값']])), b = first(str_(x[0][hi['이전값']])); return a && b && a > b; });

  // ----- 표 (2026-10-26 개편: 첫 장 요약 → 병목 · 이슈 → 진행 업무 상세 → 다음 주 계획 · 같은 건은 한 번만) -----
  var T = function (t, cols, rows, o) { o = o || {}; return { t: t, cols: cols, rows: rows || [], manual: o.manual == null ? 0 : o.manual, ex: o.ex || null, log: o.log || '', blank: o.blank || 0 }; };
  var pidOf = function (p) { return p ? str_(p[pi['실행판ID']]).toLowerCase() : ''; };
  var who = function (r, i, k) { return wkWho_(r[i[k]]); };
  var nm = function (p) { return str_(p[pi['품목명']]) + ' ' + str_(p[pi['발주차수']]); };
  var proj = function (x) { return projCol(x); };
  var lateIds = {}; late.forEach(function (x) { lateIds[pidOf(x.p)] = 1; });

  // ── 병목 · 이슈: 실행판에서 찾은 막힌 건(지연 · 일정 늦춰짐 · 샘플 지연 · 받았는데 결정 안 한 샘플) — 한 표, 같은 건 한 번
  var B = [];
  late.forEach(function (x) { B.push({ o: 0, d: x.t, row: ['입고 지연 ' + days(x.t) + '일', nm(x.p), str_(x.p[pi['업체명']]), '예정 ' + wkMd_(x.t) + ' · 남은 ' + wkQty_(x.q) + '개', '', '', wkWho_(x.p[pi['구매담당자']])] }); });
  var pushedSeen = {};
  PUSHED.forEach(function (a) {
    var r = a[0], p = a[1], k = pidOf(p) || str_(r[hi['품목명']]);
    if (lateIds[pidOf(p)] || pushedSeen[k]) return; pushedSeen[k] = 1;
    B.push({ o: 1, d: wkDay_(r[hi['시각']]), row: ['입고일정 늦춰짐', p ? nm(p) : str_(r[hi['품목명']]), p ? str_(p[pi['업체명']]) : '', chgTxt(r), '', '', wkWho_(r[hi['바꾼사람']])] });
  });
  S_LATE.forEach(function (x) { var d = wkDay_(x[si['전달예정일']]); B.push({ o: 2, d: d, row: ['샘플 지연 ' + days(d) + '일', proj(x), str_(x[si['업체명']]) || '미정', '전달예정 ' + wkMd_(x[si['전달예정일']]), lastMemo(x), '', who(x, si, '담당자')] }); });
  // 받았는데 결정 안 한 샘플 — 받은 지 7일이 넘은 것만 병목(최근 받은 건 다음 주 계획 '결정 예정')
  var DEC_OLD = NX_DEC.filter(function (x) { var d = wkDay_(x[si['전달일']]); return !d || days(d) >= 7; }), DEC_NEW = NX_DEC.filter(function (x) { return DEC_OLD.indexOf(x) < 0; });
  DEC_OLD.forEach(function (x) { var d = wkDay_(x[si['전달일']]); B.push({ o: 3, d: d, row: ['결정 대기(수신 ' + (d ? days(d) : '?') + '일)', proj(x), str_(x[si['업체명']]) || '미정', '수신 ' + wkMd_(x[si['전달일']]) + ' · 채택/드롭 미정', lastMemo(x), '', who(x, si, '담당자')] }); });
  B.sort(function (a, b) { return a.o - b.o || (a.d && b.d ? a.d - b.d : 0); });
  var BCOL = ['구분', '품목 · 구성', '업체', '상태', '최근 진행 메모', '대응 · 해결 예정일', '담당'];

  // ── 진행 업무 상세 ① 발주 · 입고 · 생산(신제품/기존은 구분 칸으로 — 예전 신제품 · 기존 · 중국 표 셋을 하나로)
  var tagNew = function (p) { return (isnew(p) ? '신제품' : '기존') + (str_(p[pi['업체명']]).indexOf('중국') > -1 ? ' · 중국' : ''); };
  var D1 = [];
  NEW_PO.concat(OLD_PO).forEach(function (x) { D1.push({ d: wkDay_(x[pi['작성일']]), row: [wkMd_(x[pi['작성일']]), '발주 · ' + tagNew(x), nm(x), wkQty_(x[pi['발주수량']]) + '개 · ' + str_(x[pi['진행상태']]) + ((str_(x[pi['단가']]) && str_(x[pi['업체명']]).indexOf('중국') > -1) ? ' · ' + str_(x[pi['단가']]) + ' ' + str_(x[pi['통화']]) : ''), str_(x[pi['업체명']]), '입고목표 ' + wkMd_(x[pi['입고목표']]), wkWho_(x[pi['구매담당자']])] }); });
  NEW_IN.concat(OLD_IN).forEach(function (a) { var r = a[0], p = a[1]; D1.push({ d: wkDay_(r[yi['입고일']]), row: [wkMd_(r[yi['입고일']]), '입고 · ' + tagNew(p), nm(p), wkQty_(r[yi['수량']]) + '개', str_(p[pi['업체명']]), '', wkWho_(p[pi['구매담당자']])] }); });
  NEW_CHG.concat(OLD_CHG).forEach(function (a) {
    var r = a[0], p = a[1], k = pidOf(p) || str_(r[hi['품목명']]);
    if (pushedSeen[k] || lateIds[pidOf(p)]) return;                   // 늦춰진 건은 병목 표에
    D1.push({ d: wkDay_(r[hi['시각']]), row: [wkMd_(r[hi['시각']]), '입고일정 변경', p ? nm(p) : str_(r[hi['품목명']]), chgTxt(r), p ? str_(p[pi['업체명']]) : '', '', wkWho_(r[hi['바꾼사람']])] });
  });
  PROD.forEach(function (r) { D1.push({ d: wkDay_(r[hi['시각']]), row: [wkMd_(r[hi['시각']]), '생산 진행', str_(r[hi['품목명']]), str_(r[hi['항목']]) + ' ' + str_(r[hi['새값']]), '', '', wkWho_(r[hi['바꾼사람']])] }); });
  D1.sort(function (a, b) { return (a.d || 0) - (b.d || 0); });

  // ── ② 샘플 · 소싱 — 프로젝트 · 업체마다 한 줄(이번 주 요청 · 수신 · 견적 · 협의 메모 · 드롭/탈락을 한 칸에). 예전 요청 · 진행 중 · 수신 · 사양 협의 · 기존/신규 협력사 표 여섯 개를 하나로
  var lateS = {}; S_LATE.forEach(function (x) { lateS[pjOf(x) + '|' + vk(str_(x[si['업체명']]) || '미정')] = 1; });
  var decS = {}; DEC_OLD.forEach(function (x) { decS[pjOf(x) + '|' + vk(str_(x[si['업체명']]) || '미정')] = 1; });
  var SV = {}, SVK = [];
  var svOf = function (r) {
    var k = pjOf(r) + '|' + vk(str_(r[si['업체명']]) || '미정');
    if (!SV[k]) { SV[k] = { k: k, r: r, ev: [], d: null }; SVK.push(k); }
    var c = SV[k]; if (wkKey_(r[si['요청일']]) >= wkKey_(c.r[si['요청일']])) c.r = r;
    return c;
  };
  var ev = function (c, d, t) { c.ev.push({ d: d, t: t }); if (d && (!c.d || d > c.d)) c.d = d; };
  SMP.forEach(function (r) {
    if (inwk(r[si['요청일']])) ev(svOf(r), wkDay_(r[si['요청일']]), wkMd_(r[si['요청일']]) + ' ' + str_(r[si['구성']]) + ' 샘플 요청' + (str_(r[si['수량']]) ? ' ' + wkQty_(r[si['수량']]) + '개' : ''));
    if (inwk(r[si['전달일']])) ev(svOf(r), wkDay_(r[si['전달일']]), wkMd_(r[si['전달일']]) + ' 샘플 수신');
    if (inwk(r[si['견적수신일']])) ev(svOf(r), wkDay_(r[si['견적수신일']]), wkMd_(r[si['견적수신일']]) + ' 견적 수신');
    if (S_OFF(r) && inwk(offAt(r))) ev(svOf(r), wkDay_(offAt(r)), wkMd_(offAt(r)) + ' ' + str_(r[si['상태']]) + ' — ' + offWhy(r));
  });
  memoWk.forEach(function (m) {
    var r = SMP.filter(function (x) { return pjOf(x) === m.pj && vk(str_(x[si['업체명']]) || '미정') === m.vk; })[0];
    if (!r || !m.text) return;
    ev(svOf(r), wkDay_(m.at), dmd(m.at) + ' ' + m.text + (m.st && m.st !== '메모' ? ' [' + m.st + ']' : ''));
  });
  var D2 = SVK.map(function (k) { return SV[k]; }).filter(function (c) { return c.ev.length; }).map(function (c) {
    var r = c.r, v = str_(r[si['업체명']]), tags = [];
    if (str_(r[si['구분']])) tags.push(str_(r[si['구분']]));
    if (CN(r)) tags.push('중국 · GWP');
    if (v && v !== '미정' && !oldV(r)) tags.push('신규 업체');
    if (grp[str_(r[si['품목명']]) + '|' + str_(r[si['구성']])] > 1) tags.push('견적 비교');
    c.ev.sort(function (a, b) { return (a.d || 0) - (b.d || 0); });
    var st = str_(r[si['상태']]) || '진행중';
    if (lateS[c.k]) st += ' · 지연(병목 표)'; else if (decS[c.k]) st += ' · 결정 대기(병목 표)';
    else if (st === '진행중' && str_(r[si['전달예정일']])) st += ' · 전달예정 ' + wkMd_(r[si['전달예정일']]);
    return { d: c.d, row: [c.d ? wkMd_(c.d) : '', tags.join(' · '), proj(r), v || '미정', c.ev.map(function (e) { return e.t; }).join(' / '), st, who(r, si, '담당자')] };
  }).sort(function (a, b) { var x = a.row[2], y = b.row[2]; return x < y ? -1 : x > y ? 1 : (a.d || 0) - (b.d || 0); });

  // ── 다음 주 계획 — 입고 예정 · 샘플 전달 예정 한 표(결정 대기 샘플은 병목 표에)
  var N1 = NX_IN.map(function (a) { var r = a[0], p = a[1]; return { d: wkDay_(r[yi['입고일']]), row: [wkMd_(r[yi['입고일']]), '입고 예정 · ' + tagNew(p), nm(p), wkQty_(r[yi['수량']]) + '개', str_(p[pi['업체명']]), wkWho_(p[pi['구매담당자']])] }; })
    .concat(NX_SMP.map(function (x) { return { d: wkDay_(x[si['전달예정일']]), row: [wkMd_(x[si['전달예정일']]), '샘플 전달 예정', proj(x), lastMemo(x), str_(x[si['업체명']]) || '미정', who(x, si, '담당자')] }; }))
    .concat(DEC_NEW.map(function (x) { return { d: wkDay_(x[si['전달일']]), row: [wkMd_(x[si['전달일']]) + ' 수신', '채택 · 드롭 결정', proj(x), lastMemo(x), str_(x[si['업체명']]) || '미정', who(x, si, '담당자')] }; }))
    .sort(function (a, b) { return (a.d || 0) - (b.d || 0); }).map(function (x) { return x.row; });

  // ── 2026-10-27 개편: 1. 요약(숫자) → 2. 항목별 리스트(요약과 같은 순서) → 3. 병목 · 이슈(직접 작성 빈칸)
  // 신제품 소싱 접수 = 이번 주에 처음 요청이 들어온 샘플 프로젝트(그 프로젝트의 가장 이른 요청일이 이번 주)
  var pjFirst = {}; SMP.forEach(function (r) { var k = pjOf(r), q = wkDay_(r[si['요청일']]); if (q && (!pjFirst[k] || q < pjFirst[k].q)) pjFirst[k] = { q: q, r: r }; });
  var NEWPJ = Object.keys(pjFirst).filter(function (k) { return inwk(pjFirst[k].q); }).map(function (k) {
    var rs = SMP.filter(function (x) { return pjOf(x) === k; }), vs = [];
    rs.forEach(function (x) { var v = str_(x[si['업체명']]); if (v && vs.indexOf(v) < 0) vs.push(v); });
    var r = pjFirst[k].r, kinds = []; rs.forEach(function (x) { var t = str_(x[si['구분']]); if (t && kinds.indexOf(t) < 0) kinds.push(t); });
    return { d: pjFirst[k].q, row: [wkMd_(pjFirst[k].q), str_(r[si['브랜드']]), str_(r[si['품목명']]), kinds.join(' · '), vs.join(', ') || '미정', wkWho_(r[si['담당자']])] };
  }).sort(function (a, b) { return a.d - b.d; });
  var L_REQ = S_REQ.map(function (x) { return [wkMd_(x[si['요청일']]), proj(x), str_(x[si['업체명']]) || '미정', str_(x[si['수량']]) ? wkQty_(x[si['수량']]) + '개' : '', str_(x[si['구분']]), wkMd_(x[si['전달예정일']]), who(x, si, '담당자')]; });
  var L_RCV = S_RCV.map(function (x) { return [wkMd_(x[si['전달일']]), proj(x), str_(x[si['업체명']]) || '미정', '요청 ' + wkMd_(x[si['요청일']]), str_(x[si['상태']]) || '수신', lastMemo(x), who(x, si, '담당자')]; });
  var L_PO = NEW_PO.concat(OLD_PO).sort(byAt('작성일', pi)).map(function (x) { return [wkMd_(x[pi['작성일']]), tagNew(x), nm(x), wkQty_(x[pi['발주수량']]) + '개', str_(x[pi['업체명']]), '입고목표 ' + wkMd_(x[pi['입고목표']]), wkWho_(x[pi['구매담당자']])]; });
  var L_IN = NEW_IN.concat(OLD_IN).sort(function (a, b) { return wkDay_(a[0][yi['입고일']]) - wkDay_(b[0][yi['입고일']]); }).map(function (a) { var r = a[0], p = a[1]; return [wkMd_(r[yi['입고일']]), tagNew(p), nm(p), wkQty_(r[yi['수량']]) + '개', str_(p[pi['업체명']]), str_(p[pi['진행상태']]), wkWho_(p[pi['구매담당자']])]; });
  // 일정 지연 — 입고 지연(예정일 지남 · 잔량) · 입고일정 늦춰짐(이번 주 변경) · 샘플 지연(전달예정 지남). 사유 · 대응은 직접
  var L_LATE = [];
  late.forEach(function (x) { L_LATE.push(['입고 지연', nm(x.p), str_(x.p[pi['업체명']]), '예정 ' + wkMd_(x.t), days(x.t) + '일', '', wkWho_(x.p[pi['구매담당자']])]); });
  var pSeen = {};
  PUSHED.forEach(function (a) { var r = a[0], p = a[1], k = pidOf(p) || str_(r[hi['품목명']]); if (lateIds[pidOf(p)] || pSeen[k]) return; pSeen[k] = 1; L_LATE.push(['입고일정 늦춰짐', p ? nm(p) : str_(r[hi['품목명']]), p ? str_(p[pi['업체명']]) : '', chgTxt(r), '', '', wkWho_(r[hi['바꾼사람']])]); });
  S_LATE.forEach(function (x) { var d = wkDay_(x[si['전달예정일']]); L_LATE.push(['샘플 지연', proj(x), str_(x[si['업체명']]) || '미정', '전달예정 ' + wkMd_(x[si['전달예정일']]), days(d) + '일', lastMemo(x), who(x, si, '담당자')]); });
  var nPushed = Object.keys(pSeen).length;
  // 다음 주 예정 — 입고 예정 · 샘플 전달 예정 · 채택/드롭 결정(받은 지 오래된 것 포함)
  var L_NX = N1.concat(DEC_OLD.map(function (x) { var d = wkDay_(x[si['전달일']]); return [wkMd_(x[si['전달일']]) + ' 수신', '결정 대기 ' + (d ? days(d) : '?') + '일', proj(x), lastMemo(x), str_(x[si['업체명']]) || '미정', who(x, si, '담당자')]; }));
  // 회신 대기(역요청) — 우리가 요청하고 답을 기다리는 일: 아직 대기 중(언제 요청했든) + 이번 주 회신 받은 것
  MEMO.forEach(function (x) { if (x.wait) WAITS.push(x); });
  var W_ALL = WAITS.filter(function (x) { return !PDONE[x.pj]; });
  var W_OPEN = W_ALL.filter(function (x) { return !x.waitDone; }).sort(function (a, b) { return (a.due || '9999') < (b.due || '9999') ? -1 : 1; });
  var W_DONE = W_ALL.filter(function (x) { return x.waitDone && inwk(x.waitDone); });
  var wLate = W_OPEN.filter(function (x) { var d = wkDay_(x.due); return d && d < TODAY; }).length;
  var L_WAIT = W_OPEN.map(function (x) { var d = wkDay_(x.due); return [wkMd_(x.at), x.wait, x.proj + (x.vendor ? ' · ' + x.vendor : ''), x.text, x.due ? wkMd_(x.due) : '', d ? (d < TODAY ? '대기 · ' + days(d) + '일 지남' : '대기 중') : '대기 중', x.who]; })
    .concat(W_DONE.map(function (x) { return [wkMd_(x.at), x.wait, x.proj + (x.vendor ? ' · ' + x.vendor : ''), x.text, x.due ? wkMd_(x.due) : '', wkMd_(x.waitDone) + ' 회신 받음', x.who]; }));
  // ── 견적 수신(이번 주) — 견적 비교 입력 · 시트 견적수신일 · 단가가 적힌 진행 메모
  var ownerOfPV = function (pj, vkey) { var r = SMP.filter(function (x) { return pjOf(x) === pj && vk(str_(x[si['업체명']]) || '미정') === vkey; })[0]; return r ? wkWho_(r[si['담당자']]) : ''; };
  var QW = [];
  QTS.forEach(function (q) { if (!inwk(q.at)) return; QW.push({ d: wkDay_(q.at), who: ownerOfPV(q.pj, q.vk) || q.by, row: [wkMd_(q.at), q.proj + (q.make ? ' · ' + q.make : ''), q.vendor, Number(String(q.price).replace(/,/g, '')).toLocaleString('en-US') + ' ' + q.cur + (q.qty ? ' (' + wkQty_(q.qty) + '개)' : ''), '견적 비교'] }); });
  SMP.forEach(function (r) { if (inwk(r[si['견적수신일']])) QW.push({ d: wkDay_(r[si['견적수신일']]), who: wkWho_(r[si['담당자']]), row: [wkMd_(r[si['견적수신일']]), projCol(r), str_(r[si['업체명']]) || '미정', '견적 수신(시트)', '시트'] }); });
  memoWk.forEach(function (x) { if (!PRICE.test(x.text)) return; QW.push({ d: wkDay_(x.at), who: ownerOfPV(x.pj, x.vk) || x.who, row: [dmd(x.at), x.proj, x.vendor, x.text, '진행 메모'] }); });
  QW.sort(function (a, b) { return (a.d || 0) - (b.d || 0); });
  var L_QT = QW.map(function (x) { return x.row.slice(0, 4).concat([x.row[4], '', x.who]); });
  // ── 담당자별 신제품 소싱 — 진행 중(누적) + 이번 주
  var P = {}, pOf = function (w) { if (!w || w === '-') w = '미지정'; return (P[w] = P[w] || { pj: {}, pv: {}, reqV: {}, rcv: 0, qt: 0, qtx: [], pick: 0, wait: 0, late: 0 }); };
  SMP.forEach(function (r) {
    var w = wkWho_(r[si['담당자']]), o = pOf(w), key = pjOf(r) + '|' + vk(str_(r[si['업체명']]) || '미정');
    if (projLive(r) && !S_OFF(r)) { o.pj[pjOf(r)] = 1; if (str_(r[si['업체명']])) o.pv[key] = 1; }
    if (inwk(r[si['요청일']]) && str_(r[si['업체명']])) o.reqV[key] = 1;
    if (inwk(r[si['전달일']])) o.rcv++;
  });
  QW.forEach(function (x) { var o = pOf(x.who); o.qt++; if (o.qtx.length < 3 && x.row[3] !== '견적 수신(시트)') o.qtx.push(x.row[2] + ' ' + String(x.row[3]).slice(0, 30)); });
  memoWk.forEach(function (x) { if (x.st === '채택') pOf(ownerOfPV(x.pj, x.vk) || x.who).pick++; });
  W_OPEN.forEach(function (x) { pOf(x.who).wait++; });
  S_LATE.forEach(function (x) { pOf(wkWho_(x[si['담당자']])).late++; });
  var order = RB_WK_TEAM.map(function (t) { return t[0]; });
  var PT = Object.keys(P).sort(function (a, b) { var x = order.indexOf(a), y = order.indexOf(b); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y) || (a < b ? -1 : 1); })
    .filter(function (w) { var o = P[w]; return Object.keys(o.pj).length || Object.keys(o.reqV).length || o.rcv || o.qt; })
    .map(function (w) { var o = P[w]; return [w, Object.keys(o.pj).length + '개', Object.keys(o.pv).length + '곳', Object.keys(o.reqV).length + '곳', o.rcv + '건', o.qt + '건' + (o.qtx.length ? ' — ' + o.qtx.join(' / ') : ''), o.pick + '건', (o.wait ? '대기 ' + o.wait : '') + (o.late ? (o.wait ? ' · ' : '') + '지연 ' + o.late : '')]; });
  // ── 금액(원화) — 발주: 수량 × 단가(원화 건만, 외화는 건수) · 입고: 지급 줄 금액
  var num = function (v) { var n = Number(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; };
  var poKrw = 0, poFx = 0; NEW_PO.concat(OLD_PO).forEach(function (x) { var cur = str_(x[pi['통화']]).toUpperCase(); if (!cur || cur === 'KRW' || cur === '원' || cur === '원화') poKrw += num(x[pi['발주수량']]) * num(x[pi['단가']]); else poFx++; });
  var inKrw = 0; NEW_IN.concat(OLD_IN).forEach(function (a) { inKrw += num(a[0][yi['금액']]); });
  var eok = function (n) { return n >= 1e8 ? (n / 1e8).toFixed(1) + '억' : n >= 1e4 ? Math.round(n / 1e4).toLocaleString('en-US') + '만' : Math.round(n).toLocaleString('en-US'); };
  var decAll = DEC_NEW.length + DEC_OLD.length;
  function adoptN() { return memoWk.filter(function (m) { return m.st === '채택'; }).length; }
  var kpi = [
    { k: 'dec', label: '결정 필요', v: decAll, sub: '받은 샘플 채택 · 드롭 미정' + (DEC_OLD.length ? ' (7일 넘음 ' + DEC_OLD.length + ')' : ''), warn: DEC_OLD.length > 0 },
    { k: 'late', label: '일정 지연', v: late.length + S_LATE.length, sub: '입고 지연 ' + late.length + ' · 샘플 지연 ' + S_LATE.length, warn: late.length + S_LATE.length > 0 },
    { k: 'wait', label: '회신 대기', v: W_OPEN.length, sub: '기한 지남 ' + wLate + ' · 이번 주 받음 ' + W_DONE.length, warn: wLate > 0 },
    { k: 'pj', label: '신제품 소싱', v: NEWPJ.length, sub: '이번 주 접수 · 진행 중 프로젝트 ' + Object.keys(SMP.reduce(function (a, r) { if (projLive(r)) a[pjOf(r)] = 1; return a; }, {})).length },
    { k: 'smp', label: '샘플 수신', v: S_RCV.length, sub: '요청 ' + S_REQ.length + ' · 채택 ' + adoptN() + ' · 견적 ' + QW.length },
    { k: 'po', label: '발주', v: L_PO.length, sub: '신제품 ' + NEW_PO.length + ' · 기존 ' + OLD_PO.length + (poKrw ? ' · ₩' + eok(poKrw) : '') + (poFx ? ' · 외화 ' + poFx + '건' : '') },
    { k: 'in', label: '입고', v: L_IN.length, sub: (inKrw ? '₩' + eok(inKrw) + ' · ' : '') + '다음 주 예정 ' + NX_IN.length }
  ];
  var parts = [
    { h: '2. 항목별 리스트', subs: [
      { t: '① 신제품 소싱 접수 (' + NEWPJ.length + ')', items: [T('이번 주 새로 들어온 샘플 프로젝트', ['접수일', '브랜드', '프로젝트', '구분', '요청 업체', '담당'], NEWPJ.map(function (x) { return x.row; }), { manual: 0 })] },
      { t: '② 샘플 요청 (' + L_REQ.length + ')', items: [T('업체에 샘플을 요청한 건(재요청 포함)', ['요청일', '프로젝트 · 구성', '업체', '수량', '구분', '전달예정', '담당'], L_REQ, { manual: 0 })] },
      { t: '③ 샘플 수신 (' + L_RCV.length + ')', items: [T('이번 주 받은 샘플 — 결과(채택 · 수정 · 드롭)는 최근 메모', ['수신일', '프로젝트 · 구성', '업체', '요청일', '상태', '최근 메모', '담당'], L_RCV, { manual: 0 })] },
      { t: '④ 발주 (' + L_PO.length + ')', items: [T('실제 발주(취소 · 계획 · 상신 전 제외)', ['발주일', '구분', '품목 · 차수', '수량', '업체', '입고목표', '담당'], L_PO, { manual: 0 })] },
      { t: '⑤ 입고 (' + L_IN.length + ')', items: [T('이번 주 입고', ['입고일', '구분', '품목 · 차수', '입고수량', '업체', '진행상태', '담당'], L_IN, { manual: 0 })] },
      { t: '⑤-2 견적 수신 (' + L_QT.length + ')', items: [T('견적 비교에 넣은 단가 · 시트 견적수신일 · 단가가 적힌 진행 메모', ['일자', '프로젝트 · 구성', '업체', '단가 · 내용', '출처', '', '담당'], L_QT, { manual: 0 })] },
      { t: '⑥ 일정 지연 · 변경 (' + L_LATE.length + ')', items: [T('입고 지연 · 입고일정 늦춰짐 · 샘플 지연 — 사유 · 대응은 3. 병목 · 이슈에', ['구분', '품목 · 프로젝트', '업체', '예정 · 변경', '지연', '최근 메모', '담당'], L_LATE, { manual: 0 })] },
      { t: '⑦ 회신 대기 — 우리가 요청하고 기다리는 일 (' + W_OPEN.length + ')', items: [T('대기 중(기한 순) + 이번 주 회신 받은 것', ['요청일', '대기 대상', '프로젝트 · 업체', '요청 내용', '회신 기한', '상태', '담당'], L_WAIT, { manual: 0 })] },
      { t: '⑧ 다음 주 예정 (' + L_NX.length + ')', items: [T(R_NX_T(), ['일자', '구분', '품목 · 구성', '내용 · 최근 메모', '업체', '담당'], L_NX, { manual: 0 })] }
    ] },
    { h: '3. 병목 · 이슈 (직접 작성)', subs: [
      { t: '지연 사유 · 품질 · 협력사 · 의사결정 필요 · 유관부서 협조 요청', items: [T('담당자가 직접 씁니다 — 엑셀 노란 칸', ['구분', '이슈 내용', '품목 · 업체', '원인', '대응 방안', '해결 예정일', '담당'], [], { manual: 6, blank: 1 })] }
    ], note: '※ 지연 건은 원인 · 대응방안 · 예상 해결 일정을 함께 · 대안이 없으면 별도 협의 요청' }
  ];
  function R_NX_T() { return '입고 예정 · 샘플 전달 예정 · 채택/드롭 결정(받은 지 오래된 결정 대기 포함)'; }
  return { v: 3, from: ymd(d0), to: ymd(d1), nextFrom: ymd(n0), nextTo: ymd(n1),
    summary: { kpi: kpi, hl: [], team: [], tables: [T('담당자별 신제품 소싱 — 진행 중(누적) · 이번 주', ['담당', '진행 프로젝트', '진행 업체', '이번 주 요청 업체', '이번 주 샘플 수신', '이번 주 견적(단가)', '채택', '대기 · 지연'], PT, { manual: 0 })] }, parts: parts };
}

