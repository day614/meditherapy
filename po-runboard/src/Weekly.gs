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
  var MEMO = [], PDONE = {}, PPICK = {};
  G.rows.forEach(function (r) {
    var gid = str_(g(r, gi, '건ID')), pj = /^p:n:/.test(gid) || !gid ? 'n:' + str_(g(r, gi, '품목명')) : gid;
    var ck = {}; try { ck = JSON.parse(str_(g(r, gi, '진행JSON')) || '{}'); } catch (e0) { ck = {}; }
    if (ck && ck._done) PDONE[pj] = 1;
    var m = {}; try { m = JSON.parse(str_(g(r, gi, '메모JSON')) || '{}'); } catch (e) { m = {}; }
    Object.keys(m).forEach(function (k) {
      if (k.indexOf('tl:') !== 0) return;
      var L = []; try { L = JSON.parse(m[k]); } catch (e2) { L = []; }
      var vkey = vk(k.slice(3));
      L.forEach(function (e) { MEMO.push({ at: str_(e.at), pj: pj, proj: pjName[pj] || str_(g(r, gi, '품목명')), vk: vkey, vendor: vName[pj + '|' + vkey] || k.slice(3), text: str_(e.text), st: str_(e.st), due: str_(e.due), who: wkWho_(e.who) }); });
    });
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

  // ----- 표 -----
  var T = function (t, cols, rows, o) { o = o || {}; return { t: t, cols: cols, rows: rows || [], manual: o.manual == null ? 2 : o.manual, ex: o.ex || null, log: o.log || '' }; };
  var VCOL = ['일자', '구분', '프로젝트(품목) · 구성', '업체', '단가', '전달예정일', '비고(이 기간 실행판 메모)', '담당'];
  var parts = [
    { h: '1. 이번 주 처리한 주요 건', subs: [
      { t: '① 신제품 구매 및 개발', items: [
        T('신규 제품 부자재 소싱 및 견적 검토 — 샘플 요청', ['요청일', '구분', '프로젝트(품목)', '구성 · 사양', '업체', '전달예정', '상태(드롭 · 탈락 사유)', '담당'],
          S_REQ.map(function (x) { return [wkMd_(x[si['요청일']]), str_(x[si['구분']]), str_(x[si['품목명']]), [str_(x[si['구성']]), str_(x[si['사양']]), str_(x[si['수량']]) ? wkQty_(x[si['수량']]) + '개' : ''].filter(String).join(' · '), str_(x[si['업체명']]) || '미정', wkMd_(x[si['전달예정일']]) || '미정', stTxt(x), wkWho_(x[si['담당자']])]; }), { log: 1 }),
        T('앞 주 요청 샘플 — 진행 중(기한 전) · 이번 주 드롭/탈락', ['요청일', '구분', '프로젝트(품목)', '구성 · 사양', '업체', '전달예정', '상태 · 최근 진행 메모', '담당'],
          S_OPEN.map(function (x) { return [wkMd_(x[si['요청일']]), str_(x[si['구분']]), str_(x[si['품목명']]), [str_(x[si['구성']]), str_(x[si['사양']])].filter(String).join(' · '), str_(x[si['업체명']]) || '미정', wkMd_(x[si['전달예정일']]) || '미정', S_OFF(x) ? stTxt(x) + ' (' + dmd(offAt(x)) + ')' : ('진행중' + (lastMemo(x) ? ' · ' + lastMemo(x) : '')), wkWho_(x[si['담당자']])]; }), { manual: 0 }),
        T('신제품별 샘플 제작, 발주 및 입고 일정 관리', ['일자', '구분', '품목', '내용', '업체', '일정', '담당'],
          S_RCV.map(function (x) { return [wkMd_(x[si['전달일']]), '샘플 수신', str_(x[si['품목명']]), str_(x[si['구성']]) + ' · 상태 ' + str_(x[si['상태']]), str_(x[si['업체명']]), '', wkWho_(x[si['담당자']])]; })
            .concat(NEW_PO.map(function (x) { return [wkMd_(x[pi['작성일']]), '신제품 발주', str_(x[pi['품목명']]), poDesc(x), str_(x[pi['업체명']]), '입고목표 ' + wkMd_(x[pi['입고목표']]), wkWho_(x[pi['구매담당자']])]; }))
            .concat(NEW_IN.map(function (a) { var r = a[0], p = a[1]; return [wkMd_(r[yi['입고일']]), '신제품 입고', str_(p[pi['품목명']]), str_(p[pi['발주차수']]) + ' · ' + wkQty_(r[yi['수량']]) + '개', str_(p[pi['업체명']]), '', wkWho_(p[pi['구매담당자']])]; }))
            .concat(NEW_CHG.map(function (a) { var r = a[0], p = a[1]; return [wkMd_(r[hi['시각']]), '입고일정 변경', str_(r[hi['품목명']]), chgTxt(r), p ? str_(p[pi['업체명']]) : '', '', wkWho_(r[hi['바꾼사람']])]; })), { log: 1 }),
        T('디자인·개발·제조사 간 부자재 사양 협의 — 샘플 진행 메모', ['일자', '구분', '프로젝트(품목)', '협의 내용', '업체', '기한', '담당'],
          S_SPEC.map(function (m) { return [dmd(m.at), m.st || '메모', m.proj, m.text, m.vendor, dmd(m.due), m.who]; }), { log: 1 })
      ] },
      { t: '② 기존제품 구매 및 공급관리', items: [
        T('주요 제품 발주 및 입고 일정 관리 — 발주 / 입고 / 입고일정 변경', ['일자', '구분', '품목명', '차수 · 수량', '업체', '입고목표 · 일정', '담당'],
          OLD_PO.map(function (x) { return [wkMd_(x[pi['작성일']]), '발주', str_(x[pi['품목명']]), poDesc(x), str_(x[pi['업체명']]), wkMd_(x[pi['입고목표']]), wkWho_(x[pi['구매담당자']])]; })
            .concat(OLD_IN.map(function (a) { var r = a[0], p = a[1]; return [wkMd_(r[yi['입고일']]), '입고', str_(p[pi['품목명']]), str_(p[pi['발주차수']]) + ' · ' + wkQty_(r[yi['수량']]) + '개', str_(p[pi['업체명']]), '', wkWho_(p[pi['구매담당자']])]; }))
            .concat(OLD_CHG.map(function (a) { var r = a[0], p = a[1]; return [wkMd_(r[hi['시각']]), '입고일정 변경', str_(r[hi['품목명']]), p ? str_(p[pi['발주차수']]) : '', p ? str_(p[pi['업체명']]) : '', chgTxt(r), wkWho_(r[hi['바꾼사람']])]; })), { log: 1 }),
        T('제품별 생산 일정 및 공급 가능 수량 확인', ['일자', '구분', '품목명', '내용', '업체', '일정', '담당'],
          PROD.map(function (r) { return [wkMd_(r[hi['시각']]), '생산진행 체크', str_(r[hi['품목명']]), str_(r[hi['항목']]) + ' ' + str_(r[hi['새값']]), '', '', wkWho_(r[hi['바꾼사람']])]; }),
          { log: 1, ex: ['(예)10/15', '생산일정', '○○ 크림 50ml', '11/3 생산 확정, 2만개 가능', '한국콜마', '11/10 입고', 'Jayden'] }),
        T('품절 우려 제품 및 안전재고 현황 점검', ['일자', '구분', '품목명', '현재고 · 안전재고', '업체', '대응', '담당'], [],
          { manual: 3, ex: ['(예)10/16', '품절 우려', '○○ 세럼 150ml', '재고 1.2개월분(안전 2개월)', '코스메카', '추가 발주 10/21', 'Nova'] })
      ] },
      { t: '③ 협력사 및 원가관리', items: [
        T('기존 협력사 단가 및 거래조건 협의', VCOL, V_OLD.map(function (r) { return vrow(r, '기존 업체'); }), { log: 1 }),
        T('신규 협력사 발굴 및 견적 비교 (중국 부자재 · GWP 포함)', VCOL, V_NEW, { log: 1 }),
        T('중국 부자재 및 GWP 소싱 진행 — 샘플은 위 표(구분 \'중국 · GWP\'), 여기는 중국 발주', VCOL,
          CN_PO.map(function (x) { return [wkMd_(x[pi['작성일']]), '발주', str_(x[pi['품목명']]) + ' ' + str_(x[pi['발주차수']]), str_(x[pi['업체명']]), (str_(x[pi['단가']]) + ' ' + str_(x[pi['통화']])).trim(), '입고목표 ' + wkMd_(x[pi['입고목표']]), wkQty_(x[pi['발주수량']]) + '개 · ' + str_(x[pi['진행상태']]) + (str_(x[pi['비고']]) ? ' / ' + str_(x[pi['비고']]) : ''), wkWho_(x[pi['구매담당자']])]; }), { log: 1 })
      ] }
    ] },
    { h: '2. 다음 주 주요 계획', subs: [
      { t: '① 신제품', items: [
        T('신제품별 미확정 사양 및 견적 확정 — 다음 주 샘플 전달 예정', ['전달예정', '구분', '프로젝트(품목)', '구성 · 사양', '업체', '최근 진행 메모', '담당'],
          NX_SMP.map(function (x) { return [wkMd_(x[si['전달예정일']]), str_(x[si['구분']]), str_(x[si['품목명']]), str_(x[si['구성']]) + ' · ' + str_(x[si['사양']]), str_(x[si['업체명']]), lastMemo(x), wkWho_(x[si['담당자']])]; })),
        T('샘플 승인 및 양산 일정 협의 — 받았는데 채택 · 드롭을 아직 안 정한 샘플', ['수신일', '구분', '프로젝트(품목)', '구성', '업체', '최근 진행 메모', '담당'],
          NX_DEC.map(function (x) { return [wkMd_(x[si['전달일']]), str_(x[si['구분']]), str_(x[si['품목명']]), str_(x[si['구성']]), str_(x[si['업체명']]), lastMemo(x), wkWho_(x[si['담당자']])]; }))
      ] },
      { t: '② 기존제품', items: [
        T('주요 제품 생산 및 입고 일정 점검 — 다음 주 입고 예정', ['입고예정', '구분', '품목명', '차수 · 수량', '업체', '', '담당'],
          NX_IN.map(function (a) { var r = a[0], p = a[1]; return [wkMd_(r[yi['입고일']]), isnew(p) ? '신제품' : '기존', str_(p[pi['품목명']]), str_(p[pi['발주차수']]) + ' · ' + wkQty_(r[yi['수량']]) + '개', str_(p[pi['업체명']]), '', wkWho_(p[pi['구매담당자']])]; })),
        T('공급 지연 예상 품목 선제 대응 — 입고예정일이 지났는데 아직 입고 안 된 건', ['입고예정', '구분', '품목명', '차수 · 남은 수량', '업체', '대응(직접)', '담당'],
          late.map(function (x) { return [wkMd_(x.t), days(x.t) + '일 지남', str_(x.p[pi['품목명']]), str_(x.p[pi['발주차수']]) + ' · ' + wkQty_(x.q) + '개', str_(x.p[pi['업체명']]), '', wkWho_(x.p[pi['구매담당자']])]; }))
      ] },
      { t: '③ 구매 프로세스 개선', items: [
        T('구매 SOP 및 업무 프로세스 개선', ['목표일', '구분', '과제', '내용', '', '', '담당'], [], { ex: ['(예)10/30', 'SOP', '발주 승인 단계 정리', '상신 → 승인 기준 문서화', '', '', 'Day'] }),
        T('협력사 관리 및 구매업무 효율화 검토', ['목표일', '구분', '과제', '내용', '', '', '담당'], [])
      ] }
    ] },
    { h: '3. 진행 중 과제 및 주요 문제점', subs: [
      { t: '① 신제품 관련 이슈', items: [
        T('품목명 / 문제점 / 현재 진행상황 / 해결 예정일', ['전달예정', '문제점', '품목명', '현재 진행상황(최근 메모)', '업체', '해결 예정일', '담당'],
          S_LATE.map(function (x) { return [wkMd_(x[si['전달예정일']]), '샘플 ' + days(wkDay_(x[si['전달예정일']])) + '일 지연', str_(x[si['품목명']]) + ' ' + str_(x[si['구성']]), lastMemo(x), str_(x[si['업체명']]), '', wkWho_(x[si['담당자']])]; }))
      ] },
      { t: '② 기존제품 관련 이슈', items: [
        T('품목명 / 입고 지연 및 공급 문제 / 대응방안 / 해결 예정일', ['입고예정', '입고 지연 및 공급 문제', '품목명', '대응방안(직접)', '업체', '해결 예정일', '담당'],
          late.map(function (x) { return [wkMd_(x.t), '입고 ' + days(x.t) + '일 지연 · 남은 ' + wkQty_(x.q) + '개', str_(x.p[pi['품목명']]) + ' ' + str_(x.p[pi['발주차수']]), '', str_(x.p[pi['업체명']]), '', wkWho_(x.p[pi['구매담당자']])]; })
            .concat(PUSHED.map(function (a) { var r = a[0], p = a[1]; return [wkMd_(r[hi['시각']]), '입고일정 늦춰짐', str_(r[hi['품목명']]), chgTxt(r), p ? str_(p[pi['업체명']]) : '', String(str_(r[hi['새값']])).split(',')[0], wkWho_(r[hi['바꾼사람']])]; })))
      ] },
      { t: '③ 품질 및 협력사 이슈', items: [
        T('품목명 또는 협력사 / 품질 문제 / 원인 및 개선방안 / 조치 일정', ['발생일', '품질 문제', '품목명 · 협력사', '원인 및 개선방안', '업체', '조치 일정', '담당'], [],
          { manual: 3, ex: ['(예)10/14', '인쇄 번짐 2%', '○○ 용기', '금형 세척 · 입고 검사 강화', '○○산업', '10/25', 'Jayden'] })
      ] },
      { t: '④ 구매 프로세스 개선 과제', items: [
        T('과제명 / 진행상황 / 병목사항 / 완료 목표일', ['', '과제명', '진행상황', '병목사항', '', '완료 목표일', '담당'], [], { manual: 3 })
      ] }
    ], note: '※ 주요 지연 건은 원인, 대응방안, 예상 해결 일정을 함께 보고' }
  ];
  // 4. 팀원별 — 1번 실행판 줄 중 그 담당자 줄 수
  var cnt = {};
  parts[0].subs.forEach(function (s) { s.items.forEach(function (it) { if (!it.log) return; it.rows.forEach(function (x) { var w = x[x.length - 1]; cnt[w] = (cnt[w] || 0) + 1; }); }); });
  var team = RB_WK_TEAM.map(function (t) { return { name: t[0], role: t[1], n: cnt[t[0]] || 0 }; });
  return { from: ymd(d0), to: ymd(d1), nextFrom: ymd(n0), nextTo: ymd(n1), parts: parts, team: team,
    decision: [T('의사결정 필요사항 : 안건 / 선택 가능한 대안 / 구매팀 의견', ['', '안건', '선택 가능한 대안', '구매팀 의견', '', '', '담당'], []),
      T('유관부서 협조 요청 : 요청부서 / 요청내용 / 필요 일정', ['', '요청부서', '요청내용', '', '', '필요 일정', '담당'], [])],
    decisionNote: '※ 추가 의사결정이 필요한 사항은 대안을 검토하여 보고하고, 선택 가능한 대안이 없는 경우 별도 협의 요청' };
}
