-- m105_sm_direct2 — 샘플 저장(진행 메모 · 완료 · 회신 받음 · 회차 상태 · 프로젝트 담당자/브랜드/코드 · 프로젝트 비고 · 프로젝트 정보 · 프로젝트 수정 · 회차 지우기)을
--   할 일 대기열(rb_pj_add)이 아니라 Supabase 함수로 바로 + 진짜 응답.
-- 규칙 = Code.js apiSampleDone · apiSampleLog(+ sampleNoteToSheet_ · sampleDueToSheet_) · apiSampleWaitDone · apiSampleStatus0_
--        Samples.js apiSampleProject0_ · apiSampleProjMemo · apiSampleProjInfo · apiSampleProjEdit(+ apiSampleRename0_ 프로젝트ID 열쇠) · apiSampleDeleteRow0_.
-- 진행 기록 = sheet_rows '_실행판_샘플진행'(pgConf.sample — m083 과 같은 잠금 rb_tab_sp · 같은 머리글 검사 · 같은 앞선 저장 막기 rb_pg_busy · 같은 뒤처리 pgx + _pgPost(kind 'set')).
-- 샘플 탭 = sheet_rows '_실행판_샘플'(rb_conf smK · 잠금 rb_tab_sm · 시트 일 rb_tab_job tab=sm 모양 = rb_sm_edit).
-- 잠금 순서는 늘 rb_tab_sp → rb_tab_sm (거꾸로 잡는 곳 없음).
-- 메모 JSON(진행 기록 칸 · 그 안의 글자 JSON)은 json(순서 그대로)으로 다뤄 JS JSON.stringify 와 같은 글자로 쓴다(rb_js) — 견적 업체 순서 · 단가 항목 순서가 바뀌지 않게.
--   응답도 같은 글자(__j)로 — 화면이 JSON.parse 해서 예전 서버 응답과 똑같은 값.
-- 입력은 p_argj(화면 인자 JSON 글자 그대로 — jsonb 는 열쇠 순서를 잃는다).
-- 뒤처리(서버 SmDirect2.js): rb_tab_job tab='sm2' {kind: views|daily|gwpq|del …} · 시트 = pgx(진행 기록) · sm(샘플 탭).
-- 켜짐: 진행 기록 쪽 = pgConf.sample.on · 샘플 탭 쪽 = rb_conf 'sm2Conf'.on(서버 sm2ConfPublish_ — 샘플 사본 믿을 수 있을 때만).
-- RB_FALLBACK(아무것도 안 바뀜 → 화면은 예전 할 일 길): 꺼짐 · 앞선 저장 · 샘플ID 없음 · 옛 열쇠 · 흔치 않은 모양.

-- ---------- JSON(순서 그대로) 도우미 ----------
create or replace function rb_js(v json) returns text language plpgsql immutable as $f$
declare t text; r text; n int; nd int;
begin
  if v is null then return 'null'; end if;
  t := json_typeof(v);
  if t = 'object' then
    select count(*), count(distinct key) into n, nd from json_each(v);
    if n <> nd then raise exception 'RB_FALLBACK JSON 겹친 열쇠'; end if;
    select '{' || coalesce(string_agg(to_json(x.key)::text || ':' || rb_js(x.value), ',' order by
        case when x.key ~ '^(0|[1-9][0-9]{0,9})$' and x.key::bigint <= 4294967294 then 0 else 1 end,
        case when x.key ~ '^(0|[1-9][0-9]{0,9})$' and x.key::bigint <= 4294967294 then x.key::bigint else 0 end, x.o), '') || '}'
      into r from json_each(v) with ordinality x(key, value, o);
    return r;
  elsif t = 'array' then
    select '[' || coalesce(string_agg(rb_js(x.value), ',' order by x.o), '') || ']' into r from json_array_elements(v) with ordinality x(value, o);
    return r;
  elsif t = 'string' then return to_json(v #>> '{}')::text;
  elsif t = 'number' then
    r := btrim(v::text);
    if r ~ '^-?(0|[1-9][0-9]{0,15})$' and r <> '-0' then return r; end if;
    if r ~ '^-?(0|[1-9][0-9]{0,14})\.[0-9]{0,13}[1-9]$' then return r; end if;
    raise exception 'RB_FALLBACK JSON 숫자 모양(%)', r;
  else return btrim(v::text);
  end if;
end $f$;

-- o[k] = v (있으면 그 자리 · 없으면 끝에)
create or replace function rb_jput(p_o json, k text, v json) returns json language sql immutable as $f$
  select coalesce(json_object_agg(z.key, z.value order by z.o), '{}'::json) from (
    select x.key, case when x.key = k then v else x.value end as value, x.o from json_each(p_o) with ordinality x(key, value, o)
    union all select k, v, 1000000000 where not exists (select 1 from json_each(p_o) y where y.key = k)) z $f$;
create or replace function rb_jdel(p_o json, k text) returns json language sql immutable as $f$
  select coalesce(json_object_agg(x.key, x.value order by x.o), '{}'::json) from json_each(p_o) with ordinality x(key, value, o) where x.key <> k $f$;

-- JS 참거짓 · == null · String(v) · str_(v)
create or replace function rb_jtru(v json) returns boolean language sql immutable as $f$ select v is not null and rb_pg_tru(v::jsonb) $f$;
create or replace function rb_jnul(v json) returns boolean language sql immutable as $f$ select v is null or json_typeof(v) = 'null' $f$;
create or replace function rb_jstr(v json) returns text language plpgsql immutable as $f$
begin
  if v is null then return 'undefined'; end if;
  case json_typeof(v)
    when 'null' then return 'null';
    when 'string' then return v #>> '{}';
    when 'number' then return rb_js(v);
    when 'boolean' then return btrim(v::text);
    else raise exception 'RB_FALLBACK 글자로 바꿀 수 없는 값(%)', json_typeof(v);
  end case;
end $f$;
create or replace function rb_jstr_(v json) returns text language plpgsql immutable as $f$
begin
  if v is null or json_typeof(v) in ('null', 'boolean') then return ''; end if;
  return rb_pg_trim(rb_jstr(v));
end $f$;
-- String(x || '')
create or replace function rb_jstro(v json) returns text language sql immutable as $f$ select case when rb_jtru(v) then rb_jstr(v) else '' end $f$;
-- s.slice(0, n) — UTF-16 길이(4바이트 글자가 있으면 서버 길)
create or replace function rb_jslice(t text, n int) returns text language plpgsql immutable as $f$
begin
  if t ~ '[\U00010000-\U0010FFFF]' then raise exception 'RB_FALLBACK 4바이트 글자'; end if;
  return left(t, n);
end $f$;
create or replace function rb_u16len(t text) returns int language sql immutable as $f$ select length(t) + coalesce(regexp_count(t, '[\U00010000-\U0010FFFF]'), 0) $f$;
-- Number(v) 를 목록 번호로(NaN · 음수 · 소수 = -1)
create or replace function rb_jidx(v json) returns int language plpgsql immutable as $f$
declare t text;
begin
  if v is null or json_typeof(v) = 'null' then return 0; end if;
  if json_typeof(v) = 'boolean' then return case when v::text = 'true' then 1 else 0 end; end if;
  if json_typeof(v) = 'number' then
    t := btrim(v::text);
    if t ~ '^(0|[1-9][0-9]{0,8})$' then return t::int; end if;
    if t ~ '^-?[0-9]+(\.[0-9]+)?$' then return -1; end if;
    raise exception 'RB_FALLBACK 번호 모양';
  end if;
  if json_typeof(v) = 'string' then
    t := rb_pg_trim(v #>> '{}');
    if t = '' then return 0; end if;
    if t ~ '^[0-9]{1,9}$' then return t::int; end if;
    raise exception 'RB_FALLBACK 번호 모양';
  end if;
  raise exception 'RB_FALLBACK 번호 모양';
end $f$;
-- Number(v) || 0 (시트 행)
create or replace function rb_jrow(v json) returns int language plpgsql immutable as $f$
declare t text;
begin
  if v is null or json_typeof(v) in ('null') then return 0; end if;
  if json_typeof(v) = 'boolean' then return case when v::text = 'true' then 1 else 0 end; end if;
  t := case when json_typeof(v) = 'string' then rb_pg_trim(v #>> '{}') when json_typeof(v) = 'number' then btrim(v::text) else null end;
  if t is null then raise exception 'RB_FALLBACK 행 번호 모양'; end if;
  if t = '' then return 0; end if;
  if t ~ '^[0-9]{1,9}$' then return t::int; end if;
  if t ~ '^-[0-9]{1,9}$' then return 0; end if;
  raise exception 'RB_FALLBACK 행 번호 모양';
end $f$;
-- JSON.parse(s || 기본) (try/catch → 기본)
create or replace function rb_jparse(t text, dflt json) returns json language plpgsql immutable as $f$
begin
  if t is null or t = '' then return dflt; end if;
  begin return t::json; exception when others then return dflt; end;
end $f$;
-- 시트 칸 값 → str_(값)
create or replace function rb_sm2_s(v jsonb) returns text language sql immutable as $f$
  select case when v is null or jsonb_typeof(v) in ('null', 'boolean') then '' when jsonb_typeof(v) = 'string' then rb_pg_trim(v #>> '{}') else btrim(v::text) end $f$;
-- norm_(s)
create or replace function rb_sm2_norm(s text) returns text language sql immutable as $f$
  select lower(regexp_replace(regexp_replace(coalesce(s, ''), '\s+', '', 'g'), '[()]', '', 'g')) $f$;

-- ---------- 진행 기록(샘플) ----------
-- 진행 기록 칸 → 객체(progRec_ · progState_)
create or replace function rb_sm2_pobj(cell jsonb) returns json language plpgsql immutable as $f$
declare t text; j json;
begin
  if cell is null or jsonb_typeof(cell) = 'null' then return '{}'::json; end if;
  if jsonb_typeof(cell) <> 'string' then raise exception 'RB_FALLBACK 진행 기록 칸 모양'; end if;
  t := cell #>> '{}';
  if t = '' then return '{}'::json; end if;
  begin j := t::json; exception when others then raise exception 'RB_FALLBACK 진행 기록 칸 JSON 읽기'; end;
  if json_typeof(j) = 'object' then perform rb_js(j); return j; end if;
  if json_typeof(j) = 'array' then raise exception 'RB_FALLBACK 진행 기록 칸이 배열'; end if;
  if not rb_jtru(j) then return '{}'::json; end if;
  raise exception 'RB_FALLBACK 진행 기록 칸이 객체가 아님';
end $f$;

-- 잠금 · 켜짐 · 머리글 · 앞선 저장 · 그 건 줄(마지막 줄)
create or replace function rb_sm2_pload(p_id text) returns jsonb language plpgsql security definer set search_path = public as $f$
declare
  HEAD constant text[] := array['건ID', '품의번호', '품목명', '발주차수', '브랜드', '담당자', '진행JSON', '메모JSON', '최종수정', '최종수정자', '날짜JSON'];
  cm jsonb; hc jsonb; i int; rw int; cx jsonb; isnew boolean := false; own text := '';
begin
  if p_id !~ '^p:P[0-9A-F]{8}$' then raise exception 'RB_FALLBACK 샘플 옛 건ID'; end if;
  perform pg_advisory_xact_lock(hashtext('rb_tab_sp'));
  cm := (select c.v->'sample' from rb_conf c where c.k = 'pgConf');
  if cm is null or coalesce(cm->>'on', '') <> '1' then raise exception 'RB_FALLBACK 샘플 진행 기록 직접 저장 꺼짐(%)', coalesce(cm->>'why', '설정 없음'); end if;
  select r0.cells into hc from sheet_rows r0 where r0.tab = cm->>'tab' and r0."row" = 1;
  for i in 1 .. 11 loop
    if rb_t(hc->(i - 1)) <> HEAD[i] then raise exception 'RB_FALLBACK 진행 기록 머리글이 다름(% 열)', i; end if;
  end loop;
  perform rb_pg_busy('sample', p_id);
  select r0."row", r0.cells into rw, cx from sheet_rows r0 where r0.tab = cm->>'tab' and r0."row" > 1 and r0.cells->>0 = p_id order by r0."row" desc limit 1 for update;
  if rw is null then
    isnew := true;
    select coalesce(max(r0."row"), 1) + 1 into rw from sheet_rows r0 where r0.tab = cm->>'tab';
    cx := '[]'::jsonb;
  else
    if rb_pg_tru(cx->5) and rb_pg_str(cx->5) is null then raise exception 'RB_FALLBACK 담당자 칸 모양'; end if;
    own := case when rb_pg_tru(cx->5) then rb_pg_trim(rb_pg_str(cx->5)) else '' end;
  end if;
  return jsonb_build_object('tab', cm->>'tab', 'rw', rw, 'isnew', isnew, 'cx', cx, 'own', own,
    'c', rb_js(rb_sm2_pobj(cx->6)), 'n', rb_js(rb_sm2_pobj(cx->7)), 'd', rb_js(rb_sm2_pobj(cx->10)));
end $f$;

-- 진행 기록 줄 쓰기(progRowValues_) + 뒤처리 일(pgx · _pgPost kind set)
create or replace function rb_sm2_psave(e text, ms bigint, pc jsonb, p_id text, meta json, c text, n text) returns void language plpgsql security definer set search_path = public as $f$
declare cx jsonb := pc->'cx'; b jsonb; a jsonb; f text; k text; sset jsonb := '{}'; sdel jsonb := '{}'; s1 jsonb; d1 jsonb; op jsonb; mj jsonb;
begin
  if meta is not null and json_typeof(meta) not in ('object', 'null') and rb_jtru(meta) then raise exception 'RB_FALLBACK 건 정보 모양'; end if;
  mj := case when meta is not null and json_typeof(meta) = 'object' then meta::jsonb else '{}'::jsonb end;
  b := jsonb_build_object('checks', (pc->>'c')::jsonb, 'notes', (pc->>'n')::jsonb, 'dates', (pc->>'d')::jsonb, 'ownerSet', pc->>'own');
  a := jsonb_build_object('checks', c::jsonb, 'notes', n::jsonb, 'dates', (pc->>'d')::jsonb, 'ownerSet', pc->>'own');
  foreach f in array array['checks', 'notes', 'dates'] loop
    s1 := '{}'; d1 := '[]';
    for k in select jsonb_object_keys(a->f) loop if (b->f->k) is distinct from (a->f->k) then s1 := s1 || jsonb_build_object(k, a->f->k); end if; end loop;
    for k in select jsonb_object_keys(b->f) loop if not (a->f ? k) then d1 := d1 || to_jsonb(k); end if; end loop;
    if s1 <> '{}' then sset := sset || jsonb_build_object(f, s1); end if;
    if d1 <> '[]' then sdel := sdel || jsonb_build_object(f, d1); end if;
  end loop;
  cx := rb_pad(cx, greatest(11, jsonb_array_length(cx)));
  cx := jsonb_set(cx, '{0}', to_jsonb(p_id));
  cx := jsonb_set(cx, '{1}', rb_pg_mcell(mj->'doc'));
  cx := jsonb_set(cx, '{2}', rb_pg_mcell(mj->'name'));
  cx := jsonb_set(cx, '{3}', rb_pg_mcell(mj->'batch'));
  cx := jsonb_set(cx, '{4}', rb_pg_mcell(mj->'brand'));
  cx := jsonb_set(cx, '{5}', case when pc->>'own' = '' then 'null'::jsonb else to_jsonb(pc->>'own') end);
  cx := jsonb_set(cx, '{6}', to_jsonb(c));
  cx := jsonb_set(cx, '{7}', to_jsonb(n));
  cx := jsonb_set(cx, '{8}', to_jsonb(rb_pg_iso(ms)));
  cx := jsonb_set(cx, '{9}', to_jsonb(e));
  cx := jsonb_set(cx, '{10}', to_jsonb(pc->>'d'));
  insert into sheet_rows(tab, "row", cells, synced_at) values (pc->>'tab', (pc->>'rw')::int, cx, now())
    on conflict (tab, "row") do update set cells = excluded.cells, synced_at = excluded.synced_at;
  op := jsonb_build_object('at', ms, 'who', e, 'mode', 'sample', 'id', p_id, 'kind', 'set', 'set', sset, 'del', sdel);
  insert into rb_tab_job(tab, job) values ('pgx', jsonb_build_object('mode', 'sample', 'id', p_id, 'row', (pc->>'rw')::int, 'at', ms, 'who', e));
  insert into rb_tab_job(tab, job) values ('pj', jsonb_build_object('fn', '_pgPost', 'who', e, 'at', ms, 'args', jsonb_build_array(jsonb_build_object(
    'mode', 'sample', 'id', p_id, 'meta', mj, 'op', op, 'before', b, 'after', a, 'sh', '', 'isnew', (pc->>'isnew')::boolean))));
end $f$;

-- ---------- 샘플 탭 ----------
create or replace function rb_sm2_sready() returns jsonb language plpgsql security definer set search_path = public as $f$
declare conf jsonb; g jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('rb_tab_sm'));
  select rc.v into g from rb_conf rc where rc.k = 'sm2Conf';
  if g is null or coalesce(g->>'on', '') <> '1' then raise exception 'RB_FALLBACK 샘플 탭 직접 저장 꺼짐(%)', coalesce(g->>'why', '설정 없음'); end if;
  select rc.v into conf from rb_conf rc where rc.k = 'smK';
  if conf is null or jsonb_typeof(conf->'K') <> 'object' then raise exception 'RB_FALLBACK 샘플 열 정보 없음'; end if;
  if coalesce((conf->'K'->>'sid')::int, -1) < 0 or coalesce((conf->'K'->>'name')::int, -1) < 0 then raise exception 'RB_FALLBACK 샘플 열 없음'; end if;
  return conf;
end $f$;
-- 샘플 탭을 바꾸는 예전 할 일이 남았으면(그 프로젝트 · 샘플ID · 값 정리) 서버 길(차례)
create or replace function rb_sm2_sbusy(p_core text[]) returns void language plpgsql security definer set search_path = public as $f$
declare j record; c text;
begin
  select id, job->>'fn' as fn into j from rb_tab_job
   where tab = 'pj' and done_at is null and coalesce(job->>'who', '') <> 'selftest@rb.local'
     and coalesce(job->>'fn', '') in ('apiSampleRemap', 'apiSampleViewsRebuild') order by id limit 1;
  if found then raise exception 'RB_FALLBACK 앞선 저장 반영 전(pj #% %)', j.id, j.fn; end if;
  foreach c in array p_core loop
    if coalesce(c, '') = '' then continue; end if;
    select id, job->>'fn' as fn into j from rb_tab_job
     where tab = 'pj' and done_at is null and coalesce(job->>'who', '') <> 'selftest@rb.local'
       and coalesce(job->>'fn', '') like 'apiSample%' and strpos(job::text, c) > 0 order by id limit 1;
    if found then raise exception 'RB_FALLBACK 앞선 저장 반영 전(pj #% %)', j.id, j.fn; end if;
  end loop;
end $f$;
-- checkSampleRow_ 의 샘플ID 길: 기억한 행이 그 샘플ID 면 그 행, 아니면 맨 위 그 샘플ID 행
create or replace function rb_sm2_find(conf jsonb, p_sid text, p_row int) returns int language plpgsql security definer set search_path = public as $f$
declare r int; sc int := (conf->'K'->>'sid')::int; hr int := coalesce((conf->>'hr')::int, 1);
begin
  if p_row > hr and exists (select 1 from sheet_rows where tab = '_실행판_샘플' and "row" = p_row and rb_sm2_s(cells->sc) = p_sid) then return p_row; end if;
  select "row" into r from sheet_rows where tab = '_실행판_샘플' and "row" > hr and rb_sm2_s(cells->sc) = p_sid order by "row" limit 1;
  return r;
end $f$;
create or replace function rb_sm2_gone(ex json) returns text language sql immutable as $f$
  select '그 회차 줄(' || rb_jstr_(ex->'v') || case when rb_jstr_(ex->'d') <> '' then ' · 요청일 ' || rb_jstr_(ex->'d') else '' end || ')은 그사이 지워졌거나 바뀐 회차입니다 — 새로고침 후 다시 해 주세요.' $f$;
-- 시트 맞추기 일(rb_sm_edit 와 같은 모양)
create or replace function rb_sm2_job(e text, ms bigint, conf jsonb, p_rows jsonb, p_audits jsonb, p_ops jsonb, p_h0 text) returns void language plpgsql security definer set search_path = public as $f$
declare j jsonb;
begin
  if p_rows = '{}'::jsonb and p_audits = '[]'::jsonb and p_ops = '[]'::jsonb then return; end if;
  j := jsonb_build_object('k', 'sm', 'at', ms, 'who', e, 'sc', (conf->'K'->>'sid')::int + 1, 'ops', p_ops, 'rows', p_rows, 'audits', p_audits);
  if p_h0 is not null then j := j || jsonb_build_object('h0', p_h0); end if;
  insert into rb_tab_job(tab, job) values ('sm', j);
end $f$;
-- 시트 한 줄의 프로젝트 열쇠(sampleRowKey_)
create or replace function rb_sm2_rkey(kc jsonb, c jsonb) returns text language sql immutable as $f$
  select coalesce(nullif(case when coalesce((kc->>'pid')::int, -1) >= 0 then regexp_replace(rb_sm2_s(c->((kc->>'pid')::int)), '^''', '') else '' end, ''),
    nullif(rb_sm2_norm(case when coalesce((kc->>'code')::int, -1) >= 0 then rb_sm2_s(c->((kc->>'code')::int)) else '' end), ''),
    'n:' || rb_sm2_norm(rb_sm2_s(c->((kc->>'name')::int)))) $f$;
-- 날짜 → 사본 값(서울 자정 ISO)
create or replace function rb_sm2_iso(d date) returns text language sql immutable as $f$
  select to_char((d::timestamp at time zone 'Asia/Seoul') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $f$;
-- sampleSidHash_(샘플ID 칸 1행부터)
create or replace function rb_sm2_h0(conf jsonb) returns text language plpgsql security definer set search_path = public as $f$
declare sc int := (conf->'K'->>'sid')::int; mx int; s text; h bigint := 5381; i int; L text[] := '{}'; r record; n int;
begin
  select max("row") into mx from sheet_rows where tab = '_실행판_샘플';
  if mx is null then return '0:' || rb_b36(5381); end if;
  L := array_fill(''::text, array[mx]);
  for r in select "row", cells from sheet_rows where tab = '_실행판_샘플' loop L[r."row"] := rb_sm2_s(r.cells->sc); end loop;
  n := mx; while n > 0 and L[n] = '' loop n := n - 1; end loop;
  s := array_to_string(L[1:n], E'\n');
  if s ~ '[\U00010000-\U0010FFFF]' then return null; end if;
  for i in 1 .. length(s) loop h := ((h * 33) & 4294967295) # ascii(substr(s, i, 1)); end loop;
  return n || ':' || rb_b36(h);
end $f$;
create or replace function rb_b36(x bigint) returns text language plpgsql immutable as $f$
declare d constant text := '0123456789abcdefghijklmnopqrstuvwxyz'; o text := '';
begin
  if x = 0 then return '0'; end if;
  while x > 0 loop o := substr(d, (x % 36)::int + 1, 1) || o; x := x / 36; end loop;
  return o;
end $f$;

-- ---------- 각 저장 ----------
-- apiSampleDone(id, meta, on, kind) → { checks }
create or replace function rb_sm2_done(e text, a json, ms bigint) returns jsonb language plpgsql security definer set search_path = public as $f$
declare id text; pc jsonb; c json; on_ boolean := rb_jtru(a->2);
begin
  if not rb_jtru(a->0) then raise exception '건ID가 비어 있습니다.'; end if;
  if json_typeof(a->0) <> 'string' then raise exception 'RB_FALLBACK 건ID 모양'; end if;
  id := a->>0;
  pc := rb_sm2_pload(id);
  c := (pc->>'c')::json;
  if on_ then c := rb_jput(c, '_done', to_json(rb_pg_kst(ms, 'YYYY-MM-DD'))); else c := rb_jdel(c, '_done'); end if;
  if on_ and a->3 is not null and json_typeof(a->3) = 'string' and (a->>3) = 'drop' then c := rb_jput(c, '_drop', '1'::json); else c := rb_jdel(c, '_drop'); end if;
  perform rb_sm2_psave(e, ms, pc, id, a->1, rb_js(c), pc->>'n');
  return jsonb_build_object('__j', '{"checks":' || rb_js(c) || '}');
end $f$;

-- 같은 기록인지(적은 날 · 내용) — withWait = 대기 기록만
create or replace function rb_sm2_same(x json, orig json, withWait boolean) returns boolean language plpgsql immutable as $f$
begin
  if not rb_jtru(x) then return false; end if;
  if json_typeof(x) <> 'object' then raise exception 'RB_FALLBACK 기록 모양'; end if;
  if withWait and not rb_jtru(x->'wait') then return false; end if;
  if rb_jnul(orig) then return true; end if;
  if json_typeof(orig) <> 'object' then raise exception 'RB_FALLBACK 원래 기록 모양'; end if;
  return rb_jstr(x->'at') = rb_jstr(orig->'at') and rb_jstro(x->'text') = rb_jstro(orig->'text');
end $f$;
-- 목록 글자 → 요소 json[]
create or replace function rb_sm2_list(t text) returns json[] language plpgsql immutable as $f$
declare j json := rb_jparse(t, '[]'::json); out json[] := '{}';
begin
  if json_typeof(j) <> 'array' then raise exception 'RB_FALLBACK 기록 목록이 배열이 아님'; end if;
  select coalesce(array_agg(x.value order by x.o), '{}') into out from json_array_elements(j) with ordinality x(value, o);
  return out;
end $f$;
create or replace function rb_sm2_ltext(L json[]) returns text language sql immutable as $f$
  select '[' || coalesce((select string_agg(rb_js(x.v), ',' order by x.o) from unnest(L) with ordinality x(v, o)), '') || ']' $f$;
-- notes 의 그 칸 글자(글자가 아니면 서버 길)
create or replace function rb_sm2_ntext(n json, k text) returns text language plpgsql immutable as $f$
declare v json := n->k;
begin
  if v is null or not rb_jtru(v) then return ''; end if;
  if json_typeof(v) <> 'string' then raise exception 'RB_FALLBACK 메모 칸 모양'; end if;
  return v #>> '{}';
end $f$;

-- apiSampleLog(id, meta, vkey, entry, del, sheetRow, projKey, editIdx, editOrig, rowSid) → { notes, sheetErr }
create or replace function rb_sm2_log(e text, a json, ms bigint) returns jsonb language plpgsql security definer set search_path = public as $f$
declare
  id text; k text; ent json := a->3; has_e boolean; eo json; e_at text := rb_pg_kst(ms, 'YYYY-MM-DD'); e_text text; e_due text; e_st text; e_wait text := ''; who text := split_part(e, '@', 1);
  pc jsonb; n json; L json[]; ix int; oi int; q int; o json; x json; lastI int; dueSync text := ''; dx json; dRk text; dLastI int; dPrevI int; di int;
  orig json := a->8; editNull boolean := rb_jnul(a->7); srow int; sheetErr text := ''; dErr text := ''; conf jsonb; kc jsonb; sid text; hr2 int; c jsonb;
  was text; addt text; nowt text; raws jsonb := '{}'; audits jsonb := '[]'; nm text; col int; dd date; iso text; wantRow boolean := false; m text[];
begin
  if not rb_jtru(a->0) then raise exception '건ID가 비어 있습니다.'; end if;
  if json_typeof(a->0) <> 'string' then raise exception 'RB_FALLBACK 건ID 모양'; end if;
  id := a->>0;
  k := 'tl:' || rb_jslice(rb_jstr_(a->2), 60);
  if k = 'tl:' then raise exception '업체가 비었습니다.'; end if;
  has_e := rb_jtru(ent);
  if has_e then
    if json_typeof(ent) <> 'object' then raise exception 'RB_FALLBACK 기록 모양'; end if;
    e_text := rb_jslice(rb_jstr_(ent->'text'), 500);
    e_due := case when rb_jstr_(ent->'due') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then rb_jstr_(ent->'due') else '' end;
    e_st := rb_jslice(rb_jstr_(ent->'st'), 10);
    eo := json_build_object('at', e_at, 'text', e_text, 'due', e_due, 'st', e_st, 'who', who);
    if rb_jstr_(ent->'rk') <> '' then eo := rb_jput(eo, 'rk', to_json(rb_jslice(rb_jstr_(ent->'rk'), 60))); end if;
    if rb_jstr_(ent->'wait') <> '' then e_wait := rb_jslice(rb_jstr_(ent->'wait'), 20); eo := rb_jput(eo, 'wait', to_json(e_wait)); end if;
    if e_text = '' and e_st = '' and e_due = '' then raise exception '적을 내용이 없습니다.'; end if;
  end if;
  srow := rb_jrow(a->5);
  -- 샘플 탭 쪽이 필요하면 미리 켜짐 확인(잠금은 진행 기록 뒤)
  pc := rb_sm2_pload(id);
  n := (pc->>'n')::json;
  L := rb_sm2_list(rb_sm2_ntext(n, k));
  if has_e and not editNull then
    ix := rb_jidx(a->7); oi := null;
    if ix >= 0 and ix < coalesce(array_length(L, 1), 0) and rb_sm2_same(L[ix + 1], orig, false) then oi := ix + 1;
    else for q in 1 .. coalesce(array_length(L, 1), 0) loop if rb_sm2_same(L[q], orig, false) then oi := q; exit; end if; end loop; end if;
    if oi is null then raise exception '그 기록이 바뀌었거나 지워졌습니다. 새로고침 후 다시 해 주세요.'; end if;
    o := L[oi];
    o := rb_jput(o, 'text', to_json(e_text)); o := rb_jput(o, 'due', to_json(e_due)); o := rb_jput(o, 'st', to_json(e_st)); o := rb_jput(o, 'edited', to_json(e_at || ' ' || who));
    if not rb_jnul(ent->'wait') then if e_wait <> '' then o := rb_jput(o, 'wait', to_json(e_wait)); else o := rb_jdel(o, 'wait'); end if; end if;
    L[oi] := o;
    lastI := null;
    for q in 1 .. array_length(L, 1) loop
      x := L[q];
      if rb_jtru(x) and json_typeof(x) = 'object' and rb_jtru(x->'due') and not rb_jtru(x->'wait') and rb_jstro(x->'rk') = rb_jstro(o->'rk') then lastI := q; end if;
    end loop;
    dueSync := case when lastI = oi then rb_jstr(o->'due') else '' end;
  elsif has_e then
    L := L || eo;
    dueSync := case when e_wait <> '' then '' else e_due end;
  elsif not rb_jnul(a->4) then
    di := rb_jidx(a->4);
    if not (di >= 0 and di < coalesce(array_length(L, 1), 0) and rb_sm2_same(L[di + 1], orig, false)) then
      di := -1;
      for q in 1 .. coalesce(array_length(L, 1), 0) loop if rb_sm2_same(L[q], orig, false) then di := q - 1; exit; end if; end loop;
    end if;
    if di > -1 then
      dx := L[di + 1]; dRk := rb_jstro(dx->'rk'); dLastI := null;
      for q in 1 .. array_length(L, 1) loop
        x := L[q];
        if rb_jtru(x) and json_typeof(x) = 'object' and rb_jtru(x->'due') and not rb_jtru(x->'wait') and rb_jstro(x->'rk') = dRk then dLastI := q; end if;
      end loop;
      L := L[1:di] || L[di + 2:array_length(L, 1)];
      if rb_jtru(dx->'due') and not rb_jtru(dx->'wait') and dLastI = di + 1 then
        dPrevI := null;
        for q in 1 .. coalesce(array_length(L, 1), 0) loop
          x := L[q];
          if rb_jtru(x) and json_typeof(x) = 'object' and rb_jtru(x->'due') and not rb_jtru(x->'wait') and rb_jstro(x->'rk') = dRk then dPrevI := q; end if;
        end loop;
        dueSync := case when dPrevI is null then '' else rb_jstr(L[dPrevI]->'due') end;
      end if;
    end if;
  end if;
  if coalesce(array_length(L, 1), 0) > 0 then
    if array_length(L, 1) > 200 then L := L[array_length(L, 1) - 199:array_length(L, 1)]; end if;
    n := rb_jput(n, k, to_json(rb_sm2_ltext(L)));
  else n := rb_jdel(n, k); end if;
  perform rb_sm2_psave(e, ms, pc, id, a->1, pc->>'c', rb_js(n));

  -- 시트 쪽(비고 덧붙임 · 전달예정일) — 예전 sampleVirtual_ 한 번과 같게, 실패는 sheetErr 로
  if (has_e and srow <> 0 and editNull) or (dueSync <> '' and srow <> 0) then
    conf := rb_sm2_sready(); kc := conf->'K';
    sid := rb_jstr_(a->9);
    if has_e and editNull and srow >= 2 and e_text <> '' then
      if coalesce((kc->>'note')::int, -1) < 0 then sheetErr := '[비고/피드백] 열 없음';
      else
        if sid = '' then raise exception 'RB_FALLBACK 샘플ID 없음(시트 비고)'; end if;
        hr2 := rb_sm2_find(conf, sid, srow);
        if hr2 is null then sheetErr := rb_sm2_gone(json_build_object('v', a->2));
        else
          select cells into c from sheet_rows where tab = '_실행판_샘플' and "row" = hr2 for update;
          c := rb_pad(c, greatest(coalesce((conf->>'lc')::int, 0), (kc->>'note')::int + 1));
          col := (kc->>'note')::int;
          was := rb_pg_trim(regexp_replace(case when jsonb_typeof(c->col) = 'string' then c->>col else rb_sm2_s(c->col) end, '^''', ''));
          addt := substr(e_at, 6, 2) || '.' || substr(e_at, 9, 2) || ' ' || e_text || case when e_st <> '' then ' [' || e_st || ']' else '' end;
          nowt := case when was <> '' then was || ' / ' else '' end || addt;
          if rb_u16len(nowt) > 45000 then sheetErr := '비고 칸이 너무 길어(4만 자 넘음) 더 붙이지 않았습니다. 시트에서 정리해 주세요.';
          else
            nm := rb_sm2_s(c->((kc->>'name')::int));
            c := jsonb_set(c, array[col::text], to_jsonb(nowt));
            raws := raws || jsonb_build_object((col + 1)::text, '''' || nowt);
            audits := audits || jsonb_build_array(jsonb_build_object('tab', '_실행판_샘플', 'row', hr2, 'col', col + 1, 'what', '샘플 비고(진행 메모)', 'before', was, 'after', nowt, 'item', nm, 'who', e, 'at', ms));
            update sheet_rows set cells = c, synced_at = now() where tab = '_실행판_샘플' and "row" = hr2;
            wantRow := true;
          end if;
        end if;
      end if;
    end if;
    m := regexp_match(dueSync, '^([0-9]{4})-([0-9]{2})-([0-9]{2})$');
    if dueSync <> '' and srow >= 2 and m is not null then
      if coalesce((kc->>'planAt')::int, -1) < 0 then dErr := '[전달예정일] 열 없음';
      else
        if sid = '' then raise exception 'RB_FALLBACK 샘플ID 없음(전달예정일)'; end if;
        hr2 := rb_sm2_find(conf, sid, srow);
        if hr2 is null then dErr := rb_sm2_gone(json_build_object('v', a->2));
        else
          begin dd := make_date(m[1]::int, m[2]::int, m[3]::int); exception when others then raise exception 'RB_FALLBACK 기한 날짜'; end;
          select cells into c from sheet_rows where tab = '_실행판_샘플' and "row" = hr2 for update;
          col := (kc->>'planAt')::int;
          c := rb_pad(c, greatest(coalesce((conf->>'lc')::int, 0), col + 1));
          was := case when jsonb_typeof(c->col) = 'string' then c->>col else rb_sm2_s(c->col) end;
          if not (was ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$' and to_char((was::timestamptz) at time zone 'Asia/Seoul', 'YYYY-MM-DD') = dueSync) then
            iso := rb_sm2_iso(dd); nm := rb_sm2_s(c->((kc->>'name')::int));
            c := jsonb_set(c, array[col::text], to_jsonb(iso));
            raws := raws || jsonb_build_object((col + 1)::text, jsonb_build_object('d', iso));
            audits := audits || jsonb_build_array(jsonb_build_object('tab', '_실행판_샘플', 'row', hr2, 'col', col + 1, 'what', '샘플 전달예정일(진행 메모 기한)',
              'before', case when was ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$' then rb_sm_dz(was) else was end, 'after', to_char(dd, 'YY/MM/DD'), 'item', nm, 'who', e, 'at', ms));
            update sheet_rows set cells = c, synced_at = now() where tab = '_실행판_샘플' and "row" = hr2;
            wantRow := true;
          end if;
        end if;
      end if;
    end if;
    if dErr <> '' then sheetErr := case when sheetErr <> '' then sheetErr || ' · ' else '' end || dErr; end if;
    if wantRow then perform rb_sm2_job(e, ms, conf, jsonb_build_object(hr2::text, jsonb_build_object('s', sid, 'w', raws)), audits, '[]'::jsonb, null); end if;
  end if;
  return jsonb_build_object('__j', '{"notes":' || rb_js(n) || ',"sheetErr":' || to_json(sheetErr)::text || '}');
end $f$;

-- apiSampleWaitDone(id, meta, vkey, idx, orig, done, reply) → { notes }
create or replace function rb_sm2_waitdone(e text, a json, ms bigint) returns jsonb language plpgsql security definer set search_path = public as $f$
declare id text; k text; pc jsonb; n json; L json[]; ix int; oi int; q int; o json; who text := split_part(e, '@', 1);
begin
  if not rb_jtru(a->0) then raise exception '건ID가 비어 있습니다.'; end if;
  if json_typeof(a->0) <> 'string' then raise exception 'RB_FALLBACK 건ID 모양'; end if;
  id := a->>0;
  k := 'tl:' || rb_jslice(rb_jstr_(a->2), 60);
  pc := rb_sm2_pload(id);
  n := (pc->>'n')::json;
  L := rb_sm2_list(rb_sm2_ntext(n, k));
  ix := rb_jidx(case when a->3 is null then 'null'::json else a->3 end);
  if a->3 is null or json_typeof(a->3) = 'null' then ix := case when a->3 is null then -1 else 0 end; end if;      -- Number(undefined) = NaN · Number(null) = 0
  oi := null;
  if ix >= 0 and ix < coalesce(array_length(L, 1), 0) and rb_sm2_same(L[ix + 1], a->4, true) then oi := ix + 1;
  else for q in 1 .. coalesce(array_length(L, 1), 0) loop if rb_sm2_same(L[q], a->4, true) then oi := q; exit; end if; end loop; end if;
  if oi is null then raise exception '그 대기 기록이 바뀌었거나 지워졌습니다. 새로고침 후 다시 해 주세요.'; end if;
  o := L[oi];
  if rb_jtru(a->5) then
    o := rb_jput(o, 'waitDone', to_json(rb_pg_kst(ms, 'YYYY-MM-DD'))); o := rb_jput(o, 'waitBy', to_json(who));
    if rb_jstr_(a->6) <> '' then o := rb_jput(o, 'waitReply', to_json(rb_jslice(rb_jstr_(a->6), 500))); end if;
  else o := rb_jdel(rb_jdel(rb_jdel(o, 'waitDone'), 'waitBy'), 'waitReply'); end if;
  L[oi] := o;
  n := rb_jput(n, k, to_json(rb_sm2_ltext(L)));
  perform rb_sm2_psave(e, ms, pc, id, a->1, pc->>'c', rb_js(n));
  insert into rb_tab_job(tab, job) values ('sm2', jsonb_build_object('kind', 'daily', 'who', e, 'at', ms));
  return jsonb_build_object('__j', '{"notes":' || rb_js(n) || '}');
end $f$;

-- apiSampleProjMemo(projKey, meta, op) → 목록
create or replace function rb_sm2_pmemo(e text, a json, ms bigint) returns jsonb language plpgsql security definer set search_path = public as $f$
declare id text; op json := a->2; pc jsonb; n json; L json[]; lj json; it json; t text; i int; len int; who text := split_part(e, '@', 1); nowm text := rb_pg_kst(ms, 'YY/MM/DD HH24:MI');
  CHG constant text := '그사이 메모가 바뀌었습니다 — 새로고침해 주세요.';
begin
  if not rb_jtru(op) then op := '{}'::json; end if;
  if json_typeof(op) <> 'object' then raise exception 'RB_FALLBACK op 모양'; end if;
  id := 'p:' || rb_jstr_(a->0);
  pc := rb_sm2_pload(id);
  n := (pc->>'n')::json;
  lj := rb_jparse(rb_sm2_ntext(n, 'pmemo'), '[]'::json);
  if json_typeof(lj) = 'array' then select coalesce(array_agg(x.value order by x.o), '{}') into L from json_array_elements(lj) with ordinality x(value, o); else L := '{}'; end if;
  len := coalesce(array_length(L, 1), 0);
  if op->'at' is not null and rb_jtru(op->'at') and json_typeof(op->'at') <> 'string' then raise exception 'RB_FALLBACK at 모양'; end if;
  if not rb_jnul(op->'add') then
    t := rb_jslice(rb_jstr_(op->'add'), 500);
    if t = '' then raise exception '메모를 적어 주세요.'; end if;
    it := json_build_object('t', t, 'at', nowm, 'by', who);
    if rb_jstr_(op->'wait') <> '' then it := rb_jput(it, 'wait', to_json(rb_jslice(rb_jstr_(op->'wait'), 20))); end if;
    if rb_jstr_(op->'due') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then it := rb_jput(it, 'due', to_json(rb_jstr_(op->'due'))); end if;
    L := L || it;
  elsif not rb_jnul(op->'waitDone') or not rb_jnul(op->'edit') or not rb_jnul(op->'del') then
    i := rb_jidx(case when not rb_jnul(op->'waitDone') then op->'waitDone' when not rb_jnul(op->'edit') then op->'edit' else op->'del' end);
    if not (i >= 0 and i < len) then raise exception '%', CHG; end if;
    if json_typeof(L[i + 1]) <> 'object' then raise exception 'RB_FALLBACK 메모 모양'; end if;
    if rb_jtru(op->'at') and rb_jstr(L[i + 1]->'at') is distinct from (op->>'at') or (rb_jtru(op->'at') and (L[i + 1]->'at' is null or json_typeof(L[i + 1]->'at') <> 'string')) then raise exception '%', CHG; end if;
    if not rb_jnul(op->'waitDone') then
      if rb_jtru(op->'undo') then L[i + 1] := rb_jdel(rb_jdel(rb_jdel(L[i + 1], 'waitDone'), 'waitBy'), 'waitReply');
      else
        L[i + 1] := rb_jput(rb_jput(L[i + 1], 'waitDone', to_json(rb_pg_kst(ms, 'YYYY-MM-DD'))), 'waitBy', to_json(who));
        if rb_jstr_(op->'reply') <> '' then L[i + 1] := rb_jput(L[i + 1], 'waitReply', to_json(rb_jslice(rb_jstr_(op->'reply'), 500))); end if;
      end if;
    elsif not rb_jnul(op->'edit') then
      t := rb_jslice(rb_jstr_(op->'t'), 500);
      if t = '' then raise exception '메모를 적어 주세요(지우려면 ×).'; end if;
      L[i + 1] := rb_jput(rb_jput(L[i + 1], 't', to_json(t)), 'edited', to_json(nowm || ' ' || who));
    else
      L := L[1:i] || L[i + 2:len];
    end if;
  end if;
  len := coalesce(array_length(L, 1), 0);
  if len > 100 then L := L[len - 99:len]; end if;
  n := rb_jput(n, 'pmemo', to_json(rb_sm2_ltext(L)));
  perform rb_sm2_psave(e, ms, pc, id, case when rb_jtru(a->1) then a->1 else '{}'::json end, pc->>'c', rb_js(n));
  return jsonb_build_object('__j', rb_sm2_ltext(L));
end $f$;

-- apiSampleProjInfo(projKey, meta, key, sets) → obj (+ __log)
create or replace function rb_sm2_pinfo(e text, a json, ms bigint) returns jsonb language plpgsql security definer set search_path = public as $f$
declare id text; key text; pc jsonb; n json; obj json; logL json[] := '{}'; lj json; s json; k text; v json; bf text; af text; o json; f text; x json; fk text; seen text[];
  at_ text := rb_pg_kst(ms, 'YYYY-MM-DD HH24:MI'); who text := split_part(e, '@', 1); j text; outj text; m json := a->1;
begin
  if a->2 is null or json_typeof(a->2) <> 'string' then raise exception 'RB_FALLBACK 칸 모양'; end if;
  key := a->>2;
  if key not in ('req', 'qt', 'rv', 'po') then raise exception '알 수 없는 칸입니다: %', key; end if;
  id := 'p:' || rb_jstr_(a->0);
  if not rb_jtru(m) then m := '{}'::json; end if;
  if json_typeof(m) <> 'object' then raise exception 'RB_FALLBACK 건 정보 모양'; end if;
  if a->3 is not null and rb_jtru(a->3) and json_typeof(a->3) <> 'array' then raise exception 'RB_FALLBACK sets 모양'; end if;
  pc := rb_sm2_pload(id);
  n := (pc->>'n')::json;
  obj := rb_jparse(rb_sm2_ntext(n, 'i:' || key), '{}'::json);
  if not rb_jtru(obj) or json_typeof(obj) <> 'object' then obj := '{}'::json; end if;
  perform rb_js(obj);
  if key = 'req' then
    lj := rb_jparse(rb_sm2_ntext(n, 'i:reqlog'), '[]'::json);
    if json_typeof(lj) = 'array' then select coalesce(array_agg(x2.value order by x2.o), '{}') into logL from json_array_elements(lj) with ordinality x2(value, o); end if;
  end if;
  for s in select x3.value from json_array_elements(case when rb_jtru(a->3) then a->3 else '[]'::json end) with ordinality x3(value, o) order by x3.o loop
    if rb_jtru(s) and json_typeof(s) <> 'object' then raise exception 'RB_FALLBACK sets 줄 모양'; end if;
    k := rb_jslice(case when rb_jtru(s) then rb_jstr_(s->'sub') else '' end, 80);
    if k = '' then continue; end if;
    if k = '__log' then raise exception 'RB_FALLBACK __log 칸'; end if;
    v := s->'val';
    if key = 'req' and left(k, 1) <> '_' then
      if obj->k is not null and json_typeof(obj->k) in ('object', 'array') then raise exception 'RB_FALLBACK 요청 칸 모양'; end if;
      bf := case when rb_jnul(obj->k) then '' else rb_jstr_(obj->k) end;
      if v is not null and json_typeof(v) in ('object', 'array') then raise exception 'RB_FALLBACK 요청 값 모양'; end if;
      af := case when rb_jnul(v) or (json_typeof(v) = 'string' and (v #>> '{}') = '') then '' else rb_jslice(rb_jstr_(v), 2000) end;
      if bf <> '' and bf <> af then logL := logL || json_build_object('at', at_, 'by', who, 'f', k, 'a', rb_jslice(bf, 200), 'b', rb_jslice(af, 200)); end if;
    end if;
    if rb_jnul(v) or (json_typeof(v) = 'string' and (v #>> '{}') = '') then obj := rb_jdel(obj, k); continue; end if;
    if json_typeof(v) in ('object', 'array') then
      if json_typeof(v) = 'array' then raise exception 'RB_FALLBACK 값이 배열'; end if;
      perform rb_js(v);
      o := '{}'::json; seen := '{}';
      for f, x in select y.key, y.value from (select z.key, z.value, z.o,
            case when z.key ~ '^(0|[1-9][0-9]{0,9})$' and z.key::bigint <= 4294967294 then 0 else 1 end as g,
            case when z.key ~ '^(0|[1-9][0-9]{0,9})$' and z.key::bigint <= 4294967294 then z.key::bigint else 0 end as gi
          from json_each(v) with ordinality z(key, value, o)) y order by y.g, y.gi, y.o limit 120 loop
        if rb_jnul(x) or (json_typeof(x) = 'string' and (x #>> '{}') = '') then continue; end if;
        if json_typeof(x) in ('object', 'array') then raise exception 'RB_FALLBACK 견적 칸 모양'; end if;
        fk := rb_jslice(rb_pg_trim(f), 60);
        if fk = any(seen) then raise exception 'RB_FALLBACK 칸 이름 겹침'; end if;
        seen := seen || fk;
        o := rb_jput(o, fk, to_json(rb_jslice(rb_jstr_(x), case when f = 'hist' then 6000 else 1000 end)));
      end loop;
      o := rb_jput(rb_jput(o, '_at', to_json(at_)), '_by', to_json(who));
      obj := rb_jput(obj, k, o);
    else
      obj := rb_jput(obj, k, to_json(rb_jslice(rb_jstr_(v), 2000)));
    end if;
  end loop;
  if key = 'req' then
    obj := rb_jput(rb_jput(obj, '_at', to_json(at_)), '_by', to_json(who));
    if coalesce(array_length(logL, 1), 0) > 300 then logL := logL[array_length(logL, 1) - 299:array_length(logL, 1)]; end if;
    n := rb_jput(n, 'i:reqlog', to_json(rb_sm2_ltext(logL)));
  end if;
  j := rb_js(obj);
  if rb_u16len(j) > 40000 then raise exception '내용이 너무 깁니다 — 줄여 주세요.'; end if;
  n := rb_jput(n, 'i:' || key, to_json(j));
  perform rb_sm2_psave(e, ms, pc, id, m, pc->>'c', rb_js(n));
  if key = 'qt' then insert into rb_tab_job(tab, job) values ('sm2', jsonb_build_object('kind', 'gwpq', 'who', e, 'at', ms)); end if;
  if key <> 'rv' then
    insert into rb_tab_job(tab, job) values ('sm2', jsonb_build_object('kind', 'views', 'who', e, 'at', ms, 'projKey', rb_jstr_(a->0), 'name', rb_jstr_(m->'name'), 'brand', rb_jstr_(m->'brand')));
  end if;
  outj := case when key = 'req' then left(j, length(j) - 1) || case when j = '{}' then '' else ',' end || '"__log":' || rb_sm2_ltext(logL) || '}' else j end;
  return jsonb_build_object('__j', outj);
end $f$;

-- apiSampleStatus(sheetRow, status, projKey, exp) → { ok, row, status }
create or replace function rb_sm2_status(e text, a json, ms bigint) returns jsonb language plpgsql security definer set search_path = public as $f$
declare rw int := rb_jrow(a->0); st text; ex json := a->3; sid text; conf jsonb; kc jsonb; hr2 int; c jsonb; col int; before text; bs text; nm text; rows_ jsonb := '{}';
begin
  if rw < 2 then raise exception '시트 행을 찾을 수 없습니다.'; end if;
  st := rb_pg_trim(case when rb_jtru(a->1) then rb_jstr(a->1) else '' end);
  if st not in ('진행중', '수신', '채택', '탈락', '드롭') then raise exception '알 수 없는 상태입니다: %', st; end if;
  if not rb_jtru(ex) or json_typeof(ex) <> 'object' then raise exception 'RB_FALLBACK 샘플ID 없음'; end if;
  sid := rb_jstr_(ex->'sid');
  if sid = '' then raise exception 'RB_FALLBACK 샘플ID 없음'; end if;
  conf := rb_sm2_sready(); kc := conf->'K';
  perform rb_sm2_sbusy(array[sid, rb_jstr_(a->2)]);
  col := coalesce((kc->>'status')::int, -1);
  if col < 0 then raise exception 'RB_FALLBACK 상태 열 없음'; end if;
  hr2 := rb_sm2_find(conf, sid, rw);
  if hr2 is null then raise exception '%', rb_sm2_gone(ex); end if;
  select cells into c from sheet_rows where tab = '_실행판_샘플' and "row" = hr2 for update;
  c := rb_pad(c, greatest(coalesce((conf->>'lc')::int, 0), col + 1));
  before := case when c->col is null or jsonb_typeof(c->col) = 'null' then '' when jsonb_typeof(c->col) = 'string' then c->>col else btrim((c->col)::text) end;
  bs := rb_pg_trim(before);
  if not rb_jnul(ex->'oldSt') and bs <> '' and bs <> rb_jstr_(ex->'oldSt') and bs <> st then
    raise exception '그사이 다른 사람이 상태를 [%](으)로 바꿨습니다. 덮어쓰지 않았습니다 — 새로고침 후 다시 해 주세요.', bs;
  end if;
  nm := rb_sm2_s(c->((kc->>'name')::int));
  if before <> st then
    c := jsonb_set(c, array[col::text], to_jsonb(st));
    update sheet_rows set cells = c, synced_at = now() where tab = '_실행판_샘플' and "row" = hr2;
    rows_ := jsonb_build_object(hr2::text, jsonb_build_object('s', sid, 'w', jsonb_build_object((col + 1)::text, st)));
  end if;
  perform rb_sm2_job(e, ms, conf, rows_, jsonb_build_array(jsonb_build_object('tab', '_실행판_샘플', 'row', hr2, 'col', col + 1, 'what', '샘플 상태', 'before', before, 'after', st, 'item', nm, 'who', e, 'at', ms)), '[]'::jsonb, null);
  return jsonb_build_object('__j', '{"ok":true,"row":' || hr2 || ',"status":' || to_json(st)::text || '}');
end $f$;

-- apiSampleProject0_(projKey, fields, vendor) — 잠금 · 켜짐은 부르는 쪽. 돌려줌 { n, rows, audits }
create or replace function rb_sm2_proj_in(e text, ms bigint, conf jsonb, p_key text, f json, p_vendor json) returns jsonb language plpgsql security definer set search_path = public as $f$
declare kc jsonb := conf->'K'; hr int := coalesce((conf->>'hr')::int, 1); r record; hits int[] := '{}'; vk text := ''; fl text; col int; want text; cur text; c jsonb;
  audits jsonb := '[]'; rows_ jsonb := '{}'; lab text; sc int := (kc->>'sid')::int;
begin
  if rb_jstr_(p_vendor) <> '' then vk := rb_sm2_norm(rb_jstr_(p_vendor)); end if;
  for r in select "row", cells from sheet_rows where tab = '_실행판_샘플' and "row" > hr order by "row" loop
    if rb_sm2_s(r.cells->((kc->>'name')::int)) = '' then continue; end if;
    if rb_sm2_rkey(kc, r.cells) <> p_key then continue; end if;
    if vk <> '' and rb_sm2_norm(coalesce(nullif(case when coalesce((kc->>'vendor')::int, -1) >= 0 then rb_sm2_s(r.cells->((kc->>'vendor')::int)) else '' end, ''), '업체 미정')) <> vk then continue; end if;
    hits := hits || r."row";
  end loop;
  if coalesce(array_length(hits, 1), 0) = 0 then raise exception '_실행판_샘플 시트에서 이 프로젝트 줄을 찾지 못했습니다. 새로고침 후 다시 해 주세요.'; end if;
  foreach fl in array array['owner', 'brand', 'code'] loop
    col := coalesce((kc->>fl)::int, -1);
    if rb_jnul(f->fl) or col < 0 then continue; end if;
    if json_typeof(f->fl) in ('object', 'array') then raise exception 'RB_FALLBACK 값 모양'; end if;
    want := rb_jstr_(f->fl);
    if fl = 'code' then want := rb_jslice(upper(regexp_replace(want, '\s', '', 'g')), 40); end if;
    lab := case fl when 'owner' then '담당자' when 'brand' then '브랜드' else '품목코드' end;
    for r in select "row", cells from sheet_rows where tab = '_실행판_샘플' and "row" = any(hits) order by "row" loop
      cur := rb_sm2_s(r.cells->col);
      if cur = want then continue; end if;
      c := rb_pad(r.cells, greatest(coalesce((conf->>'lc')::int, 0), col + 1));
      c := jsonb_set(c, array[col::text], case when want = '' then 'null'::jsonb else to_jsonb(want) end);
      update sheet_rows set cells = c, synced_at = now() where tab = '_실행판_샘플' and "row" = r."row";
      rows_ := jsonb_set(case when rows_ ? r."row"::text then rows_ else rows_ || jsonb_build_object(r."row"::text, jsonb_build_object('s', rb_sm2_s(r.cells->sc), 'w', '{}'::jsonb)) end,
        array[r."row"::text, 'w', (col + 1)::text], to_jsonb(case when want = '' then '' else '''' || want end));
      audits := audits || jsonb_build_array(jsonb_build_object('tab', '_실행판_샘플', 'row', r."row", 'col', col + 1, 'what', '샘플 ' || lab, 'before', cur, 'after', want, 'item', rb_sm2_s(r.cells->((kc->>'name')::int)), 'who', e, 'at', ms));
    end loop;
  end loop;
  return jsonb_build_object('n', jsonb_array_length(audits), 'rows', rows_, 'audits', audits);
end $f$;

create or replace function rb_sm2_project(e text, a json, ms bigint) returns jsonb language plpgsql security definer set search_path = public as $f$
declare conf jsonb; r jsonb; f json := a->1;
begin
  if not rb_jtru(f) then f := '{}'::json; end if;
  if json_typeof(f) <> 'object' then raise exception 'RB_FALLBACK fields 모양'; end if;
  conf := rb_sm2_sready();
  perform rb_sm2_sbusy(array[rb_jstr(a->0)]);
  r := rb_sm2_proj_in(e, ms, conf, rb_jstr(a->0), f, a->2);
  perform rb_sm2_job(e, ms, conf, r->'rows', r->'audits', '[]'::jsonb, null);
  return jsonb_build_object('__j', '{"ok":true,"n":' || (r->>'n') || '}');
end $f$;

-- apiSampleProjEdit(projKey, meta, f) → { projKey, id, n, links? }  (이름 바꾸기는 프로젝트ID 열쇠만)
create or replace function rb_sm2_projedit(e text, a json, ms bigint) returns jsonb language plpgsql security definer set search_path = public as $f$
declare pk text := rb_jstr_(a->0); id text; f json := a->2; nn int := 0; conf jsonb; pf json := '{}'::json; r jsonb; links text[] := '{}'; u text; src json; pc jsonb; n json; m json := a->1;
  lj text := null; nm text; kc jsonb; hr int; rr record; hits int[] := '{}'; rows_ jsonb := '{}'; audits jsonb := '[]'; c jsonb; prow int; pcx jsonb; ptab text; out text;
begin
  id := 'p:' || pk;
  if not rb_jtru(f) then f := '{}'::json; end if;
  if json_typeof(f) <> 'object' then raise exception 'RB_FALLBACK f 모양'; end if;
  if not rb_jtru(m) then m := '{}'::json; end if;
  if json_typeof(m) <> 'object' then raise exception 'RB_FALLBACK 건 정보 모양'; end if;
  nm := case when not rb_jnul(f->'name') then rb_jstr_(f->'name') else '' end;
  if nm <> '' and pk !~ '^P[0-9A-F]{8}$' then raise exception 'RB_FALLBACK 옛 열쇠 프로젝트 이름 바꾸기'; end if;
  -- 잠금 순서: 진행 기록(sp) → 샘플 탭(sm)
  if not rb_jnul(f->'links') or nm <> '' then pc := rb_sm2_pload(id); end if;
  conf := rb_sm2_sready(); kc := conf->'K'; hr := coalesce((conf->>'hr')::int, 1);
  perform rb_sm2_sbusy(array[pk]);
  if not rb_jnul(f->'brand') then pf := rb_jput(pf, 'brand', f->'brand'); end if;
  if not rb_jnul(f->'code') then pf := rb_jput(pf, 'code', f->'code'); end if;
  if pf::text <> '{}' then
    r := rb_sm2_proj_in(e, ms, conf, pk, pf, null);
    nn := nn + (r->>'n')::int;
    perform rb_sm2_job(e, ms, conf, r->'rows', r->'audits', '[]'::jsonb, null);
  end if;
  if not rb_jnul(f->'links') then
    src := f->'links';
    if json_typeof(src) = 'array' then
      for u in select case when json_typeof(x.value) in ('object', 'array') then '' else rb_jstr_(x.value) end from json_array_elements(src) with ordinality x(value, o) order by x.o loop
        if u ~* '^https?://' and not exists (select 1 from unnest(links) l where l = u) then links := links || rb_jslice(u, 500); end if;
      end loop;
    else
      for u in select x from regexp_split_to_table(rb_jstr_(src), '[\s,]+') x loop
        if u ~* '^https?://' and not exists (select 1 from unnest(links) l where l = u) then links := links || rb_jslice(u, 500); end if;
      end loop;
    end if;
    links := links[1:20];
    lj := '[' || coalesce((select string_agg(to_json(l)::text, ',' order by o) from unnest(links) with ordinality q(l, o)), '') || ']';
    n := (pc->>'n')::json;
    n := rb_jput(n, 'plinks', to_json(lj));
    perform rb_sm2_psave(e, ms, pc, id, rb_jput(m, 'id', to_json(id)), pc->>'c', rb_js(n));
    nn := nn + 1;
  end if;
  if nm <> '' then
    for rr in select "row", cells from sheet_rows where tab = '_실행판_샘플' and "row" > hr order by "row" loop
      if rb_sm2_s(rr.cells->((kc->>'name')::int)) = '' then continue; end if;
      if rb_sm2_rkey(kc, rr.cells) = pk then hits := hits || rr."row"; end if;
    end loop;
    if coalesce(array_length(hits, 1), 0) > 0 then
      for rr in select "row", cells from sheet_rows where tab = '_실행판_샘플' and "row" = any(hits) order by "row" loop
        if not (jsonb_typeof(rr.cells->((kc->>'name')::int)) = 'string' and rr.cells->>((kc->>'name')::int) = nm) then      -- 같은 값이면 시트 일 없음(예전 가상 저장 끝맺기도 줄이 그대로면 건너뜀)
          c := jsonb_set(rb_pad(rr.cells, (kc->>'name')::int + 1), array[(kc->>'name')::text], to_jsonb(nm));
          update sheet_rows set cells = c, synced_at = now() where tab = '_실행판_샘플' and "row" = rr."row";
          rows_ := rows_ || jsonb_build_object(rr."row"::text, jsonb_build_object('s', rb_sm2_s(rr.cells->((kc->>'sid')::int)), 'w', jsonb_build_object(((kc->>'name')::int + 1)::text, '''' || nm)));
        end if;
        audits := audits || jsonb_build_array(jsonb_build_object('tab', '_실행판_샘플', 'row', rr."row", 'col', (kc->>'name')::int + 1, 'what', '프로젝트명',
          'before', case when jsonb_typeof(rr.cells->((kc->>'name')::int)) = 'string' then rr.cells->>((kc->>'name')::int) else rb_sm2_s(rr.cells->((kc->>'name')::int)) end, 'after', nm, 'item', nm, 'who', e, 'at', ms));
      end loop;
      perform rb_sm2_job(e, ms, conf, rows_, audits, '[]'::jsonb, null);
      -- 진행 기록 품목명(건ID 그대로) — 마지막 줄(그 줄 칸만, 최종수정은 그대로)
      ptab := pc->>'tab';
      select "row", cells into prow, pcx from sheet_rows where tab = ptab and "row" > 1 and cells->>0 = id order by "row" desc limit 1 for update;
      if prow is not null and rb_sm2_s(pcx->2) <> nm then
        pcx := jsonb_set(jsonb_set(rb_pad(pcx, 11), '{0}', to_jsonb(id)), '{2}', to_jsonb(nm));
        update sheet_rows set cells = pcx, synced_at = now() where tab = ptab and "row" = prow;
        insert into rb_tab_job(tab, job) values ('pgx', jsonb_build_object('mode', 'sample', 'id', id, 'row', prow, 'at', ms, 'who', e));
      end if;
      nn := nn + array_length(hits, 1);
    end if;
  end if;
  out := '{"projKey":' || to_json(pk)::text || ',"id":' || to_json(id)::text || ',"n":' || nn || case when lj is not null then ',"links":' || lj else '' end || '}';
  return jsonb_build_object('__j', out);
end $f$;

-- apiSampleDeleteRow(sheetRow, projKey, exp) → { ok, row }
create or replace function rb_sm2_delrow(e text, a json, ms bigint) returns jsonb language plpgsql security definer set search_path = public as $f$
declare rw int := rb_jrow(a->0); ex json := a->2; sid text; conf jsonb; kc jsonb; hr2 int; c jsonb; info text; h0 text;
begin
  if rw < 2 then raise exception '시트 행을 찾을 수 없습니다.'; end if;
  if not rb_jtru(ex) or json_typeof(ex) <> 'object' or rb_jstr_(ex->'sid') = '' then raise exception 'RB_FALLBACK 샘플ID 없음'; end if;
  sid := rb_jstr_(ex->'sid');
  conf := rb_sm2_sready(); kc := conf->'K';
  if not rb_jtru(a->1) then raise exception '프로젝트를 알 수 없어 지우지 않았습니다. 새로고침 후 다시 해 주세요.'; end if;
  perform rb_sm2_sbusy(array[sid, rb_jstr(a->1)]);
  hr2 := rb_sm2_find(conf, sid, rw);
  if hr2 is null then raise exception '%', rb_sm2_gone(ex); end if;
  select cells into c from sheet_rows where tab = '_실행판_샘플' and "row" = hr2 for update;
  info := rb_sm2_s(c->((kc->>'name')::int)) || ' / ' || case when coalesce((kc->>'vendor')::int, -1) >= 0 then rb_sm2_s(c->((kc->>'vendor')::int)) else '' end
    || ' / ' || case when coalesce((kc->>'make')::int, -1) >= 0 then rb_sm2_s(c->((kc->>'make')::int)) else '' end;
  h0 := rb_sm2_h0(conf);
  if h0 is null then raise exception 'RB_FALLBACK 샘플ID 글자'; end if;
  delete from sheet_rows where tab = '_실행판_샘플' and "row" = hr2;
  update sheet_rows set "row" = -"row" where tab = '_실행판_샘플' and "row" > hr2;
  update sheet_rows set "row" = -"row" - 1, synced_at = now() where tab = '_실행판_샘플' and "row" < 0;
  perform rb_sm2_job(e, ms, conf, '{}'::jsonb, '[]'::jsonb, jsonb_build_array(jsonb_build_object('r', hr2, 'n', 1, 's', jsonb_build_array(sid))), h0);
  insert into rb_tab_job(tab, job) values ('sm2', jsonb_build_object('kind', 'del', 'who', e, 'at', ms, 'row', hr2, 'info', info, 'cells', c, 'lc', coalesce((conf->>'lc')::int, 0)));
  return jsonb_build_object('__j', '{"ok":true,"row":' || hr2 || '}');
end $f$;

-- ---------- 입구 ----------
create or replace function rb_sm2_do(e text, p_fn text, a json) returns jsonb language plpgsql security definer set search_path = public as $f$
declare ms bigint := rb_pg_ms();
begin
  if a is null or json_typeof(a) <> 'array' then raise exception 'RB_FALLBACK 인자 모양'; end if;
  return case p_fn
    when 'apiSampleDone' then rb_sm2_done(e, a, ms)
    when 'apiSampleLog' then rb_sm2_log(e, a, ms)
    when 'apiSampleWaitDone' then rb_sm2_waitdone(e, a, ms)
    when 'apiSampleProjMemo' then rb_sm2_pmemo(e, a, ms)
    when 'apiSampleProjInfo' then rb_sm2_pinfo(e, a, ms)
    when 'apiSampleStatus' then rb_sm2_status(e, a, ms)
    when 'apiSampleProject' then rb_sm2_project(e, a, ms)
    when 'apiSampleProjEdit' then rb_sm2_projedit(e, a, ms)
    when 'apiSampleDeleteRow' then rb_sm2_delrow(e, a, ms)
    else null end;
end $f$;

create or replace function rb_sm2_save(p_token text, p_fn text, p_argj text) returns jsonb language plpgsql security definer set search_path = public as $f$
declare e text := rb_me(p_token); ed boolean; a json; r jsonb;
begin
  if e is null then raise exception 'RB_SESSION'; end if;
  select editor into ed from rb_session where token = p_token;
  if not coalesce(ed, false) then raise exception 'RB_SESSION 저장 권한 확인'; end if;
  if coalesce(p_fn, '') not in ('apiSampleDone', 'apiSampleLog', 'apiSampleWaitDone', 'apiSampleProjMemo', 'apiSampleProjInfo', 'apiSampleStatus', 'apiSampleProject', 'apiSampleProjEdit', 'apiSampleDeleteRow') then
    raise exception 'RB_FALLBACK % 는 서버 길', p_fn;
  end if;
  if length(coalesce(p_argj, '')) > 200000 then raise exception 'RB_FALLBACK 인자가 큼'; end if;
  begin a := p_argj::json; exception when others then raise exception 'RB_FALLBACK 인자 JSON'; end;
  r := rb_sm2_do(e, p_fn, a);
  return r || jsonb_build_object('direct', 1);
end $f$;

-- 서버(서비스 키)만: 샘플 탭 직접 저장 켜기/끄기 — 같은 잠금이라 진행 중 저장이 끝난 뒤 바뀐다
create or replace function rb_sm2_conf_put(p_conf jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
begin
  perform pg_advisory_xact_lock(hashtext('rb_tab_sm'));
  insert into rb_conf (k, v, at) values ('sm2Conf', p_conf, now()) on conflict (k) do update set v = excluded.v, at = excluded.at;
  return jsonb_build_object('ok', true, 'on', p_conf->>'on');
end $f$;

do $d$ declare f text; begin
  foreach f in array array['rb_js(json)', 'rb_jput(json,text,json)', 'rb_jdel(json,text)', 'rb_jtru(json)', 'rb_jnul(json)', 'rb_jstr(json)', 'rb_jstr_(json)', 'rb_jstro(json)', 'rb_jslice(text,int)', 'rb_u16len(text)',
    'rb_jidx(json)', 'rb_jrow(json)', 'rb_jparse(text,json)', 'rb_sm2_s(jsonb)', 'rb_sm2_norm(text)', 'rb_sm2_pobj(jsonb)', 'rb_sm2_pload(text)', 'rb_sm2_psave(text,bigint,jsonb,text,json,text,text)',
    'rb_sm2_sready()', 'rb_sm2_sbusy(text[])', 'rb_sm2_find(jsonb,text,int)', 'rb_sm2_gone(json)', 'rb_sm2_job(text,bigint,jsonb,jsonb,jsonb,jsonb,text)', 'rb_sm2_rkey(jsonb,jsonb)', 'rb_sm2_iso(date)',
    'rb_sm2_h0(jsonb)', 'rb_b36(bigint)', 'rb_sm2_done(text,json,bigint)', 'rb_sm2_same(json,json,boolean)', 'rb_sm2_list(text)', 'rb_sm2_ltext(json[])', 'rb_sm2_ntext(json,text)',
    'rb_sm2_log(text,json,bigint)', 'rb_sm2_waitdone(text,json,bigint)', 'rb_sm2_pmemo(text,json,bigint)', 'rb_sm2_pinfo(text,json,bigint)', 'rb_sm2_status(text,json,bigint)',
    'rb_sm2_proj_in(text,bigint,jsonb,text,json,json)', 'rb_sm2_project(text,json,bigint)', 'rb_sm2_projedit(text,json,bigint)', 'rb_sm2_delrow(text,json,bigint)', 'rb_sm2_do(text,text,json)', 'rb_sm2_conf_put(jsonb)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
  end loop;
end $d$;
revoke all on function rb_sm2_save(text, text, text) from public;
grant execute on function rb_sm2_save(text, text, text) to anon, authenticated;
