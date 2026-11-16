-- m087_kv — 옛 코드 그대로 두기(apiOldAck) · 네고 연간 발주량(apiNegoQtySet) · 네고 집계 고르기(apiNegoPick) · 지출결의서 상신 체크(apiCloseExpSet)
--   원본을 스크립트 속성(rb.oldack · rb.negoqty · rb.negopick) · 숨김 탭(_실행판_마감상신) 에서 rb_conf('kv:oldack' · 'kv:negoqty' · 'kv:negopick' · 'kv:closeexp')로 옮긴다.
--   처음 값은 서버 1분 작업(kvSeed_)이 한 번 올린다 — 올리기 전에는 RB_FALLBACK(서버 길). 읽는 쪽(apiOldAcks · apiNegoData · apiCloseList)은 rb_conf 를 먼저 읽고,
--   속성 · 숨김 탭은 뒤처리('pj' '_pgPost' {x:'kv'})가 rb_conf 지금 값으로 맞춘다(옛 판 · 개인용 · 진단이 읽어도 같게).
--   서버 길(gas · 할 일 길)도 같은 함수 rb_kv_srv(서비스 키)로 — 저장 길 하나.
-- 규칙 = BomExtra.js apiOldAck(400건 · 속성 한 칸 8500자 · 오래된 것부터) · Nego.js apiNegoQtySet · apiNegoPick · Closing.js apiCloseExpSet.

-- JSON.stringify(o) 길이(열쇠 차례 ks) — 속성 한 칸에 담던 한도를 그대로 지킨다
create or replace function rb_kv_jslen(o jsonb, ks jsonb) returns int language sql immutable as $f$
  select 2 + coalesce(sum(length(to_jsonb(k)::text) + 1 + length(case when jsonb_typeof(o->k) = 'string' then to_jsonb(o->>k)::text else (o->k)::text end)), 0)::int
           + greatest(count(*)::int - 1, 0)
    from jsonb_array_elements_text(ks) k where o ? k $f$;

create or replace function rb_kv_do(e text, p_fn text, a jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
declare kk text; cv jsonb; o jsonb; ks jsonb; id text; v text; q text; who text; at text; jn text; out jsonb; ms bigint := rb_pg_ms(); post jsonb;
begin
  if jsonb_typeof(a) <> 'array' then raise exception 'RB_FALLBACK 인자 모양'; end if;
  kk := case p_fn when 'apiOldAck' then 'kv:oldack' when 'apiNegoQtySet' then 'kv:negoqty' when 'apiNegoPick' then 'kv:negopick' when 'apiCloseExpSet' then 'kv:closeexp' end;
  if kk is null then raise exception 'RB_FALLBACK % 는 서버 길', p_fn; end if;
  -- 규칙 검사(잠금 전 — 같은 문구)
  if p_fn = 'apiOldAck' then
    if rb_odx_s(a->0) is null or rb_odx_s(a->1) is null then raise exception 'RB_FALLBACK 값 모양'; end if;
    id := rb_odx_s(a->0); v := upper(rb_odx_s(a->1));
    if id = '' or v = '' then raise exception '발주 건 · 새 코드가 없습니다.'; end if;
  elsif p_fn = 'apiNegoQtySet' then
    if rb_odx_s(a->0) is null then raise exception 'RB_FALLBACK 값 모양'; end if;
    id := upper(regexp_replace(rb_odx_s(a->0), '\s', '', 'g'));
    if id = '' then raise exception '품목코드가 없습니다.'; end if;
    q := case when a->1 is null or jsonb_typeof(a->1) = 'null' then '' when jsonb_typeof(a->1) = 'boolean' then a->>1 else rb_pg_str(a->1) end;      -- String(qty)
    if q is null then raise exception 'RB_FALLBACK 수량 모양'; end if;
    q := rb_pg_trim(replace(q, ',', ''));
    if q <> '' then
      if rb_odx_jsnum(q) = 'x' then raise exception 'RB_FALLBACK 숫자 모양'; end if;
      if (case when rb_odx_jsnum(q) = 'n' then btrim(q)::numeric < 0 else true end) then raise exception '연간 발주량은 숫자로 넣어 주세요.'; end if;
    end if;
  elsif p_fn = 'apiNegoPick' then
    if rb_odx_s(a->0) is null then raise exception 'RB_FALLBACK 값 모양'; end if;
    id := rb_odx_s(a->0);
    if id = '' then raise exception '변경ID 가 없습니다.'; end if;
  else
    if rb_odx_s(a->0) is null then raise exception 'RB_FALLBACK 값 모양'; end if;
    id := rb_odx_s(a->0);
    if id = '' then raise exception '저장한 줄만 체크할 수 있습니다.'; end if;
  end if;
  if rb_odx_astral(id) or rb_odx_astral(coalesce(v, '')) then raise exception 'RB_FALLBACK 글자'; end if;
  perform pg_advisory_xact_lock(hashtext('rb_kv'));
  select c.v into cv from rb_conf c where c.k = kk for update;
  if cv is null or jsonb_typeof(cv->'o') <> 'object' then raise exception 'RB_FALLBACK 처음 값 올리기 전(%)', kk; end if;
  if exists (select 1 from rb_conf g where g.k = 'gate:rb_kv_set' and coalesce(g.v->>'on', '') = '1') then raise exception 'RB_FALLBACK 맞추기 중'; end if;
  o := cv->'o'; ks := coalesce(cv->'ks', (select coalesce(jsonb_agg(x), '[]') from jsonb_object_keys(o) x));
  if p_fn = 'apiOldAck' then
    if not (ks ? id) then ks := ks || to_jsonb(id); end if;
    o := o || jsonb_build_object(id, v);
    while jsonb_array_length(ks) > 400 loop o := o - (ks->>0); ks := ks - 0; end loop;
    while jsonb_array_length(ks) > 0 and rb_kv_jslen(o, ks) > 8500 loop o := o - (ks->>0); ks := ks - 0; end loop;
    out := o; post := jsonb_build_object('what', '옛 자재코드 발주 그대로 두기 ' || id, 'after', v);
  elsif p_fn = 'apiNegoQtySet' then
    if q = '' then o := o - id; ks := ks - id; else o := o || jsonb_build_object(id, to_jsonb(btrim(q)::numeric::float8)); if not (ks ? id) then ks := ks || to_jsonb(id); end if; end if;
    out := o; post := jsonb_build_object('what', '네고 실적 연간 발주량 ' || id, 'after', case when q = '' then '(자동)' else q end);
  elsif p_fn = 'apiNegoPick' then
    o := o || jsonb_build_object(id, case when rb_pg_tru(a->1) then 1 else 0 end); if not (ks ? id) then ks := ks || to_jsonb(id); end if;
    out := o; post := '{}'::jsonb;
  else
    who := split_part(e, '@', 1); at := rb_pg_kst(ms, 'YYYY-MM-DD HH24:MI');
    o := o || jsonb_build_object(id, jsonb_build_object('on', case when rb_pg_tru(a->1) then 'Y' else '' end, 'by', who, 'at', at)); if not (ks ? id) then ks := ks || to_jsonb(id); end if;
    out := jsonb_build_object('id', id, 'on', rb_pg_tru(a->1), 'by', who, 'at', at);
    post := jsonb_build_object('item', '지출결의서 상신 ' || case when rb_pg_tru(a->1) then '체크' else '풀기' end, 'after', id);
  end if;
  update rb_conf set v = jsonb_build_object('o', o, 'ks', ks), at = now() where k = kk;
  insert into rb_tab_job(tab, job) values ('pj', jsonb_build_object('fn', '_pgPost', 'who', e, 'at', ms, 'args', jsonb_build_array(jsonb_build_object('x', 'kv', 'fn', p_fn, 'k', kk, 'id', id) || post)));
  return out;
end $f$;

create or replace function rb_kv_set(p_token text, p_fn text, p_args jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
declare e text := rb_me(p_token); ed boolean;
begin
  if e is null then raise exception 'RB_SESSION'; end if;
  select editor into ed from rb_session where token = p_token;
  if not coalesce(ed, false) then raise exception 'RB_SESSION 저장 권한 확인'; end if;
  return rb_kv_do(e, coalesce(p_fn, ''), coalesce(p_args, '[]'::jsonb));
end $f$;
-- 서버(서비스 키)만: 서버 길 저장도 같은 함수로(저장한 사람 = p_who)
create or replace function rb_kv_srv(p_who text, p_fn text, p_args jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
begin
  if coalesce(p_who, '') = '' then raise exception '저장한 사람이 없습니다.'; end if;
  return rb_kv_do(p_who, coalesce(p_fn, ''), coalesce(p_args, '[]'::jsonb));
end $f$;
-- 서버(서비스 키)만: 처음 값 올리기 — 이미 있으면 그대로(두 번 올려도 덮지 않음)
create or replace function rb_kv_seed(p_k text, p_v jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
declare n int;
begin
  if p_k not in ('kv:oldack', 'kv:negoqty', 'kv:negopick', 'kv:closeexp') or jsonb_typeof(p_v->'o') <> 'object' then raise exception '잘못된 값'; end if;
  perform pg_advisory_xact_lock(hashtext('rb_kv'));
  insert into rb_conf (k, v, at) values (p_k, p_v, now()) on conflict (k) do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('k', p_k, 'new', n > 0);
end $f$;
revoke all on function rb_kv_jslen(jsonb, jsonb) from public, anon, authenticated;
revoke all on function rb_kv_do(text, text, jsonb) from public, anon, authenticated;
revoke all on function rb_kv_srv(text, text, jsonb) from public, anon, authenticated;
revoke all on function rb_kv_seed(text, jsonb) from public, anon, authenticated;
revoke all on function rb_kv_set(text, text, jsonb) from public;
grant execute on function rb_kv_set(text, text, jsonb) to anon, authenticated;
