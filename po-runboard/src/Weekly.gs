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
function apiWeeklyReport(from, to, kind) {
  var now = new Date(), t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var d1 = wkDay_(to), d0 = wkDay_(from);
  if (!d1) { d1 = new Date(t0); d1.setDate(d1.getDate() - 1); while (d1.getDay() !== 4) d1.setDate(d1.getDate() - 1); }   // 어제까지 중 가장 최근 목요일
  if (!d0) { d0 = new Date(d1); d0.setDate(d0.getDate() - 6); }
  var TODAY = new Date(d1); if (kind !== 'day') TODAY.setDate(TODAY.getDate() + 1);    // 일일보고: 그날 기준(그날 기한은 아직 지연 아님)
  var n0 = new Date(d1); n0.setDate(n0.getDate() + 1); var n1 = new Date(n0); n1.setDate(n1.getDate() + 6);
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
  var MEMO = [], PDONE = {}, PPICK = {}, WAITS = [], QTS = [], RVS = {};
  G.rows.forEach(function (r) {
    var gid = str_(g(r, gi, '건ID')), pj = /^p:n:/.test(gid) || !gid ? 'n:' + str_(g(r, gi, '품목명')) : gid;
    var ck = {}; try { ck = JSON.parse(str_(g(r, gi, '진행JSON')) || '{}'); } catch (e0) { ck = {}; }
    if (ck && ck._done) PDONE[pj] = 1;
    var m = {}; try { m = JSON.parse(str_(g(r, gi, '메모JSON')) || '{}'); } catch (e) { m = {}; }
    Object.keys(m).forEach(function (k) {
      if (k.indexOf('tl:') !== 0) return;
      var L = []; try { L = JSON.parse(m[k]); } catch (e2) { L = []; }
      var vkey = vk(k.slice(3));
      L.forEach(function (e) { MEMO.push({ at: str_(e.at), pj: pj, proj: pjName[pj] || str_(g(r, gi, '품목명')), vk: vkey, vendor: vName[pj + '|' + vkey] || k.slice(3), text: str_(e.text), st: str_(e.st), due: str_(e.due), who: wkWho_(e.who), wait: str_(e.wait), waitDone: str_(e.waitDone), waitReply: str_(e.waitReply), rawText: str_(e.text) }); });
    });
    // 견적 비교(구매 소싱 관리 [견적 비교] — 테스트판 · 개인판에만 있음): 업체 · 구성별 단가
    var QJ = {}; try { QJ = JSON.parse(m['i:qt'] || '{}'); } catch (eQ) { QJ = {}; }
    Object.keys(QJ || {}).forEach(function (qk) {
      var q = QJ[qk] || {}; if (!str_(q.price)) return;
      var ci = qk.indexOf('::'), mk = ci > 0 ? qk.slice(0, ci) : str_(q.make), qv = ci > 0 ? qk.slice(ci + 2) : qk;
      QTS.push({ at: str_(q._at).slice(0, 10), pj: pj, proj: pjName[pj] || str_(g(r, gi, '품목명')), vk: qv, vendor: str_(q.name) || vName[pj + '|' + qv] || qv, make: mk, price: str_(q.price), cur: str_(q.cur) || 'KRW', qty: str_(q.qty), by: wkWho_(q._by) });
    });
    try { RVS[pj] = JSON.parse(m['i:rv'] || '{}') || {}; } catch (eR) { RVS[pj] = {}; }      // 회차 검토 결과(승인 · 수정 요청 · 재샘플 · 반려)
    // 프로젝트 비고의 역요청 대기(업체와 상관없는 것)
    var PM = []; try { PM = JSON.parse(m.pmemo || '[]'); } catch (eP) { PM = []; }
    (Array.isArray(PM) ? PM : []).forEach(function (x) { if (x && x.wait) WAITS.push({ at: str_(x.at), pj: pj, proj: pjName[pj] || str_(g(r, gi, '품목명')), vendor: '', text: str_(x.t), wait: str_(x.wait), due: str_(x.due), waitDone: str_(x.waitDone), waitReply: str_(x.waitReply), who: wkWho_(x.by), vk: '', rawText: str_(x.t) }); });
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
  // 끝난 발주 — 취소 · 종결 · 종결 칸(잔량 마감) · 발주잔량 0(전량 입고). 목록의 '마감'과 같은 기준(2026-10-27: 잔량 마감한 건이 보고서 입고 지연에 남았다)
  var poShut = function (p) {
    if (['취소', '종결'].indexOf(str_(p[pi['진행상태']])) > -1) return true;
    if (pi['종결'] != null && str_(p[pi['종결']])) return true;
    var rm = pi['발주잔량'] == null ? '' : str_(p[pi['발주잔량']]).replace(/,/g, '');
    return rm !== '' && isFinite(Number(rm)) && Number(rm) <= 0 && Number(String(p[pi['발주수량']]).replace(/,/g, '')) > 0;
  };
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
    if (p && !poShut(p)) NX_IN.push([r, p]);
  });
  NX_IN.sort(function (a, b) { return wkDay_(a[0][yi['입고일']]) - wkDay_(b[0][yi['입고일']]); });
  var LATE = {}, lateK = [];
  PAY.forEach(function (r) {
    if (str_(r[yi['종류']]) !== '예정') return;
    var t = wkDay_(r[yi['입고일']]); if (!t || t >= TODAY) return;
    var k = str_(r[yi['실행판ID']]).toLowerCase(), p = poById[k];
    if (!p || poShut(p)) return;
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
    if (projLive(r) && !S_OFF(r) && isLastQ(r)) { o.pj[pjOf(r)] = 1; if (str_(r[si['업체명']])) o.pv[key] = 1; }     // 아래 ⑥ 내역 목록과 같은 기준
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
  // ── 2026-10-27 보고서 구조: 1. 요약(항목마다 한 줄 — 건수 · 핵심) → 2. 상세(요약과 같은 번호 · 순서). 0건도 '없음'으로 적는다
  function adoptN() { return memoWk.filter(function (m) { return m.st === '채택'; }).length; }
  var cnt = function (n, u) { return n ? n + (u || '건') : '없음'; };
  // ① 결정 필요 — 받은 샘플 중 채택 · 드롭을 아직 안 정한 것(업체마다 마지막 회차 · 완료 프로젝트 · 채택한 프로젝트 제외)
  var DEC = NX_DEC.slice().sort(function (a, b) { return (wkDay_(a[si['전달일']]) || 0) - (wkDay_(b[si['전달일']]) || 0); });
  var L_DEC = DEC.map(function (x) { var d = wkDay_(x[si['전달일']]); return [wkMd_(x[si['전달일']]), d ? days(d) + '일' : '', proj(x), str_(x[si['업체명']]) || '미정', lastMemo(x), '', who(x, si, '담당자')]; });
  var dec7 = DEC_OLD.length;
  var decTop = DEC.slice(0, 2).map(function (x) { var d = wkDay_(x[si['전달일']]); return str_(x[si['품목명']]) + '(' + (str_(x[si['업체명']]) || '미정') + (d ? ' ' + days(d) + '일' : '') + ')'; });
  // ② 일정 지연
  var L_LATE2 = [];
  late.forEach(function (x) { L_LATE2.push({ n: days(x.t), row: ['입고 지연', nm(x.p), str_(x.p[pi['업체명']]), '예정 ' + wkMd_(x.t) + ' · 남은 ' + wkQty_(x.q) + '개', days(x.t) + '일', memoOfPo(x.p), wkWho_(x.p[pi['구매담당자']])] }); });
  S_LATE.forEach(function (x) { var d = wkDay_(x[si['전달예정일']]); L_LATE2.push({ n: days(d), row: ['샘플 지연', proj(x), str_(x[si['업체명']]) || '미정', '전달예정 ' + wkMd_(x[si['전달예정일']]), days(d) + '일', lastMemo(x), who(x, si, '담당자')] }); });
  L_LATE2.sort(function (a, b) { return b.n - a.n; });
  var L_PUSH = [];
  PUSHED.forEach(function (a) { var r = a[0], p = a[1]; L_PUSH.push([wkMd_(r[hi['시각']]), p ? nm(p) : str_(r[hi['품목명']]), p ? str_(p[pi['업체명']]) : '', chgTxt(r), '', '', wkWho_(r[hi['바꾼사람']])]); });
  function memoOfPo(p) { return str_(p[pi['비고']] || '').slice(0, 80); }
  // ⑤ 향후 7일 예정(결정 대기는 ①에)
  var L_NX2 = NX_IN.map(function (a) { var r = a[0], p = a[1]; return { d: wkDay_(r[yi['입고일']]), row: [wkMd_(r[yi['입고일']]), '입고 예정 · ' + tagNew(p), nm(p), wkQty_(r[yi['수량']]) + '개', str_(p[pi['업체명']]), '', wkWho_(p[pi['구매담당자']])] }; })
    .concat(NX_SMP.map(function (x) { return { d: wkDay_(x[si['전달예정일']]), row: [wkMd_(x[si['전달예정일']]), '샘플 전달 예정', proj(x), lastMemo(x), str_(x[si['업체명']]) || '미정', '', who(x, si, '담당자')] }; }))
    .sort(function (a, b) { return (a.d || 0) - (b.d || 0); }).map(function (x) { return x.row; });
  // ④ 실적 금액
  var num = function (v) { var n = Number(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; };
  var poKrw = 0, poFx = 0; NEW_PO.concat(OLD_PO).forEach(function (x) { var cur = str_(x[pi['통화']]).toUpperCase(); if (!cur || cur === 'KRW' || cur === '원' || cur === '원화') poKrw += num(x[pi['발주수량']]) * num(x[pi['단가']]); else poFx++; });
  var inKrw = 0; NEW_IN.concat(OLD_IN).forEach(function (a) { inKrw += num(a[0][yi['금액']]); });
  var eok = function (n) { return n >= 1e8 ? (n / 1e8).toFixed(1) + '억' : n >= 1e4 ? Math.round(n / 1e4).toLocaleString('en-US') + '만' : Math.round(n).toLocaleString('en-US'); };
  var actN = L_PO.length + L_IN.length + L_REQ.length + L_RCV.length + L_QT.length + NEWPJ.length;
  var actTxt = [L_PO.length ? '발주 ' + L_PO.length + '건' + (poKrw ? '(₩' + eok(poKrw) + (poFx ? ' · 외화 ' + poFx + '건' : '') + ')' : '') : '', L_IN.length ? '입고 ' + L_IN.length + '건' + (inKrw ? '(₩' + eok(inKrw) + ')' : '') : '',
    NEWPJ.length ? '신제품 소싱 접수 ' + NEWPJ.length + '건' : '', L_REQ.length ? '샘플 요청 ' + L_REQ.length + '건' : '', L_RCV.length ? '샘플 수신 ' + L_RCV.length + '건' : '', L_QT.length ? '견적 ' + L_QT.length + '건' : '', adoptN() ? '채택 ' + adoptN() + '건' : '', L_PUSH.length ? '입고일정 변경 ' + L_PUSH.length + '건' : ''].filter(Boolean).join(' · ');
  var lateTop = L_LATE2.slice(0, 2).map(function (x) { return x.row[1].split(' · ')[0].slice(0, 24) + '(' + x.row[2] + ' ' + x.row[4] + ')'; });
  var waitTop = W_OPEN.slice(0, 2).map(function (x) { return x.wait + ' — ' + x.proj.slice(0, 20); });
  var nxTop = L_NX2.slice(0, 2).map(function (r) { return r[0] + ' ' + r[2].slice(0, 22); });
  // ── 2026-10-27 양식(담당자 지정): 1. 요약(1-1 건수 · 1-2 이슈) → 2. 발주건 → 3. 샘플건 → 4. 기타 특이사항(직접)
  // 금주 = 보고일이 든 주(월~일) · 전주 = 그 앞 주. 당일 기록 = 보고일(d1) 하루. 경과 · 지연일은 '마지막 진행 기록'부터 센다(최초 요청일부터 세면 장기 프로젝트가 전부 지연이 된다)
  var w0 = new Date(d1); w0.setDate(w0.getDate() - ((w0.getDay() + 6) % 7)); var w1 = new Date(w0); w1.setDate(w1.getDate() + 6);
  var p0 = new Date(w0); p0.setDate(p0.getDate() - 7); var p1 = new Date(w0); p1.setDate(p1.getDate() - 1);
  var inR = function (x, a, b) { var d = wkDay_(x); return !!d && d >= a && d <= b; };
  var md = function (d) { return wkMd_(d); };
  var IDLE = 7;                                   // 마지막 진행 뒤 7일 넘게 움직임이 없으면 이슈
  // 업체 · 회차의 마지막 진행일 — 요청 · 수신 · 견적 · 진행 메모(보고일까지) 중 가장 늦은 날
  var lastAct = function (r) {
    var c = [r[si['요청일']], r[si['전달일']], r[si['견적수신일']]].map(wkDay_).filter(function (d) { return d && d <= d1; });
    memoOf(r).forEach(function (m) { var d = wkDay_(m.at); if (d && d <= d1) c.push(d); });
    return c.length ? new Date(Math.max.apply(null, c)) : null;
  };
  var lastTxt = function (r) {
    var L = memoOf(r).filter(function (m) { var d = wkDay_(m.at); return m.text && d && d <= d1; });
    return L.length ? dmd(L[L.length - 1].at) + ' ' + L[L.length - 1].text : '';
  };
  var idle = function (r) { var d = lastAct(r); return d ? days(d) : null; };
  // ── 1-1 건수
  var poOpen = PO.filter(function (r) { return ['계획', '상신'].indexOf(str_(r[pi['진행상태']])) < 0 && !poShut(r); });
  var sOpen = SMP.filter(function (r) { return str_(r[si['상태']]) === '진행중' && !str_(r[si['전달일']]) && projLive(r) && isLastQ(r); });
  var T_RCV = S_RCV, T_REQ = S_REQ, T_PO = NEW_PO.concat(OLD_PO).sort(byAt('작성일', pi));       // 당일(보고일) 기준
  var cntW = { rcv: SMP.filter(function (r) { return inR(r[si['전달일']], w0, d1); }).length, req: SMP.filter(function (r) { return inR(r[si['요청일']], w0, d1); }).length,
    po: PO.filter(function (r) { return inR(r[pi['작성일']], w0, d1) && poLive(r); }).length };
  // ── 2. 발주건
  var IN_W = [];                                  // 2-1 금주 입고예정(지난 날짜인데 아직 '예정'이면 지연 표시)
  PAY.forEach(function (r) {
    if (str_(r[yi['종류']]) !== '예정' || !inR(r[yi['입고일']], w0, w1)) return;
    var p = poById[str_(r[yi['실행판ID']]).toLowerCase()];
    if (p && !poShut(p)) IN_W.push([r, p]);
  });
  IN_W.sort(function (a, b) { return wkDay_(a[0][yi['입고일']]) - wkDay_(b[0][yi['입고일']]); });
  var L21 = IN_W.map(function (a) { var r = a[0], p = a[1], t = wkDay_(r[yi['입고일']]); return [md(t), nm(p), wkQty_(r[yi['수량']]) + '개', str_(p[pi['업체명']]), t < TODAY ? '지연 ' + days(t) + '일' : (t - TODAY === 0 ? '오늘' : '예정'), memoOfPo(p), wkWho_(p[pi['구매담당자']])]; });
  var L22 = H.rows.filter(function (r) { return inR(r[hi['시각']], p0, p1) && str_(r[hi['종류']]) === '입고일정'; }).map(function (r) { return [r, poOfHist(r)]; })
    .sort(function (a, b) { return wkDay_(a[0][hi['시각']]) - wkDay_(b[0][hi['시각']]); })
    .map(function (a) { var r = a[0], p = a[1]; return [wkMd_(r[hi['시각']]), p ? nm(p) : str_(r[hi['품목명']]), p ? str_(p[pi['업체명']]) : '', str_(r[hi['이전값']]), str_(r[hi['새값']]), str_(r[hi['사유']]), wkWho_(r[hi['바꾼사람']])]; });
  var IN_P = [];
  PAY.forEach(function (r) { if (str_(r[yi['종류']]) !== '입고' || !inR(r[yi['입고일']], p0, p1)) return; var p = poById[str_(r[yi['실행판ID']]).toLowerCase()]; if (p) IN_P.push([r, p]); });
  IN_P.sort(function (a, b) { return wkDay_(a[0][yi['입고일']]) - wkDay_(b[0][yi['입고일']]); });
  var inPKrw = 0; IN_P.forEach(function (a) { inPKrw += num(a[0][yi['금액']]); });
  var L23 = IN_P.map(function (a) { var r = a[0], p = a[1]; return [wkMd_(r[yi['입고일']]), nm(p), wkQty_(r[yi['수량']]) + '개', str_(p[pi['업체명']]), num(r[yi['금액']]) ? '₩' + eok(num(r[yi['금액']])) : '', str_(p[pi['진행상태']]), wkWho_(p[pi['구매담당자']])]; });
  var L24 = T_PO.map(function (x) { return [wkMd_(x[pi['작성일']]), tagNew(x), nm(x), wkQty_(x[pi['발주수량']]) + '개', str_(x[pi['업체명']]), '입고목표 ' + wkMd_(x[pi['입고목표']]), wkWho_(x[pi['구매담당자']])]; });
  // 2-5 발주건 이슈 — 입고 예정일이 지났는데 잔량이 남은 건(지연일 = 예정일부터)
  var L25 = late.map(function (x) { return [nm(x.p), str_(x.p[pi['업체명']]), '예정 ' + wkMd_(x.t), '남은 ' + wkQty_(x.q) + '개', days(x.t) + '일', memoOfPo(x.p), wkWho_(x.p[pi['구매담당자']])]; });
  // ── 3. 샘플건
  var L31 = T_RCV.map(function (x) { return [wkMd_(x[si['전달일']]), proj(x), str_(x[si['업체명']]) || '미정', '요청 ' + wkMd_(x[si['요청일']]), str_(x[si['상태']]) || '수신', lastTxt(x), who(x, si, '담당자')]; });
  var L32 = T_REQ.map(function (x) { return [wkMd_(x[si['요청일']]), proj(x), str_(x[si['업체명']]) || '미정', str_(x[si['수량']]) ? wkQty_(x[si['수량']]) + '개' : '', str_(x[si['구분']]), wkMd_(x[si['전달예정일']]), who(x, si, '담당자')]; });
  var L33 = L_WAIT;
  // 3-4 당일 진행 업데이트 — 보고일에 남긴 진행 메모만
  var L34 = MEMO.filter(function (m) { return inR(m.at, d1, d1) && m.text && !PDONE[m.pj]; }).sort(function (a, b) { return a.at < b.at ? -1 : 1; })
    .map(function (m) { return [str_(m.at).slice(11, 16) || dmd(m.at), m.proj, m.vendor, m.text, m.st && m.st !== '메모' ? m.st : '', m.wait ? '대기: ' + m.wait : '', ownerOfPV(m.pj, m.vk) || m.who]; });
  // 3-5 샘플진행건 이슈 — 마지막 진행 뒤 7일 넘게 움직임 없는 것: 기한 지남 · 받고 결정 안 함. 회신 대기 기한 지남도
  var SI = [];
  S_LATE.forEach(function (x) { var n = idle(x); if (n == null || n >= IDLE) SI.push({ n: n == null ? 999 : n, row: ['기한 지남', proj(x), str_(x[si['업체명']]) || '미정', '기한 ' + wkMd_(x[si['전달예정일']]) + ' (' + days(wkDay_(x[si['전달예정일']])) + '일 지남)', n == null ? '' : n + '일 전', lastTxt(x), who(x, si, '담당자')] }); });
  NX_DEC.forEach(function (x) { var n = idle(x); if (n != null && n >= IDLE) SI.push({ n: n, row: ['결정 대기', proj(x), str_(x[si['업체명']]) || '미정', '수신 ' + wkMd_(x[si['전달일']]) + ' · 채택/드롭 미정', n + '일 전', lastTxt(x), who(x, si, '담당자')] }); });
  W_OPEN.forEach(function (x) { var d = wkDay_(x.due); if (d && d < TODAY) SI.push({ n: days(d), row: ['회신 기한 지남', x.proj, x.vendor || '', x.wait + ' — ' + x.text, '기한 ' + wkMd_(x.due) + ' (' + days(d) + '일 지남)', '', x.who] }); });
  SI.sort(function (a, b) { return b.n - a.n; });
  var L35 = SI.map(function (x) { return x.row; });
  var nIdleOK = S_LATE.length + NX_DEC.length - SI.filter(function (x) { return x.row[0] !== '회신 기한 지남'; }).length;
  // ── 2026-10-27 v7: 1. 현황 요약(숫자 칸 + 특이사항 요약) → 2. 발주건(표를 항목마다 따로) → 3. 샘플건(표를 항목마다 따로) → 4. 기타 특이사항 및 명일 계획
  // 기간: d0 = d1 이면 일일(당일), d0 < d1 이면 주간 취합(그 주 월 ~ 일 · 오늘까지). 금주 · 전주 = d1 이 든 주와 그 앞 주
  // 이슈 = 담당자가 발주건 · 샘플건에 등록한 것(열림) + 보고서가 찾은 것(입고 지연 · 멈춘 샘플 · 회신 기한 지남). 팀장이 피드백을 쓰면 '확인' → 이슈에서 빠진다
  var WK = d0 < d1, PL = WK ? '주간' : '당일';
  var ISSL = []; try { ISSL = issAll_(); } catch (eI) { ISSL = []; }
  var ISS_OK = {}; ISSL.forEach(function (x) { if (x.st === '확인') ISS_OK[x.id] = 1; });
  var ISS_OPEN = ISSL.filter(function (x) { return x.st !== '확인'; });
  var sheetRowOf = function (r) { return SM.rows.indexOf(r) + 2; };
  var rvOf = function (r) { var R0 = RVS[pjOf(r)] || {}, sid = si['샘플ID'] == null ? '' : str_(r[si['샘플ID']]); return R0[sid] || R0['r' + sheetRowOf(r)] || null; };
  var pjId = function (r) { return si['프로젝트ID'] == null ? '' : str_(r[si['프로젝트ID']]); };
  var dts = function (v) { return str_(v).split(/\s*,\s*/).filter(String).map(function (x) { return wkMd_(x); }).join(', '); };      // '2026-10-19, 2026-10-23' → '10/19, 10/23'
  var poNo = function (p) { return p ? str_(p[pi['품의번호']]) : ''; };
  var iss = function (id, meta, x) { return { id: id, kind: meta.kind, ref: meta.ref, name: meta.name, vendor: meta.vendor, text: meta.text, by: x ? x.by : '자동', at: x ? x.at : '' }; };
  var regTxt = function (x) { return x.text + ' (' + x.at.slice(5, 10).replace('-', '/') + ' ' + x.by + ')'; };
  var SEC = function (id, t, cols, rows, o) { o = o || {}; return { id: id, t: t, cols: cols, rows: rows, fb: !!o.fb, hot: !!o.hot }; };
  // ── 2. 발주건
  // 구분(완제품 · 부자재 …)별로 표를 나눈다(2026-10-27 담당자) — 완제품 · 부자재 먼저, 그 밖의 구분은 그 이름으로
  var catOf = function (p) { return p ? (str_(p[pi['구분']]) || '기타') : '기타'; };
  var CAT_ORD = ['완제품', '부자재'];
  var byCat = function (id, t, cols, rows) {
    var cats = []; rows.forEach(function (x) { if (cats.indexOf(x.cat) < 0) cats.push(x.cat); });
    cats.sort(function (a, b) { var x = CAT_ORD.indexOf(a), y = CAT_ORD.indexOf(b); return (x < 0 ? 9 : x) - (y < 0 ? 9 : y) || (a < b ? -1 : 1); });
    if (!cats.length) return [SEC(id, t, cols, [])];
    return cats.map(function (c, i) { return SEC(id + (i ? '-' + i : ''), t + ' · ' + c, cols, rows.filter(function (x) { return x.cat === c; })); });
  };
  var P_ISS = [];
  ISS_OPEN.filter(function (x) { return x.kind === '발주'; }).forEach(function (x) {
    var p = poById[x.ref.replace(/^po:/, '')];
    P_ISS.push({ warn: 1, c: ['등록 이슈', poNo(p), p ? str_(p[pi['업체명']]) : x.vendor, p ? nm(p) : x.name, p ? wkMd_(p[pi['입고목표']]) : '', regTxt(x)], iss: iss(x.id, x, x) });
  });
  late.forEach(function (x) {
    var pid = pidOf(x.p), key = 'auto:late:' + pid + ':' + ymd(x.t); if (ISS_OK[key]) return;
    var tx = '지연 ' + days(x.t) + '일 · 잔량 ' + wkQty_(x.q) + '개' + (memoOfPo(x.p) ? ' — ' + memoOfPo(x.p) : '');
    P_ISS.push({ warn: 1, c: ['입고 지연', poNo(x.p), str_(x.p[pi['업체명']]), nm(x.p), wkMd_(x.t), tx], iss: iss(key, { kind: '발주', ref: 'po:' + pid, name: nm(x.p), vendor: str_(x.p[pi['업체명']]), text: '[입고 지연] 예정 ' + wkMd_(x.t) + ' · ' + tx }) });
  });
  var P_NEW = T_PO.map(function (x) { return { cat: catOf(x), c: [wkMd_(x[pi['작성일']]), poNo(x), str_(x[pi['업체명']]), nm(x), wkQty_(x[pi['발주수량']]), wkMd_(x[pi['입고목표']]), tagNew(x) + ' · ' + str_(x[pi['진행상태']])] }; });
  var P_IN_W = IN_W.map(function (a) { var r = a[0], p = a[1], t = wkDay_(r[yi['입고일']]), lt = t < TODAY;
    return { cat: catOf(p), warn: lt ? 1 : 0, c: [wkMd_(t), poNo(p), str_(p[pi['업체명']]), nm(p), wkQty_(r[yi['수량']]), lt ? '지연 ' + days(t) + '일' : (t - TODAY === 0 ? '오늘' : '예정'), memoOfPo(p)] }; });
  var P_CHG = H.rows.filter(function (r) { return inR(r[hi['시각']], p0, p1) && str_(r[hi['종류']]) === '입고일정'; }).sort(function (a, b) { return wkDay_(a[hi['시각']]) - wkDay_(b[hi['시각']]); }).map(function (r) {
    var p = poOfHist(r), a0 = first(str_(r[hi['이전값']])), b0 = first(str_(r[hi['새값']])), push = a0 && b0 && b0 > a0;
    return { cat: catOf(p), warn: push ? 1 : 0, c: [wkMd_(r[hi['시각']]), p ? poNo(p) : str_(r[hi['품의번호']]), p ? str_(p[pi['업체명']]) : '', p ? nm(p) : str_(r[hi['품목명']]), dts(r[hi['이전값']]), dts(r[hi['새값']]) + (push ? ' (늦춰짐)' : ''), str_(r[hi['사유']]), wkWho_(r[hi['바꾼사람']])] };
  });
  // 남은 잔량 — 진행상태 대신(2026-10-27 담당자): 잔량 N개 · 전량 입고 · 잔량 마감
  var remTxt = function (p) {
    if (pi['종결'] != null && str_(p[pi['종결']])) return '잔량 마감';
    var rm = pi['발주잔량'] == null ? '' : str_(p[pi['발주잔량']]).replace(/,/g, '');
    if (rm !== '' && isFinite(Number(rm))) return Number(rm) > 0 ? '잔량 ' + wkQty_(rm) + '개' : '전량 입고';
    return str_(p[pi['진행상태']]) === '종결' ? '완료' : '';
  };
  var P_IN = IN_P.map(function (a) { var r = a[0], p = a[1]; return { cat: catOf(p), c: [wkMd_(r[yi['입고일']]), poNo(p), str_(p[pi['업체명']]), nm(p), wkQty_(r[yi['수량']]), num(r[yi['금액']]) ? '₩' + eok(num(r[yi['금액']])) : '', remTxt(p)] }; });
  // ── 3. 샘플건
  var brandOf = function (pj) { var r = SMP.filter(function (x) { return pjOf(x) === pj; })[0]; return r ? str_(r[si['브랜드']]) : ''; };
  var wt = function (x) { return { pj: x.pj, vk: x.vk || '', at: x.at, text: x.rawText != null ? x.rawText : x.text, name: x.proj, brand: brandOf(x.pj) }; };
  var smpOfRef = function (ref) {
    var m = ref.match(/^s:(.*)\|([^|]*)$/); if (!m) return null;
    var L = SMP.filter(function (x) { return pjOf(x) === m[1] && (!m[2] || vk(str_(x[si['업체명']]) || '미정') === m[2]); });
    return L.length ? L[L.length - 1] : null;
  };
  var S_ISS = [];
  ISS_OPEN.filter(function (x) { return x.kind === '샘플'; }).forEach(function (x) {
    var r = smpOfRef(x.ref);
    S_ISS.push({ warn: 1, c: ['등록 이슈', r ? pjId(r) : '', x.vendor || (r ? str_(r[si['업체명']]) : '') || '프로젝트 전체', r ? proj(r) : x.name, regTxt(x)], iss: iss(x.id, x, x) });
  });
  // 샘플은 자동 이슈(기한 지남 · 결정 대기 · 회신 기한 지남)를 만들지 않는다 — 담당자가 등록한 이슈만(2026-10-27 담당자). 회신 기한이 지난 건은 3-4 회신 대기에 '기한 지남'으로만
  var rvTxt = function (r) { var v = rvOf(r); return v ? '검토 ' + v.res + (v.note ? '(' + v.note + ')' : '') : ''; };
  var S_RCV2 = T_RCV.map(function (x) { return { c: [wkMd_(x[si['전달일']]), pjId(x), str_(x[si['업체명']]) || '미정', proj(x), wkQty_(x[si['수량']]), [rvTxt(x), lastTxt(x)].filter(String).join(' · ') || '수신'] }; });
  var S_REQ2 = T_REQ.map(function (x) { return { c: [wkMd_(x[si['요청일']]), pjId(x), str_(x[si['업체명']]) || '미정', proj(x), wkQty_(x[si['수량']]), wkMd_(x[si['전달예정일']]), str_(x[si['구분']])] }; });
  var pjIdOf = function (pj) { var r0 = SMP.filter(function (y) { return pjOf(y) === pj; })[0]; return r0 ? pjId(r0) : ''; };
  var S_WAIT = W_OPEN.map(function (x) { var d = wkDay_(x.due); return { c: [wkMd_(x.at), pjIdOf(x.pj), x.vendor || '', x.proj, x.wait + ' — ' + x.text, x.due ? wkMd_(x.due) + (d < TODAY ? ' (지남)' : '') : ''], wt: wt(x) }; });
  var S_DONE = W_DONE.map(function (x) { return { c: [wkMd_(x.waitDone), pjIdOf(x.pj), x.vendor || '', x.proj, x.wait + ' — ' + x.text, x.waitReply || '(내용 없음)'] }; });
  var S_UPD = MEMO.filter(function (m) { return inR(m.at, d0, d1) && m.text && !PDONE[m.pj] && !m.wait; }).sort(function (a, b) { return a.at < b.at ? -1 : 1; }).map(function (m) {
    var r0 = SMP.filter(function (x) { return pjOf(x) === m.pj; })[0];
    return { c: [WK ? dmd(m.at) : (str_(m.at).slice(11, 16) || dmd(m.at)), r0 ? pjId(r0) : '', m.vendor, m.proj, m.text, m.st && m.st !== '메모' ? m.st : '', ownerOfPV(m.pj, m.vk) || m.who] };
  });
  var nPoIss = P_ISS.length, nSIss = S_ISS.length;
  var KPI = [
    { k: 'po', label: '발주 건수', v: poOpen.length, sub: '진행 중' },
    { k: 'poin', label: '발주 접수건수', v: T_PO.length, sub: WK ? '주간' : '당일 · 금주 ' + cntW.po },
    { k: 'sreq', label: '샘플요청 접수건', v: T_REQ.length, sub: WK ? '주간' : '당일 · 금주 ' + cntW.req },
    { k: 'sopen', label: '샘플 진행건수', v: sOpen.length, sub: '받기 전' },
    { k: 'srcv', label: '샘플 수신건수', v: T_RCV.length, sub: WK ? '주간' : '당일 · 금주 ' + cntW.rcv },
    { k: 'poiss', label: '발주 이슈건', v: nPoIss, warn: 1, sub: '피드백 전' },
    { k: 'siss', label: '샘플 이슈건', v: nSIss, warn: 1, sub: '피드백 전' }
  ];
  var issTop = function (L) { return L.slice(0, 2).map(function (x) { return x.c[3].slice(0, 20) + ' ' + x.c[0]; }).join(', '); };
  var NOTE = '[특이사항 요약] ' + (nPoIss ? '발주 이슈 ' + nPoIss + '건(' + issTop(P_ISS) + ')' : '발주 이슈 없음') + ', ' + (nSIss ? '샘플 이슈 ' + nSIss + '건(' + issTop(S_ISS) + ')' : '샘플 이슈 없음');
  var wr = function (a, b) { return md(a) + '~' + md(b); };
  var PO_S = [
    SEC('p1', '2-1. 발주 이슈', ['구분', '발주번호', '협력업체', '품목명 / 차수', '입고예정', '이슈 내용'], P_ISS, { fb: 1, hot: 1 })
  ].concat(byCat('p2', '2-2. 금주 입고예정 (' + wr(w0, w1) + ')', ['입고예정일', '발주번호', '협력업체', '품목명 / 차수', '수량', '상태', '비고'], P_IN_W))
    .concat(byCat('p3', '2-3. 전주 일정변경 (' + wr(p0, p1) + ')', ['변경일', '발주번호', '협력업체', '품목명 / 차수', '이전 일정', '새 일정', '사유', '변경자'], P_CHG))
    .concat(byCat('p4', '2-4. 전주 입고 (' + wr(p0, p1) + ')', ['입고일', '발주번호', '협력업체', '품목명 / 차수', '입고수량', '금액', '잔량'], P_IN))
    .concat(byCat('p5', '2-5. ' + PL + ' 발주 접수', ['작성일', '발주번호', '협력업체', '품목명 / 차수', '발주수량', '입고목표', '구분 · 상태'], P_NEW));
  var SM_S = [
    SEC('s1', '3-1. 샘플 이슈', ['구분', '샘플관리ID', '업체', '샘플 품목', '이슈 내용'], S_ISS, { fb: 1, hot: 1 }),
    SEC('s2', '3-2. 수신 샘플 (' + PL + ')', ['수신일', '샘플관리ID', '업체', '샘플 품목', '수량', '검토현황 및 후속조치'], S_RCV2),
    SEC('s3', '3-3. 접수 샘플 (' + PL + ' 요청)', ['요청일', '샘플관리ID', '업체', '샘플 품목', '수량', '전달예정', '구분'], S_REQ2),
    SEC('s4', '3-4. 회신 대기', ['요청일', '샘플관리ID', '업체', '샘플 품목', '대기 대상 · 요청 내용', '회신 기한'], S_WAIT, { fb: 1 }),
    SEC('s5', '3-5. 회신 받음 (' + PL + ')', ['회신일', '샘플관리ID', '업체', '샘플 품목', '대기 대상 · 요청 내용', '회신 내용'], S_DONE),
    SEC('s6', '3-6. ' + PL + ' 진행 업데이트', [WK ? '일자' : '시각', '샘플관리ID', '업체', '샘플 품목', '내용', '상태 변경', '담당'], S_UPD)
  ];
  return { v: 7, week: WK, from: ymd(d0), to: ymd(d1), nextFrom: ymd(n0), nextTo: ymd(n1), wk: { from: ymd(w0), to: ymd(w1), prevFrom: ymd(p0), prevTo: ymd(p1) },
    kpi: KPI, note: NOTE, poS: PO_S, smS: SM_S,
    summary: { rows: [], kpi: [], hl: [], team: [], tables: [] }, parts: [] };
}
