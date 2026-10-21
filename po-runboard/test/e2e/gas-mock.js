// Apps Script 흉내(시트 · 캐시 · 속성 · 잠금 등) — 실제 서버 코드(src/*.gs)를 node 에서 돌려 화면을 시험한다.
// 시트 데이터는 xlsx 에서 뽑은 JSON({탭: {v, f, hidden}}). 수식은 다시 계산하지 않는다(값은 내려받을 때 값).
'use strict';
const READS = { n: 0, cells: 0, by: {} };          // 시트 읽기 횟수 · 칸 수(속도 비교용)
const fs = require('fs'), path = require('path'), vm = require('vm');

const colL = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const colN = s => s.split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0);
const toR1C1 = (f, r, c) => f.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)/g, (m, a, L, b, R) => 'R[' + (Number(R) - r) + ']C[' + (colN(L) - c) + ']');
const fromR1C1 = (f, r, c) => f.replace(/R\[(-?\d+)\]C\[(-?\d+)\]/g, (m, dr, dc) => colL(c + Number(dc)) + (r + Number(dr)));
const revive = x => (x && typeof x === 'object' && x.d ? new Date(x.d) : x);

// 모르는 메서드는 그냥 자기 자신을 돌려준다(서식 · 보호 · 필터 등 화면 시험에 상관없는 것)
// CALLS: 시트에 가는 호출 수(실제 Apps Script 는 호출마다 왕복 · 쓰기 뒤 읽기는 재계산 대기) — 종류별로 센다
const CALLS = { n: 0, by: {}, log: [] };
const CALL_SKIP = /^(getRow|getColumn|getNumRows|getNumColumns|getLastRow\b|getSheet|getName|getParent|getA1Notation|_.*|constructor|toString|valueOf|getSheetId)$/;
function lenient(obj) {
  return new Proxy(obj, { get(t, k) {
    const f = (k in t) ? t[k] : (typeof k === 'symbol' ? undefined : function () { return lenient(t); });
    if (typeof f !== 'function' || typeof k !== 'string' || CALL_SKIP.test(k)) return f;
    return function () { CALLS.n++; const nm = (t.name || (t.sh && t.sh.name) || '?') + '.' + k; CALLS.by[nm] = (CALLS.by[nm] || 0) + 1; if (process.env.CALL_TRACE) CALLS.log.push(nm + ' < ' + new Error().stack.split('\n').slice(2, 4).map(x => x.trim().split(' ')[1]).join(' < ')); return f.apply(this, arguments); };
  } });
}

class Sheet {
  constructor(ss, name, data) {
    this.ss = ss; this.name = name; this.hidden = !!(data && data.hidden);
    this.v = data ? data.v.map(r => r.map(revive)) : []; this.f = data ? data.f.map(r => r.slice()) : [];
    this.cols = Math.max(26, ...this.v.map(r => r.length)); this.maxRows = Math.max(1000, this.v.length + 50);
  }
  _ensure(r, c) { while (this.v.length < r) { this.v.push([]); this.f.push([]); } if (c > this.cols) this.cols = c; if (r > this.maxRows) this.maxRows = r; }
  getName() { return this.name; } getSheetName() { return this.name; } getSheetId() { return this.name.length * 7919; }
  getLastRow() { let n = this.v.length; while (n && !(this.v[n - 1] || []).some(x => x !== '' && x != null) && !(this.f[n - 1] || []).some(Boolean)) n--; return n; }
  getLastColumn() { let m = 0; this.v.forEach((r, i) => { for (let j = r.length; j > 0; j--) if ((r[j - 1] !== '' && r[j - 1] != null) || (this.f[i] || [])[j - 1]) { m = Math.max(m, j); break; } }); return m; }
  getMaxRows() { return this.maxRows; } getMaxColumns() { return this.cols; }
  getRange(a, b, c, d) {
    if (typeof a === 'string') { const m = a.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/); const r1 = +m[2], c1 = colN(m[1]); return lenient(new Range(this, r1, c1, m[3] ? +m[4] - r1 + 1 : 1, m[3] ? colN(m[3]) - c1 + 1 : 1)); }
    return lenient(new Range(this, a, b, c || 1, d || 1));
  }
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  insertRowAfter(r) { return this.insertRowsAfter(r, 1); }
  insertRowsAfter(r, n) { for (let i = 0; i < n; i++) { this.v.splice(r, 0, []); this.f.splice(r, 0, []); } this.maxRows += n; return this; }
  insertRowBefore(r) { return this.insertRowsAfter(r - 1, 1); }
  insertRowsBefore(r, n) { return this.insertRowsAfter(r - 1, n); }
  deleteRow(r) { return this.deleteRows(r, 1); }
  deleteRows(r, n) { this.v.splice(r - 1, n); this.f.splice(r - 1, n); return this; }
  insertColumnAfter() { this.cols++; return this; } insertColumnsAfter(c, n) { this.cols += n; return this; }
  isSheetHidden() { return this.hidden; } hideSheet() { this.hidden = true; return this; } showSheet() { this.hidden = false; return this; }
  getParent() { return this.ss; }
  createTextFinder(q) {
    const sh = this; let re = null, fm = false;
    const tf = { useRegularExpression() { re = new RegExp(q); return tf; }, matchFormulaText(b) { fm = b; return tf; }, matchCase() { return tf; }, matchEntireCell() { return tf; },
      findAll() { const out = []; (fm ? sh.f : sh.v).forEach((row, i) => row.forEach((x, j) => { const s = String(x == null ? '' : x); if (s && (re ? re.test(s) : s.indexOf(q) > -1)) out.push(sh.getRange(i + 1, j + 1)); })); return out; },
      findNext() { return tf.findAll()[0] || null; } };
    return tf;
  }
  getFilter() { return null; } getFrozenRows() { return 0; }
  // 칸 여러 개(A1 목록) — 같은 값 쓰기 · 서식
  getRangeList(list) { const rs = (list || []).map(a => this.getRange(a)); const rl = { getRanges: () => rs, setValue(v) { rs.forEach(r => r.setValue(v)); return rl; }, setNumberFormat() { return rl; }, clearContent() { rs.forEach(r => r.setValue('')); return rl; } }; return rl; }
}
class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  _map(fn) { const o = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(fn(this.r + i - 1, this.c + j - 1)); o.push(row); } return o; }
  getRow() { return this.r; } getColumn() { return this.c; } getNumRows() { return this.nr; } getNumColumns() { return this.nc; } getLastRow() { return this.r + this.nr - 1; }
  getSheet() { return this.sh; } getA1Notation() { return colL(this.c) + this.r + (this.nr > 1 || this.nc > 1 ? ':' + colL(this.c + this.nc - 1) + (this.r + this.nr - 1) : ''); }
  getValues() { if (this.sh.name === process.env.TRACE_TAB) console.log('READ', this.sh.name, this.nr + 'x' + this.nc, new Error().stack.split('\n').slice(2, 6).map(s => s.trim().split(' ')[1]).join(' < ')); READS.n++; READS.cells += this.nr * this.nc; READS.by[this.sh.name] = (READS.by[this.sh.name] || 0) + this.nr * this.nc; return this._map((i, j) => { const x = (this.sh.v[i] || [])[j]; return x == null ? '' : x; }); }
  getDisplayValues() { return this.getValues().map(r => r.map(x => (x instanceof Date ? x.toISOString().slice(0, 10) : String(x)))); }
  getFormulas() { return this._map((i, j) => (this.sh.f[i] || [])[j] || ''); }
  getFormulasR1C1() { return this._map((i, j) => { const f = (this.sh.f[i] || [])[j]; return f ? toR1C1(f, i + 1, j + 1) : ''; }); }
  getValue() { return this.getValues()[0][0]; } getDisplayValue() { return this.getDisplayValues()[0][0]; } getFormula() { return this.getFormulas()[0][0]; }
  getBackgrounds() { return this._map(() => '#ffffff'); } getNotes() { return this._map(() => ''); } getFontColors() { return this._map(() => '#000000'); }
  getDataValidations() { return this._map(() => null); } getDataValidation() { return null; } getMergedRanges() { return []; }
  setValues(a) { this.sh._ensure(this.r + a.length - 1, this.c + (a[0] || []).length - 1); a.forEach((row, i) => row.forEach((x, j) => {
    const s = String(x == null ? '' : x);
    if (s.charAt(0) === '=') { this.sh.f[this.r + i - 1][this.c + j - 1] = s; this.sh.v[this.r + i - 1][this.c + j - 1] = ''; }
    else { this.sh.v[this.r + i - 1][this.c + j - 1] = x; this.sh.f[this.r + i - 1][this.c + j - 1] = ''; } })); return this; }
  setValue(x) { return this.setValues(this._map(() => x)); }
  setFormula(f) { return this.setFormulas(this._map(() => f)); }
  setFormulas(a) { this.sh._ensure(this.r + a.length - 1, this.c + a[0].length - 1); a.forEach((row, i) => row.forEach((f, j) => { this.sh.f[this.r + i - 1][this.c + j - 1] = f; })); return this; }
  setFormulaR1C1(f) { return this.setFormula(fromR1C1(f, this.r, this.c)); }
  setFormulasR1C1(a) { return this.setFormulas(a.map((row, i) => row.map((f, j) => (f ? fromR1C1(f, this.r + i, this.c + j) : '')))); }
  clearContent() { this._map((i, j) => { if (this.sh.v[i]) this.sh.v[i][j] = ''; if (this.sh.f[i]) this.sh.f[i][j] = ''; }); return this; }
  clear() { return this.clearContent(); }
  copyTo(dst) { const v = this.getValues(), f = this.getFormulasR1C1(); const d = dst.r ? dst : dst; d.sh._ensure(d.r + this.nr - 1, d.c + this.nc - 1);
    v.forEach((row, i) => row.forEach((x, j) => { d.sh.v[d.r + i - 1][d.c + j - 1] = x; d.sh.f[d.r + i - 1][d.c + j - 1] = f[i][j] ? fromR1C1(f[i][j], d.r + i, d.c + j) : ''; })); return this; }
  offset(dr, dc, nr, nc) { return this.sh.getRange(this.r + dr, this.c + dc, nr || this.nr, nc || this.nc); }
  isBlank() { return this.getValues().every(r => r.every(x => x === '')); }
}
class SS {
  constructor(id, data) { this.id = id; this.sheets = Object.keys(data || {}).map(n => lenient(new Sheet(this, n, data[n]))); }
  getId() { return this.id; } getName() { return 'mock ' + this.id; } getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
  getSheets() { return this.sheets.slice(); }
  getSheetByName(n) { return this.sheets.find(s => s.getName() === n) || null; }
  getSheetById(id) { return this.sheets.find(s => s.getSheetId() === id) || null; }
  insertSheet(n, i) { const s = lenient(new Sheet(this, n || 'Sheet' + (this.sheets.length + 1), null)); if (i != null) this.sheets.splice(i, 0, s); else this.sheets.push(s); return s; }
  deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
  setActiveSheet() {} moveActiveSheet() {} getSpreadsheetTimeZone() { return 'Asia/Seoul'; }
}

function cacheStore() {
  const m = new Map();
  const api = { get: k => (m.has(k) ? m.get(k) : null), put: (k, v) => { m.set(k, String(v)); }, remove: k => { m.delete(k); },
    getAll: ks => { const o = {}; ks.forEach(k => { if (m.has(k)) o[k] = m.get(k); }); return o; }, putAll: o => { Object.keys(o).forEach(k => m.set(k, String(o[k]))); }, removeAll: ks => ks.forEach(k => m.delete(k)) };
  return api;
}
function propStore(init) {
  const m = Object.assign({}, init || {});
  return { getProperty: k => (k in m ? m[k] : null), setProperty: (k, v) => { m[k] = String(v); return this; }, deleteProperty: k => { delete m[k]; }, getKeys: () => Object.keys(m),
    getProperties: () => Object.assign({}, m), setProperties: o => { Object.assign(m, o); }, deleteAllProperties: () => { Object.keys(m).forEach(k => delete m[k]); } };
}
const pad = n => String(n).padStart(2, '0');
function formatDate(d, tz, fmt) {
  d = new Date(d.getTime() + 9 * 3600e3);       // Asia/Seoul
  const map = { yyyy: d.getUTCFullYear(), yy: String(d.getUTCFullYear()).slice(2), MM: pad(d.getUTCMonth() + 1), dd: pad(d.getUTCDate()), HH: pad(d.getUTCHours()), mm: pad(d.getUTCMinutes()), ss: pad(d.getUTCSeconds()),
    M: d.getUTCMonth() + 1, d: d.getUTCDate(), E: ['일', '월', '화', '수', '목', '금', '토'][d.getUTCDay()] };
  return fmt.replace(/'[^']*'|yyyy|yy|MM|dd|HH|mm|ss|M|d|E+/g, t => (t[0] === "'" ? t.slice(1, -1) : (t[0] === 'E' ? map.E : map[t])));
}

function makeContext(opt) {
  const data = JSON.parse(fs.readFileSync(opt.data, 'utf8'));
  const main = new SS(opt.ssId, data), bomFile = new SS(opt.bomId, {});
  const user = opt.user || 'day@meditherapy.co.kr';
  const ctx = {
    console, JSON, Math, Date, Number, String, RegExp, Object, Array, Boolean, Error, TypeError, isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, escape, unescape,
    SpreadsheetApp: { openById: id => (id === opt.bomId ? bomFile : main), getActive: () => main, getActiveSpreadsheet: () => main, flush() {},
      CopyPasteType: { PASTE_FORMAT: 'f', PASTE_VALUES: 'v', PASTE_NORMAL: 'n', PASTE_DATA_VALIDATION: 'dv' }, newDataValidation: () => lenient({ build: () => ({}) }),
      BorderStyle: {}, WrapStrategy: {}, ProtectionType: {}, newConditionalFormatRule: () => lenient({ build: () => ({}) }), newTextStyle: () => lenient({ build: () => ({}) }) },
    CacheService: (() => { const c = cacheStore(), u = cacheStore(); return { getScriptCache: () => c, getUserCache: () => u, getDocumentCache: () => c }; })(),
    PropertiesService: (() => { const s = propStore(opt.props), u = propStore(), d = propStore(); return { getScriptProperties: () => s, getUserProperties: () => u, getDocumentProperties: () => d }; })(),
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {}, hasLock: () => true }), getUserLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {}, hasLock: () => true }), getDocumentLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {}, hasLock: () => true }) },
    Session: { getActiveUser: () => ({ getEmail: () => user }), getEffectiveUser: () => ({ getEmail: () => user }), getScriptTimeZone: () => 'Asia/Seoul', getTemporaryActiveUserKey: () => 'k' },
    Utilities: { formatDate, getUuid: () => require('crypto').randomUUID(), sleep() {}, base64Encode: s => Buffer.from(String(s)).toString('base64'), base64Decode: s => Array.from(Buffer.from(s, 'base64')),
      newBlob: (d) => lenient({ getDataAsString: () => String(d), getBytes: () => Array.from(Buffer.from(String(d))) }), computeDigest: (a, s) => Array.from(require('crypto').createHash('md5').update(String(s)).digest()),
      DigestAlgorithm: { MD5: 'md5', SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, parseCsv: s => String(s).split('\n').map(l => l.split(',')), jsonStringify: JSON.stringify },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => lenient({}), deleteTrigger() {}, getService: () => ({ getUrl: () => 'http://localhost/exec' }), getScriptId: () => 'mock',
      AuthMode: {}, getOAuthToken: () => 'x', WeekDay: {} },
    DriveApp: lenient({ getFileById: () => lenient({ getName: () => 'f', getUrl: () => '' }) }), MailApp: lenient({}), GmailApp: lenient({}), UrlFetchApp: lenient({ fetch: () => lenient({ getContentText: () => '{}', getResponseCode: () => 200 }) }),
    HtmlService: lenient({}), ContentService: lenient({}), Logger: { log() {} }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const dir = opt.src;
  fs.readdirSync(dir).filter(f => f.endsWith('.gs')).sort().forEach(f => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }));
  ctx.__main = main; ctx.__bom = bomFile;
  return ctx;
}
module.exports = { makeContext, READS, CALLS };
