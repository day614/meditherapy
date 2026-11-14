// 2단계 clasp 로그인: start <user> → 주소 출력 · finish <user> '<redirect url>' → ~/.clasprc.json tokens.<user>
import fs from 'fs'; import crypto from 'crypto'; import os from 'os';
const [,, step, user, redir] = process.argv;
const RC = os.homedir() + '/.clasprc.json', ST = new URL('.', import.meta.url).pathname + 'login_' + user + '.json';
const rc = JSON.parse(fs.readFileSync(RC, 'utf8')); const base = rc.tokens.default;
const SC = ['script.deployments','script.projects','script.webapp.deploy','drive.metadata.readonly','drive.file','service.management','logging.read','userinfo.email','userinfo.profile','cloud-platform'].map(s => 'https://www.googleapis.com/auth/' + s).join(' ');
const b64 = b => b.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
if (step === 'start') {
  const v = b64(crypto.randomBytes(48)), state = b64(crypto.randomBytes(24));
  fs.writeFileSync(ST, JSON.stringify({ v, state }));
  const q = new URLSearchParams({ redirect_uri: 'http://localhost:8888', access_type: 'offline', prompt: 'consent select_account', scope: SC, state, code_challenge: b64(crypto.createHash('sha256').update(v).digest()), code_challenge_method: 'S256', response_type: 'code', client_id: base.client_id });
  console.log('https://accounts.google.com/o/oauth2/v2/auth?' + q);
} else {
  const s = JSON.parse(fs.readFileSync(ST, 'utf8')), u = new URL(redir);
  if (u.searchParams.get('state') !== s.state) throw new Error('state 다름');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: u.searchParams.get('code'), client_id: base.client_id, client_secret: base.client_secret, code_verifier: s.v, redirect_uri: 'http://localhost:8888', grant_type: 'authorization_code' }) });
  const j = await r.json(); if (!j.refresh_token) throw new Error('토큰 실패: ' + JSON.stringify(j).slice(0, 300));
  rc.tokens[user] = { client_id: base.client_id, client_secret: base.client_secret, type: 'authorized_user', refresh_token: j.refresh_token, access_token: j.access_token };
  fs.writeFileSync(RC, JSON.stringify(rc, null, 2), { mode: 0o600 });
  const who = await (await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + j.access_token } })).json();
  console.log('logged in as', who.email);
}
