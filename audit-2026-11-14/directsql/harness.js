// JS(실제 Keys.js apiSetState0_ · poCancel_ — 가짜 시트) ↔ SQL(rb_od_state · rb_po_cancel — 로컬 Postgres) 비교
// 쓰기: node harness.js <cn 폴더(원본 서버 코드)> <PdDirect.js>
'use strict';
const fs = require('fs'), vm = require('vm'), cp = require('child_process'), path = require('path');
const CN = process.argv[2], PDD = process.argv[3];
const DB = process.env.RB_DB || 'ds';
const TAB = '_실행판_발주';

// ---------- 가짜 GAS ----------
function mkProps() { const m = {}; return { getProperty: k => (k in m ? m[k] : null), setProperty: (k, v) => { m[k] = String(v); }, deleteProperty: k => { delete m[k]; }, getProperties: () => Object.assign({}, m), getKeys: () => Object.keys(m), setProperties: o => Object.assign(m, o), _m: m }; }
const PROPS = mkProps();
const CACHE = (() => { const m = {}; return { get: k => (k in m ? m[k] : null), put: (k, v) => { m[k] = String(v); }, remove: k => { delete m[k]; }, getAll: ks => { const o = {}; ks.forEach(k => { if (k in m) o[k] = m[k]; }); return o; } }; })();
const LOCK = { tryLock: () => true, waitLock: () => { }, releaseLock: () => { }, hasLock: () => true };
const ctx = {
  console: { log() { }, warn() { }, error() { } },
  PropertiesService: { getScriptProperties: () => PROPS, getUserProperties: () => mkProps() },
  CacheService: { getScriptCache: () => CACHE, getUserCache: () => CACHE },
  LockService: { getScriptLock: () => LOCK, getUserLock: () => LOCK },
  Utilities: { getUuid: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, () => (Math.random() * 16 | 0).toString(16)), formatDate: (d, tz, f) => new Date(d).toISOString(), sleep() { } },
  SpreadsheetApp: { flush() { } },
  Session: { getActiveUser: () => ({ getEmail: () => 'tester@x' }), getEffectiveUser: () => ({ getEmail: () => 'tester@x' }) },
  ScriptApp: { getProjectTriggers: () => [] },
  Date, JSON, Math, Object, Array, String, Number, RegExp, Error, isNaN, parseInt, parseFloat, encodeURIComponent, Proxy
};
vm.createContext(ctx);
for (const f of ['Code.js', 'Keys.js']) vm.runInContext(fs.readFileSync(path.join(CN, f), 'utf8'), ctx, { filename: f });
vm.runInContext(fs.readFileSync(PDD, 'utf8'), ctx, { filename: 'PdDirect.js' });

// ---------- 가짜 발주 DB 시트 ----------
const HEAD = ['품의번호', '발주일', '구분', '브랜드', '채널', '품목코드', '품목명', '발주차수', '발주수량', '업체명', '단가', '발주금액', '진행상태', '입고목표', '입고일정', '입고수량', '발주잔량', '비고', '작성일', '발주요청팀', '요청팀담당자', '소진완료목표일', '발주요청링크', '통화', '결재문서번호', '구매담당자', '실행판ID'];
const C = n => HEAD.indexOf(n);
function row(o) { const r = HEAD.map(() => ''); Object.keys(o).forEach(k => { r[C(k)] = o[k]; }); return r; }
const BASE = [
  HEAD,
  row({ 품의번호: 'MTB2C-202611-01', 품목코드: 'M0001AA1', 품목명: '세럼 A', 발주차수: '1차', 발주수량: 1000, 단가: 1200, 진행상태: '계획', 실행판ID: 'RB261101-AAA001' }),          // 2
  row({ 품의번호: 'MTB2C-202611-02', 품목코드: 'M0002AA1', 품목명: '세럼 B', 발주차수: '2차', 발주수량: 500, 단가: 900, 진행상태: '상신', 실행판ID: 'RB261101-AAA002' }),            // 3
  row({ 품의번호: 'MTB2C-202611-03', 품목코드: 'M0003AA1', 품목명: '토너 C', 발주차수: '1차', 진행상태: '승인', 결재문서번호: 'AP-777', 실행판ID: 'RB261101-AAA003' }),               // 4
  row({ 품의번호: 'MTB2C-202611-04', 품목코드: 'M0004AA1', 품목명: '크림 D', 발주차수: '3차', 진행상태: '발주', 결재문서번호: 'AP-778', 발주일: '2026-11-03', 실행판ID: 'RB261101-AAA004' }), // 5
  row({ 품의번호: 'MTB2C-202610-05', 품목코드: 'M0005AA1', 품목명: '앰플 E', 진행상태: '종결', 실행판ID: 'RB261101-AAA005' }),                                                       // 6
  row({ 품의번호: 'MTB2C-202610-06', 품목코드: 'M0006AA1', 품목명: '패드 F', 진행상태: '취소', 실행판ID: 'RB261101-AAA006' }),                                                       // 7
  row({ 품의번호: 'MTB2C-202611-07', 품목코드: 'M0007AA1', 품목명: '마스크 G', 진행상태: '', 실행판ID: 'RB261101-AAA007' }),                                                         // 8 (빈 상태)
  row({ 품목코드: 'M0008AA1', 품목명: '미스트 H', 진행상태: '계획', 실행판ID: 'RB261101-AAA008' }),                                                                                  // 9 (품의번호 없음)
  row({ 품의번호: 'MTB2C-202611-09', 품목코드: 'M0009AA1', 품목명: '겹침 I', 진행상태: '상신', 실행판ID: 'RB261101-DUP009' }),                                                     // 10 겹침
  row({ 품의번호: 'MTB2C-202611-09', 품목코드: 'M0009AA1', 품목명: '겹침 I', 진행상태: '상신', 실행판ID: 'RB261101-DUP009' }),                                                     // 11 겹침
  row({ 품의번호: 'MTB2C-202611-10', 품목코드: 'M0010AA1', 품목명: '옛 열쇠 J', 진행상태: '상신' }),                                                                                  // 12 ID 없음
  row({ 품의번호: 'OLD-1', 품목코드: 'M0011AA1', 품목명: '옛 ID K', 진행상태: '승인', 결재문서번호: 'AP-9', 실행판ID: 'old-1|m0011aa1' }),                                          // 13 옛 조합 열쇠 ID
  row({ 품의번호: 'MTB2C-202611-12', 품목코드: 'M0012AA1', 품목명: '공백 L', 진행상태: ' 상신 ', 실행판ID: ' RB261101-AAA012 ' })                                                    // 14 앞뒤 공백
];
let DATA;
function sheet() {
  const rng = (r, c, nr, nc) => {
    nr = nr || 1; nc = nc || 1;
    const R = {
      getValue: () => { const x = (DATA[r - 1] || [])[c - 1]; return x === undefined ? '' : x; },
      getValues: () => { const o = []; for (let i = 0; i < nr; i++) { const a = []; for (let j = 0; j < nc; j++) { const x = (DATA[r - 1 + i] || [])[c - 1 + j]; a.push(x === undefined ? '' : x); } o.push(a); } return o; },
      setValue: v => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) { while (DATA.length < r + i) DATA.push(HEAD.map(() => '')); DATA[r - 1 + i][c - 1 + j] = v; } return R; },
      setValues: vs => { vs.forEach((a, i) => a.forEach((v, j) => { DATA[r - 1 + i][c - 1 + j] = v; })); return R; },
      setNumberFormat: () => R, setFontWeight: () => R
    };
    return R;
  };
  return {
    getRange: (a, b, c, d) => rng(a, b, c, d), getName: () => TAB, getSheetName: () => TAB,
    getLastRow: () => { let n = DATA.length; while (n > 0 && DATA[n - 1].every(x => x === '' || x == null)) n--; return n; },
    getLastColumn: () => HEAD.length, getMaxRows: () => DATA.length, getMaxColumns: () => HEAD.length
  };
}

// 실제 함수 중 바깥(잠금 · 캐시 · 이력 · AP · 진행 기록)만 갈아 끼운다
let AUD, DOCQ0, DOCQ_OUT, PROG;
Object.assign(ctx, {
  statusSheet_: () => sheet(), pdLock_: () => LOCK, waitLock_: () => { }, drainJournalIfState_: () => 0, deferVer_: () => true, endVer_: () => { },
  cacheGet_: () => null, cachePut_: () => { }, cacheDrop_: () => { }, requireEditor_: () => { }, podbLaterOn_: () => false, bumpVer_: () => { }, apRefreshSoon_: () => { },
  appendHist_: list => { AUD.push(...list); }, docQueueRead_: () => JSON.parse(JSON.stringify(DOCQ0)), docQueueWrite_: q => { DOCQ_OUT = q; },
  metaFast_: () => ({ steps: [], cfg: {} }), dateSlots_: () => ({}), bulkEditProgress_: ids => { PROG = ids; return ids.length; }, me_: () => 'tester@x'
});
function jsRun(fn, args) {
  DATA = JSON.parse(JSON.stringify(BASE)); AUD = []; DOCQ_OUT = null; PROG = null;
  DOCQ0 = { 'id:RB261101-AAA002': '2026-11-10', 'id:RB261101-AAA003': '2026-11-10', [ctx.norm_('MTB2C-202611-07')]: '2026-11-11', 'id:RB261101-ZZZ': '2026-11-12' };
  vm.runInContext('RB_COLS_MEMO = null; RB_KEYCOLS_MEMO = {}; RB_ROWKEY = {};', ctx);
  let res, err = null;
  try { res = ctx[fn].apply(null, JSON.parse(JSON.stringify(args))); } catch (e) { err = e.message; }
  return { res, err, data: DATA, aud: AUD.map(audKey), docq: DOCQ_OUT, prog: PROG };
}
function audKey(a) { return { id: a.id || '', doc: a.doc || '', code: a.code || '', name: a.name || '', item: a.item, before: String(a.before), after: String(a.after), where: a.where }; }

// ---------- SQL ----------
function psql(sql) {
  return cp.execSync(`su nobody -s /bin/bash -c "/usr/lib/postgresql/16/bin/psql -X -q -At -h /tmp/rbpg_once1 -p 5544 -U postgres -d ${DB} -v ON_ERROR_STOP=1"`, { input: sql, encoding: 'utf8' });
}
const q = s => "'" + String(s).replace(/'/g, "''") + "'";
function pdConf(over) {
  // 서버 pdConfBuild_ 그대로(rb.pdHead = 전체 맞추기가 적는 값)
  PROPS.setProperty('rb.pdHead', JSON.stringify({ hr: 1, head: HEAD, idc: C('실행판ID'), st: C('진행상태') }));
  Object.assign(ctx, { tvDefs_: () => ({ pd: { tab: TAB } }), tvOn_: () => true, tvP_: (k, w) => 'rb.' + k + w, mirrorBuildOk_: () => true, sbMigDone_: () => true, RB_BUILD: 't' });
  PROPS.setProperty('rb.pdmirror', 'x 1 t');
  const c = vm.runInContext('pdConfBuild_()', ctx);
  return Object.assign(c, over || {});
}
function cellsOf(r) { return r.map(v => (v === '' || v == null ? null : v)); }
function sqlRun(fn, args, o) {
  o = o || {};
  const conf = pdConf(o.conf);
  const rows = BASE.map((r, i) => `(${q(TAB)}, ${i + 1}, ${q(JSON.stringify(cellsOf(o.head && i === 0 ? o.head : r)))}::jsonb, now())`).join(',\n');
  const jobs = (o.jobs || []).map(j => `insert into rb_tab_job(tab, job) values (${q(j.tab)}, ${q(JSON.stringify(j.job))}::jsonb);`).join('\n');
  const call = o.once ? `select test_once(${q(o.tok || 'tokE')}, ${q(o.once)}, ${q(fn)}, ${q(JSON.stringify({ p_args: args }))}::jsonb);` + (o.twice ? `select test_once(${q(o.tok || 'tokE')}, ${q(o.once)}, ${q(fn)}, ${q(JSON.stringify({ p_args: args }))}::jsonb);` : '')
    : `select test_call(${q(fn)}, ${q(o.tok || 'tokE')}, ${q(JSON.stringify(args))}::jsonb);`;
  const sql = `
delete from sheet_rows where tab = ${q(TAB)}; insert into sheet_rows(tab, "row", cells, synced_at) values ${rows};
delete from rb_tab_job; delete from rb_recent; delete from rb_ver; delete from rb_conf where k in ('pdConf', 'pdJ');
insert into rb_conf(k, v) values ('pdConf', ${q(JSON.stringify(conf))}::jsonb);
${o.pdJ ? `insert into rb_conf(k, v) values ('pdJ', ${q(JSON.stringify({ ids: o.pdJ }))}::jsonb);` : ''}
${jobs}
delete from rb_ver;
${call}
select coalesce(json_agg(cells order by "row"), '[]') from sheet_rows where tab = ${q(TAB)};
select coalesce(json_agg(json_build_object('tab', tab, 'job', job) order by id), '[]') from rb_tab_job where tab in ('pdx', 'pj') and coalesce(job->>'fn', '_pdPost') = '_pdPost' and job->>'who' = 'tester@x';
select 'V:' || coalesce((select v from rb_ver where k = 'r'), '');
`;
  const out = psql(sql).trim().split('\n');
  const r = out.slice(0, o.twice ? 2 : 1).map(x => JSON.parse(x)), cells = JSON.parse(out[out.length - 3]), jobs2 = JSON.parse(out[out.length - 2]);
  const data = cells.map(c => HEAD.map((_, i) => (c[i] == null ? '' : c[i])));
  const post = jobs2.filter(j => j.tab === 'pj').map(j => j.job.args[0]);
  const aud = [].concat(...post.map(p => (p.audits || []).map(a => audKey({ id: a.id, doc: a.doc, code: a.code, name: a.item, item: a.what, before: a.before, after: a.after,
    where: [TAB, a.row ? a.row + '행' : '', a.col ? ctx.colLetterRB_(a.col) + '열' : ''].filter(String).join(' ') }))));
  const ids = [].concat(...post.map(p => p.ids || []));
  // 품의번호 대기열 · 진행 기록은 서버 뒷정리(pdDirectPost_)가 같은 도우미로 — 여기서 그대로 돌려 본다
  let docq = null;
  if (ids.length) { DOCQ0 = { 'id:RB261101-AAA002': '2026-11-10', 'id:RB261101-AAA003': '2026-11-10', [ctx.norm_('MTB2C-202611-07')]: '2026-11-11', 'id:RB261101-ZZZ': '2026-11-12' }; DOCQ_OUT = null; ctx.poCancelDocq_(ids); docq = DOCQ_OUT; }
  const R0 = r[r.length - 1];
  return { res: R0.ok, err: R0.err || null, data, aud, docq, prog: ids.length ? ids : null, pdx: jobs2.filter(j => j.tab === 'pdx').map(j => j.job.rows), ver: out[out.length - 1].slice(2), first: r[0] };
}

// ---------- 시험 ----------
const strip = r => { if (!r || typeof r !== 'object') return r; const o = Object.assign({}, r); delete o.direct; delete o.timing; return o; };
const canon = v => Array.isArray(v) ? v.map(canon) : (v && typeof v === 'object' ? Object.keys(v).sort().reduce((o, k) => { o[k] = canon(v[k]); return o; }, {}) : v);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const ex = (id, extra) => Object.assign({ id: id }, extra || {});
const REF = r => { const v = BASE[r - 1]; return { id: String(v[C('실행판ID')]).trim(), doc: v[C('품의번호')], code: v[C('품목코드')], batch: v[C('발주차수')], name: v[C('품목명')] }; };
const it = (r, over) => ({ id: REF(r).id, statusRow: r, expect: Object.assign(REF(r), over || {}) });
const ST = 'apiSetState0_', PC = 'apiPoCancel0_';
const cases = [
  // [이름, JS 함수, SQL 함수, 인자, 기대('same' | 'fallback' | 'sqlerr:<정규식>'), SQL 옵션]
  ['상태 계획→상신', ST, 'rb_od_state', [2, REF(2), '상신'], 'same'],
  ['상태 상신→승인', ST, 'rb_od_state', [3, REF(3), '승인'], 'same'],
  ['상태 승인→발주', ST, 'rb_od_state', [4, REF(4), '발주'], 'same'],
  ['상태 발주→취소', ST, 'rb_od_state', [5, REF(5), '취소'], 'same'],
  ['상태 발주→종결', ST, 'rb_od_state', [5, REF(5), '종결'], 'same'],
  ['상태 종결→계획(풀기)', ST, 'rb_od_state', [6, REF(6), '계획'], 'same'],
  ['상태 취소→발주(취소 풀기)', ST, 'rb_od_state', [7, REF(7), '발주'], 'same'],
  ['상태 빈칸→계획', ST, 'rb_od_state', [8, REF(8), '계획'], 'same'],
  ['같은 상태(바뀜 없음)', ST, 'rb_od_state', [2, REF(2), '계획'], 'same'],
  ['상태 앞뒤 공백 " 승인 "', ST, 'rb_od_state', [3, REF(3), ' 승인 '], 'same'],
  ['모르는 상태 "보류"', ST, 'rb_od_state', [2, REF(2), '보류'], 'same'],
  ['빈 상태', ST, 'rb_od_state', [2, REF(2), ''], 'same'],
  ['행 번호 1', ST, 'rb_od_state', [1, REF(2), '상신'], 'same'],
  ['행 번호 0', ST, 'rb_od_state', [0, REF(2), '상신'], 'same'],
  ['행 번호 글자 "3"', ST, 'rb_od_state', ['3', REF(3), '승인'], 'same'],
  ['행 번호 null', ST, 'rb_od_state', [null, REF(3), '승인'], 'same'],
  ['행이 밀림(기억 4 · 실제 2)', ST, 'rb_od_state', [4, REF(2), '상신'], 'same'],
  ['행 번호가 끝 넘음(99)', ST, 'rb_od_state', [99, REF(3), '승인'], 'same'],
  ['없는 실행판ID', ST, 'rb_od_state', [2, ex('RB261101-NOPE99', { name: 'x' }), '상신'], 'same'],
  ['겹친 ID · 기억한 행이 맞음', ST, 'rb_od_state', [10, REF(10), '승인'], 'same'],
  ['겹친 ID · 기억한 행이 다름', ST, 'rb_od_state', [2, REF(10), '승인'], 'same'],
  ['ID 앞뒤 공백 행', ST, 'rb_od_state', [14, REF(14), '승인'], 'same'],
  ['옛 조합 열쇠 ID(…|…) 있음', ST, 'rb_od_state', [13, REF(13), '발주'], 'same'],
  ['옛 조합 열쇠 ID 못 찾음', ST, 'rb_od_state', [12, ex('mtb2c-202611-10|m0010aa1', { doc: 'MTB2C-202611-10', code: 'M0010AA1', batch: '', name: '옛 열쇠 J' }), '승인'], 'fallback'],
  ['ID 없는 확인값', ST, 'rb_od_state', [12, { doc: 'MTB2C-202611-10', code: 'M0010AA1', batch: '', name: '옛 열쇠 J' }, '승인'], 'fallback'],
  ['앞선 할 일(pj · 같은 건)', ST, 'rb_od_state', [2, REF(2), '상신'], 'fallback', { jobs: [{ tab: 'pj', job: { fn: 'apiSetDate', args: ['RB261101-AAA001', {}, 'submitted', '2026-11-14', 'po'], who: 'a@x', at: 1 } }] }],
  ['앞선 할 일(od · 같은 건)', ST, 'rb_od_state', [2, REF(2), '상신'], 'fallback', { jobs: [{ tab: 'od', job: { id: 'RB261101-AAA001', row: 2, patch: { memo: 'x' }, who: 'a@x' } }] }],
  ['앞선 할 일(다른 건) — 그대로', ST, 'rb_od_state', [2, REF(2), '상신'], 'same', { jobs: [{ tab: 'pj', job: { fn: 'apiSetDate', args: ['RB261101-AAA003'], who: 'a@x', at: 1 } }] }],
  ['앞선 직접 뒷정리(_pdPost)는 막지 않음', ST, 'rb_od_state', [2, REF(2), '상신'], 'same', { jobs: [{ tab: 'pj', job: { fn: '_pdPost', args: [{ kind: 'state', audits: [{ id: 'RB261101-AAA001' }] }], who: 'b@x', at: 1 } }] }],
  ['진행 장부 상태 올리기 남음(pdJ)', ST, 'rb_od_state', [2, REF(2), '상신'], 'fallback', { pdJ: { 'RB261101-AAA001': 1 } }],
  ['직접 저장 꺼짐(pdConf on=0)', ST, 'rb_od_state', [2, REF(2), '상신'], 'fallback', { conf: { on: '0', why: '시트가 Supabase 보다 앞섬' } }],
  ['머리글이 다름', ST, 'rb_od_state', [2, REF(2), '상신'], 'fallback', { head: HEAD.map(h => (h === '진행상태' ? '상태' : h)) }],
  ['보기 전용 세션', ST, 'rb_od_state', [2, REF(2), '상신'], 'sqlerr:RB_SESSION', { tok: 'tokV' }],
  ['rb_once 같은 요청 두 번', ST, 'rb_od_state', [2, REF(2), '상신'], 'once', { once: 'qtestonce0001', twice: true }],
  // ---------- 품의 취소 ----------
  ['품의 취소 상신(품의번호)', PC, 'rb_po_cancel', [[it(3)], '단가 바뀜'], 'same'],
  ['품의 취소 승인(품의번호 · 결재번호)', PC, 'rb_po_cancel', [[it(4)], '수량 변경'], 'same'],
  ['품의 취소 계획(품의번호만)', PC, 'rb_po_cancel', [[it(2)], '잘못 넣음'], 'same'],
  ['품의 취소 빈 상태', PC, 'rb_po_cancel', [[it(8)], '잘못 넣음'], 'same'],
  ['품의 취소 계획 · 품의번호 없음', PC, 'rb_po_cancel', [[it(9)], '사유'], 'same'],
  ['품의 취소 발주 건 → 건너뜀', PC, 'rb_po_cancel', [[it(5)], '사유'], 'same'],
  ['품의 취소 종결 · 취소 → 건너뜀', PC, 'rb_po_cancel', [[it(6), it(7)], '사유'], 'same'],
  ['품의 취소 여러 건(섞임)', PC, 'rb_po_cancel', [[it(2), it(3), it(4), it(5), it(6)], '일괄'], 'same'],
  ['품의 취소 없는 ID → 건너뜀', PC, 'rb_po_cancel', [[{ id: 'RB261101-NOPE99', statusRow: 3, expect: ex('RB261101-NOPE99', { name: '없는 건' }) }, it(3)], '사유'], 'same'],
  ['품의 취소 겹친 ID → 건너뜀', PC, 'rb_po_cancel', [[it(10), it(3)], '사유'], 'same'],
  ['품의 취소 행이 밀림', PC, 'rb_po_cancel', [[Object.assign(it(3), { statusRow: 7 })], '사유'], 'same'],
  ['품의 취소 같은 건 두 번', PC, 'rb_po_cancel', [[it(3), it(3)], '사유'], 'same'],
  ['품의 취소 사유 빈칸', PC, 'rb_po_cancel', [[it(3)], '  '], 'same'],
  ['품의 취소 행 번호 1 뿐', PC, 'rb_po_cancel', [[Object.assign(it(3), { statusRow: 1 })], '사유'], 'same'],
  ['품의 취소 빈 목록', PC, 'rb_po_cancel', [[], '사유'], 'same'],
  ['품의 취소 statusRow 글자 "4"', PC, 'rb_po_cancel', [[Object.assign(it(4), { statusRow: '4' })], '사유'], 'same'],
  ['품의 취소 공백 상태 " 상신 "(행 14)', PC, 'rb_po_cancel', [[it(14)], '사유'], 'same'],
  ['품의 취소 x.id 만(expect.id 없음)', PC, 'rb_po_cancel', [[{ id: 'RB261101-AAA002', statusRow: 3, expect: { doc: 'MTB2C-202611-02', code: 'M0002AA1', batch: '2차', name: '세럼 B' } }], '사유'], 'fallback'],
  ['품의 취소 옛 조합 열쇠 ID(있음)', PC, 'rb_po_cancel', [[it(13)], '사유'], 'same'],
  ['품의 취소 앞선 할 일(한 건이라도)', PC, 'rb_po_cancel', [[it(2), it(3)], '사유'], 'fallback', { jobs: [{ tab: 'ln', job: { k: 'ln', rows: { 5: { v: ['RB261101-AAA002'] } }, who: 'a@x' } }] }],
  ['품의 취소 꺼짐', PC, 'rb_po_cancel', [[it(3)], '사유'], 'fallback', { conf: { on: '0' } }],
  ['품의 취소 rb_once 두 번', PC, 'rb_po_cancel', [[it(3), it(4)], '사유'], 'once', { once: 'qtestonce0002', twice: true }]
];

const rows = [];
let pass = 0;
for (const [name, jf, sf, args, want, o] of cases) {
  const J = jsRun(jf, args), S = sqlRun(sf, args, o);
  let ok, note = '';
  if (want === 'fallback') { ok = /RB_FALLBACK/.test(S.err || '') && same(S.data.slice(1), BASE.slice(1)) && !S.pdx.length && !S.aud.length && !S.ver; note = 'SQL→서버 길: ' + String(S.err).slice(0, 60); }
  else if (want.startsWith('sqlerr:')) { ok = new RegExp(want.slice(7)).test(S.err || ''); note = String(S.err).slice(0, 60); }
  else {
    const diffs = [];
    if (want === 'once') {
      if (!same(S.first.ok, S.res)) diffs.push('두 번째 결과가 다름');
      if (S.pdx.length > 1 || S.aud.length !== J.aud.length) diffs.push('두 번 저장됨');
    }
    if (!same(strip(J.res), strip(S.res))) diffs.push('결과 JS ' + JSON.stringify(J.res) + ' / SQL ' + JSON.stringify(S.res));
    if ((J.err || null) !== (S.err || null)) diffs.push('오류 JS ' + J.err + ' / SQL ' + S.err);
    if (!same(J.data.map(r => r.map(x => String(x))), S.data.map(r => r.map(x => String(x))))) {
      J.data.forEach((r, i) => r.forEach((x, j) => { if (String(x) !== String((S.data[i] || [])[j])) diffs.push('칸 ' + (i + 1) + '행 ' + HEAD[j] + ' JS=' + x + ' SQL=' + (S.data[i] || [])[j]); }));
    }
    if (!same(J.aud, S.aud)) diffs.push('이력 JS ' + JSON.stringify(J.aud) + ' / SQL ' + JSON.stringify(S.aud));
    if (!same(J.docq, S.docq)) diffs.push('품의번호 대기열 JS ' + JSON.stringify(J.docq) + ' / SQL ' + JSON.stringify(S.docq));
    if (!same(J.prog, S.prog)) diffs.push('진행 기록 건 JS ' + JSON.stringify(J.prog) + ' / SQL ' + JSON.stringify(S.prog));
    // 시트 맞추기 일: 바뀐 칸만 · 바뀌면 변경 번호
    const changed = []; J.data.forEach((r, i) => r.forEach((x, j) => { if (String(x) !== String(BASE[i][j])) changed.push((i + 1) + ':' + j); }));
    const pdxCells = [].concat(...S.pdx.map(L => [].concat(...L.map(x => x.cols.map(c => x.row + ':' + c))))).sort();
    if (!same(changed.slice().sort(), Array.from(new Set(pdxCells)).sort())) diffs.push('시트 맞추기 칸 ' + JSON.stringify(pdxCells) + ' ≠ 바뀐 칸 ' + JSON.stringify(changed));
    if (!!changed.length !== !!S.ver) diffs.push('변경 번호(r) ' + S.ver);
    ok = !diffs.length; note = ok ? (J.err ? '오류 같음: ' + J.err.slice(0, 50) : '결과 ' + JSON.stringify(strip(S.res)).slice(0, 70)) : diffs.join(' | ').slice(0, 600);
  }
  if (ok) pass++;
  rows.push([name, want, ok ? 'OK' : 'DIFF', note]);
}
rows.forEach(r => console.log(r.join(' ‖ ')));
console.log(`\n${pass}/${cases.length} 통과`);
fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(rows, null, 1));
process.exit(pass === cases.length ? 0 : 1);
