/**
 * 고정값 목록 — 새 발주 · 발주 수정에서 드롭다운으로만 고르는 항목.
 * 목록은 _실행판_설정(list.*)에 쉼표로 저장, 관리자 화면에서 고친다. 목록 밖 값은 저장을 막는다.
 */

var RB_CHOICE = {
  cat:     { key: 'list.cat',     label: '구분',       def: ['완제품', '부자재', '반제품', '부재료', '임가공', '일회성'] },
  brand:   { key: 'list.brand',   label: '브랜드',     def: ['메디', '히디프'] },
  channel: { key: 'list.channel', label: '채널',       def: ['B2C', 'B2B', 'D2C', 'run', 'new'] },
  team:    { key: 'list.team',    label: '발주요청팀', def: ['B2C', 'B2B', 'D2C'] }
};
/** 브랜드별 채널 — 브랜드를 고르면 그 브랜드 채널만 고를 수 있다. 설정 'list.channelByBrand' 에 '메디: B2B, B2C, D2C / 히디프: run, new' 꼴(줄바꿈 · / 로 구분) */
var RB_CH_BY_BRAND_KEY = 'list.channelByBrand';
var RB_CH_BY_BRAND_DEF = '메디: B2B, B2C, D2C / 히디프: run, new';
function chByBrandOf_(txt) {
  var out = {};
  String(txt == null || txt === '' ? RB_CH_BY_BRAND_DEF : txt).split(/[\n\/]/).forEach(function (part) {
    var m = part.match(/^\s*([^:：]+)[:：](.*)$/);
    if (!m) return;
    var b = m[1].trim(), l = splitList_(m[2]);
    if (b && l.length) out[b] = l;
  });
  return out;
}
function chByBrandText_(map) { return Object.keys(map).map(function (b) { return b + ': ' + map[b].join(', '); }).join(' / '); }

function splitList_(s) {
  var seen = {}, out = [];
  String(s || '').split(/[,\n]/).forEach(function (x) {
    x = x.trim();
    if (x && !seen[x]) { seen[x] = 1; out.push(x); }
  });
  return out;
}

/** { cat: [...], brand: [...], channel: [...], team: [...] } */
function choicesOf_(cfg) {
  cfg = cfg || readConfig_();
  var out = {};
  Object.keys(RB_CHOICE).forEach(function (k) {
    var v = splitList_(cfg[RB_CHOICE[k].key]);
    out[k] = v.length ? v : RB_CHOICE[k].def.slice();
  });
  out.chByBrand = chByBrandOf_(cfg[RB_CH_BY_BRAND_KEY]);
  Object.keys(RB_SCHOICE).forEach(function (k) { out[k] = splitList_(cfg[RB_SCHOICE[k].key]); });   // 비어 있으면 화면이 시트에 쓰인 값으로 보여 준다
  if (out.smake && out.smake.length && out.smake.indexOf('기타') < 0) out.smake.push('기타');      // 구성에는 늘 '기타'(2026-10-26)
  return out;
}

/** 샘플 구성 · 사양 · 구분 목록(2026-10-15) — 사용자가 정한 목록을 고르기 칸에 보여 준다. 비우면 시트에 쓰인 값. 목록 밖 값도 적을 수는 있다 */
var RB_SCHOICE = {
  smake: { key: 'list.sample.make', label: '샘플 구성' },
  sspec: { key: 'list.sample.spec', label: '샘플 사양' },
  skind: { key: 'list.sample.kind', label: '샘플 구분' }
};
function apiSetSampleChoices(lists) {
  requireEditor_();
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  try {
    var before = choicesOf_(), patch = {}, hist = [];
    Object.keys(RB_SCHOICE).forEach(function (k) {
      if (!lists || lists[k] == null) return;
      var v = splitList_(lists[k]).map(function (x) { return x.slice(0, 60); }).slice(0, 200);
      if (v.join(', ') === (before[k] || []).join(', ')) return;
      patch[RB_SCHOICE[k].key] = v.join(', ');
      hist.push({ kind: '설정', item: RB_SCHOICE[k].label + ' 목록', before: (before[k] || []).join(', '), after: v.join(', '), where: RB.T_CONFIG });
    });
    if (Object.keys(patch).length) {
      writeConfigNoLock_(patch);
      try { appendHist_(hist); } catch (e) { /* 넘어간다 */ }
    }
  } finally {
    lock.releaseLock();
  }
  return choicesOf_();
}

/** p 에 들어 있는(빈칸 아닌) 고정값 항목이 목록 안인지. 밖이면 throw. */
var RB_CHOICES_MEMO = null;
function checkChoices_(p) {
  // 한 번 실행되는 동안 목록은 한 번만 만든다. 설정 캐시가 있으면 설정 탭을 열지 않는다.
  // (예전에는 지급 줄마다 설정 탭을 다시 읽어, 채널이 든 줄이 많으면 저장이 그만큼 느려졌다)
  if (!RB_CHOICES_MEMO) {
    var mc = cacheGet_(metaKey_('po'));
    RB_CHOICES_MEMO = choicesOf_(mc && mc.cfg ? mc.cfg : null);
  }
  var ch = RB_CHOICES_MEMO;
  var bad = [];
  Object.keys(RB_CHOICE).forEach(function (k) {
    if (!p || p[k] == null) return;
    var v = str_(p[k]);
    if (v && ch[k].indexOf(v) < 0) bad.push(RB_CHOICE[k].label + ' "' + v + '"');
  });
  // 브랜드 · 채널을 같이 넣으면(새 발주 등) 그 브랜드 채널인지도 본다
  if (p && str_(p.brand) && str_(p.channel) && ch.chByBrand && ch.chByBrand[str_(p.brand)] && ch.chByBrand[str_(p.brand)].indexOf(str_(p.channel)) < 0) {
    bad.push('채널 "' + str_(p.channel) + '"(' + str_(p.brand) + ' 채널은 ' + ch.chByBrand[str_(p.brand)].join(', ') + ')');
  }
  if (bad.length) throw new Error(bad.join(' · ') + ' 은(는) 목록에 없는 값입니다. 드롭다운에서 골라 주세요(목록은 관리자 화면에서 바꿉니다).');
}

/** 관리자: 목록 저장. lists: { cat: '완제품, 부자재', ... } */
function apiSetChoices(lists) {
  requireAdmin_();
  // 이전 목록 읽기 → 쓰기를 한 잠금 안에서(두 관리자가 동시에 저장하면 이력의 '이전 값'이 어긋났다)
  var lock = LockService.getScriptLock();
  waitLock_(lock);
  try { return setChoicesLocked_(lists); } finally { lock.releaseLock(); }
}
function setChoicesLocked_(lists) {
  var patch = {}, before = choicesOf_();
  Object.keys(RB_CHOICE).forEach(function (k) {
    if (!lists || lists[k] == null) return;
    var v = splitList_(lists[k]);
    if (!v.length) throw new Error(RB_CHOICE[k].label + ' 목록이 비었습니다.');
    patch[RB_CHOICE[k].key] = v.join(', ');
  });
  if (lists && lists.chByBrand != null) {
    var mp = chByBrandOf_(lists.chByBrand), master = (patch[RB_CHOICE.channel.key] ? splitList_(patch[RB_CHOICE.channel.key]) : before.channel);
    Object.keys(mp).forEach(function (b) { mp[b].forEach(function (c) { if (master.indexOf(c) < 0) throw new Error('브랜드별 채널의 "' + c + '"(' + b + ')는 채널 목록에 없습니다. 채널 목록에 먼저 넣어 주세요.'); }); });
    patch[RB_CH_BY_BRAND_KEY] = chByBrandText_(mp);
  }
  writeConfigNoLock_(patch);
  var after = choicesOf_();
  appendHist_(Object.keys(patch).filter(function (key) { return key !== RB_CH_BY_BRAND_KEY; }).map(function (key) {
    var k = Object.keys(RB_CHOICE).filter(function (x) { return RB_CHOICE[x].key === key; })[0];
    return { kind: '설정', item: RB_CHOICE[k].label + ' 목록', before: before[k].join(', '), after: after[k].join(', '), where: RB.T_CONFIG };
  }));
  return after;
}

