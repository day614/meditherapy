// BomExtra.gs 로직 시험(가짜 시트) — node po-runboard/test/bomextra.test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const SRC = path.join(__dirname, '..', 'src');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');
function pick(src, names) {        // 최상위 function 하나씩 잘라 오기
  return names.map(n => {
    const i = src.indexOf('function ' + n + '(');
    if (i < 0) throw new Error('no fn ' + n);
    let d = 0, j = src.indexOf('{', i);
    for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); } }
  }).join('\n');
}
// ---- 가짜 시트 ----
const colL = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const colN = s => s.split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0);
const toR1C1 = (f, r, c) => f.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)/g, (m, a, L, b, R) => 'R[' + (Number(R) - r) + ']C[' + (colN(L) - c) + ']');
const fromR1C1 = (f, r, c) => f.replace(/R\[(-?\d+)\]C\[(-?\d+)\]/g, (m, dr, dc) => colL(c + Number(dc)) + (r + Number(dr)));
function Sheet(rows) {
  this.v = rows.map(r => r.slice()); this.f = rows.map(r => r.map(() => ''));
}
Sheet.prototype = {
  getLastRow() { let n = this.v.length; while (n && this.v[n - 1].every(x => x === '' || x == null) && this.f[n - 1].every(x => !x)) n--; return n; },
  getLastColumn() { return this.v[0].length; },
  getRange(r, c, nr, nc) { return new Rg(this, r, c, nr || 1, nc || 1); }
};
function Rg(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
Rg.prototype = {
  _map(fn) { const o = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(fn(this.r + i - 1, this.c + j - 1)); o.push(row); } return o; },
  getValues() { return this._map((i, j) => (this.sh.v[i] || [])[j] ?? ''); },
  getFormulas() { return this._map((i, j) => (this.sh.f[i] || [])[j] || ''); },
  getFormulasR1C1() { return this._map((i, j) => { const f = (this.sh.f[i] || [])[j]; return f ? toR1C1(f, i + 1, j + 1) : ''; }); },
  getFormula() { return this.getFormulas()[0][0]; }, getValue() { return this.getValues()[0][0]; },
  setValues(a) { a.forEach((row, i) => row.forEach((x, j) => { this.sh.v[this.r + i - 1][this.c + j - 1] = x; this.sh.f[this.r + i - 1][this.c + j - 1] = ''; })); return this; },
  setValue(x) { return this.setValues([[x]]); },
  setFormula(f) { this.sh.f[this.r - 1][this.c - 1] = f; return this; },
  setFormulaR1C1(f) { this.sh.f[this.r - 1][this.c - 1] = fromR1C1(f, this.r, this.c); return this; },
  getA1Notation() { return colL(this.c) + this.r; },
  setNumberFormat() { return this; }, setFontWeight() { return this; }
};
// ---- BOM 탭 ----
const HEAD = ['제품코드', '제품명', '구분', '자재코드', '품목명', '초도', '종료', '원가반영', '반제품 구성', '업체명', '매입정보', '사양', 'MOQ', '소요량', '단가', '통화', '환율', '임가공', '배송비/기타', '소요원가', '공용여부', '입고지', '구매발주 특이사항', '변동사항', '브랜드명', '줄ID'];
const row = (p, t, code, vendor, buy, unit, start, end, id, ship) => { const r = HEAD.map(() => ''); Object.assign(r, { 0: p, 2: t, 3: code, 4: code + ' 이름', 5: start || '1차', 6: end || '', 9: vendor, 10: buy, 13: 1, 14: unit, 15: '원화', 16: 1, 18: ship ?? '', 25: id }); return r; };
function makeSheet() {
  const rows = [HEAD.map(() => ''), HEAD.slice(),
    row('M0001AA1', '제품', 'M0001AA1', '비앤비코리아', '턴키', 1000, '1차', '', 'a1'),
    row('M0001AA1', '용기', 'MP0001BO1', '두코', '턴키', 300, '1차', '2차', 'a2'),
    row('M0002AA1', '제품', 'M0002AA1', '코스맥스', '턴키', 2000, '1차', '', 'b1'),
    row('M0001AA1', '용기', 'MP0001BO2', '두코', '턴키', 320, '3차', '', 'a3'),
    row('M0001AA1', '단상자', 'MP0001CA1', '성진', '턴키', 100, '1차', '', 'a4', 5),
    row('M0001AA1', '라벨', 'MP0001BL1', '에이치씨', '사급', 50, '1차', '', 'a5'),
    row('M0002AA1', '용기', 'MP0002BO1', '두코', '턴키', 400, '1차', '', 'b2')];
  const sh = new Sheet(rows);
  for (let r = 3; r <= rows.length; r++) sh.f[r - 1][19] = '=((O' + r + '*Q' + r + ')+R' + r + '+S' + r + ')*N' + r;
  return sh;
}
// ---- 스크립트 불러오기 ----
let SH, PROPS = {}, LOGS = [];
const ctx = {
  console, JSON, Math, Date, Number, String, RegExp, Object, Array, isNaN,
  SpreadsheetApp: { flush() {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => PROPS[k] || null, setProperty: (k, v) => { PROPS[k] = v; } }) },
  Utilities: { getUuid: () => 'uuid-0000-1111' },
  bomSheet_: () => SH, bomSS_: () => ({}), bomLock_: () => ({ releaseLock() {} }), bomLogWrite_: (ss, r) => LOGS.push(...r),
  bomAfterSave_() {}, costTableMark_() {}, apiBomGet: c => ({ code: c }), requireEditor_() {}, me_: () => 'tester@x', fmtDate_: d => d.toISOString().slice(0, 10),
  colRB_: colL, str_: v => (v == null ? '' : String(v)).trim(), num_: v => Number(String(v == null ? '' : v).replace(/,/g, '')) || 0,
  itemCodeKey_: c => String(c == null ? '' : c).toUpperCase().replace(/\s/g, '')
};
vm.createContext(ctx);
const bom = read('Bom.gs');
vm.runInContext("var RB_BOM_HEAD = " + bom.match(/var RB_BOM_HEAD = (\{[\s\S]*?\});/)[1] + ";\n" +
  pick(bom, ['bomIdDiff_', 'bomCols_', 'bomRowObj_', 'bomReadProduct_', 'bomRnum_', 'bomFixCost_', 'bomSetColRuns_']), ctx);
// bomCols_ 는 getDisplayValues 를 쓴다
Rg.prototype.getDisplayValues = function () { return this.getValues().map(r => r.map(String)); };
vm.runInContext(read('BomExtra.gs'), ctx);

// ---- 1) 순서 바꾸기: 순서 칸에 숫자만(줄 자리는 그대로) · 순서 칸이 없으면 만든다 ----
SH = makeSheet();
SH.getMaxColumns = function () { return this.v[0].length; };
SH.insertColumnAfter = function () { this.v.forEach(r => r.push('')); this.f.forEach(r => r.push('')); };
Rg.prototype.copyTo = function () {};
ctx.SpreadsheetApp.CopyPasteType = { PASTE_FORMAT: 1 };
const before = JSON.stringify(SH.v.map(r => r[3]));
let r = ctx.apiBomReorder('M0001AA1', [[7, 'a4', 'MP0001CA1', 10], [8, 'a5', 'MP0001BL1', 20], [3, 'a1', 'M0001AA1', 30], [4, 'a2', 'MP0001BO1', 40], [6, 'a3', 'MP0001BO2', 40]].map(([row, id, code, ord]) => ({ row, id, code, ord })), '');
assert.strictEqual(r.moved, 5);
assert.strictEqual(SH.v[1][26], '순서', '순서 칸 머리글');
assert.deepStrictEqual([3, 4, 6, 7, 8].map(x => SH.v[x - 1][26]), [30, 40, 40, 10, 20]);
assert.strictEqual(JSON.stringify(SH.v.map(r => r[3])), before, '줄 자리는 그대로');
assert.strictEqual(SH.v[4][26], '', '다른 품목 줄은 그대로');
assert.throws(() => ctx.apiBomReorder('M0001AA1', [{ row: 5, id: 'b1', code: 'M0002AA1', ord: 1 }], ''), /그사이 바뀌었/);
// ---- 빈 줄 지우기 ----
SH = makeSheet(); SH.deleteRow = function (r) { this.v.splice(r - 1, 1); this.f.splice(r - 1, 1); };
SH.v[3] = SH.v[3].map(() => ''); SH.f[3] = SH.f[3].map(() => '');
assert.strictEqual(ctx.bomDropBlankRows_(SH, ctx.bomCols_(SH), [4, 5]), 1, '빈 줄만 지운다(5행은 내용 있음)');
assert.strictEqual(SH.v[3][3], 'M0002AA1');

// ---- 2) 핸들링피(턴키만 / 모든 자재 / 제조사 단가) ----
SH = makeSheet(); PROPS = {};
SH.v[6][18] = ''; SH.v[2][18] = 7;
let out = ctx.apiHfSet('비앤비코리아', 3, 'turnkey', 'M0001AA1', '');
assert.strictEqual(SH.f[5][18], '=O6*Q6*3%');
assert.strictEqual(SH.f[6][18], '=O7*Q7*3%');
assert.strictEqual(SH.f[3][18], '', '끝난 줄은 그대로');
assert.strictEqual(SH.f[7][18], '', '턴키만이면 사급은 빼기');
assert.strictEqual(SH.f[2][18], '', '제품 줄 그대로');
assert.strictEqual(out.applied.n, 2);
assert.strictEqual(ctx.hfApplyRows_(SH, ctx.bomCols_(SH), 'M0002AA1', [9]), null, '다른 제조사엔 안 붙음');
// 모든 자재 + 손입력 칸은 그대로
SH = makeSheet(); SH.v[7][18] = 4;
out = ctx.apiHfSet('비앤비코리아', 3, 'all', 'M0001AA1', '');
assert.deepStrictEqual(Array.from(out.applied.skipped), [7, 8], '손으로 넣은 배송비 칸(단상자 5 · 라벨 4)은 건너뛴다');
SH = makeSheet(); SH.v[6][18] = '';
out = ctx.apiHfSet('비앤비코리아', 3, 'all', 'M0001AA1', '');
assert.strictEqual(SH.f[7][18], '=O8*Q8*3%', '모든 자재 = 사급도');
// 이미 핸들링피 수식이 있으면 % 만 바꾼다
SH = makeSheet(); SH.f[5][18] = '=O6*0.03';
ctx.apiHfSet('비앤비코리아', 5, 'turnkey', 'M0001AA1', '');
assert.strictEqual(SH.f[5][18], '=O6*Q6*5%');
// 제조사 단가에만
SH = makeSheet(); SH.v[2][18] = '';
ctx.apiHfSet('(주)비앤비코리아', 2, 'maker', 'M0001AA1', '');
assert.strictEqual(SH.f[2][18], '=O3*Q3*2%');
assert.strictEqual(SH.f[6][18], '', '자재 줄은 그대로');
assert.strictEqual(Object.keys(JSON.parse(PROPS['rb.hfee'])).length, 1, '같은 제조사 키 하나로(주식회사 표기 무시)');
// 예전 저장값(mat + sa) 읽기
assert.strictEqual(ctx.hfMode_({ mode: 'mat', sa: true }), 'all');
ctx.apiHfSet('비앤비코리아', 0, 'turnkey', '', '');
assert.strictEqual(JSON.parse(PROPS['rb.hfee'])['비앤비코리아'], undefined, '0% = 설정 지움');

// ---- 3) 품목 DB 맞추기 ----
const keys = read('Keys.gs'), idel = read('ItemDelete.gs');
vm.runInContext('var RB_ITEM = ' + keys.match(/var RB_ITEM = (\{[\s\S]*?\n\});/)[1] + ';\nvar RB_ITEM_EDIT = { price: 5 };\n' +
  pick(keys, ['itemDbAllCodes_']) + '\n' + pick(idel, ['deleteRowsDesc_']), ctx);
const ITEM = new Sheet([['품목코드', '품목명', '브랜드', '채널', '업체', '단가', '바코드', '구코드1', '구코드2', '등록일', '등록자', '출처', '사양'],
  ['MP0001BO2', '용기', '', '', '두코', '', '', '', '', '', '', 'BOM', ''], ['MP0009XX1', '안씀', '', '', '', 1, '', '', '', '', '', '', ''],
  ['MP0001CA1', '단상자', '', '', '성진', '', '', '', '', '', '', '', '']]);
ITEM.deleteRows = function (r, n) { this.v.splice(r - 1, n); this.f.splice(r - 1, n); };
let ORDERED = {}, REG = [];
Object.assign(ctx, { sheet_: () => ITEM, itemOrderCodes_: () => ORDERED, cacheDrop_() {}, appendHist_() {}, RB_II_CACHE: 'x', RB_II_REF: 'y',
  bomRegFromRows_: (codes) => { REG.push(...codes); ITEM.v.push([codes[0], 'BOM 값', '', '', '', '', '', '', '', '', '', '', '']); ITEM.f.push(Array(13).fill('')); return codes; } });
SH = makeSheet();
SH.v[5] = SH.v[5].map(() => '');                        // MP0001BO2 줄을 BOM 에서 지웠다
let gone = ctx.itemDbDropOrphans_(['MP0001BO2', 'MP0001CA1'], '테스트', 'M0001AA1');
assert.deepStrictEqual(Array.from(gone), ['MP0001BO2'], 'BOM 에 남은 CA1 은 그대로');
assert.ok(!ITEM.v.some(r => r[0] === 'MP0001BO2'));
assert.strictEqual(ctx.itemDbRestore_('MP0001BO2'), true, '되돌리면 BOM 줄 값으로 다시 등록');
assert.deepStrictEqual(REG, ['MP0001BO2']);
ORDERED = { MP0009XX1: 1 };
assert.strictEqual(ctx.itemDbDropOrphans_(['MP0009XX1'], '', '').length, 0, '발주 이력 있으면 안 지움');
// 단가: 빈 칸 채우기 · 전부(null)
SH = makeSheet();
assert.strictEqual(ctx.itemDbPriceSync_(['MP0001CA1', 'M0001AA1']), 1);
assert.strictEqual(ITEM.v.find(r => r[0] === 'MP0001CA1')[5], 100);
assert.strictEqual(ctx.itemDbPriceSync_(null), 1, '전부: 다시 등록된 BO2 빈 단가 채움');
assert.strictEqual(ITEM.v.find(r => r[0] === 'MP0001BO2')[5], 320);
assert.strictEqual(ctx.itemDbPriceSync_(null), 0, '이미 맞으면 그대로');
console.log('bomextra: all passed');
