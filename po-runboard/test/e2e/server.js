// 화면 시험 서버: 실제 PageHtml.html + 실제 서버 코드(gas-mock) — node server.js <시트 JSON> [port]
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const { makeContext, READS, CALLS } = require('./gas-mock');
const SRC = path.join(__dirname, '..', '..', 'src');
const code = fs.readFileSync(path.join(SRC, 'Code.gs'), 'utf8');
const ctx = makeContext({ data: process.argv[2], src: SRC, ssId: code.match(/SS_ID: '([^']+)'/)[1], bomId: code.match(/BOM_SS_ID: '([^']+)'/)[1], user: process.env.RB_USER });
const port = Number(process.argv[3] || 8765);
const SHIM = `<script>(function(){function mk(ok,fail,uo){return new Proxy({},{get:function(_,k){
if(k==='withSuccessHandler')return function(f){return mk(f,fail,uo)};if(k==='withFailureHandler')return function(f){return mk(ok,f,uo)};
if(k==='withUserObject')return function(o){return mk(ok,fail,o)};
return function(){var a=[].slice.call(arguments);window.__rpcN=(window.__rpcN||0)+1;fetch('/rpc',{method:'POST',body:JSON.stringify({n:k,a:a})}).then(function(r){return r.json()}).then(function(j){window.__rpcN--;
if(j.err){var e=new Error(j.err);if(fail)fail(e,uo);else console.error(k,j.err)}else if(ok)ok(j.res,uo)}).catch(function(e){window.__rpcN--;if(fail)fail(e,uo)})}}})}
window.google={script:{get run(){return mk(null,null,undefined)},host:{close:function(){},setHeight:function(){}},url:{getLocation:function(cb){cb({parameter:{},hash:''})}}}};})();</script>`;
const log = [];
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/rpc') {
    let b = ''; req.on('data', d => (b += d)); req.on('end', () => {
      CALLS.log = []; const { n, a } = JSON.parse(b), t0 = Date.now(), c0 = READS.cells, by0 = Object.assign({}, READS.by), k0 = CALLS.n, kb0 = Object.assign({}, CALLS.by); let out;
      try {
        if (typeof ctx[n] !== 'function' || /_$/.test(n)) throw new Error('Script function not found: ' + n);
        out = { res: JSON.parse(JSON.stringify(ctx[n].apply(null, a) ?? null)) };
      } catch (e) { out = { err: String(e && e.message || e) }; }
      const by = {}; Object.keys(READS.by).forEach(k => { const d = READS.by[k] - (by0[k] || 0); if (d) by[k] = d; });
      const kby = {}; Object.keys(CALLS.by).forEach(k => { const d = CALLS.by[k] - (kb0[k] || 0); if (d) kby[k] = d; });
      log.push({ n, ms: Date.now() - t0, err: out.err || '', cells: READS.cells - c0, by, calls: CALLS.n - k0, kby, clog: CALLS.log.slice(0, 400) });
      // 저장 계열 응답을 늦춰 '저장 중에 다음 작업' 을 재현한다(RPC_DELAY=ms)
      // RPC_LAT=ms: 모든 호출에 더하는 기본 지연(Apps Script 호출 한 번 ≈ 3초 — 실제 속도 기록 apiVer 중간값)
      const slow = Number(process.env.RPC_LAT || 0) + (Number(process.env.RPC_DELAY || 0) && /Save|Fix|Undo|Set|Reorder|Delete|Register|Commit|Write|Bulk|Add|Update/.test(n) ? Number(process.env.RPC_DELAY) : 0);
      setTimeout(() => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(out)); }, slow);
    });
    return;
  }
  if (req.url === '/__log') { res.end(JSON.stringify(log.splice(0))); return; }
  if (req.url.indexOf('/__sheet') === 0) { const tb = decodeURIComponent((req.url.split('tab=')[1] || '_실행판_BOM3')); const s = ctx.__main.getSheetByName(tb); res.end(JSON.stringify({ v: s.v, f: s.f })); return; }
  let page = fs.readFileSync(path.join(SRC, 'PageHtml.html'), 'utf8');
  const inj = SHIM + '<script>window.__BUILD=' + JSON.stringify(ctx.RB_BUILD) + ';window.__EXEC="http://localhost:' + port + '/";window.__UPD="";</script>';
  // 시험용: 화면 코드 안 함수를 밖에서 부를 수 있게(window.__t('식'))
  page = page.replace(/\n\}\)\(\);\n/, '\nwindow.__t = function (s) { return eval(s); };\n})();\n');
  page = page.indexOf('<head>') > -1 ? page.replace('<head>', '<head>' + inj) : inj + page;
  res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(page);
}).listen(port, () => console.log('ready http://localhost:' + port));
