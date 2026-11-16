-- m140_mat_inb — BOM 자재 입고(발주 상세 [▸ BOM 자재 입고]) · Supabase 가 원본
--  · rb_mat_inb  : 자재 부분 입고 줄(발주 실행판ID · 자재코드 · 입고일 · 수량 · 메모 — 돈 없음)
--  · rb_mat_link : 사급 자재 → 사급 발주 연결(발주ID · 자재코드 → 사급 발주ID, '-' = 연결 안 함(여기서 적음))
--  · rb_mat_log  : 바꾼 기록(누가 · 언제 · 앞 · 뒤)
--  · rb_mat_save(token) / rb_mat_save_srv(email) : 저장 길 하나(rb_mat_do) — 세션 · 저장 권한 · 검사 · 잠금 · 시트 사본 일(rb_tab_job 'mi') · rb_ver 'mi'
--  · rb_mat_get(token)  / rb_mat_get_srv        : 한 발주 건 줄 · 연결
--  · rb_mat_import(rows, links) : 켜기 전 시트(_실행판_자재입고 · _실행판_자재연결)에 있던 것을 한 번 옮기고 rb_conf 'miConf' 를 켬(서버만)
-- 켜짐: rb_conf 'miConf' {on:'1'}(rb_mat_import 가 켬). 'gate:rb_mat_save' {on:'1'} 이면 화면 직접 저장은 RB_FALLBACK(서버 길).

create table if not exists rb_mat_inb (
  id text primary key,
  oid text not null,
  code text not null,
  d date not null,
  qty numeric not null check (qty > 0),
  memo text not null default '',
  by_email text not null default '',
  at timestamptz not null default now(),
  upd_by text not null default '',
  upd_at timestamptz,
  ver int not null default 1
);
create index if not exists rb_mat_inb_oid on rb_mat_inb (oid);
create table if not exists rb_mat_link (
  oid text not null,
  code text not null,
  link text not null,
  by_email text not null default '',
  at timestamptz not null default now(),
  primary key (oid, code)
);
create table if not exists rb_mat_log (
  id bigserial primary key,
  oid text not null,
  code text not null default '',
  op text not null,
  line_id text,
  before jsonb,
  after jsonb,
  by_email text not null default '',
  at timestamptz not null default now()
);
create index if not exists rb_mat_log_oid on rb_mat_log (oid);

alter table rb_mat_inb enable row level security;
alter table rb_mat_link enable row level security;
alter table rb_mat_log enable row level security;
revoke all on rb_mat_inb, rb_mat_link, rb_mat_log from anon, authenticated;
grant select on rb_mat_inb, rb_mat_link to authenticated;
drop policy if exists rb_mat_inb_read on rb_mat_inb;
create policy rb_mat_inb_read on rb_mat_inb for select to authenticated using (true);
drop policy if exists rb_mat_link_read on rb_mat_link;
create policy rb_mat_link_read on rb_mat_link for select to authenticated using (true);

-- 한 발주 건의 지금 값(화면 · 서버 모두 이 모양)
create or replace function rb_mat_state(p_oid text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'oid', p_oid,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'code', i.code, 'd', to_char(i.d, 'YYYY-MM-DD'), 'qty', i.qty, 'memo', i.memo,
               'by', i.by_email, 'at', i.at, 'updBy', i.upd_by, 'updAt', i.upd_at, 'ver', i.ver) order by i.code, i.d, i.at, i.id)
             from rb_mat_inb i where i.oid = p_oid), '[]'::jsonb),
    'links', coalesce((select jsonb_object_agg(l.code, jsonb_build_object('link', l.link, 'by', l.by_email, 'at', l.at)) from rb_mat_link l where l.oid = p_oid), '{}'::jsonb),
    'db', 1)
$$;

-- 검사 도우미
create or replace function rb_mat_txt(v jsonb) returns text language sql immutable as $$
  select case when v is null or jsonb_typeof(v) = 'null' then '' when jsonb_typeof(v) = 'string' then btrim(v #>> '{}') else btrim(v::text) end
$$;
create or replace function rb_mat_day(t text) returns date language plpgsql immutable as $$
declare d date;
begin
  if t !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'RB_MAT_BAD 입고일은 yyyy-mm-dd 로 적어 주세요(%).', t; end if;
  begin d := t::date; exception when others then raise exception 'RB_MAT_BAD 없는 날짜입니다(%).', t; end;
  if to_char(d, 'YYYY-MM-DD') <> t then raise exception 'RB_MAT_BAD 없는 날짜입니다(%).', t; end if;
  if d < date '2000-01-01' or d > date '2100-12-31' then raise exception 'RB_MAT_BAD 입고일이 이상합니다(%).', t; end if;
  return d;
end $$;
create or replace function rb_mat_num(t text) returns numeric language plpgsql immutable as $$
declare s text := replace(replace(coalesce(t, ''), ',', ''), ' ', ''); n numeric;
begin
  if s !~ '^\d+(\.\d{1,4})?$' then raise exception 'RB_MAT_BAD 수량은 0보다 큰 숫자로 적어 주세요(%).', coalesce(t, ''); end if;
  n := s::numeric;
  if n <= 0 then raise exception 'RB_MAT_BAD 수량은 0보다 커야 합니다.'; end if;
  if n > 1000000000 then raise exception 'RB_MAT_BAD 수량이 너무 큽니다(%).', t; end if;
  return n;
end $$;

-- 저장 본체(화면 직접 · 서버 길 모두)
create or replace function rb_mat_do(p_email text, p_op text, p_a jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a jsonb := coalesce(p_a, '{}'::jsonb);
  v_oid text := rb_mat_txt(a->'oid');
  v_id text := rb_mat_txt(a->'id');
  v_code text := upper(regexp_replace(rb_mat_txt(a->'code'), '\s', '', 'g'));
  v_memo text;
  v_d date; q numeric; base int;
  cur rb_mat_inb%rowtype;
  lk text; n int;
  bef jsonb; aft jsonb;
begin
  if coalesce(p_email, '') = '' then raise exception 'RB_SESSION'; end if;
  if v_oid = '' or length(v_oid) > 80 then raise exception 'RB_MAT_BAD 발주 건을 알 수 없습니다.'; end if;
  if p_op not in ('add', 'set', 'del', 'link') then raise exception 'RB_MAT_BAD 모르는 저장(%).', p_op; end if;
  perform pg_advisory_xact_lock(hashtext('rb_mat:' || v_oid));
  if a ? 'ver' and rb_mat_txt(a->'ver') ~ '^\d+$' then base := rb_mat_txt(a->'ver')::int; end if;

  if p_op in ('add', 'set') then
    v_memo := rb_mat_txt(a->'memo');
    if length(v_memo) > 300 then raise exception 'RB_MAT_BAD 메모는 300자까지입니다.'; end if;
    v_d := rb_mat_day(rb_mat_txt(a->'d'));
    q := rb_mat_num(rb_mat_txt(a->'qty'));
  end if;
  if p_op in ('add', 'set', 'del') and (v_id = '' or v_id !~ '^[A-Za-z0-9_-]{6,64}$') then raise exception 'RB_MAT_BAD 입고 줄 ID 가 이상합니다.'; end if;

  if p_op = 'add' then
    if v_code = '' or length(v_code) > 40 then raise exception 'RB_MAT_BAD 자재코드가 없습니다.'; end if;
    select * into cur from rb_mat_inb where rb_mat_inb.id = v_id;
    if found then
      -- 같은 요청이 다시 온 것(응답만 잃음) — 같은 값이면 그대로 성공
      if cur.oid = v_oid and cur.code = v_code and cur.d = v_d and cur.qty = q and cur.memo = v_memo then
        return rb_mat_state(v_oid) || jsonb_build_object('op', p_op, 'id', v_id, 'again', 1);
      end if;
      raise exception 'RB_MAT_BAD 같은 입고 줄 ID 가 이미 있습니다 — 다시 불러온 뒤 적어 주세요.';
    end if;
    select l.link into lk from rb_mat_link l where l.oid = v_oid and l.code = v_code;
    if coalesce(lk, '') not in ('', '-') then
      raise exception 'RB_MAT_LINKED 이 자재는 사급 발주(%)에 연결돼 있어 여기서 입고를 적지 않습니다 — 그 발주에서 입고를 등록하거나 연결을 풀어 주세요.', lk;
    end if;
    insert into rb_mat_inb (id, oid, code, d, qty, memo, by_email, at, ver) values (v_id, v_oid, v_code, v_d, q, v_memo, p_email, now(), 1);
    aft := jsonb_build_object('d', to_char(v_d, 'YYYY-MM-DD'), 'qty', q, 'memo', v_memo);
  elsif p_op = 'set' then
    select * into cur from rb_mat_inb where rb_mat_inb.id = v_id for update;
    if not found or cur.oid <> v_oid then raise exception 'RB_MAT_GONE 그사이 지워진 입고 줄입니다 — 다시 불러왔습니다.'; end if;
    v_code := cur.code;
    if cur.d = v_d and cur.qty = q and cur.memo = v_memo then
      return rb_mat_state(v_oid) || jsonb_build_object('op', p_op, 'id', v_id, 'same', 1);      -- 바뀐 것 없음(다시 보낸 저장 포함)
    end if;
    if base is not null and base <> cur.ver then
      raise exception 'RB_MAT_CHANGED 그사이 %님이 이 입고 줄을 고쳤습니다 — 다시 불러왔으니 확인 후 다시 고쳐 주세요.', coalesce(nullif(cur.upd_by, ''), cur.by_email);
    end if;
    bef := jsonb_build_object('d', to_char(cur.d, 'YYYY-MM-DD'), 'qty', cur.qty, 'memo', cur.memo);
    update rb_mat_inb set d = v_d, qty = q, memo = v_memo, upd_by = p_email, upd_at = now(), ver = cur.ver + 1 where rb_mat_inb.id = v_id;
    aft := jsonb_build_object('d', to_char(v_d, 'YYYY-MM-DD'), 'qty', q, 'memo', v_memo);
  elsif p_op = 'del' then
    select * into cur from rb_mat_inb where rb_mat_inb.id = v_id for update;
    if not found then return rb_mat_state(v_oid) || jsonb_build_object('op', p_op, 'id', v_id, 'again', 1); end if;      -- 이미 지움
    if cur.oid <> v_oid then raise exception 'RB_MAT_BAD 다른 발주 건의 입고 줄입니다.'; end if;
    if base is not null and base <> cur.ver then
      raise exception 'RB_MAT_CHANGED 그사이 %님이 이 입고 줄을 고쳤습니다 — 다시 불러왔으니 확인 후 지워 주세요.', coalesce(nullif(cur.upd_by, ''), cur.by_email);
    end if;
    v_code := cur.code;
    bef := jsonb_build_object('d', to_char(cur.d, 'YYYY-MM-DD'), 'qty', cur.qty, 'memo', cur.memo);
    delete from rb_mat_inb where rb_mat_inb.id = v_id;
  else -- link
    if v_code = '' or length(v_code) > 40 then raise exception 'RB_MAT_BAD 자재코드가 없습니다.'; end if;
    lk := rb_mat_txt(a->'link');
    if length(lk) > 80 then raise exception 'RB_MAT_BAD 연결할 발주가 이상합니다.'; end if;
    if lk = v_oid then raise exception 'RB_MAT_BAD 자기 발주에는 연결할 수 없습니다.'; end if;
    select to_jsonb(l.link) into bef from rb_mat_link l where l.oid = v_oid and l.code = v_code;
    if lk not in ('', '-') then
      select count(*) into n from rb_mat_inb i where i.oid = v_oid and i.code = v_code;
      if n > 0 then
        raise exception 'RB_MAT_HAS_LINES 이 자재에 여기서 적은 입고가 %줄 있습니다 — 같은 입고가 두 번 세어지지 않게 먼저 지운 뒤 연결해 주세요.', n;
      end if;
    end if;
    if coalesce(bef #>> '{}', '') = lk then return rb_mat_state(v_oid) || jsonb_build_object('op', p_op, 'same', 1); end if;
    if lk = '' then delete from rb_mat_link l where l.oid = v_oid and l.code = v_code;
    else insert into rb_mat_link (oid, code, link, by_email, at) values (v_oid, v_code, lk, p_email, now())
           on conflict (oid, code) do update set link = excluded.link, by_email = excluded.by_email, at = excluded.at;
    end if;
    aft := to_jsonb(lk);
  end if;

  insert into rb_mat_log (oid, code, op, line_id, before, after, by_email) values (v_oid, v_code, p_op, nullif(v_id, ''), bef, aft, p_email);
  insert into rb_tab_job (tab, job) values ('mi', jsonb_build_object('oid', v_oid, 'op', p_op, 'code', v_code, 'who', p_email, 'at', now()));
  if p_email <> 'selftest@rb.local' then
    insert into rb_ver (k, v, at) values ('mi', (floor(extract(epoch from clock_timestamp()) * 1000))::bigint::text || ':' || p_email, now())
      on conflict (k) do update set v = excluded.v, at = excluded.at;
  end if;
  return rb_mat_state(v_oid) || jsonb_build_object('op', p_op, 'id', nullif(v_id, ''));
end $$;

-- 화면(세션 표)
create or replace function rb_mat_save(p_token text, p_op text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := rb_me(p_token); ed boolean; c jsonb;
begin
  if e is null then raise exception 'RB_SESSION'; end if;
  select editor into ed from rb_session where token = p_token;
  if not coalesce(ed, false) then raise exception 'RB_SESSION 저장 권한 확인'; end if;
  select v into c from rb_conf where k = 'miConf';
  if coalesce(c->>'on', '') <> '1' then raise exception 'RB_FALLBACK 자재 입고 직접 저장 꺼짐'; end if;
  select v into c from rb_conf where k = 'gate:rb_mat_save';
  if coalesce(c->>'on', '') = '1' then raise exception 'RB_FALLBACK 막음(gate)'; end if;
  return rb_mat_do(e, p_op, coalesce(p_args, '{}'::jsonb));
end $$;
create or replace function rb_mat_get(p_token text, p_oid text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e text := rb_me(p_token); c jsonb;
begin
  if e is null then raise exception 'RB_SESSION'; end if;
  select v into c from rb_conf where k = 'miConf';
  if coalesce(c->>'on', '') <> '1' then raise exception 'RB_FALLBACK 자재 입고 직접 꺼짐'; end if;
  return rb_mat_state(btrim(coalesce(p_oid, '')));
end $$;
-- 서버 길(서비스 키만)
create or replace function rb_mat_save_srv(p_email text, p_op text, p_args jsonb) returns jsonb
language sql security definer set search_path = public as $$ select rb_mat_do(lower(btrim(p_email)), p_op, coalesce(p_args, '{}'::jsonb)) $$;
create or replace function rb_mat_get_srv(p_oid text) returns jsonb
language sql stable security definer set search_path = public as $$ select rb_mat_state(btrim(coalesce(p_oid, ''))) $$;

-- 켜기 전 시트에 있던 것 옮기기(이미 있는 줄 · 연결은 그대로) + 켬
create or replace function rb_mat_import(p_rows jsonb, p_links jsonb, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x jsonb; n1 int := 0; n2 int := 0; bad int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('rb_mat_import'));
  for x in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    begin
      insert into rb_mat_inb (id, oid, code, d, qty, memo, by_email, at, upd_by, upd_at, ver)
      values (rb_mat_txt(x->'id'), rb_mat_txt(x->'oid'), upper(rb_mat_txt(x->'code')), rb_mat_day(rb_mat_txt(x->'d')), rb_mat_num(rb_mat_txt(x->'qty')),
              rb_mat_txt(x->'memo'), rb_mat_txt(x->'by'), coalesce(nullif(rb_mat_txt(x->'at'), '')::timestamptz, now()),
              rb_mat_txt(x->'updBy'), nullif(rb_mat_txt(x->'updAt'), '')::timestamptz, greatest(1, coalesce(nullif(rb_mat_txt(x->'ver'), '')::int, 1)))
      on conflict (id) do nothing;
      if found then n1 := n1 + 1; end if;
    exception when others then bad := bad + 1;
    end;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) loop
    begin
      if rb_mat_txt(x->'oid') <> '' and rb_mat_txt(x->'code') <> '' and rb_mat_txt(x->'link') <> '' then
        insert into rb_mat_link (oid, code, link, by_email, at)
        values (rb_mat_txt(x->'oid'), upper(rb_mat_txt(x->'code')), rb_mat_txt(x->'link'), rb_mat_txt(x->'by'), coalesce(nullif(rb_mat_txt(x->'at'), '')::timestamptz, now()))
        on conflict (oid, code) do nothing;
        if found then n2 := n2 + 1; end if;
      end if;
    exception when others then bad := bad + 1;
    end;
  end loop;
  if p_on then
    insert into rb_conf (k, v, at) values ('miConf', jsonb_build_object('on', '1', 'at', now()), now())
      on conflict (k) do update set v = excluded.v, at = excluded.at;
  end if;
  return jsonb_build_object('lines', n1, 'links', n2, 'bad', bad);
end $$;

revoke all on function rb_mat_state(text) from public, anon, authenticated;
revoke all on function rb_mat_do(text, text, jsonb) from public, anon, authenticated;
revoke all on function rb_mat_save_srv(text, text, jsonb) from public, anon, authenticated;
revoke all on function rb_mat_get_srv(text) from public, anon, authenticated;
revoke all on function rb_mat_import(jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function rb_mat_save(text, text, jsonb) from public;
revoke all on function rb_mat_get(text, text) from public;
grant execute on function rb_mat_save(text, text, jsonb) to anon, authenticated;
grant execute on function rb_mat_get(text, text) to anon, authenticated;
grant execute on function rb_mat_save_srv(text, text, jsonb) to service_role;
grant execute on function rb_mat_get_srv(text) to service_role;
grant execute on function rb_mat_import(jsonb, jsonb, boolean) to service_role;
