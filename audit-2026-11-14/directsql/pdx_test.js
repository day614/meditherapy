// 시트 맞추기(pdx) 시험: SQL 직접 저장 → 서버 pdxDrainIn_(실제 TabShim tvRepApply_ · SampleShim sampleRepApply_) → 가짜 시트 = Supabase 사본인지
// 그리고 앞선 가상 저장 대기열(rb.tv.pd.* — 같은 칸 옛 값)이 있어도 최종 시트 = 사본인지(차례 뒤바뀜 막기)
// 쓰기: node pdx_test.js <cn 폴더> <patched 폴더>
'use strict';
const fs = require('fs'), vm = require('vm'), cp = require('child_process'), path = require('path');
const CN = process.argv[2], PT = process.argv[3], DB = process.env.RB_DB || 'ds', TAB = '_실행판_발주';
const psql = sql => cp.execSync(`su nobody -s /bin/bash -c "/usr/lib/postgresql/16/bin/psql -X -q -At -h /tmp/rbpg_once1 -p 5544 -U postgres -d ${DB} -v ON_ERROR_STOP=1"`, { input: sql, encoding: 'utf8' });
const q = s => "'" + String(s).replace(/'/g, "''") + "'";
function mkProps() { const m = {}; return { getProperty: k => (k in m ? m[k] : null), setProperty: (k, v) => { m[k] = String(v); }, deleteProperty: k => { delete m[k]; }, getProperties: () => Object.assign({}, m), getKeys: () => Object.keys(m), setProperties: o => Object.assign(m, o), _m: m }; }
const PROPS = mkProps(), CM = {};
const CACHE = { get: k => (k in CM ? CM[k] : null), put: (k, v) => { CM[k] = String(v); }, remove: k => { delete CM[k]; } };
const LOCK = { tryLock: () => true, waitLock: () => { }, releaseLock: () => { }, hasLock: () => true };
const ctx = { console: { log() { }, warn() { }, error() { } }, PropertiesService: { getScriptProperties: () => PROPS }, CacheService: { getScriptCache: () => CACHE }, LockService: { getScriptLock: () => LOCK },
  Utilities: { getUuid: () => 'u-' + Math.random(), formatDate: d => new Date(d).toISOString(), sleep() { } }, SpreadsheetApp: { flush() { } }, Date, JSON, Math, Object, Array, String, Number, RegExp, Error, isNaN, encodeURIComponent, decodeURIComponent, Proxy };
vm.createContext(ctx);
for (const f of ['Code.js', 'Keys.js', 'SampleShim.js', 'LinesShim.js']) vm.runInContext(fs.readFileSync(path.join(CN, f), 'utf8'), ctx, { filename: f });
for (const f of ['TabShim.js', 'PdDirect.js']) vm.runInContext(fs.readFileSync(path.join(PT, f), 'utf8'), ctx, { filename: f });

const HEAD = ['품의번호', '발주일', '구분', '브랜드', '채널', '품목코드', '품목명', '발주차수', '발주수량', '업체명', '단가', '발주금액', '진행상태', '입고목표', '입고일정', '입고수량', '발주잔량', '비고', '작성일', '발주요청팀', '요청팀담당자', '소진완료목표일', '발주요청링크', '통화', '결재문서번호', '구매담당자', '실행판ID'];
const C = n => HEAD.indexOf(n);
const row = o => { const r = HEAD.map(() => ''); Object.keys(o).forEach(k => { r[C(k)] = o[k]; }); return r; };
const BASE = [HEAD,
  row({ 품의번호: 'D-01', 품목코드: 'M0001AA1', 품목명: 'A', 진행상태: '계획', 실행판ID: 'RB261101-AAA001' }),
  row({ 품의번호: 'D-02', 품목코드: 'M0002AA1', 품목명: 'B', 진행상태: '상신', 실행판ID: 'RB261101-AAA002' }),
  row({ 품의번호: 'D-03', 품목코드: 'M0003AA1', 품목명: 'C', 진행상태: '승인', 결재문서번호: 'AP-1', 실행판ID: 'RB261101-AAA003' }),
  row({ 품의번호: '02035', 품목코드: 'M0004AA1', 품목명: 'D', 진행상태: '발주', 비고: '10/15', 실행판ID: 'RB261101-AAA004' })];
let DATA = JSON.parse(JSON.stringify(BASE));
const SH = {
  getRange: (r, c, nr, nc) => { nr = nr || 1; nc = nc || 1; const R = {
    getValue: () => (DATA[r - 1] || [])[c - 1] ?? '', getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (DATA[r - 1 + i] || [])[c - 1 + j] ?? '')),
    setValues: vs => { vs.forEach((a, i) => a.forEach((v, j) => { DATA[r - 1 + i][c - 1 + j] = v; })); return R; }, setValue: v => { DATA[r - 1][c - 1] = v; return R; }, setNumberFormat: () => R }; return R; },
  getRangeList: L => ({ setValue: v => { L.forEach(a1 => { const m = /^([A-Z]+)(\d+)$/.exec(a1); let c = 0; for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64; DATA[Number(m[2]) - 1][c - 1] = v; }); } }),
  getLastRow: () => DATA.length, getLastColumn: () => HEAD.length, getMaxRows: () => DATA.length, insertRowsAfter: (a, n) => { for (let i = 0; i < n; i++) DATA.push(HEAD.map(() => '')); }, getName: () => TAB
};
// PostgREST 흉내(pdxDrainIn_ 가 쓰는 모양만)
function sbFetch_(m, p) {
  const u = new URL('http://x' + p), sp = u.searchParams;
  if (u.pathname === '/rest/v1/rb_tab_job' && m === 'get') return JSON.parse(psql(`select coalesce(json_agg(json_build_object('id', id, 'job', job) order by id), '[]') from (select * from rb_tab_job where tab = 'pdx' and done_at is null order by id limit 200) t;`));
  if (u.pathname === '/rest/v1/rb_tab_job' && m === 'patch') { const ids = /in\.\(([\d,]+)\)/.exec(sp.get('id'))[1]; psql(`update rb_tab_job set done_at = ${arguments[2].done_at ? 'now()' : 'null'} where id in (${ids});`); return null; }
  if (u.pathname === '/rest/v1/sheet_rows' && m === 'get') {
    if (sp.get('row')) { const rows = /in\.\(([\d,]+)\)/.exec(sp.get('row'))[1]; return JSON.parse(psql(`select coalesce(json_agg(json_build_object('row', "row", 'cells', cells)), '[]') from sheet_rows where tab = ${q(TAB)} and "row" in (${rows});`)); }
    for (const [k, v] of sp) if (/^cells->>/.test(k)) return JSON.parse(psql(`select coalesce(json_agg(json_build_object('row', "row", 'cells', cells)), '[]') from sheet_rows where tab = ${q(TAB)} and cells->>${Number(k.slice(8))} = ${q(v.replace(/^eq\./, ''))};`));
  }
  throw new Error('흉내 못 함 ' + m + ' ' + p);
}
PROPS.setProperty('rb.pdHead', JSON.stringify({ hr: 1, head: HEAD, idc: C('실행판ID'), st: C('진행상태') }));
PROPS.setProperty('SB_PODB_FIRST', '1'); PROPS.setProperty('rb.pdmirror', 'x 1 t');
Object.assign(ctx, { sbFetch_, sbKey_: () => 'k', sbMigDone_: () => true, ss_: () => ({ getSheetByName: () => SH }), bomHoldsLock_: () => false, lockWhoMark_: () => { }, RB_LOCK_OBJ: null,
  cacheGet_: () => null, cachePut_: () => { }, journalTriggerEnsure_: () => { }, mirrorBuildOk_: () => true, RB_ISS_TAB: 'i', RB_ISS_HEAD: [], RB_QUAL: { TAB: 'q', HEAD: [] }, RB_BLINK: { TAB: 'l', HEAD: [] } });
vm.runInContext('RB_TV_DEFS = null; RB_TVS = {};', ctx);
ctx.tvOn_ = () => true;

// ① Supabase 사본을 시트와 같게 놓고 직접 저장 두 번
const cells = r => r.map(v => (v === '' ? null : v));
psql(`delete from sheet_rows where tab = ${q(TAB)}; insert into sheet_rows(tab, "row", cells) values ${BASE.map((r, i) => `(${q(TAB)}, ${i + 1}, ${q(JSON.stringify(cells(r)))}::jsonb)`).join(',')};
delete from rb_tab_job; delete from rb_recent; delete from rb_conf where k in ('pdConf', 'pdJ');
insert into rb_conf(k, v) values ('pdConf', ${q(JSON.stringify(vm.runInContext('pdConfBuild_()', ctx)))}::jsonb);`);
// 가상 저장 대기열에 '앞선' 일: 4행(AAA003) 진행상태를 옛 값 '상신'으로(직접 저장보다 먼저 일어난 서버 길 저장이 아직 시트에 안 감)
vm.runInContext(`tvRepPut_('pd', { k: 'pd', at: 1, put: { 'RB261101-AAA003': { 13: '상신' } }, del: [], add: [] })`, ctx);
console.log(psql(`select test_call('rb_po_cancel', 'tokE', ${q(JSON.stringify([[{ id: 'RB261101-AAA003', statusRow: 4, expect: { id: 'RB261101-AAA003', name: 'C' } }, { id: 'RB261101-AAA002', statusRow: 3, expect: { id: 'RB261101-AAA002', name: 'B' } }], '시험']))}::jsonb);`).trim());
console.log(psql(`select test_call('rb_od_state', 'tokE', ${q(JSON.stringify([5, { id: 'RB261101-AAA004', name: 'D' }, '취소']))}::jsonb);`).trim());
// 줄이 밀린 경우: 사본 2행 ↔ 3행 맞바꿈은 하지 않고, 일의 row 를 틀리게 하나 더(실행판ID 로 다시 찾는지)
psql(`insert into rb_tab_job(tab, job) values ('pdx', '{"k":"pd","rows":[{"id":"RB261101-AAA001","row":4,"cols":[12]}]}'::jsonb);`);
const n = vm.runInContext('pdxDrainIn_(true)', ctx);
const sb = JSON.parse(psql(`select json_agg(cells order by "row") from sheet_rows where tab = ${q(TAB)};`)).map(c => HEAD.map((_, i) => (c[i] == null ? '' : c[i])));
let bad = 0;
sb.forEach((r, i) => r.forEach((v, j) => { if (String(v) !== String(DATA[i][j])) { bad++; console.log('다름 ' + (i + 1) + '행 ' + HEAD[j] + ' 시트=' + DATA[i][j] + ' 사본=' + v); } }));
const left = psql(`select count(*) from rb_tab_job where tab = 'pdx' and done_at is null;`).trim();
console.log(`pdx 일 ${n}개 옮김 · 남은 일 ${left} · 가상 저장 대기열 남음 ${vm.runInContext("tvRepKeys_('pd').length", ctx)} · 시트≠사본 칸 ${bad}`);
console.log('글자 칸 그대로(02035 · 10/15): ' + (DATA[4][C('품의번호')] === '02035' && DATA[4][C('비고')] === '10/15'));
process.exit(bad || left !== '0' ? 1 : 0);
