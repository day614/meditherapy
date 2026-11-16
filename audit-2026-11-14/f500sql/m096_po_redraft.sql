-- m096_po_redraft — 기안 원복(apiPoRedraft = poCancel_(items, why || '단가 · 수량 변경 — 기안 다시', withOrdered=true)) Supabase 함수로 바로
-- 규칙 = m081 rb_po_cancel_do 와 같고 '발주'(업체에 낸 · 입고 전) 건도 계획으로. 뒷정리는 같은 '_pdPost' kind poCancel(rb.docq · 진행 기록 상신일/승인일 · 이력 · AP).
create or replace function rb_po_redraft_do(e text, a jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
declare
  why text := coalesce(nullif(rb_t(a->1), ''), '단가 · 수량 변경 — 기안 다시'); x jsonb; ex jsonb; nm text; xid text; id text; rw int; f jsonb; conf jsonb;
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
  conf := rb_pd_ready('rb_po_redraft');
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
    if not (st0 = any(array['', '계획', '상신', '승인', '발주'])) then
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
    if sc >= 0 and st0 in ('상신', '승인', '발주') then
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


create or replace function rb_po_redraft(p_token text, p_args jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
begin return rb_po_redraft_do(rb_po_me(p_token), coalesce(p_args, '[]'::jsonb)); end $f$;
revoke all on function rb_po_redraft_do(text, jsonb) from public, anon, authenticated;
revoke all on function rb_po_redraft(text, jsonb) from public;
grant execute on function rb_po_redraft(text, jsonb) to anon, authenticated;
