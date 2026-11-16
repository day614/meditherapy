-- m097_po_pend — 상신 대기(apiPoPendAdd · apiPoPendDrop) · 상신 완료(apiPoSubmit) 를 Supabase 함수로 바로
-- 상신 대기 목록의 원본을 스크립트 속성(rb:popend)에서 rb_conf 'poPend' {o:{품의번호:{at,by,bucket,type,base,rows}}, ver} 로 옮긴다
-- (서버 poPendRead_/poPendWrite_ 도 이것을 읽고 씀 — 쓰기는 rb_po_pend_put(판 번호 확인) · 처음 한 번 rb_po_pend_import).
-- 규칙 = Keys.js apiPoPendAdd · apiPoPendDrop · apiPoSubmit(apiBulkDoc0_ · podbBulkApprovalNo_). 잠금 rb_tab_pd(발주 DB 직접 저장과 같음).
-- 상신 완료의 진행 기록(상신일 · 체크 — markSubmitted_) · 품의번호 대기열(rb.docq) · 이력은 뒷정리 'pj' '_poPost' kind submit(실제 서버 함수 · 할 일 차례).

create or replace function rb_po_today() returns text language sql stable as $f$ select to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD') $f$;
-- 90일 지난 것 빼기(poPendWrite_)
create or replace function rb_po_pend_cut(o jsonb) returns jsonb language sql stable as $f$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(coalesce(o, '{}'::jsonb)) t(k, v)
   where rb_t(v->'at') >= to_char((now() - interval '90 days') at time zone 'Asia/Seoul', 'YYYY-MM-DD')
$f$;
-- poPendList_ 모양(품의번호 순)
create or replace function rb_po_pend_list(o jsonb) returns jsonb language sql stable as $f$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('no', k, 'at', v->'at', 'by', v->'by', 'bucket', v->'bucket', 'type', v->'type', 'base', v->'base')) || jsonb_build_object('rows', coalesce(v->'rows', '[]'::jsonb)) order by k collate "C"), '[]'::jsonb)
    from jsonb_each(coalesce(o, '{}'::jsonb)) t(k, v)
$f$;
create or replace function rb_po_pend_o() returns jsonb language plpgsql security definer set search_path = public as $f$
declare c jsonb;
begin
  select v into c from rb_conf where k = 'poPend';
  if c is null or jsonb_typeof(c->'o') <> 'object' then raise exception 'RB_FALLBACK 상신 대기 목록을 아직 옮기지 않음'; end if;
  return c->'o';
end $f$;
create or replace function rb_po_pend_w(o jsonb) returns void language plpgsql security definer set search_path = public as $f$
begin
  update rb_conf set v = jsonb_build_object('o', rb_po_pend_cut(o), 'ver', coalesce((v->>'ver')::int, 0) + 1), at = now() where k = 'poPend';
end $f$;
-- 서버(서비스 키): 읽기 · 쓰기(판 번호가 같을 때만) · 처음 옮기기(없을 때만)
create or replace function rb_po_pend_get() returns jsonb language sql security definer set search_path = public stable as $f$
  select v from rb_conf where k = 'poPend'
$f$;
create or replace function rb_po_pend_put(p_o jsonb, p_ver int) returns jsonb language plpgsql security definer set search_path = public as $f$
declare cur int;
begin
  perform pg_advisory_xact_lock(hashtext('rb_tab_pd'));
  select coalesce((v->>'ver')::int, 0) into cur from rb_conf where k = 'poPend';
  if cur is null then raise exception 'RB_FALLBACK 상신 대기 목록 없음'; end if;
  if cur <> coalesce(p_ver, -1) then raise exception 'RB_ROW_TAKEN 상신 대기를 그사이 다른 사람이 바꿨습니다 — 잠시 뒤 다시 해 주세요.'; end if;
  update rb_conf set v = jsonb_build_object('o', coalesce(p_o, '{}'::jsonb), 'ver', cur + 1), at = now() where k = 'poPend';
  return jsonb_build_object('ver', cur + 1);
end $f$;
create or replace function rb_po_pend_import(p_o jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
begin
  perform pg_advisory_xact_lock(hashtext('rb_tab_pd'));
  insert into rb_conf (k, v, at) values ('poPend', jsonb_build_object('o', coalesce(p_o, '{}'::jsonb), 'ver', 1), now()) on conflict (k) do nothing;
  return (select v from rb_conf where k = 'poPend');
end $f$;

-- ---------- 상신 대기에서 버리기 — p_args = [no] ----------
create or replace function rb_po_pend_drop_do(e text, a jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
declare o jsonb;
begin
  if jsonb_typeof(a) <> 'array' or jsonb_typeof(a->0) in ('object', 'array') then raise exception 'RB_FALLBACK 인자 모양'; end if;
  perform pg_advisory_xact_lock(hashtext('rb_tab_pd'));
  perform rb_po_conf('pp');
  o := rb_po_pend_o() - rb_t(a->0);
  perform rb_po_pend_w(o);
  return rb_po_pend_list(rb_po_pend_cut(o));
end $f$;
create or replace function rb_po_pend_drop(p_token text, p_args jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
begin return rb_po_pend_drop_do(rb_po_me(p_token), coalesce(p_args, '[]'::jsonb)); end $f$;

-- 진행 기록 사본에서 BOM 확인이 끝났는지(bomCheckDone_ — 체크 · 'cy:' 'N'). 건ID 마지막 줄(readProgress_) · 작은 글자 ID 도
create or replace function rb_po_bom_done(pg jsonb, id text, bkey text) returns boolean language plpgsql security definer set search_path = public as $f$
declare c jsonb; ck jsonb;
begin
  select cells into c from sheet_rows where tab = pg->>'tab' and "row" > 1 and rb_t(cells->0) = id order by "row" desc limit 1;
  if c is null then select cells into c from sheet_rows where tab = pg->>'tab' and "row" > 1 and rb_t(cells->0) = lower(id) order by "row" desc limit 1; end if;
  if c is null then return false; end if;
  begin ck := (rb_t(c->6))::jsonb; exception when others then ck := '{}'::jsonb; end;
  if jsonb_typeof(ck) <> 'object' then ck := '{}'::jsonb; end if;
  return rb_po_truthy(ck->bkey) or rb_t(ck->('cy:' || bkey)) = 'N';
end $f$;

-- ---------- 상신 대기 올리기 — p_args = [groups] ----------
create or replace function rb_po_pend_add_do(e text, a jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
declare
  pc jsonb; po jsonb; pg jsonb; o jsonb; grp jsonb; g jsonb; r jsonb; x jsonb; dc int; idc int; hr int; bkey text;
  allIds text[] := '{}'; names jsonb := '{}'; codes jsonb := '{}'; miss text[] := '{}'; id text; ex jsonb;
  docOf jsonb := '{}'; doneNo jsonb := '{}'; nos jsonb := '[]'; no text; no0 text; pre text; rows_ jsonb; ids text[]; again text; overl text[]; kx text; n1 int; mk text; t boolean;
begin
  if jsonb_typeof(a) <> 'array' then raise exception 'RB_FALLBACK 인자 모양'; end if;
  grp := case when jsonb_typeof(a->0) = 'array' then a->0 else '[]'::jsonb end;
  perform pg_advisory_xact_lock(hashtext('rb_tab_pd'));
  pc := rb_pd_ready('rb_po_pend_add');
  po := rb_po_conf('pp');
  o := rb_po_pend_o();
  -- 발주 DB 에 이미 쓰인 품의번호(다른 건)
  dc := coalesce((pc->>'doc')::int, -1); idc := (pc->>'idc')::int; hr := coalesce((pc->>'hr')::int, 1);
  if dc >= 0 then
    select coalesce(jsonb_object_agg(d, ids0), '{}'::jsonb) into docOf from (
      select rb_t(cells->dc) d, jsonb_object_agg(rb_t(cells->idc), 1) ids0 from sheet_rows where tab = pc->>'tab' and "row" > hr and rb_t(cells->dc) <> '' group by 1) q;
  end if;
  -- BOM 확인 안 된 건(bomCheckMissing_)
  for g in select * from jsonb_array_elements(grp) loop
    for r in select * from jsonb_array_elements(case when jsonb_typeof(g->'rows') = 'array' then g->'rows' else '[]'::jsonb end) loop
      id := rb_t(r->'id'); if id = '' then continue; end if;
      ex := case when jsonb_typeof(r->'expect') = 'object' then r->'expect' else '{}'::jsonb end;
      allIds := allIds || id;
      names := names || jsonb_build_object(id, coalesce(nullif(rb_t(ex->'name'), ''), nullif(rb_t(ex->'code'), ''), id));
      codes := codes || jsonb_build_object(id, rb_t(ex->'code'));
    end loop;
  end loop;
  bkey := coalesce(po->>'bomKey', '');
  if bkey <> '' and coalesce(array_length(allIds, 1), 0) > 0 then
    select v->'po' into pg from rb_conf where k = 'pgConf';
    if pg is null or coalesce(pg->>'on', '') <> '1' then raise exception 'RB_FALLBACK 진행 기록 사본 꺼짐(BOM 확인 검사)'; end if;
    foreach id in array allIds loop
      if split_part(id, '|', 2) ~* '^[A-Z]Z0000$' and strpos(id, '|') > 0 then continue; end if;
      if upper(coalesce(codes->>id, '')) ~ '^[A-Z]Z0000$' then continue; end if;
      if exists (select 1 from rb_conf c where c.k = 'pgJ' and jsonb_typeof(c.v->'ids') = 'object' and (c.v->'ids') ? ('po:' || id)) then raise exception 'RB_FALLBACK 앞선 저장 반영 전(진행 장부 %)', id; end if;
      if not rb_po_bom_done(pg, id, bkey) then miss := miss || id; end if;
    end loop;
    if coalesce(array_length(miss, 1), 0) > 0 then
      raise exception '%', 'BOM 확인이 안 된 건이 있어 품의를 만들 수 없습니다 — ' || (select string_agg(names->>m, ', ' order by i) from unnest(miss[1:8]) with ordinality u(m, i))
        || case when array_length(miss, 1) > 8 then ' 외 ' || (array_length(miss, 1) - 8) || '건' else '' end || '. 발주 상세 1단계 [BOM 보기]에서 [변경 없음] 또는 고쳐서 [저장]해 주세요.';
    end if;
  end if;
  for g in select * from jsonb_array_elements(grp) loop
    no := left(rb_t(g->'no'), 60);
    if jsonb_typeof(g) <> 'object' or no = '' then nos := nos || to_jsonb(''::text); continue; end if;
    no0 := no;
    rows_ := (select coalesce(jsonb_agg(jsonb_build_object('id', rb_t(y->'id'),
        'statusRow', case when jsonb_typeof(y->'statusRow') = 'number' then (y->'statusRow') when rb_t(y->'statusRow') ~ '^\s*-?\d+(\.\d+)?\s*$' then to_jsonb(rb_t(y->'statusRow')::numeric) else to_jsonb(0) end,
        'expect', jsonb_build_object('id', coalesce(nullif(rb_t(y->'expect'->'id'), ''), rb_t(y->'id')), 'doc', rb_t(y->'expect'->'doc'), 'code', rb_t(y->'expect'->'code'),
          'batch', rb_t(y->'expect'->'batch'), 'name', left(rb_t(y->'expect'->'name'), 60))) order by o2), '[]'::jsonb)
      from jsonb_array_elements(case when jsonb_typeof(g->'rows') = 'array' then g->'rows' else '[]'::jsonb end) with ordinality t(y, o2) where o2 <= 60);
    ids := (select coalesce(array_agg(y->>'id' order by o2), '{}') from jsonb_array_elements(rows_) with ordinality t(y, o2));
    pre := regexp_replace(no, '\d+$', '');
    -- 같은 건들로 이미 상신 대기 → 그 번호(같은 품의서를 다시 받음)
    select min(kk collate "C") into again from jsonb_each(o) t(kk, vv)
      where left(kk, length(pre)) = pre and not (doneNo ? kk)
        and (select count(*) from jsonb_array_elements(coalesce(vv->'rows', '[]'::jsonb))) = coalesce(array_length(ids, 1), 0)
        and not exists (select 1 from jsonb_array_elements(coalesce(vv->'rows', '[]'::jsonb)) z where not ((z->>'id') = any(ids)));
    select coalesce(array_agg(kk order by kk collate "C"), '{}') into overl from jsonb_each(o) t(kk, vv)
      where left(kk, length(pre)) = pre and not (doneNo ? kk) and exists (select 1 from jsonb_array_elements(coalesce(vv->'rows', '[]'::jsonb)) z where (z->>'id') = any(ids));
    if again is not null then no := again;
    elsif coalesce(array_length(overl, 1), 0) > 0 and not (docOf ? overl[1] and exists (select 1 from jsonb_object_keys(docOf->overl[1]) d0 where not (d0 = any(ids)))) then no := overl[1];
    else
      -- taken: 이번에 쓴 번호 · 다른 건들의 상신 대기 · 발주 DB 에 다른 건으로 쓰인 번호
      t := (doneNo ? no) or (o ? no and not ((select count(*) from jsonb_array_elements(coalesce(o->no->'rows', '[]'::jsonb))) = coalesce(array_length(ids, 1), 0)
             and not exists (select 1 from jsonb_array_elements(coalesce(o->no->'rows', '[]'::jsonb)) z where not ((z->>'id') = any(ids)))))
           or (docOf ? no and exists (select 1 from jsonb_object_keys(docOf->no) d0 where not (d0 = any(ids))));
      if t then
        n1 := 1;
        loop
          mk := pre || lpad(n1::text, greatest(2, length(n1::text)), '0');
          t := (doneNo ? mk) or (o ? mk and not ((select count(*) from jsonb_array_elements(coalesce(o->mk->'rows', '[]'::jsonb))) = coalesce(array_length(ids, 1), 0)
                 and not exists (select 1 from jsonb_array_elements(coalesce(o->mk->'rows', '[]'::jsonb)) z where not ((z->>'id') = any(ids)))))
               or (docOf ? mk and exists (select 1 from jsonb_object_keys(docOf->mk) d0 where not (d0 = any(ids))));
          exit when not t;
          n1 := n1 + 1;
        end loop;
        no := mk;
      end if;
    end if;
    foreach kx in array overl loop if kx <> no then o := o - kx; end if; end loop;
    doneNo := doneNo || jsonb_build_object(no, 1);
    nos := nos || to_jsonb(no);
    o := o || jsonb_build_object(no, jsonb_build_object('at', rb_po_today(), 'by', e, 'bucket', rb_t(g->'bucket'), 'type', rb_t(g->'type'), 'base', rb_t(g->'base'), 'rows', rows_));
  end loop;
  perform rb_po_pend_w(o);
  return jsonb_build_object('list', rb_po_pend_list(rb_po_pend_cut(o)), 'nos', nos, 'direct', 1);
end $f$;
create or replace function rb_po_pend_add(p_token text, p_args jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
begin return rb_po_pend_add_do(rb_po_me(p_token), coalesce(p_args, '[]'::jsonb)); end $f$;

-- ---------- 상신 완료 — p_args = [no, approvalNo, day] ----------
create or replace function rb_po_submit_do(e text, a jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
declare
  pc jsonb; po jsonb; pg jsonb; o jsonb; g jsonb; x jsonb; ex jsonb; f jsonb; no text := rb_t(a->0); ap text := left(rb_t(a->1), 80); day text := rb_t(a->2);
  dc int; sc int; apc int; rw int; done_rows int[] := '{}'; byRow jsonb := '{}'; nm text; xid text; before text; st text;
  n int := 0; states int := 0; checked int := 0; apn int := 0; skipped jsonb := '[]'; skippedIds jsonb := '[]'; fails jsonb := '[]'; bad jsonb := '{}'; badOrd jsonb := '[]';
  audits jsonb := '[]'; wrote jsonb := '[]'; prow jsonb := '{}'; left_ jsonb; ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint; ck jsonb; dt jsonb; c jsonb; sk jsonb;
  apb text; apOk boolean;
begin
  if jsonb_typeof(a) <> 'array' or exists (select 1 from jsonb_array_elements(a) z where jsonb_typeof(z) in ('object', 'array')) then raise exception 'RB_FALLBACK 인자 모양'; end if;
  if ap = '' then raise exception '결재문서번호(아마란스 문서번호)를 넣어 주세요.'; end if;
  if strpos(ap, '메디테라피') = 0 and ap !~ '\d{4}-\d+' then raise exception '결재문서번호는 아마란스 문서번호(예: 주식회사 메디테라피-2026-1944)입니다.'; end if;
  perform pg_advisory_xact_lock(hashtext('rb_tab_pd'));
  pc := rb_pd_ready('rb_po_submit');
  po := rb_po_conf('pp');
  o := rb_po_pend_o();
  g := o->no;
  if g is null then raise exception '% 는 상신 대기에 없습니다(이미 상신 완료했거나 버렸습니다). 새로고침해 주세요.', no; end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(g->'rows', '[]'::jsonb)) z where rb_num(z->'statusRow') >= 2) then raise exception '이 품의에 발주 DB 건이 없습니다.'; end if;
  -- apiBulkDoc0_(list, no, overwrite=false, day)
  if left(no, 60) = '' then raise exception '품의번호(엑셀 품의서 번호, MTB2C-…)를 넣어주세요.'; end if;
  if strpos(left(no, 60), '메디테라피') > 0 then raise exception '결재문서번호(%)는 품의번호가 아닙니다. 엑셀 품의서의 품의번호(MTB2C-…)를 넣어주세요.', left(no, 60); end if;
  dc := coalesce((pc->>'doc')::int, -1); sc := coalesce((pc->>'state')::int, -1); apc := coalesce((pc->>'apNo')::int, -1);
  if dc < 0 then raise exception '[품의번호] 열을 찾을 수 없습니다.'; end if;
  if apc < 0 then raise exception 'RB_FALLBACK 결재문서번호 열 없음(발주 수정 길)'; end if;
  -- 앞선 저장(진행 장부 상태 올리기 · 할 일) — 서버 길은 drainJournalIfState_ 로 먼저 옮겼다
  for x in select z from jsonb_array_elements(g->'rows') z where rb_num(z->'statusRow') >= 2 loop
    perform rb_pd_busy(rb_t(x->'expect'->'id'));
    if exists (select 1 from rb_conf cj where cj.k = 'pgJ' and jsonb_typeof(cj.v->'ids') = 'object' and (cj.v->'ids') ? ('po:' || rb_t(x->'expect'->'id'))) then raise exception 'RB_FALLBACK 앞선 저장 반영 전(진행 장부)'; end if;
  end loop;
  for x in select z from jsonb_array_elements(g->'rows') z where rb_num(z->'statusRow') >= 2 loop
    ex := coalesce(x->'expect', '{}'::jsonb); nm := rb_t(ex->'name'); xid := rb_t(ex->'id');
    f := rb_pd_find(pc, rb_t(ex->'id'), floor(rb_num(x->'statusRow'))::int, false);
    if f ? 'fb' then raise exception 'RB_FALLBACK %', f->>'fb'; end if;
    if f ? 'err' then skipped := skipped || to_jsonb(nm || ' — 행을 찾지 못함, 새로고침 필요'); skippedIds := skippedIds || to_jsonb(xid); continue; end if;
    rw := (f->>'row')::int;
    if rw = any(done_rows) then continue; end if;
    done_rows := done_rows || rw;
    before := rb_pd_cell(pc, rw, dc); st := case when sc >= 0 then rb_pd_cell(pc, rw, sc) else '' end;
    if sc >= 0 and st in ('취소', '종결') then skipped := skipped || to_jsonb(nm || ' — ' || st || '된 건'); skippedIds := skippedIds || to_jsonb(xid); continue; end if;
    if before <> '' and before <> left(no, 60) then skipped := skipped || to_jsonb(nm || ' — 이미 품의번호 ' || before); skippedIds := skippedIds || to_jsonb(xid); continue; end if;
    perform rb_pd_put(pc, rw, dc, left(no, 60));
    prow := prow || jsonb_build_object(rw::text, jsonb_build_object('id', xid, 'cols', coalesce(prow->rw::text->'cols', '[]'::jsonb) || to_jsonb(dc)));
    audits := audits || jsonb_build_object('row', rw, 'col', dc + 1, 'what', '품의번호(일괄)', 'before', before, 'after', left(no, 60), 'item', nm, 'id', xid, 'doc', left(no, 60), 'code', rb_t(ex->'code'));
    if sc >= 0 and st = '계획' then
      perform rb_pd_put(pc, rw, sc, '상신');
      prow := jsonb_set(prow, array[rw::text, 'cols'], (prow->rw::text->'cols') || to_jsonb(sc));
      audits := audits || jsonb_build_object('row', rw, 'col', sc + 1, 'what', '진행상태', 'before', '계획', 'after', '상신', 'item', nm, 'id', xid, 'doc', left(no, 60), 'code', rb_t(ex->'code'));
      states := states + 1;
    end if;
    n := n + 1;
    wrote := wrote || jsonb_build_object('id', xid, 'meta', jsonb_build_object('doc', left(no, 60), 'name', nm, 'batch', rb_t(ex->'batch'), 'code', rb_t(ex->'code')));
  end loop;
  -- checked(markSubmitted_ 이 고칠 건 수 — 상신일이 없거나 상신 항목 체크가 빠진 건) — 진행 기록은 뒷정리가 실제 함수로
  select v->'po' into pg from rb_conf where k = 'pgConf';
  for x in select * from jsonb_array_elements(wrote) loop
    if rb_t(x->'id') = '' then continue; end if;
    select cells into c from sheet_rows where tab = coalesce(pg->>'tab', '_실행판_진행') and "row" > 1 and rb_t(cells->0) = rb_t(x->'id') order by "row" desc limit 1;
    begin ck := (rb_t(c->6))::jsonb; exception when others then ck := '{}'::jsonb; end;
    begin dt := (rb_t(c->10))::jsonb; exception when others then dt := '{}'::jsonb; end;
    if jsonb_typeof(ck) is distinct from 'object' then ck := '{}'::jsonb; end if;
    if jsonb_typeof(dt) is distinct from 'object' then dt := '{}'::jsonb; end if;
    if not rb_po_truthy(dt->'submitted') or exists (select 1 from jsonb_array_elements(coalesce(pg->'slots'->'submitted', '[]'::jsonb)) s where not rb_po_truthy(ck->(s->>'key'))) then checked := checked + 1; end if;
  end loop;
  for x in select * from jsonb_array_elements(skippedIds) loop if rb_t(x) <> '' then bad := bad || jsonb_build_object(rb_t(x), 1); badOrd := badOrd || x; end if; end loop;
  -- 결재문서번호(podbBulkApprovalNo_) — 품의번호를 못 넣은 건 빼고
  for x in select z from jsonb_array_elements(g->'rows') z where rb_num(z->'statusRow') >= 2 loop
    ex := coalesce(x->'expect', '{}'::jsonb); nm := rb_t(ex->'name'); xid := rb_t(ex->'id');
    if bad ? xid then continue; end if;
    f := rb_pd_find(pc, xid, floor(rb_num(x->'statusRow'))::int, false);
    if f ? 'err' then fails := fails || to_jsonb(coalesce(nullif(nm, ''), rb_t(x->'statusRow')) || ': ' || (f->>'err')); if xid <> '' and not (bad ? xid) then badOrd := badOrd || to_jsonb(xid); end if; bad := bad || jsonb_build_object(xid, 1); continue; end if;
    rw := (f->>'row')::int;
    st := case when sc >= 0 then rb_pd_cell(pc, rw, sc) else '' end;
    if st in ('종결', '취소') then
      fails := fails || to_jsonb(coalesce(nullif(nm, ''), rb_t(x->'statusRow')) || ': ' || st || '된 건은 고칠 수 없습니다 — 먼저 ' || case when st = '종결' then '[종결 풀기]' else '[취소 풀기]' end || '를 해 주세요.');
      if xid <> '' and not (bad ? xid) then badOrd := badOrd || to_jsonb(xid); end if; bad := bad || jsonb_build_object(xid, 1); continue;
    end if;
    apb := rb_pd_cell(pc, rw, apc);
    perform rb_pd_put(pc, rw, apc, ap);
    prow := prow || jsonb_build_object(rw::text, jsonb_build_object('id', xid, 'cols', coalesce(prow->rw::text->'cols', '[]'::jsonb) || to_jsonb(apc)));
    audits := audits || jsonb_build_object('row', rw, 'col', apc + 1, 'what', '결재문서번호', 'before', apb, 'after', '''' || ap, 'item', nm, 'id', xid, 'doc', left(no, 60), 'code', rb_t(ex->'code'));
    apn := apn + 1;
  end loop;
  -- 실패한 건만 상신 대기에 남긴다
  left_ := (select coalesce(jsonb_agg(z order by i), '[]'::jsonb) from jsonb_array_elements(coalesce(g->'rows', '[]'::jsonb)) with ordinality t(z, i) where bad ? rb_t(z->'id'));
  if jsonb_array_length(left_) > 0 then o := jsonb_set(o, array[no, 'rows'], left_); else o := o - no; end if;
  perform rb_po_pend_w(o);
  if prow <> '{}'::jsonb then
    insert into rb_tab_job(tab, job) values ('pdx', jsonb_build_object('k', 'pd', 'at', ms, 'who', e,
      'rows', (select jsonb_agg(jsonb_build_object('id', v->'id', 'row', k::int, 'cols', v->'cols') order by k::int) from jsonb_each(prow) t(k, v))));
    perform rb_pd_ver(e);
  end if;
  insert into rb_tab_job(tab, job) values ('pj', jsonb_build_object('fn', '_poPost', 'who', e, 'at', ms, 'args', jsonb_build_array(jsonb_build_object(
    'kind', 'submit', 'no', left(no, 60), 'audits', audits, 'docq', wrote, 'day', case when day ~ '^\d{4}-\d{2}-\d{2}$' then day else rb_po_today() end))));
  return jsonb_build_object('n', n, 'states', states, 'checked', checked, 'ap', apn, 'skipped', skipped || fails, 'skippedIds', badOrd, 'pend', rb_po_pend_list(rb_po_pend_cut(o)), 'sb', 1);
end $f$;
create or replace function rb_po_submit(p_token text, p_args jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
begin return rb_po_submit_do(rb_po_me(p_token), coalesce(p_args, '[]'::jsonb)); end $f$;

revoke all on function rb_po_today() from public, anon, authenticated;
revoke all on function rb_po_pend_cut(jsonb) from public, anon, authenticated;
revoke all on function rb_po_pend_list(jsonb) from public, anon, authenticated;
revoke all on function rb_po_pend_o() from public, anon, authenticated;
revoke all on function rb_po_pend_w(jsonb) from public, anon, authenticated;
revoke all on function rb_po_pend_get() from public, anon, authenticated;
revoke all on function rb_po_pend_put(jsonb, int) from public, anon, authenticated;
revoke all on function rb_po_pend_import(jsonb) from public, anon, authenticated;
revoke all on function rb_po_bom_done(jsonb, text, text) from public, anon, authenticated;
revoke all on function rb_po_pend_drop_do(text, jsonb) from public, anon, authenticated;
revoke all on function rb_po_pend_add_do(text, jsonb) from public, anon, authenticated;
revoke all on function rb_po_submit_do(text, jsonb) from public, anon, authenticated;
revoke all on function rb_po_pend_drop(text, jsonb) from public;
revoke all on function rb_po_pend_add(text, jsonb) from public;
revoke all on function rb_po_submit(text, jsonb) from public;
grant execute on function rb_po_pend_drop(text, jsonb) to anon, authenticated;
grant execute on function rb_po_pend_add(text, jsonb) to anon, authenticated;
grant execute on function rb_po_submit(text, jsonb) to anon, authenticated;
