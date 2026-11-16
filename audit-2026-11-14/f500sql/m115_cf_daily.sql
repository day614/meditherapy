-- m115_cf_daily — 일일보고 저장(보고서 [저장] · 병목/이슈 · 보고 제외 · 저장 풀기)을 Supabase 함수로 바로(할 일 대기열 대신 · 진짜 응답)
-- 원본: rb_daily(날짜마다 한 줄 = 시트 '_실행판_일일보고' 줄의 머리 + 직접 저장한 보고서 글) · rb_dly_hide(날짜마다 보고 제외 열쇠 = 예전 속성 rb.dlyhide.<날짜>).
-- 시트는 사본 — 저장마다 rb_tab_job tab='dly' {d, kind, who, at} → 서버 cfDailyDrainIn_ 가 그 날짜 줄을 '지금 rb_daily 값'으로 시트에(차례가 뒤바뀌어도 시트 = 원본).
-- 서버 길(apiDailySaveRep · apiDailyIssues · apiDailyHide · apiDailyUnlock · dailyReportCore_ [저장])도 켜져 있으면 rb_dly_srv 로(저장 길 하나 · 같은 잠금 rb_dly).
-- 켜짐 rb_conf 'dlyConf' {on:'1', seeded, admins[]} — 서버 cfDailyConfPublish_ 가 시트 → rb_daily 처음 채우기(rb_dly_seed) 뒤에 켠다.
create table if not exists rb_daily (
  d text primary key,                    -- 'yyyy-MM-dd'
  pos int not null,                      -- 시트 줄 번호(뒤 날짜 찾기 · 새 줄 자리 — 시트 차례 그대로)
  saved_at text not null default '',     -- 'yyyy-MM-dd HH:mm'(서울)
  saved_by text not null default '',
  issues jsonb not null default '[]'::jsonb,
  has_rep boolean not null default false,
  rep text,                              -- 직접 저장한 보고서 JSON 글(시트에 옮기면 비움)
  rep_w text not null default 'k',       -- 시트 보고서 칸: k 그대로 · s rep 를 씀 · c 비움
  seq bigint not null default 0,
  at timestamptz not null default now()
);
create table if not exists rb_dly_hide (
  d text primary key,
  keys jsonb not null default '[]'::jsonb,
  seq bigint not null default 0,
  at timestamptz not null default now()
);
alter table rb_daily enable row level security;
alter table rb_dly_hide enable row level security;
revoke all on table rb_daily from anon, authenticated;
revoke all on table rb_dly_hide from anon, authenticated;

-- JS String.prototype.trim 과 같은 공백(\s 에 NBSP · 전각 공백 · BOM 등)
create or replace function rb_cf_trim(t text) returns text language sql immutable as $$
  select regexp_replace(coalesce(t, ''), '^[\s   -     　﻿]+|[\s   -     　﻿]+$', '', 'g') $$;
-- JS str_(v): true/false → '' · null → '' · 글자 → trim · 숫자 → 글자. 다른 모양(객체 · 배열)은 null(부르는 쪽이 RB_FALLBACK)
create or replace function rb_cf_str(v jsonb) returns text language sql immutable as $$
  select case when v is null or jsonb_typeof(v) in ('null', 'boolean') then ''
              when jsonb_typeof(v) = 'string' then rb_cf_trim(v #>> '{}')
              when jsonb_typeof(v) = 'number' and (v #>> '{}') ~ '^-?[0-9]+(\.[0-9]*[1-9])?$' and length(v #>> '{}') < 16 then v #>> '{}'
              else null end $$;
-- 4바이트 글자(JS 에선 두 칸) — 글자 수 자르기가 JS 와 달라지므로 있으면 RB_FALLBACK
create or replace function rb_cf_astral(t text) returns boolean language sql immutable as $$
  select coalesce(t, '') ~ '[\U00010000-\U0010FFFF]' $$;
create or replace function rb_dly_today() returns text language sql stable as $$
  select to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD') $$;
create or replace function rb_dly_okdate(v jsonb) returns text language sql immutable as $$
  select case when rb_cf_str(v) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then rb_cf_str(v) else '' end $$;
-- JS Number(x) >= 7 처럼(보고서 판 rep.v) — 숫자 · 숫자 글자만, 나머지는 false
create or replace function rb_dly_vok(v jsonb) returns boolean language plpgsql immutable as $$
declare s text;
begin
  if v is null or jsonb_typeof(v) <> 'number' and jsonb_typeof(v) <> 'string' then return false; end if;
  if jsonb_typeof(v) = 'number' then return (v #>> '{}')::numeric >= 7; end if;
  s := rb_cf_trim(v #>> '{}');
  if s = '' then return false; end if;
  if s ~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$' then return s::numeric >= 7; end if;
  return false;
end $$;

/** 켜짐 · 앞선 저장 확인(직접 길만). 서버 길(p_srv)은 처음 채우기만 본다 */
create or replace function rb_dly_ready(p_srv boolean) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c jsonb;
begin
  select v into c from rb_conf where k = 'dlyConf';
  if c is null or rb_t(c->'seeded') = '' then raise exception 'RB_FALLBACK 일일보고 직접 저장 준비 전'; end if;
  if p_srv then return c; end if;
  if coalesce(c->>'on', '') <> '1' then raise exception 'RB_FALLBACK 일일보고 직접 저장 꺼짐(%)', coalesce(c->>'why', ''); end if;
  -- 할 일 대기열(예전 길)에 일일보고 저장이 남았으면 그 뒤 차례로(예전 길)
  if exists (select 1 from rb_tab_job where tab = 'pj' and done_at is null and job->>'fn' in ('apiDailyHide', 'apiDailyIssues', 'apiDailySaveRep', 'apiDailyUnlock')) then
    raise exception 'RB_FALLBACK 앞선 일일보고 저장이 대기열에 있음';
  end if;
  return c;
end $$;

create or replace function rb_dly_do(e text, p_fn text, a jsonb, p_admin boolean, p_srv boolean) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c jsonb; who text := split_part(coalesce(e, ''), '@', 1); today text; dt text; ahead text; r rb_daily%rowtype; repj jsonb; rept text; ms bigint;
  nowat text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'); clean jsonb := '[]'::jsonb; rw jsonb; cell jsonb; cs text; line jsonb; keep boolean;
  ks jsonb := '[]'::jsonb; L jsonb; k text; onv boolean; i int; n int; ln int; later text; adm jsonb;
begin
  c := rb_dly_ready(p_srv);
  if jsonb_typeof(a) is distinct from 'array' then raise exception 'RB_FALLBACK 인자 모양'; end if;
  perform pg_advisory_xact_lock(hashtext('rb_dly'));
  c := rb_dly_ready(p_srv);      -- 잠근 뒤 다시(끄기 · 처음 채우기는 같은 잠금)
  today := rb_dly_today();
  ms := (extract(epoch from clock_timestamp()) * 1000)::bigint;

  if p_fn = 'apiDailySaveRep' then
    dt := rb_dly_okdate(a->0); if dt = '' then dt := today; end if;
    if dt < today then raise exception '지난 날짜는 이 방식으로 저장하지 않습니다 — 새로고침 후 다시 해 주세요.'; end if;
    select case when exists (select 1 from rb_daily x where x.d = today and x.has_rep) then to_char((today::date + 1), 'YYYY-MM-DD') else '' end into ahead;
    if dt > today and dt <> ahead then raise exception '앞으로의 날짜는 저장할 수 없습니다.'; end if;
    -- 보고서는 화면이 JSON 글로 보낸다(jsonb 는 열쇠 차례를 바꾸므로 글 그대로 둔다)
    if jsonb_typeof(a->1) = 'string' then
      rept := a->>1;
      begin repj := rept::jsonb; exception when others then repj := null; end;
    elsif jsonb_typeof(a->1) in ('null') or a->1 is null then repj := null;
    else raise exception 'RB_FALLBACK 보고서를 글로 보내지 않음'; end if;
    if repj is null or jsonb_typeof(repj) not in ('object', 'array') or not rb_dly_vok(repj->'v') or not rb_pg_tru(repj->'asOf') then
      raise exception '보고서 내용이 없습니다 — 새로고침 후 다시 해 주세요.';
    end if;
    if jsonb_typeof(repj) <> 'object' or repj ? 'issues' or repj ? 'author' or repj ? 'weekMode' then raise exception 'RB_FALLBACK 보고서 모양'; end if;
    select * into r from rb_daily where d = dt;
    if found and r.has_rep then raise exception '% 보고서는 이미 저장(%)했습니다.', dt, r.saved_at; end if;
    if length(rept) + (length(rept) - length(regexp_replace(rept, '[\U00010000-\U0010FFFF]', '', 'g'))) > 8 * 45000 then raise exception '보고서가 너무 커서 저장하지 못했습니다.'; end if;
    if found then
      update rb_daily set saved_at = nowat, saved_by = who, has_rep = true, rep = rept, rep_w = 's', seq = seq + 1, at = now() where d = dt;
    else
      insert into rb_daily(d, pos, saved_at, saved_by, issues, has_rep, rep, rep_w, seq)
        values (dt, coalesce((select max(pos) from rb_daily), 1) + 1, nowat, who, '[]'::jsonb, true, rept, 's', 1);
    end if;
    insert into rb_tab_job(tab, job) values ('dly', jsonb_build_object('d', dt, 'kind', 'rep', 'who', e, 'at', ms));
    return jsonb_build_object('date', dt, 'saved', true, 'savedAt', nowat, 'savedBy', who, 'direct', 1);

  elsif p_fn = 'apiDailyIssues' then
    dt := rb_dly_okdate(a->0); if dt = '' then raise exception '날짜가 없습니다.'; end if;
    if exists (select 1 from rb_daily x where x.d = dt and x.has_rep) then raise exception '% 보고서는 이미 저장했습니다 — 저장한 보고서는 고칠 수 없습니다(관리자 [저장 풀기]).', dt; end if;
    if a->1 is not null and jsonb_typeof(a->1) not in ('array', 'null') then raise exception 'RB_FALLBACK 이슈 모양'; end if;
    for rw in select z from jsonb_array_elements(coalesce(nullif(a->1, 'null'::jsonb), '[]'::jsonb)) z loop
      if jsonb_typeof(rw) = 'null' then rw := '[]'::jsonb; end if;
      if jsonb_typeof(rw) <> 'array' then raise exception 'RB_FALLBACK 이슈 줄 모양'; end if;
      line := '[]'::jsonb; keep := false; i := 0;
      for cell in select z2 from jsonb_array_elements(rw) z2 loop
        i := i + 1; exit when i > 7;
        cs := rb_cf_str(cell);
        if cs is null or rb_cf_astral(cs) then raise exception 'RB_FALLBACK 이슈 칸 모양'; end if;
        cs := left(cs, 500);
        if cs <> '' then keep := true; end if;
        line := line || to_jsonb(cs);
      end loop;
      if keep and jsonb_array_length(clean) < 50 then clean := clean || jsonb_build_array(line); end if;
    end loop;
    select * into r from rb_daily where d = dt;
    if found then
      update rb_daily set saved_at = nowat, saved_by = who, issues = clean, seq = seq + 1, at = now() where d = dt;
    else
      insert into rb_daily(d, pos, saved_at, saved_by, issues, has_rep, rep, rep_w, seq)
        values (dt, coalesce((select max(pos) from rb_daily), 1) + 1, nowat, who, clean, false, null, 'k', 1);
    end if;
    insert into rb_tab_job(tab, job) values ('dly', jsonb_build_object('d', dt, 'kind', 'iss', 'who', e, 'at', ms));
    return jsonb_build_object('issues', clean);

  elsif p_fn = 'apiDailyHide' then
    dt := rb_dly_okdate(a->0); if dt = '' then raise exception '날짜가 없습니다.'; end if;
    if exists (select 1 from rb_daily x where x.d = dt and x.has_rep) then raise exception '% 보고서는 이미 저장했습니다 — 저장한 보고서는 고칠 수 없습니다(관리자 [저장 풀기]).', dt; end if;
    if a->1 is not null and jsonb_typeof(a->1) not in ('array', 'null') then raise exception 'RB_FALLBACK 열쇠 모양'; end if;
    for cell in select z from jsonb_array_elements(coalesce(nullif(a->1, 'null'::jsonb), '[]'::jsonb)) z loop
      cs := rb_cf_str(cell);
      if cs is null or rb_cf_astral(cs) then raise exception 'RB_FALLBACK 열쇠 모양'; end if;
      cs := left(cs, 40);
      if cs <> '' then ks := ks || to_jsonb(cs); end if;
    end loop;
    onv := rb_pg_tru(a->2);
    select keys into L from rb_dly_hide where d = dt;
    L := coalesce(L, '[]'::jsonb);
    for k in select jsonb_array_elements_text(ks) loop
      select min(o - 1) into i from jsonb_array_elements_text(L) with ordinality t(x, o) where x = k;
      if onv and i is null then L := L || to_jsonb(k); end if;
      if not onv and i is not null then L := L - i; end if;
    end loop;
    -- 속성 한 칸(9KB) 안에 — JSON.stringify(L).length > 8500 이면 앞에서 지움
    loop
      n := jsonb_array_length(L);
      exit when n = 0;
      select 2 + coalesce(sum(length(to_json(x)::text)), 0) + greatest(n - 1, 0) into ln from jsonb_array_elements_text(L) x;
      exit when ln <= 8500;
      L := L - 0;
    end loop;
    insert into rb_dly_hide(d, keys, seq) values (dt, L, 1) on conflict (d) do update set keys = excluded.keys, seq = rb_dly_hide.seq + 1, at = now();
    insert into rb_tab_job(tab, job) values ('dly', jsonb_build_object('d', dt, 'kind', 'hide', 'who', e, 'at', ms, 'n', jsonb_array_length(ks), 'on', onv));
    return L;

  elsif p_fn = 'apiDailyUnlock' then
    adm := coalesce(c->'admins', '[]'::jsonb);
    if not p_admin and not exists (select 1 from jsonb_array_elements_text(adm) x where lower(x) = lower(coalesce(e, ''))) then raise exception '관리자만 변경할 수 있습니다.'; end if;
    dt := rb_dly_okdate(a->0); if dt = '' then raise exception '날짜가 없습니다.'; end if;
    select * into r from rb_daily where d = dt;
    if not found then raise exception '저장된 보고서가 없습니다.'; end if;
    select x.d into later from rb_daily x where x.d > dt and x.has_rep order by x.pos limit 1;
    if later is not null then raise exception '% 보고서가 이미 저장돼 있어 % 저장을 풀 수 없습니다(뒤 보고서 구간과 겹침).', later, dt; end if;
    update rb_daily set has_rep = false, rep = null, rep_w = 'c', seq = seq + 1, at = now() where d = dt;
    insert into rb_tab_job(tab, job) values ('dly', jsonb_build_object('d', dt, 'kind', 'unlock', 'who', e, 'at', ms));
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'RB_FALLBACK % 는 서버 길', p_fn;
end $$;

/** 화면(세션) — rb_once 로 부른다 */
create or replace function rb_dly_save(p_token text, p_fn text, p_args jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := rb_me(p_token); ed boolean;
begin
  if e is null then raise exception 'RB_SESSION'; end if;
  select editor into ed from rb_session where token = p_token;
  if not coalesce(ed, false) then raise exception 'RB_SESSION 저장 권한 확인'; end if;
  return rb_dly_do(e, p_fn, p_args, false, false);
end $$;

/** 서버 길(서비스 키) — 켜져 있으면 서버 api 도 여기로(같은 규칙 · 같은 잠금). p_admin = 서버가 requireAdmin_ 를 이미 함 */
create or replace function rb_dly_srv(p_email text, p_fn text, p_args jsonb, p_admin boolean) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return rb_dly_do(p_email, p_fn, p_args, coalesce(p_admin, false), true);
end $$;

/** 서버 [저장](dailyReportCore_ · 지난 날짜 · 다시 계산한 보고서)도 같은 원본에 — 검사는 서버가 했다. p_rep = 보고서 JSON 글(null = 특이사항만) */
create or replace function rb_dly_write_srv(p_email text, p_date text, p_rep text, p_issues jsonb, p_who text, p_chk text) returns jsonb language plpgsql security definer set search_path = public as $$
declare r rb_daily%rowtype; nowat text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'); ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  perform rb_dly_ready(true);
  if coalesce(p_date, '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception '날짜가 없습니다.'; end if;
  perform pg_advisory_xact_lock(hashtext('rb_dly'));
  select * into r from rb_daily where d = p_date;
  -- 서버가 시트를 읽은 뒤 그사이 직접 저장이 들어온 경우(같은 잠금 안에서 다시 확인)
  if p_chk = 'rep' and found and r.has_rep then raise exception '% 보고서는 이미 저장(%)했습니다 — 저장한 보고서는 고칠 수 없습니다(관리자 [저장 풀기]).', p_date, r.saved_at; end if;
  if p_chk = 'lock' and found and r.has_rep then raise exception '% 보고서는 이미 저장했습니다 — 저장한 보고서는 고칠 수 없습니다(관리자 [저장 풀기]).', p_date; end if;
  if p_rep is not null and length(p_rep) + (length(p_rep) - length(regexp_replace(p_rep, '[\U00010000-\U0010FFFF]', '', 'g'))) > 8 * 45000 then raise exception '보고서가 너무 커서 저장하지 못했습니다.'; end if;
  if found then
    update rb_daily set saved_at = nowat, saved_by = coalesce(nullif(p_who, ''), split_part(p_email, '@', 1)), issues = coalesce(p_issues, issues),      -- 보고서 저장은 특이사항을 안 보냄(그사이 직접 저장한 특이사항을 덮지 않게)
      has_rep = case when p_rep is null then has_rep else p_rep <> '' end, rep = case when p_rep is null then rep else p_rep end,
      rep_w = case when p_rep is null then rep_w else 's' end, seq = seq + 1, at = now() where d = p_date;
  else
    insert into rb_daily(d, pos, saved_at, saved_by, issues, has_rep, rep, rep_w, seq)
      values (p_date, coalesce((select max(pos) from rb_daily), 1) + 1, nowat, coalesce(nullif(p_who, ''), split_part(p_email, '@', 1)), coalesce(p_issues, '[]'::jsonb),
              coalesce(p_rep, '') <> '', p_rep, case when p_rep is null then 'k' else 's' end, 1);
  end if;
  insert into rb_tab_job(tab, job) values ('dly', jsonb_build_object('d', p_date, 'kind', case when p_rep is null then 'iss' else 'write' end, 'who', p_email, 'at', ms, 'srv', 1));
  return jsonb_build_object('savedAt', nowat);
end $$;

/** 처음 채우기(서버 · 끈 상태에서만) — 시트 줄 머리 · 보고 제외 속성 그대로. 남은 시트 맞추기 일이 있으면 안 함 */
create or replace function rb_dly_seed(p_rows jsonb, p_hide jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform pg_advisory_xact_lock(hashtext('rb_dly'));
  if exists (select 1 from rb_tab_job where tab = 'dly' and done_at is null) then raise exception 'RB_DLY_PENDING 시트 맞추기 일이 남음'; end if;
  if exists (select 1 from rb_conf where k = 'dlyConf' and coalesce(v->>'on', '') = '1') then raise exception 'RB_DLY_ON 켜진 채로는 다시 채우지 않음'; end if;
  delete from rb_daily; delete from rb_dly_hide;
  insert into rb_daily(d, pos, saved_at, saved_by, issues, has_rep, rep, rep_w, seq)
    select x->>'d', (x->>'pos')::int, coalesce(x->>'savedAt', ''), coalesce(x->>'savedBy', ''), coalesce(x->'issues', '[]'::jsonb), coalesce((x->>'hasRep')::boolean, false), null, 'k', 0
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x on conflict (d) do nothing;
  get diagnostics n = row_count;
  insert into rb_dly_hide(d, keys) select key, value from jsonb_each(coalesce(p_hide, '{}'::jsonb)) where jsonb_typeof(value) = 'array';
  return jsonb_build_object('rows', n);
end $$;

/** 켜기 · 끄기(같은 잠금 — 진행 중인 직접 저장이 끝난 뒤 바뀜) */
create or replace function rb_dly_conf_put(p_conf jsonb) returns void language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('rb_dly'));
  insert into rb_conf(k, v, at) values ('dlyConf', p_conf, now()) on conflict (k) do update set v = excluded.v, at = excluded.at;
end $$;

revoke all on function rb_cf_trim(text) from public, anon, authenticated;
revoke all on function rb_cf_str(jsonb) from public, anon, authenticated;
revoke all on function rb_cf_astral(text) from public, anon, authenticated;
revoke all on function rb_dly_today() from public, anon, authenticated;
revoke all on function rb_dly_okdate(jsonb) from public, anon, authenticated;
revoke all on function rb_dly_vok(jsonb) from public, anon, authenticated;
revoke all on function rb_dly_ready(boolean) from public, anon, authenticated;
revoke all on function rb_dly_do(text, text, jsonb, boolean, boolean) from public, anon, authenticated;
revoke all on function rb_dly_srv(text, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function rb_dly_write_srv(text, text, text, jsonb, text, text) from public, anon, authenticated;
revoke all on function rb_dly_seed(jsonb, jsonb) from public, anon, authenticated;
revoke all on function rb_dly_conf_put(jsonb) from public, anon, authenticated;
revoke all on function rb_dly_save(text, text, jsonb) from public;
grant execute on function rb_dly_save(text, text, jsonb) to anon, authenticated;
