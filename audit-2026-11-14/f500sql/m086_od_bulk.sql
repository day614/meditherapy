-- m086_od_bulk — 일괄 품의번호(apiBulkDoc) · 일괄 결재문서번호(apiBulkApprovalNo) · 일괄 발주일(apiBulkOrderDate) · 품목코드 넣기(apiSetCode, force)
--   를 Supabase 함수로 바로(진짜 결과). 규칙 = Keys.js apiBulkDoc0_ + markSubmitted_ · apiBulkApprovalNo0_(건마다 editOrder_) · Code.js apiBulkOrderDate0_ · Keys.js apiSetCode0_.
-- m085 도우미(rb_odx_*) · m081(rb_pd_*) · m083(rb_pg_*) 를 쓴다. 잠금 차례 진행 기록 → 발주 DB.
-- 뒤처리 'pj' '_pgPost' {x: 'bulkDoc' | 'bulkOrd' | 'setCode'} → 서버 odDirectPost_(이력 · 품의번호 대기열 rb.docq · 발주일 지킴 목록 · 단계 이력 · 품목 DB 등록).
-- 결재문서번호는 건마다 rb_od_save_do 를 부분 트랜잭션으로(규칙 오류는 그 건만 fails, RB_FALLBACK 은 통째로 서버 길).

create or replace function rb_od_bulk_do(e text, p_fn text, a jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
declare
  ms bigint := rb_pg_ms(); oc jsonb; pdc jsonb; pg jsonb; x jsonb; ex jsonb; id text; nm text; f jsonb; rw int; sc int; cdoc int; cord int; ccode int;
  rows int[] := '{}'; byr jsonb := '{}'; skipped jsonb := '[]'; skippedIds jsonb := '[]'; audits jsonb := '[]'; pdx jsonb := '[]'; cols jsonb;
  n int := 0; states int := 0; doc text; dnow text; snow text; day text; wrote jsonb := '[]'; S jsonb := '{}'; ord text[] := '{}'; g jsonb; st jsonb; c jsonb; d jsonb; r jsonb;
  checked int := 0; before text; k text; v2 boolean; slots jsonb; m text[]; stamp text; dval text; c0 text; ci int; SO constant text[] := array['계획', '상신', '승인', '발주'];
  fails jsonb := '[]'; failIds jsonb := '[]'; res jsonb; code text; bc text; nxt int; logs jsonb; t0 text; guard jsonb := '[]';
begin
  if jsonb_typeof(a) <> 'array' then raise exception 'RB_FALLBACK 인자 모양'; end if;
  if p_fn not in ('apiBulkDoc', 'apiBulkApprovalNo', 'apiBulkOrderDate', 'apiSetCode') then raise exception 'RB_FALLBACK % 는 서버 길', p_fn; end if;
  if p_fn <> 'apiSetCode' then
    if a->0 is not null and jsonb_typeof(a->0) not in ('array', 'null') then raise exception 'RB_FALLBACK 목록 모양'; end if;
    if jsonb_array_length(coalesce(case when jsonb_typeof(a->0) = 'array' then a->0 end, '[]')) > 400 then raise exception 'RB_FALLBACK 너무 많은 건'; end if;
  end if;

  -- ============ 결재문서번호: 건마다 발주 수정(editOrder_) ============
  if p_fn = 'apiBulkApprovalNo' then
    for x in select q from jsonb_array_elements(coalesce(case when jsonb_typeof(a->0) = 'array' then a->0 end, '[]')) q loop
      if jsonb_typeof(x) <> 'object' then if rb_pg_tru(x) then raise exception 'RB_FALLBACK 건 모양'; end if; continue; end if;
      if rb_odx_s(x->'approvalNo') is null then raise exception 'RB_FALLBACK 결재번호 모양'; end if;
      if rb_odx_s(x->'approvalNo') = '' then continue; end if;
      ex := case when jsonb_typeof(x->'expect') = 'object' then x->'expect' else '{}'::jsonb end;
      nm := case when rb_pg_tru(ex->'name') then coalesce(rb_pg_str(ex->'name'), '?') else coalesce(rb_pg_str(x->'statusRow'), '') end;
      if nm = '?' or (not rb_pg_tru(ex->'name') and x->'statusRow' is not null and jsonb_typeof(x->'statusRow') not in ('number', 'string', 'null')) then raise exception 'RB_FALLBACK 이름 모양'; end if;
      if not rb_pg_tru(ex->'name') and (x->'statusRow' is null or jsonb_typeof(x->'statusRow') = 'null') then nm := case when x->'statusRow' is null then 'undefined' else 'null' end; end if;
      begin
        perform rb_od_save_do(e, jsonb_build_array(coalesce(x->'statusRow', 'null'::jsonb), ex, jsonb_build_object('approvalNo', left(rb_odx_s(x->'approvalNo'), 80))));
        n := n + 1;
      exception when others then
        if SQLERRM like 'RB_FALLBACK%' or SQLERRM like 'RB_SESSION%' then raise; end if;
        fails := fails || to_jsonb(nm || ': ' || SQLERRM); failIds := failIds || to_jsonb(coalesce(rb_odx_s(ex->'id'), ''));
      end;
    end loop;
    return jsonb_build_object('n', n, 'fails', fails, 'failIds', failIds, 'direct', 1);
  end if;

  -- ============ 품목코드 넣기(force — 같은 코드 다른 이름 검사는 화면이 품목 목록으로 먼저) ============
  if p_fn = 'apiSetCode' then
    if rb_odx_s(a->2) is null or rb_odx_s(a->3) is null then raise exception 'RB_FALLBACK 값 모양'; end if;
    code := upper(left(rb_odx_s(a->2), 40));
    bc := left(regexp_replace(rb_odx_s(a->3), '\s', '', 'g'), 40);
    if bc <> '' and bc !~ '^[0-9A-Za-z-]+$' then raise exception '바코드는 숫자 · 영문으로만 넣어주세요.'; end if;
    if code = '' then raise exception '품목코드를 넣어주세요.'; end if;
    if code !~ '^[A-Z0-9_-]+$' then raise exception '품목코드는 영문 · 숫자로만 넣어주세요.'; end if;
    if not rb_pg_tru(a->4) then raise exception 'RB_FALLBACK 품목 DB 이름 검사(서버 길)'; end if;
    ex := case when jsonb_typeof(a->1) = 'object' then a->1 else '{}'::jsonb end;
    if rb_odx_s(ex->'id') is null or rb_odx_s(ex->'name') is null then raise exception 'RB_FALLBACK 확인값 모양'; end if;
    id := rb_odx_s(ex->'id');
    perform pg_advisory_xact_lock(hashtext('rb_tab_pd'));
    oc := rb_odx_ready('rb_od_bulk'); pdc := rb_pd_ready('rb_od_bulk');
    ccode := rb_odx_col(oc, 'code');
    if ccode < 0 then raise exception '[품목코드] 열을 찾을 수 없습니다.'; end if;
    perform rb_pd_busy(id);
    f := rb_pd_find(pdc, id, rb_odx_rownum(a->0), true);
    if f ? 'fb' then raise exception 'RB_FALLBACK %', f->>'fb'; end if;
    if f ? 'err' then raise exception '%', f->>'err'; end if;
    rw := (f->>'row')::int;
    sc := coalesce((oc->>'state')::int, -1);
    if sc >= 0 then
      t0 := rb_odx_cs(rb_odx_cell(oc, rw, sc));
      if t0 in ('종결', '취소') then raise exception '%된 건은 고칠 수 없습니다 — 먼저 %를 해 주세요.', t0, case when t0 = '종결' then '[종결 풀기]' else '[취소 풀기]' end; end if;
    end if;
    before := rb_odx_cs(rb_odx_cell(oc, rw, ccode));
    perform rb_odx_put(oc, rw, ccode, to_jsonb(code)); perform rb_odx_amt_fix(oc, rw);
    if before is distinct from code then insert into rb_tab_job(tab, job) values ('pdx', jsonb_build_object('k', 'pd', 'at', ms, 'who', e, 'rows', jsonb_build_array(jsonb_build_object('id', id, 'row', rw, 'cols', jsonb_build_array(ccode))))); end if;
    perform rb_pd_ver(e);
    insert into rb_tab_job(tab, job) values ('pj', jsonb_build_object('fn', '_pgPost', 'who', e, 'at', ms, 'args', jsonb_build_array(jsonb_build_object('x', 'setCode', 'id', id, 'row', rw, 'expect', ex,
      'audits', jsonb_build_array(jsonb_build_object('row', rw, 'col', ccode + 1, 'what', '품목코드', 'before', before, 'after', code, 'item', rb_odx_s(ex->'name'))),
      'item', jsonb_build_object('code', code, 'barcode', bc, 'name', rb_odx_cell(oc, rw, rb_odx_col(oc, 'name')), 'brand', rb_odx_cell(oc, rw, rb_odx_col(oc, 'brand')),
        'channel', rb_odx_cell(oc, rw, rb_odx_col(oc, 'channel')), 'vendor', rb_odx_cell(oc, rw, rb_odx_col(oc, 'vendor')), 'price', rb_odx_cell(oc, rw, rb_odx_col(oc, 'price'))), 'ap', true))));
    return jsonb_build_object('ok', true, 'before', before, 'code', code, 'direct', 1);
  end if;

  -- ============ 일괄 품의번호 · 일괄 발주일 ============
  if p_fn = 'apiBulkDoc' then
    if rb_odx_s(a->1) is null then raise exception 'RB_FALLBACK 품의번호 모양'; end if;
    doc := left(rb_odx_s(a->1), 60);
    if rb_odx_astral(doc) then raise exception 'RB_FALLBACK 품의번호 글자'; end if;
    if doc = '' then raise exception '품의번호(엑셀 품의서 번호, MTB2C-…)를 넣어주세요.'; end if;
    if strpos(doc, '메디테라피') > 0 then raise exception '결재문서번호(%)는 품의번호가 아닙니다. 엑셀 품의서의 품의번호(MTB2C-…)를 넣어주세요.', doc; end if;
    day := case when rb_odx_s(a->3) ~ '^\d{4}-\d{2}-\d{2}$' then rb_odx_s(a->3) else rb_pg_kst(ms, 'YYYY-MM-DD') end;
  end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(case when jsonb_typeof(a->0) = 'array' then a->0 end, '[]')) q where jsonb_typeof(q) = 'object' and rb_pd_num(q->'statusRow') >= 2) then
    return case when p_fn = 'apiBulkDoc' then jsonb_build_object('n', 0, 'skipped', '[]'::jsonb, 'direct', 1) else jsonb_build_object('n', 0, 'direct', 1) end;
  end if;
  if p_fn = 'apiBulkOrderDate' then
    m := regexp_match(coalesce(rb_odx_s(a->1), ''), '^(\d{4})-(\d{1,2})-(\d{1,2})$');
    if m is null then raise exception '발주일을 넣어주세요.'; end if;
    stamp := right(m[1], 2) || '/' || lpad(m[2]::int::text, 2, '0') || '/' || lpad(m[3]::int::text, 2, '0');
    dval := rb_odx_diso((make_date(m[1]::int, 1, 1) + make_interval(months => m[2]::int - 1) + (m[3]::int - 1) * interval '1 day')::date);
  end if;
  perform pg_advisory_xact_lock(hashtext('rb_tab_pg'));
  perform pg_advisory_xact_lock(hashtext('rb_tab_pd'));
  oc := rb_odx_ready('rb_od_bulk'); pdc := rb_pd_ready('rb_od_bulk');
  pg := rb_odx_pg_ready('po'); v2 := coalesce((pg->>'v2')::boolean, false);
  sc := coalesce((oc->>'state')::int, -1);
  cdoc := rb_odx_col(oc, 'doc'); cord := rb_odx_col(oc, 'ordered');
  if p_fn = 'apiBulkDoc' and cdoc < 0 then raise exception '[품의번호] 열을 찾을 수 없습니다.'; end if;
  if p_fn = 'apiBulkOrderDate' and cord < 0 then raise exception '[발주일] 열을 찾을 수 없습니다.'; end if;
  -- 행 찾기(findStatusRow_) — 같은 행은 처음 것만
  for x in select q from jsonb_array_elements(a->0) q loop
    if jsonb_typeof(x) <> 'object' or not (rb_pd_num(x->'statusRow') >= 2) then continue; end if;
    ex := case when p_fn = 'apiBulkDoc' then (case when jsonb_typeof(x->'expect') = 'object' then x->'expect' else null end) else x end;
    if ex is not null and (rb_odx_s(ex->'id') is null or rb_odx_s(ex->'doc') is null or rb_odx_s(ex->'name') is null) then raise exception 'RB_FALLBACK 확인값 모양'; end if;
    id := coalesce(rb_odx_s(ex->'id'), '');
    if strpos(id, '|') > 0 or (id = '' and coalesce(rb_odx_s(ex->'doc'), '') <> '') then raise exception 'RB_FALLBACK 예전 열쇠(품의번호 · 코드 · 차수)'; end if;
    f := case when id = '' then jsonb_build_object('err', 'x') else rb_pd_find(pdc, id, rb_odx_rownum(x->'statusRow'), false) end;
    if f ? 'fb' then raise exception 'RB_FALLBACK %', f->>'fb'; end if;
    if f ? 'err' then
      if p_fn = 'apiBulkDoc' then
        skipped := skipped || to_jsonb(coalesce(rb_odx_s(ex->'name'), '') || ' — 행을 찾지 못함, 새로고침 필요');
        skippedIds := skippedIds || to_jsonb(case when id <> '' then id else coalesce(rb_odx_s(x->'id'), '') end);
      else
        skipped := skipped || to_jsonb(coalesce(rb_pg_str(x->'statusRow'), (x->'statusRow')::text) || '행 (' || case when rb_pg_tru(x->'name') then coalesce(rb_pg_str(x->'name'), '') else '' end || ') — 행이 바뀜, 새로고침 필요');
      end if;
      continue;
    end if;
    if id <> '' then perform rb_pd_busy(id); end if;
    rw := (f->>'row')::int;
    if rw = any(rows) then continue; end if;
    rows := rows || rw; byr := byr || jsonb_build_object(rw::text, x);
  end loop;
  foreach rw in array rows loop
    x := byr->rw::text;
    if p_fn = 'apiBulkDoc' then
      ex := coalesce(case when jsonb_typeof(x->'expect') = 'object' then x->'expect' end, '{}'::jsonb);
      nm := coalesce(rb_odx_s(ex->'name'), ''); id := coalesce(rb_odx_s(ex->'id'), '');
      dnow := rb_odx_cs(rb_odx_cell(oc, rw, cdoc)); snow := case when sc >= 0 then rb_odx_cs(rb_odx_cell(oc, rw, sc)) else '' end;
      if sc >= 0 and snow in ('취소', '종결') then skipped := skipped || to_jsonb(nm || ' — ' || snow || '된 건'); skippedIds := skippedIds || to_jsonb(case when id <> '' then id else coalesce(rb_odx_s(x->'id'), '') end); continue; end if;
      if dnow <> '' and dnow <> doc and not rb_pg_tru(a->2) then skipped := skipped || to_jsonb(nm || ' — 이미 품의번호 ' || dnow); skippedIds := skippedIds || to_jsonb(case when id <> '' then id else coalesce(rb_odx_s(x->'id'), '') end); continue; end if;
      cols := '[]';
      if rb_odx_cell(oc, rw, cdoc) is distinct from to_jsonb(doc) then cols := cols || to_jsonb(cdoc); end if;
      perform rb_odx_put(oc, rw, cdoc, to_jsonb(doc));
      audits := audits || jsonb_build_object('row', rw, 'col', cdoc + 1, 'what', '품의번호(일괄)', 'before', dnow, 'after', doc, 'item', nm, 'id', id, 'doc', doc, 'code', coalesce(rb_odx_s(ex->'code'), ''));
      if sc >= 0 and snow = '계획' then
        perform rb_odx_put(oc, rw, sc, '"상신"'); cols := cols || to_jsonb(sc);
        audits := audits || jsonb_build_object('row', rw, 'col', sc + 1, 'what', '진행상태', 'before', '계획', 'after', '상신', 'item', nm, 'id', id, 'doc', coalesce(rb_odx_s(ex->'doc'), ''), 'code', coalesce(rb_odx_s(ex->'code'), ''));
        states := states + 1;
      end if;
      perform rb_odx_amt_fix(oc, rw);
      if jsonb_array_length(cols) > 0 then pdx := pdx || jsonb_build_object('id', id, 'row', rw, 'cols', cols); end if;
      n := n + 1;
      wrote := wrote || jsonb_build_object('id', id, 'meta', jsonb_build_object('doc', doc, 'name', nm, 'batch', coalesce(rb_odx_s(ex->'batch'), ''), 'code', coalesce(rb_odx_s(ex->'code'), '')));
    else
      id := coalesce(rb_odx_s(x->'id'), '');
      cols := jsonb_build_array(cord);
      before := null;
      audits := audits || jsonb_build_object('row', rw, 'col', cord + 1, 'what', '발주일', 'before', rb_odx_cell(oc, rw, cord), 'after', stamp, 'noItem', true, 'id', id, 'doc', coalesce(rb_odx_s(x->'doc'), ''), 'code', coalesce(rb_odx_s(x->'code'), ''));
      perform rb_odx_put(oc, rw, cord, to_jsonb(dval));
      if rb_pg_tru(x->'id') then
        if rb_pg_str(x->'id') is null then raise exception 'RB_FALLBACK 건ID 모양'; end if;
        if jsonb_typeof(x->'meta') not in ('object', 'null') and rb_pg_tru(x->'meta') then raise exception 'RB_FALLBACK 건 정보 모양'; end if;
        wrote := wrote || jsonb_build_object('id', rb_pg_str(x->'id'), 'meta', coalesce(case when jsonb_typeof(x->'meta') = 'object' then x->'meta' end, '{}'::jsonb));
        guard := guard || to_jsonb(rb_pg_str(x->'id'));
      end if;
      c0 := case when sc >= 0 then rb_odx_cs(rb_odx_cell(oc, rw, sc)) else '' end; ci := coalesce(array_position(SO, c0), 0) - 1;
      if sc >= 0 and not (c0 <> '' and ci < 0) and ci < 3 then
        perform rb_odx_put(oc, rw, sc, '"발주"'); cols := cols || to_jsonb(sc);
        audits := audits || jsonb_build_object('row', rw, 'col', sc + 1, 'what', '진행상태(자동)', 'before', c0, 'after', '발주', 'item', coalesce(rb_odx_s(x->'name'), ''), 'id', id, 'doc', coalesce(rb_odx_s(x->'doc'), ''), 'code', coalesce(rb_odx_s(x->'code'), ''));
      end if;
      perform rb_odx_amt_fix(oc, rw);
      pdx := pdx || jsonb_build_object('id', id, 'row', rw, 'cols', cols);
      n := n + 1;
    end if;
  end loop;
  -- 진행 기록: 품의번호 → markSubmitted_(상신일 · 상신 항목 체크 · __docAuto) / 발주일 → 발주일 항목 체크
  slots := coalesce(pg->'slots'->(case when p_fn = 'apiBulkDoc' then 'submitted' else 'ordered' end), '[]'::jsonb);
  for x in select q from jsonb_array_elements(wrote) q loop
    id := x->>'id';
    if id = '' then continue; end if;
    if not S ? id then
      perform rb_pg_busy('po', id);
      g := rb_odx_pg_get(pg->>'tab', id);
      if (g->>'isnew')::boolean then nxt := coalesce(nxt, (g->>'row')::int); g := jsonb_set(g, '{row}', to_jsonb(nxt)); nxt := nxt + 1; end if;
      S := S || jsonb_build_object(id, g || jsonb_build_object('before', g->'st', 'touched', false)); ord := ord || id;
    end if;
    st := S->id->'st'; c := coalesce(st->'checks', '{}'); d := coalesce(st->'dates', '{}');
    r := c;
    if p_fn = 'apiBulkDoc' then
      if not rb_pg_tru(d->'submitted') then d := d || jsonb_build_object('submitted', day); end if;
      for k in select s0->>'key' from jsonb_array_elements(slots) s0 loop
        if not rb_pg_tru(c->k) then c := rb_pg_ckset(c, k, true, true, v2); end if;
      end loop;
      if not rb_pg_tru(d->'__docAuto') then d := d || jsonb_build_object('__docAuto', day); end if;
      if c = r and coalesce(d->>'submitted', '') = coalesce((S->id->'st'->'dates')->>'submitted', '') then continue; end if;
    else
      for k in select s0->>'key' from jsonb_array_elements(slots) s0 loop
        if not rb_pg_tru(c->k) then c := rb_pg_ckset(c, k, true, true, v2); end if;
      end loop;
      if c = r then continue; end if;
    end if;
    r := rb_pg_stamp(c, d, pg->'full', rb_pg_kst(ms, 'YYYY-MM-DD HH24:MI:SS')); c := r->'c'; d := r->'d';
    st := jsonb_set(jsonb_set(st, '{checks}', c), '{dates}', d);
    S := jsonb_set(S, array[id], (S->id) || jsonb_build_object('st', st, 'meta', x->'meta', 'touched', true));
    checked := checked + 1;
  end loop;
  for id in select unnest(ord) loop
    if not (S->id->>'touched')::boolean then continue; end if;
    perform rb_odx_pg_put(pg->>'tab', (S->id->>'row')::int, S->id->'cx', id, S->id->'meta', S->id->'st', e, ms);
    insert into rb_tab_job(tab, job) values ('pgx', jsonb_build_object('mode', 'po', 'id', id, 'row', (S->id->>'row')::int, 'at', ms, 'who', e));
  end loop;
  if jsonb_array_length(pdx) > 0 then
    insert into rb_tab_job(tab, job) values ('pdx', jsonb_build_object('k', 'pd', 'at', ms, 'who', e, 'rows', pdx));
    perform rb_pd_ver(e);
  end if;
  insert into rb_tab_job(tab, job) values ('pj', jsonb_build_object('fn', '_pgPost', 'who', e, 'at', ms, 'args', jsonb_build_array(jsonb_build_object(
    'x', case when p_fn = 'apiBulkDoc' then 'bulkDoc' else 'bulkOrd' end, 'mode', 'po', 'sh', pg->>'sh', 'audits', audits, 'ap', n > 0, 'doc', doc, 'stamp', stamp, 'day', day,
    'wrote', wrote, 'guard', guard, 'res', jsonb_build_object('n', n, 'checked', checked),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', q, 'row', (S->q->>'row')::int, 'meta', S->q->'meta', 'touched', S->q->'touched', 'before', S->q->'before', 'after', S->q->'st')) from unnest(ord) q), '[]'::jsonb)))));
  if p_fn = 'apiBulkDoc' then return jsonb_build_object('n', n, 'states', states, 'skipped', skipped, 'skippedIds', skippedIds, 'checked', checked, 'direct', 1); end if;
  return jsonb_build_object('n', n, 'stamp', stamp, 'skipped', skipped, 'col', oc->>'ordLetter', 'checked', checked, 'direct', 1);
end $f$;

create or replace function rb_od_bulk(p_token text, p_fn text, p_args jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
declare e text := rb_me(p_token); ed boolean;
begin
  if e is null then raise exception 'RB_SESSION'; end if;
  select editor into ed from rb_session where token = p_token;
  if not coalesce(ed, false) then raise exception 'RB_SESSION 저장 권한 확인'; end if;
  return rb_od_bulk_do(e, coalesce(p_fn, ''), coalesce(p_args, '[]'::jsonb));
end $f$;
revoke all on function rb_od_bulk_do(text, text, jsonb) from public, anon, authenticated;
revoke all on function rb_od_bulk(text, text, jsonb) from public;
grant execute on function rb_od_bulk(text, text, jsonb) to anon, authenticated;
