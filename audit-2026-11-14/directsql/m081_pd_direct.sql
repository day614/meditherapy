-- m081_pd_direct — 진행상태 바꾸기(apiSetState) · 품의 취소(apiPoCancel) 를 Supabase 함수로 바로(할 일 대기열 아님)
-- 규칙 = Keys.js apiSetState0_ · poCancel_(withOrdered = null). 발주 DB 사본 = sheet_rows(tab '_실행판_발주').
-- 열 위치 · 머리글 줄 · 켜짐은 서버가 올린 rb_conf 'pdConf'(pdConfPublish_). 머리글 줄 글자가 다르면 RB_FALLBACK.
-- 잠금 = rb_tab_commit('pd') 와 같은 advisory lock(hashtext('rb_tab_pd')) — 서버 길 끝맺기(tvVirtualCommit_ pd)도 이 잠금 + p_chk 로 바꿈(JS 패치).
-- 시트 맞추기 일: rb_tab_job tab='pdx' {rows:[{id,row,cols}]} — 서버가 그 칸의 '지금 Supabase 값'을 시트에(차례가 뒤바뀌어도 사본과 같아짐).
-- 뒷정리 일: rb_tab_job tab='pj' fn '_pdPost'(이력 · 품의번호 대기열 · 진행 기록 상신일/승인일 지움 · 캐시 · AP) — pj 대기열 차례 그대로.
-- 앞선 저장(pj · od · ln 대기열에 그 건이 남음 · 진행 장부에 상태 올리기/내리기가 남음 rb_conf 'pdJ')이 있으면 RB_FALLBACK '앞선 저장'(화면은 예전 할 일 길로).

create or replace function rb_pd_num(v jsonb) returns numeric language sql immutable as $f$
  select case when v is null or jsonb_typeof(v) = 'null' then 0
              when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric
              when jsonb_typeof(v) = 'string' and btrim(v #>> '{}') ~ '^-?\d+(\.\d+)?$' then btrim(v #>> '{}')::numeric
              else 0 end
$f$;

create or replace function rb_pd_ready(p_fn text) returns jsonb language plpgsql security definer set search_path = public as $f$
declare conf jsonb; hc jsonb; ck text; want text; hr int;
begin
  select c.v into conf from rb_conf c where c.k = 'pdConf';
  if conf is null or coalesce(conf->>'on', '') <> '1' then raise exception 'RB_FALLBACK 발주 DB 직접 저장 꺼짐(%)', coalesce(conf->>'why', '설정 없음'); end if;
  if exists (select 1 from rb_conf g where g.k = 'gate:' || p_fn and coalesce(g.v->>'on', '') = '1') then raise exception 'RB_FALLBACK 시트 맞추기 중(%)', p_fn; end if;
  hr := coalesce((conf->>'hr')::int, 1);
  select cells into hc from sheet_rows where tab = conf->>'tab' and "row" = hr;
  if hc is null then raise exception 'RB_FALLBACK 발주 DB 머리글 줄 없음'; end if;
  for ck, want in select * from jsonb_each_text(coalesce(conf->'names', '{}'::jsonb)) loop
    if regexp_replace(rb_t(hc->(ck::int)), '\s', '', 'g') <> regexp_replace(want, '\s', '', 'g') then
      raise exception 'RB_FALLBACK 발주 DB 머리글이 다름(% 열)', ck::int + 1;
    end if;
  end loop;
  return conf;
end $f$;

-- 그 건에 아직 시트에 안 옮긴 앞선 저장이 있는지 — 있으면 예전 할 일 길(차례 지킴)
create or replace function rb_pd_busy(p_id text) returns void language plpgsql security definer set search_path = public as $f$
declare j record;
begin
  if p_id = '' then return; end if;
  select id, tab, job->>'fn' as fn into j from rb_tab_job
   where tab in ('pj', 'od', 'ln') and done_at is null and coalesce(job->>'fn', '') <> '_pdPost'
     and coalesce(job->>'who', '') <> 'selftest@rb.local' and strpos(job::text, p_id) > 0
   order by id limit 1;
  if found then raise exception 'RB_FALLBACK 앞선 저장 반영 전(% #% %)', j.tab, j.id, coalesce(j.fn, ''); end if;
  if exists (select 1 from rb_conf c where c.k = 'pdJ' and jsonb_typeof(c.v->'ids') = 'object' and (c.v->'ids') ? p_id) then
    raise exception 'RB_FALLBACK 앞선 저장 반영 전(진행 장부 상태 올리기)';
  end if;
end $f$;

-- 행 찾기 = findStatusRow_ / checkStatusRow_ 의 실행판ID 길. given_first = checkStatusRow_(기억한 행 먼저)
-- 돌려줌 { row } | { err } | { fb }(예전 열쇠 · 서버 길)
create or replace function rb_pd_find(conf jsonb, p_id text, p_row int, given_first boolean) returns jsonb language plpgsql security definer set search_path = public as $f$
declare T text := conf->>'tab'; hr int := coalesce((conf->>'hr')::int, 1); idc int := (conf->>'idc')::int; hits int[];
begin
  if p_id = '' then return jsonb_build_object('fb', 'ID 없는 건(예전 열쇠)'); end if;
  if given_first and p_row > hr and exists (select 1 from sheet_rows where tab = T and "row" = p_row and rb_t(cells->idc) = p_id) then
    return jsonb_build_object('row', p_row);
  end if;
  select coalesce(array_agg("row" order by "row"), '{}') into hits from sheet_rows where tab = T and "row" > hr and rb_t(cells->idc) = p_id;
  if array_length(hits, 1) = 1 then return jsonb_build_object('row', hits[1]); end if;
  if coalesce(array_length(hits, 1), 0) > 1 then
    return jsonb_build_object('err', '발주 DB에 실행판ID ' || p_id || ' 가 ' || array_length(hits, 1) || '행 있습니다. 관리자에게 알려주세요.');
  end if;
  if strpos(p_id, '|') > 0 then return jsonb_build_object('fb', '예전 열쇠(품의번호 · 코드 · 차수)'); end if;
  return jsonb_build_object('err', '발주 DB에서 이 건(실행판ID ' || p_id || ')을 찾지 못했습니다. 줄이 지워졌거나 ID 칸이 바뀌었을 수 있습니다. 새로고침 후 확인해 주세요.');
end $f$;

create or replace function rb_pd_cell(conf jsonb, p_row int, p_col int) returns text language sql security definer set search_path = public stable as $f$
  select coalesce((select rb_t(cells->p_col) from sheet_rows where tab = conf->>'tab' and "row" = p_row), '')
$f$;

create or replace function rb_pd_put(conf jsonb, p_row int, p_col int, p_val text) returns void language plpgsql security definer set search_path = public as $f$
begin
  update sheet_rows set cells = jsonb_set(rb_pad(cells, p_col + 1), array[p_col::text], case when p_val = '' then 'null'::jsonb else to_jsonb(p_val) end), synced_at = now()
   where tab = conf->>'tab' and "row" = p_row;
end $f$;

create or replace function rb_pd_ver(e text) returns void language plpgsql security definer set search_path = public as $f$
begin
  insert into rb_ver (k, v, at) values ('r', (floor(extract(epoch from clock_timestamp()) * 1000))::bigint::text || ':' || e, now())
    on conflict (k) do update set v = excluded.v, at = excluded.at;
end $f$;

-- ---------- 진행상태 바꾸기 — p_args = [statusRow, expect, state](apiSetState 인자 그대로) ----------
create or replace function rb_od_state_do(e text, a jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
declare
  states constant text[] := array['계획', '상신', '승인', '발주', '종결', '취소'];
  st text := rb_t(a->2); ex jsonb := case when jsonb_typeof(a->1) = 'object' then a->1 else '{}'::jsonb end;
  rw int; conf jsonb; f jsonb; sc int; before text; id text := rb_t(ex->'id'); ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if jsonb_typeof(a) <> 'array' then raise exception 'RB_FALLBACK 인자 모양'; end if;
  if not (st = any(states)) then raise exception '알 수 없는 진행상태입니다: %', st; end if;
  rw := case when jsonb_typeof(a->0) = 'number' then floor((a->>0)::numeric)::int
             when rb_t(a->0) ~ '^\d+(\.\d+)?$' then floor(rb_t(a->0)::numeric)::int else 0 end;
  if rw < 2 then raise exception '발주 DB에 없는 건입니다.'; end if;
  perform pg_advisory_xact_lock(hashtext('rb_tab_pd'));
  conf := rb_pd_ready('rb_od_state');
  sc := (conf->>'state')::int;
  if sc is null or sc < 0 then raise exception '[진행상태] 열이 없습니다. 관리자에게 알려 주세요.'; end if;
  perform rb_pd_busy(id);
  f := rb_pd_find(conf, id, rw, true);
  if f ? 'fb' then raise exception 'RB_FALLBACK %', f->>'fb'; end if;
  if f ? 'err' then raise exception '%', f->>'err'; end if;
  rw := (f->>'row')::int;
  before := rb_pd_cell(conf, rw, sc);
  if before = st then return jsonb_build_object('ok', true, 'state', st, 'before', before); end if;
  perform rb_pd_put(conf, rw, sc, st);
  insert into rb_tab_job(tab, job) values ('pdx', jsonb_build_object('k', 'pd', 'at', ms, 'who', e, 'rows', jsonb_build_array(jsonb_build_object('id', id, 'row', rw, 'cols', jsonb_build_array(sc)))));
  insert into rb_tab_job(tab, job) values ('pj', jsonb_build_object('fn', '_pdPost', 'who', e, 'at', ms, 'args', jsonb_build_array(jsonb_build_object(
    'kind', 'state', 'ap', true,
    'audits', jsonb_build_array(jsonb_build_object('row', rw, 'col', sc + 1, 'what', '진행상태', 'before', before, 'after', st, 'item', rb_t(ex->'name'),
      'id', id, 'doc', rb_t(ex->'doc'), 'code', rb_t(ex->'code')))))));
  perform rb_pd_ver(e);
  return jsonb_build_object('ok', true, 'state', st, 'before', before, 'direct', 1);
end $f$;

create or replace function rb_od_state(p_token text, p_args jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
declare e text := rb_me(p_token); ed boolean;
begin
  if e is null then raise exception 'RB_SESSION'; end if;
  select editor into ed from rb_session where token = p_token;
  if not coalesce(ed, false) then raise exception 'RB_SESSION 저장 권한 확인'; end if;
  return rb_od_state_do(e, coalesce(p_args, '[]'::jsonb));
end $f$;

-- ---------- 품의 취소 — p_args = [items, why](apiPoCancel 인자 그대로 · withOrdered 없음) ----------
create or replace function rb_po_cancel_do(e text, a jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
declare
  why text := rb_t(a->1); x jsonb; ex jsonb; nm text; xid text; id text; rw int; f jsonb; conf jsonb;
  sc int; dc int; apc int; cc int; st0 text; doc text; apv text;
  n int := 0; skipped jsonb := '[]'; skippedIds jsonb := '[]'; audits jsonb := '[]'; ids jsonb := '[]'; prow jsonb := '[]'; cols jsonb;
  ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint; any_items boolean := false;
begin
  if jsonb_typeof(a) <> 'array' then raise exception 'RB_FALLBACK 인자 모양'; end if;
  if why = '' then raise exception '취소 사유를 적어 주세요.'; end if;
  for x in select v from jsonb_array_elements(case when jsonb_typeof(a->0) = 'array' then a->0 else '[]'::jsonb end) v loop
    if jsonb_typeof(x) = 'object' and rb_pd_num(x->'statusRow') >= 2 then any_items := true; end if;
  end loop;
  if not any_items then return jsonb_build_object('n', 0); end if;
  perform pg_advisory_xact_lock(hashtext('rb_tab_pd'));
  conf := rb_pd_ready('rb_po_cancel');
  sc := coalesce((conf->>'state')::int, -1); dc := coalesce((conf->>'doc')::int, -1); apc := coalesce((conf->>'apNo')::int, -1); cc := coalesce((conf->>'code')::int, -1);
  -- 먼저 모든 건의 앞선 저장 · 예전 열쇠를 본다(중간에 RB_FALLBACK 이면 통째로 되돌리지만, 먼저 보면 헛일이 없다)
  for x in select v from jsonb_array_elements(a->0) v loop
    if not (jsonb_typeof(x) = 'object' and rb_pd_num(x->'statusRow') >= 2) then continue; end if;
    ex := case when jsonb_typeof(x->'expect') = 'object' then x->'expect' else '{}'::jsonb end;
    perform rb_pd_busy(case when rb_t(ex->'id') <> '' then rb_t(ex->'id') else rb_t(x->'id') end);
  end loop;
  for x in select v from jsonb_array_elements(a->0) v loop
    if not (jsonb_typeof(x) = 'object' and rb_pd_num(x->'statusRow') >= 2) then continue; end if;
    ex := case when jsonb_typeof(x->'expect') = 'object' then x->'expect' else '{}'::jsonb end;
    nm := rb_t(ex->'name');
    xid := case when rb_t(ex->'id') <> '' then rb_t(ex->'id') else rb_t(x->'id') end;
    f := rb_pd_find(conf, rb_t(ex->'id'), floor(rb_pd_num(x->'statusRow'))::int, false);
    if f ? 'fb' then raise exception 'RB_FALLBACK %', f->>'fb'; end if;
    if f ? 'err' then skipped := skipped || to_jsonb(nm || ' — 행을 찾지 못함'); skippedIds := skippedIds || to_jsonb(xid); continue; end if;
    rw := (f->>'row')::int;
    st0 := case when sc >= 0 then rb_pd_cell(conf, rw, sc) else '' end;
    if not (st0 = any(array['', '계획', '상신', '승인'])) then
      skipped := skipped || to_jsonb(nm || ' — 진행상태 ' || st0 || '(계획 · 상신 · 승인만 취소)'); skippedIds := skippedIds || to_jsonb(xid); continue;
    end if;
    cols := '[]';
    doc := case when dc >= 0 then rb_pd_cell(conf, rw, dc) else '' end;
    if doc <> '' then
      perform rb_pd_put(conf, rw, dc, ''); cols := cols || to_jsonb(dc);
      audits := audits || jsonb_build_object('row', rw, 'col', dc + 1, 'what', '품의번호(품의 취소)', 'before', doc, 'after', '', 'item', nm || ' — ' || why);
    end if;
    if apc >= 0 then
      apv := rb_pd_cell(conf, rw, apc);
      if apv <> '' then
        perform rb_pd_put(conf, rw, apc, ''); cols := cols || to_jsonb(apc);
        audits := audits || jsonb_build_object('row', rw, 'col', apc + 1, 'what', '결재문서번호(품의 취소)', 'before', apv, 'after', '', 'item', nm);
      end if;
    end if;
    if sc >= 0 and st0 in ('상신', '승인') then
      perform rb_pd_put(conf, rw, sc, '계획'); cols := cols || to_jsonb(sc);
      audits := audits || jsonb_build_object('row', rw, 'col', sc + 1, 'what', '진행상태(품의 취소)', 'before', st0, 'after', '계획', 'item', nm);
    end if;
    -- 이력 줄의 건 열쇠 = writeAudits_ 가 RB_ROWKEY(rowKeyNote_ — 화면이 준 expect)로 붙이는 값: 품의번호 칸 변경은 바꾼 뒤 값(빈칸), 나머지는 expect.doc
    audits := (select coalesce(jsonb_agg(case when (q->>'row')::int = rw and not (q ? 'id') then q || jsonb_build_object('id', rb_t(ex->'id'),
                 'doc', case when q->>'what' like '%품의번호%' then q->>'after' else rb_t(ex->'doc') end, 'code', rb_t(ex->'code')) else q end), '[]') from jsonb_array_elements(audits) q);
    if jsonb_array_length(cols) > 0 then prow := prow || jsonb_build_object('id', rb_t(ex->'id'), 'row', rw, 'cols', cols); end if;
    id := case when rb_t(ex->'id') <> '' then rb_t(ex->'id') else rb_t(x->'id') end;
    if id <> '' then ids := ids || jsonb_build_object('id', id, 'meta', jsonb_build_object('doc', '', 'name', nm, 'batch', rb_t(ex->'batch'), 'code', rb_t(ex->'code')), 'doc', doc); end if;
    n := n + 1;
  end loop;
  if jsonb_array_length(prow) > 0 then
    insert into rb_tab_job(tab, job) values ('pdx', jsonb_build_object('k', 'pd', 'at', ms, 'who', e, 'rows', prow));
  end if;
  -- 뒷정리(이력 · 품의번호 대기열 · 진행 기록 상신일/승인일 · 캐시 · AP)는 건너뛴 것만 있어도(예전처럼 AP 다시) — 할 일 하나
  insert into rb_tab_job(tab, job) values ('pj', jsonb_build_object('fn', '_pdPost', 'who', e, 'at', ms, 'args', jsonb_build_array(jsonb_build_object(
    'kind', 'poCancel', 'ap', true, 'audits', audits, 'ids', ids))));
  if jsonb_array_length(prow) > 0 then perform rb_pd_ver(e); end if;
  return jsonb_build_object('n', n, 'skipped', skipped, 'skippedIds', skippedIds, 'direct', 1);
end $f$;


create or replace function rb_po_cancel(p_token text, p_args jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
declare e text := rb_me(p_token); ed boolean;
begin
  if e is null then raise exception 'RB_SESSION'; end if;
  select editor into ed from rb_session where token = p_token;
  if not coalesce(ed, false) then raise exception 'RB_SESSION 저장 권한 확인'; end if;
  return rb_po_cancel_do(e, coalesce(p_args, '[]'::jsonb));
end $f$;

revoke all on function rb_pd_ready(text) from public, anon, authenticated;
revoke all on function rb_pd_busy(text) from public, anon, authenticated;
revoke all on function rb_pd_find(jsonb, text, int, boolean) from public, anon, authenticated;
revoke all on function rb_pd_cell(jsonb, int, int) from public, anon, authenticated;
revoke all on function rb_pd_put(jsonb, int, int, text) from public, anon, authenticated;
revoke all on function rb_pd_ver(text) from public, anon, authenticated;
revoke all on function rb_pd_num(jsonb) from public, anon, authenticated;
revoke all on function rb_od_state_do(text, jsonb) from public, anon, authenticated;
revoke all on function rb_po_cancel_do(text, jsonb) from public, anon, authenticated;
revoke all on function rb_od_state(text, jsonb) from public;
revoke all on function rb_po_cancel(text, jsonb) from public;
grant execute on function rb_od_state(text, jsonb) to anon, authenticated;
grant execute on function rb_po_cancel(text, jsonb) to anon, authenticated;

-- 서버(서비스 키)만: 켜짐 · 열 위치 올리기 — 같은 잠금이라 진행 중인 직접 저장이 끝난 뒤 바뀐다(끄면 그 뒤 직접 저장은 없음)
create or replace function rb_pd_conf_put(p_conf jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
begin
  perform pg_advisory_xact_lock(hashtext('rb_tab_pd'));
  insert into rb_conf (k, v, at) values ('pdConf', p_conf, now()) on conflict (k) do update set v = excluded.v, at = excluded.at;
  return jsonb_build_object('ok', true, 'on', p_conf->>'on');
end $f$;
revoke all on function rb_pd_conf_put(jsonb) from public, anon, authenticated;
