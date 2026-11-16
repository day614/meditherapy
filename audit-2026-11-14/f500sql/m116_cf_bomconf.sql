-- m116_cf_bomconf — BOM 설정 저장(반제품 차수 고르기 apiSemiPin · 자재 구분 추가 apiBomAddType · 세트에서 구성 자재 빼기 apiBomSetCompOff)을 Supabase 함수로 바로.
-- 원본은 서버 스크립트 속성(rb.semipin · bom:types · bom:setx) — 함수는 그 사본 rb_conf 'bomConf'(semipins · types · setx)를 그 자리에서 고치고
-- 진짜 결과(그 품목 BOM 줄 · 이력 · 고른 차수 / 구분표 / 뺀 자재)를 준다. 속성 · BOM변경이력 시트 · 캐시는 rb_tab_job tab='bom'(cfSemiPin · cfTypeAdd · cfSetx)
-- → 서버 bomDbDrainIn_ 가 같은 일을 속성에 다시 해 맞춘다(덮어쓰기가 아니라 같은 바꾸기 — 그사이 서버 길로 바꾼 다른 칸을 지우지 않게).
-- 사본 덮어쓰기 막기: bomConfPublish_ 는 rb_bom_conf_put 으로 — 아직 속성에 안 옮긴 직접 저장이 있으면 그 칸(semipins · types · setx · hf)은 사본 값 그대로.
-- 켜짐 · 겹침: rb_bom_guard(BOM 직접 저장 켜짐 · 시트 앞섬 없음 · 서버 BOM 가상 저장 중이면 RB_FALLBACK) · 잠금 rb_bom(다른 BOM 직접 저장과 같은 줄).

-- JS Number(v) — 숫자 · 숫자 글자 · 참거짓 · null. 못 읽으면 null(NaN)
create or replace function rb_cf_num(v jsonb) returns numeric language plpgsql immutable as $$
declare s text;
begin
  if v is null or jsonb_typeof(v) = 'null' then return 0; end if;
  if jsonb_typeof(v) = 'boolean' then return case when (v #>> '{}')::boolean then 1 else 0 end; end if;
  if jsonb_typeof(v) = 'number' then return (v #>> '{}')::numeric; end if;
  if jsonb_typeof(v) <> 'string' then return null; end if;
  s := rb_cf_trim(v #>> '{}');
  if s = '' then return 0; end if;
  if s ~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$' then return s::numeric; end if;
  return null;
end $$;
-- JS 숫자 → 글자(String(n)) — 흔한 모양만(정수 · 소수)
create or replace function rb_cf_ntxt(n numeric) returns text language sql immutable as $$ select trim_scale(n)::text $$;

/** 그 품목 BOM 줄 · 이력(최근 50) — 화면 bvDirectOut 이 apiBomGet 모양으로 만든다 */
create or replace function rb_cf_bomout(P text) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  return jsonb_build_object(
    'rows', (select coalesce(jsonb_agg(to_jsonb(b) - 'synced_at' order by b.sheet_row, b.id), '[]'::jsonb) from bom_rows b where upper(b.product) = P),
    'log', (select coalesce(jsonb_agg(to_jsonb(l) - 'synced_at' order by l.sheet_row desc), '[]'::jsonb) from (select * from bom_log where upper(product) = P order by sheet_row desc limit 50) l));
end $$;

/** BOM변경이력 한 줄(bom_log 사본 + 시트 일의 logs 줄 모양) */
create or replace function rb_cf_bomlog(e text, P text, rnd text, kind text, typ text, ca text, cb text, bef text, aft text, why text, st text, tag text) returns jsonb language plpgsql security definer set search_path = public as $$
declare nowiso text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'); lsr int;
begin
  select coalesce(max(sheet_row), 1) into lsr from bom_log;
  insert into bom_log select * from jsonb_populate_record(null::bom_log, jsonb_build_object('sheet_row', lsr + 1, 'at', nowiso, 'who', e, 'product', P, 'product_name', '', 'round', rnd,
    'kind', kind, 'type', typ, 'code_a', ca, 'code_b', cb, 'before', bef, 'after', aft, 'why', why, 'order_ref', '', 'state', st, 'change_id', tag, 'synced_at', now()));
  return jsonb_build_array(jsonb_build_object('d', nowiso), e, P, '', rnd, kind, typ, ca, cb, bef, aft, why, '', st, tag, '');
end $$;

create or replace function rb_cf_bomjob(e text, P text, tag text, logs jsonb, extra jsonb) returns void language sql security definer set search_path = public as $$
  insert into rb_tab_job(tab, job) values ('bom', jsonb_build_object('k', 'bom', 'v', 1, 'at', (extract(epoch from now()) * 1000)::bigint, 'who', e, 'product', P, 'tag', tag,
    'rep', jsonb_build_object('codes', case when P <> '' then jsonb_build_array(P) else '[]'::jsonb end, 'ins', '{}'::jsonb, 'upd', '{}'::jsonb, 'del', '{}'::jsonb), 'logs', logs,
    'hist', '[]'::jsonb, 'reg', '[]'::jsonb, 'price', '[]'::jsonb, 'unmark', '[]'::jsonb, 'made', '[]'::jsonb) || extra) $$;

/* ---------- 반제품 차수 고르기(apiSemiPin0_ 와 같은 규칙) ---------- */
create or replace function rb_bom_semipin_do(e text, a jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  P text := upper(rb_cf_str(a->'product')); sc text := upper(rb_cf_str(a->'semi')); fr numeric := rb_cf_num(a->'fromRound'); sr numeric := rb_cf_num(a->'semiRound');
  why text := rb_cf_str(a->'why'); op text := left(rb_t(a->'op'), 60); hit text; conf jsonb; all_ jsonb; m jsonb; L jsonb; bef numeric := 0; x jsonb; tag text := substr(md5(random()::text || clock_timestamp()::text), 1, 8);
  logs jsonb; res jsonb;
begin
  if P is null or sc is null or why is null or P ~ '[^\x01-\x7e]' then raise exception 'RB_FALLBACK 인자 모양'; end if;
  if fr is null or fr = 0 then fr := 1; end if;
  if sr is null then sr := 0; end if;
  if sc !~ '^[A-Z]X[0-9]{4}[A-Z]{2}[0-9]+$' or P = '' then raise exception '코드가 맞지 않습니다.'; end if;
  conf := rb_bom_guard(false);
  if jsonb_typeof(conf->'semipins') is distinct from 'object' then raise exception 'RB_FALLBACK 반제품 차수 사본 모름'; end if;
  perform pg_advisory_xact_lock(hashtext('rb_bom'));
  perform rb_bom_guard(true);
  if op <> '' then
    select rv into hit from rb_recent where rk = 'op:bomsp:' || op and rat > now() - interval '30 minutes';
    if hit is not null then return hit::jsonb || rb_cf_bomout(P) || '{"duplicate":true}'::jsonb; end if;
  end if;
  select rc.v->'semipins' into all_ from rb_conf rc where rc.k = 'bomConf';
  m := coalesce(all_->P, '{}'::jsonb);
  if jsonb_typeof(m) <> 'object' or (m ? sc and jsonb_typeof(m->sc) <> 'array') then raise exception 'RB_FALLBACK 반제품 차수 사본 모양'; end if;
  -- L = 그 차수를 뺀 것 → 그때의 고른 차수(before — 서버와 같게 뺀 뒤에 셈)
  select coalesce(jsonb_agg(z order by o), '[]'::jsonb) into L from jsonb_array_elements(coalesce(m->sc, '[]'::jsonb)) with ordinality t(z, o) where (z->0) is distinct from to_jsonb(fr);
  for x in select z from jsonb_array_elements(L) with ordinality t(z, o) order by rb_num(z->0), o loop
    if rb_num(x->0) <= fr then bef := coalesce(rb_cf_num(x->1), 0); end if;
  end loop;
  L := L || jsonb_build_array(jsonb_build_array(fr, sr));
  select jsonb_agg(z order by rb_num(z->0), o) into L from jsonb_array_elements(L) with ordinality t(z, o);
  m := m || jsonb_build_object(sc, L);
  all_ := all_ || jsonb_build_object(P, m);
  update rb_conf set v = jsonb_set(v, '{semipins}', all_) where k = 'bomConf';
  logs := jsonb_build_array(rb_cf_bomlog(e, P, rb_cf_ntxt(fr) || '차~', '정정', '반제품', sc, sc,
    '반제품 차수 ' || case when bef <> 0 then rb_cf_ntxt(bef) || '차' else '최신' end, '반제품 차수 ' || case when sr <> 0 then rb_cf_ntxt(sr) || '차' else '최신' end,
    coalesce(nullif(why, ''), '반제품 차수 고르기'), '참고', tag || '-sp'));
  perform rb_cf_bomjob(e, P, tag, logs, jsonb_build_object('cfSemiPin', jsonb_build_object('product', P, 'semi', sc, 'from', fr, 'sr', sr)));
  res := jsonb_build_object('ok', true, 'sb', 1, 'code', P, 'semiPin', m, 'saved', 1, 'logTag', tag, 'made', '[]'::jsonb, 'splitMap', '{}'::jsonb);
  if op <> '' then
    insert into rb_recent(rk, rby, rv, rat) values ('op:bomsp:' || op, e, res::text, now()) on conflict on constraint rb_recent_pkey do update set rby = excluded.rby, rv = excluded.rv, rat = excluded.rat;
  end if;
  return res || rb_cf_bomout(P);
end $$;

/* ---------- 자재 구분 추가(apiBomAddType 와 같은 규칙) ---------- */
create or replace function rb_bom_addtype_do(e text, a jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  nm text := rb_cf_str(a->'name'); cd text := upper(rb_cf_str(a->'code')); op text := left(rb_t(a->'op'), 60); hit text; conf jsonb; tp jsonb; byc text; used jsonb; ul text; tag text := substr(md5(random()::text || clock_timestamp()::text), 1, 8);
  logs jsonb; res jsonb;
begin
  if nm is null or cd is null or rb_cf_astral(nm) then raise exception 'RB_FALLBACK 인자 모양'; end if;
  nm := left(regexp_replace(nm, '[\s   -     　﻿]+', ' ', 'g'), 20);
  if nm = '' then raise exception '구분 이름을 넣어 주세요.'; end if;
  if cd !~ '^[A-Z]{2}$' then raise exception '약호는 영문 대문자 2글자로 넣어 주세요(예: CS).'; end if;
  conf := rb_bom_guard(false);
  if jsonb_typeof(conf->'types') is distinct from 'object' then raise exception 'RB_FALLBACK 구분표 모름'; end if;
  perform pg_advisory_xact_lock(hashtext('rb_bom'));
  perform rb_bom_guard(true);
  if op <> '' then
    select rv into hit from rb_recent where rk = 'op:bomty:' || op and rat > now() - interval '30 minutes';
    if hit is not null then return hit::jsonb || '{"duplicate":true}'::jsonb; end if;
  end if;
  select rc.v into conf from rb_conf rc where rc.k = 'bomConf';
  tp := conf->'types';
  if rb_t(tp->nm) <> '' then raise exception '"%" 구분은 이미 있습니다(약호 %).', nm, tp->>nm; end if;
  select string_agg(key, ', ') into byc from jsonb_each_text(tp) where value = cd;
  if byc is not null then raise exception '약호 % 는 이미 "%" 에 쓰고 있습니다.', cd, byc; end if;
  used := rb_bom_used(conf);
  select string_agg(k, ', ') into ul from (select k from jsonb_object_keys(used) k where k ~ ('^[A-Z]P[0-9]{4}' || cd || '[0-9]+$') order by k limit 3) z;
  if ul is not null then raise exception '약호 % 는 이미 자재코드에 쓰였습니다(%). 다른 약호를 넣어 주세요.', cd, ul; end if;
  tp := tp || jsonb_build_object(nm, cd);
  update rb_conf set v = jsonb_set(v, '{types}', tp) where k = 'bomConf';
  logs := jsonb_build_array(rb_cf_bomlog(e, '', '', '구분 추가', nm, '', '', '', nm || ' = ' || cd, '자재 구분 새로 추가', '-', tag || '-ty'));
  perform rb_cf_bomjob(e, '', tag, logs, jsonb_build_object('cfTypeAdd', jsonb_build_object('name', nm, 'code', cd)));
  res := jsonb_build_object('ok', true, 'types', tp);
  if op <> '' then
    insert into rb_recent(rk, rby, rv, rat) values ('op:bomty:' || op, e, res::text, now()) on conflict on constraint rb_recent_pkey do update set rby = excluded.rby, rv = excluded.rv, rat = excluded.rat;
  end if;
  return res;
end $$;

/* ---------- 세트에서 구성 완제품 자재 빼기 · 되살리기(apiBomSetCompOff 와 같은 규칙) ---------- */
create or replace function rb_bom_compoff_do(e text, a jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  P text := upper(rb_cf_str(a->'product')); cc text := upper(rb_cf_str(a->'comp')); fam text := rb_cf_str(a->'fam'); off_ boolean := rb_pg_tru(a->'off'); why text := rb_cf_str(a->'why');
  op text := left(rb_t(a->'op'), 60); hit text; conf jsonb; all_ jsonb; sk text; L jsonb; bef text; aft text; i int; tag text := substr(md5(random()::text || clock_timestamp()::text), 1, 8);
  logs jsonb; res jsonb; co jsonb; typ text;
begin
  if P is null or cc is null or fam is null or why is null or rb_cf_astral(fam) or rb_cf_astral(why) or P ~ '[^\x01-\x7e]' or cc ~ '[^\x01-\x7e]' then raise exception 'RB_FALLBACK 인자 모양'; end if;
  if P !~ '^[A-Z]X?[0-9]{4}[A-Z]{2}[0-9]+$' or cc !~ '^[A-Z]X?[0-9]{4}[A-Z]{2}[0-9]+$' or P = cc then raise exception '세트 · 구성 완제품 코드가 맞지 않습니다.'; end if;
  if fam !~ '^[^|]{1,30}\|[A-Z0-9]{4,20}$' then raise exception '뺄 자재가 맞지 않습니다: %', fam; end if;
  conf := rb_bom_guard(false);
  if jsonb_typeof(conf->'setx') is distinct from 'object' then raise exception 'RB_FALLBACK 세트 뺀 자재 사본 모름'; end if;
  perform pg_advisory_xact_lock(hashtext('rb_bom'));
  perform rb_bom_guard(true);
  if op <> '' then
    select rv into hit from rb_recent where rk = 'op:bomcx:' || op and rat > now() - interval '30 minutes';
    if hit is not null then return hit::jsonb || rb_cf_bomout(P) || '{"duplicate":true}'::jsonb; end if;
  end if;
  select rc.v->'setx' into all_ from rb_conf rc where rc.k = 'bomConf';
  sk := P || '|' || cc;
  L := coalesce(all_->sk, '[]'::jsonb);
  if jsonb_typeof(L) <> 'array' or exists (select 1 from jsonb_array_elements(L) z where jsonb_typeof(z) <> 'string') then raise exception 'RB_FALLBACK 세트 뺀 자재 사본 모양'; end if;
  select coalesce(string_agg(z, ', ' order by o), '') into bef from jsonb_array_elements_text(L) with ordinality t(z, o);
  select min(o - 1) into i from jsonb_array_elements_text(L) with ordinality t(z, o) where z = fam;
  if off_ and i is null then L := L || to_jsonb(fam); elsif not off_ and i is not null then L := L - i; end if;
  select coalesce(string_agg(z, ', ' order by o), '') into aft from jsonb_array_elements_text(L) with ordinality t(z, o);
  if bef <> aft then
    if jsonb_array_length(L) > 0 then
      select jsonb_agg(z order by z collate "C", o) into L from jsonb_array_elements_text(L) with ordinality t(z, o);
      all_ := all_ || jsonb_build_object(sk, L);
    else all_ := all_ - sk; end if;
    update rb_conf set v = jsonb_set(v, '{setx}', all_) where k = 'bomConf';
    typ := split_part(fam, '|', 1);
    logs := jsonb_build_array(rb_cf_bomlog(e, P, '', '세트 구성 ' || case when off_ then '뺌' else '되살림' end, typ, cc, cc, coalesce(nullif(bef, ''), '-'), coalesce(nullif(aft, ''), '-'),
      coalesce(nullif(left(why, 200), ''), cc || ' 의 ' || typ || ' — 이 세트에서만 ' || case when off_ then '안 씀' else '다시 씀' end), '참고', tag || '-cx'));
    perform rb_cf_bomjob(e, P, tag, logs, jsonb_build_object('cfSetx', jsonb_build_object('product', P, 'comp', cc, 'fam', fam, 'off', off_)));
  end if;
  select coalesce(jsonb_object_agg(substr(key, length(P) + 2), value), '{}'::jsonb) into co from jsonb_each(all_)
   where left(key, length(P) + 1) = P || '|' and jsonb_typeof(value) = 'array' and jsonb_array_length(value) > 0;
  res := jsonb_build_object('ok', true, 'sb', 1, 'code', P, 'compOff', co, 'saved', case when bef <> aft then 1 else 0 end, 'logTag', case when bef <> aft then tag else '' end, 'made', '[]'::jsonb, 'splitMap', '{}'::jsonb);
  if op <> '' then
    insert into rb_recent(rk, rby, rv, rat) values ('op:bomcx:' || op, e, res::text, now()) on conflict on constraint rb_recent_pkey do update set rby = excluded.rby, rv = excluded.rv, rat = excluded.rat;
  end if;
  return res || rb_cf_bomout(P);
end $$;

create or replace function rb_bom_cfset(p_token text, p_fn text, p_args jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := rb_me(p_token); ed boolean;
begin
  if e is null then raise exception 'RB_SESSION'; end if;
  select editor into ed from rb_session where token = p_token;
  if not coalesce(ed, false) then raise exception 'RB_SESSION 저장 권한 확인'; end if;
  if p_fn = 'apiSemiPin' then return rb_bom_semipin_do(e, coalesce(p_args, '{}'::jsonb)); end if;
  if p_fn = 'apiBomAddType' then return rb_bom_addtype_do(e, coalesce(p_args, '{}'::jsonb)); end if;
  if p_fn = 'apiBomSetCompOff' then return rb_bom_compoff_do(e, coalesce(p_args, '{}'::jsonb)); end if;
  raise exception 'RB_FALLBACK % 는 서버 길', p_fn;
end $$;

/** 서버 bomConfPublish_ — 속성에 아직 안 옮긴 직접 저장이 있으면 그 칸은 사본 값 그대로(옛 속성 값으로 덮지 않게) */
create or replace function rb_bom_conf_put(p_conf jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare cur jsonb; nv jsonb := p_conf; kept text[] := '{}';
begin
  perform pg_advisory_xact_lock(hashtext('rb_bom'));
  select v into cur from rb_conf where k = 'bomConf';
  if cur is not null then
    if exists (select 1 from rb_tab_job where tab = 'bom' and done_at is null and job ? 'hfProp') and cur ? 'hf' then nv := jsonb_set(nv, '{hf}', cur->'hf'); kept := array_append(kept, 'hf'); end if;
    if exists (select 1 from rb_tab_job where tab = 'bom' and done_at is null and (job ? 'cfSemiPin' or job ? 'semiPinAdd')) and cur ? 'semipins' then nv := jsonb_set(nv, '{semipins}', cur->'semipins'); kept := array_append(kept, 'semipins'); end if;
    if exists (select 1 from rb_tab_job where tab = 'bom' and done_at is null and job ? 'cfTypeAdd') and cur ? 'types' then nv := jsonb_set(nv, '{types}', cur->'types'); kept := array_append(kept, 'types'); end if;
    if exists (select 1 from rb_tab_job where tab = 'bom' and done_at is null and job ? 'cfSetx') and cur ? 'setx' then nv := jsonb_set(nv, '{setx}', cur->'setx'); kept := array_append(kept, 'setx'); end if;
  end if;
  insert into rb_conf(k, v, at) values ('bomConf', nv, now()) on conflict (k) do update set v = excluded.v, at = excluded.at;
  return jsonb_build_object('kept', to_jsonb(kept));
end $$;

revoke all on function rb_cf_num(jsonb) from public, anon, authenticated;
revoke all on function rb_cf_ntxt(numeric) from public, anon, authenticated;
revoke all on function rb_cf_bomout(text) from public, anon, authenticated;
revoke all on function rb_cf_bomlog(text, text, text, text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function rb_cf_bomjob(text, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function rb_bom_semipin_do(text, jsonb) from public, anon, authenticated;
revoke all on function rb_bom_addtype_do(text, jsonb) from public, anon, authenticated;
revoke all on function rb_bom_compoff_do(text, jsonb) from public, anon, authenticated;
revoke all on function rb_bom_conf_put(jsonb) from public, anon, authenticated;
revoke all on function rb_bom_cfset(text, text, jsonb) from public;
grant execute on function rb_bom_cfset(text, text, jsonb) to anon, authenticated;
