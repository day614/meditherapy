-- m085_od_direct — 발주 수정(apiEditOrder) · 통화(apiSetCur) · 표시 단추(apiSetFlag) · 여러 건 숨기기/담당자/상신일·승인일/단계 처리
--   (apiBulkHide · apiBulkOwner · apiBulkDate · apiBulkStep) 를 Supabase 함수로 바로(할 일 대기열 아님 · 진짜 결과).
-- 규칙 = Keys.js editOrder_ · Code.js apiSetCur0_/dbSetCur_ · apiSetFlag · apiBulkHide · apiBulkOwner0_/writeOwnerCells_ · apiBulkDate0_/bumpStates_ · apiBulkStep.
-- 발주 DB 사본 = sheet_rows '_실행판_발주'(m081 rb_pd_* 도우미) · 진행 기록 사본 = '_실행판_진행' | '_실행판_샘플진행'(m083 rb_pg_* 도우미).
-- 열 위치 · 단계 정의(제목 · 표시 단추 · 날짜 칸) · 켜짐 = rb_conf 'odConf'(서버 odConfPublish_ → rb_odx_conf_put, 세 잠금).
-- 잠금 순서는 늘 진행 기록(rb_tab_pg | rb_tab_sp) → 발주 DB(rb_tab_pd) (m083 과 같음 — 거꾸로 잡는 곳 없음).
-- 뒤처리: 'pdx'(발주 DB 칸 → 시트) · 'pgx'(진행 기록 줄 → 시트) · 'pj' '_pgPost' {x:…}(이력 · 결과 대조 — 서버 odDirectPost_) ·
--         수량 · 단가를 바꾼 발주 수정은 'pj' '_odLines'(지급 줄 따라 고치기 · 이력 — 그 건의 다음 직접 저장은 이것이 끝날 때까지 RB_FALLBACK).
-- RB_FALLBACK(아무것도 안 바뀜 → 화면은 예전 길): 꺼짐 · 머리글 다름 · 앞선 저장(rb_pd_busy · rb_pg_busy) · 옛 열쇠(ID 없음) · 흔치 않은 값 모양.

-- ---------- 도우미 ----------
-- JS str_(v): 참거짓 · null → '' · 글자 → trim · 숫자 → String(n). 표기가 JS 와 다를 수 있는 숫자 · 객체는 null(부르는 쪽이 RB_FALLBACK)
create or replace function rb_odx_s(v jsonb) returns text language sql immutable as $f$
  select case when v is null or jsonb_typeof(v) in ('null', 'boolean') then ''
              when jsonb_typeof(v) = 'string' then rb_pg_trim(v #>> '{}')
              when jsonb_typeof(v) = 'number' and (v #>> '{}') ~ '^-?(0|[1-9][0-9]{0,14})(\.[0-9]{0,11}[1-9])?$' then v #>> '{}'
              else null end $f$;

-- 4바이트 글자(JS slice 는 UTF-16 길이) — 흔치 않으니 서버 길
create or replace function rb_odx_astral(t text) returns boolean language sql immutable as $f$
  select coalesce(t, '') ~ '[\U00010000-\U0010FFFF]' $f$;

-- JS Number(s) 가 평범한 10진수로 읽는 글자인지(앞뒤 빈칸 · 부호 · 소수점) — 아니면 null. 지수 · 16진 · Infinity 같은 것은 'x'
create or replace function rb_odx_jsnum(s text) returns text language sql immutable as $f$
  select case when s ~ '^\s*[+-]?(\d+\.?\d*|\.\d+)\s*$' then 'n'
              when s ~ '^\s*$' then 'z'
              when s ~* '^\s*[+-]?((\d+\.?\d*|\.\d+)e[+-]?\d+|0x[0-9a-f]+|0b[01]+|0o[0-7]+|infinity)\s*$' then 'x'
              else null end $f$;

-- num_(v) — 글자/숫자 → 숫자(못 읽으면 0). 지수 · 16진 표기는 null(서버 길)
create or replace function rb_odx_num(v jsonb) returns numeric language plpgsql immutable as $f$
declare s text; k text;
begin
  if v is null or jsonb_typeof(v) in ('null', 'boolean') then return 0; end if;
  if jsonb_typeof(v) = 'number' then return (v #>> '{}')::numeric; end if;
  if jsonb_typeof(v) <> 'string' then return null; end if;
  s := regexp_replace(v #>> '{}', '[, ]', '', 'g');
  if s = '' then return 0; end if;
  k := rb_odx_jsnum(s);
  if k = 'n' then return btrim(s)::numeric; end if;
  if k = 'z' then return 0; end if;
  if k = 'x' then return null; end if;
  return 0;
end $f$;

-- 칸 값(jsonb) 그대로 · 쓰기(글자 · 숫자 · null)
create or replace function rb_odx_cell(conf jsonb, p_row int, p_col int) returns jsonb language sql stable security definer set search_path = public as $f$
  select case when p_col is null or p_col < 0 then 'null'::jsonb else coalesce((select cells->p_col from sheet_rows where tab = conf->>'tab' and "row" = p_row), 'null'::jsonb) end $f$;
create or replace function rb_odx_put(conf jsonb, p_row int, p_col int, p_val jsonb) returns void language plpgsql security definer set search_path = public as $f$
begin
  update sheet_rows set cells = jsonb_set(rb_pad(cells, p_col + 1), array[p_col::text], case when p_val is null or p_val = '""'::jsonb then 'null'::jsonb else p_val end), synced_at = now()
   where tab = conf->>'tab' and "row" = p_row;
end $f$;

-- 사본 칸(jsonb) → 시트 값 str_(): ISO 날짜 글자는 날짜(그대로 둠 — 비교는 같은 사본 값끼리)
create or replace function rb_odx_cs(v jsonb) returns text language sql immutable as $f$
  select case when v is null or jsonb_typeof(v) = 'null' then '' when jsonb_typeof(v) = 'string' then rb_pg_trim(v #>> '{}') when jsonb_typeof(v) = 'boolean' then ''
              else coalesce(rb_odx_s(v), v::text) end $f$;

-- toDate_(v) — 사본 칸. ISO(시트 날짜) → 서울 날짜 · 일련번호 · 여러 글자 모양. 못 읽으면 null
create or replace function rb_odx_todate(v jsonb) returns date language plpgsql immutable as $f$
declare s text; m text[]; y int; mo int; dd int;
begin
  if v is null or jsonb_typeof(v) = 'null' then return null; end if;
  if jsonb_typeof(v) = 'number' then
    if (v #>> '{}')::numeric > 20000 and (v #>> '{}')::numeric < 80000 then return date '1899-12-30' + floor((v #>> '{}')::numeric)::int; end if;
    s := v #>> '{}';
  elsif jsonb_typeof(v) = 'string' then s := v #>> '{}';
  else return null; end if;
  if s ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$' then return (s::timestamptz at time zone 'Asia/Seoul')::date; end if;
  s := rb_pg_trim(s);
  if s ~ '^\d{4}\.?\s+\d{1,2}\.?\s+\d{1,2}\.?$' then s := regexp_replace(s, '\.?\s+', '.', 'g'); end if;
  s := regexp_replace(regexp_replace(regexp_replace(s, '\s+', '', 'g'), '[년월]', '.', 'g'), '일$', '');
  m := regexp_match(s, '^(\d{4}|\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})\.?$');
  if m is null then return null; end if;
  y := m[1]::int; if y < 100 then y := y + 2000; end if;
  mo := m[2]::int; dd := m[3]::int;
  if mo < 1 or mo > 12 or dd < 1 or dd > 31 then return null; end if;
  return make_date(y, mo, 1) + (dd - 1);      -- new Date(y, mo-1, dd) 처럼 넘치면 다음 달
end $f$;

-- 서울 자정 Date → 사본 ISO 글자
create or replace function rb_odx_diso(d date) returns text language sql immutable as $f$
  select to_char((d::timestamp at time zone 'Asia/Seoul') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS".000Z"') $f$;

-- sheetDateTok_('yyyy-m-d', ref)
create or replace function rb_odx_tok(t text, ref date) returns text language plpgsql immutable as $f$
declare m text[]; y int; mo int; dd int; md text; gy int;
begin
  t := rb_pg_trim(t);
  if t = '' then return t; end if;
  m := regexp_match(t, '^(\d{4}|\d{2})[./-](\d{1,2})[./-](\d{1,2})$');
  if m is null then raise exception 'RB_FALLBACK 날짜 모양'; end if;
  y := m[1]::int; if y < 100 then y := y + 2000; end if;
  mo := m[2]::int; dd := m[3]::int;
  md := lpad(mo::text, 2, '0') || '/' || lpad(dd::text, 2, '0');
  if ref is null then return right(y::text, 2) || '/' || md; end if;
  gy := case when mo < extract(month from ref)::int then extract(year from ref)::int + 1 else extract(year from ref)::int end;
  return case when gy = y then md else right(y::text, 2) || '/' || md end;
end $f$;

-- JS (Number) 곱 — 시트 수식 대신 사본에 값으로(tvVirtualCommit_ 발주금액). 숫자로 못 읽으면 ''(null)
create or replace function rb_odx_amt(q jsonb, pr jsonb) returns jsonb language plpgsql immutable as $f$
declare a float8; b float8; k text;
begin
  if q is null or pr is null or jsonb_typeof(q) = 'null' or jsonb_typeof(pr) = 'null' or q = '""'::jsonb or pr = '""'::jsonb then return 'null'::jsonb; end if;
  if jsonb_typeof(q) = 'number' then a := (q #>> '{}')::float8;
  elsif jsonb_typeof(q) = 'string' then k := rb_odx_jsnum(q #>> '{}'); if k = 'n' then a := btrim(q #>> '{}')::float8; elsif k = 'z' then a := 0; elsif k = 'x' then raise exception 'RB_FALLBACK 수량 칸 모양'; else return 'null'::jsonb; end if;
  else return 'null'::jsonb; end if;
  if jsonb_typeof(pr) = 'number' then b := (pr #>> '{}')::float8;
  elsif jsonb_typeof(pr) = 'string' then k := rb_odx_jsnum(pr #>> '{}'); if k = 'n' then b := btrim(pr #>> '{}')::float8; elsif k = 'z' then b := 0; elsif k = 'x' then raise exception 'RB_FALLBACK 단가 칸 모양'; else return 'null'::jsonb; end if;
  else return 'null'::jsonb; end if;
  return to_jsonb(a * b);
end $f$;

-- 고친 행의 발주금액을 사본 값으로 다시(tvVirtualCommit_ 은 고친 행마다 — 수량 · 단가를 안 바꿔도)
create or replace function rb_odx_amt_fix(oc jsonb, p_row int) returns void language plpgsql security definer set search_path = public as $f$
declare ca int := coalesce((oc->'col'->>'amt')::int, -1); cq int := coalesce((oc->'col'->>'qty')::int, -1); cp int := coalesce((oc->'col'->>'price')::int, -1);
begin
  if ca >= 0 and cq >= 0 and cp >= 0 and coalesce((oc->>'amtCalc')::boolean, false) then
    perform rb_odx_put(oc, p_row, ca, rb_odx_amt(rb_odx_cell(oc, p_row, cq), rb_odx_cell(oc, p_row, cp)));
  end if;
end $f$;

-- (Number).toLocaleString() — 정수 · 소수 3자리까지
create or replace function rb_odx_loc(n numeric) returns text language sql immutable as $f$
  select rtrim(rtrim(to_char(round(n, 3), 'FM999,999,999,999,990.999'), '0'), '.') $f$;

-- 켜짐 · 머리글 확인(발주 DB) — pdConf(m081) + odConf
create or replace function rb_odx_ready(p_fn text) returns jsonb language plpgsql security definer set search_path = public as $f$
declare pdc jsonb; oc jsonb; hc jsonb; ck text; want text;
begin
  pdc := rb_pd_ready(p_fn);
  select c.v into oc from rb_conf c where c.k = 'odConf';
  if oc is null or coalesce(oc->>'on', '') <> '1' then raise exception 'RB_FALLBACK 발주 직접 저장 꺼짐(%)', coalesce(oc->>'why', '설정 없음'); end if;
  if coalesce(oc->>'tab', '') <> coalesce(pdc->>'tab', '') or coalesce((oc->>'hr')::int, 1) <> coalesce((pdc->>'hr')::int, 1) or coalesce((oc->>'idc')::int, -9) <> coalesce((pdc->>'idc')::int, -8) then
    raise exception 'RB_FALLBACK 발주 직접 설정이 진행상태 설정과 다름';
  end if;
  select cells into hc from sheet_rows where tab = oc->>'tab' and "row" = coalesce((oc->>'hr')::int, 1);
  for ck, want in select * from jsonb_each_text(coalesce(oc->'names', '{}'::jsonb)) loop
    if regexp_replace(rb_t(hc->(ck::int)), '\s', '', 'g') <> regexp_replace(want, '\s', '', 'g') then
      raise exception 'RB_FALLBACK 발주 DB 머리글이 다름(% 열)', ck::int + 1;
    end if;
  end loop;
  return oc || jsonb_build_object('state', pdc->'state');
end $f$;

-- 열 위치(없으면 -1)
create or replace function rb_odx_col(oc jsonb, k text) returns int language sql immutable as $f$
  select coalesce((oc->'col'->>k)::int, -1) $f$;

-- ---------- 진행 기록 줄 도우미 ----------
-- 켜짐 · 머리글 · 그 모드 conf(pgConf + odConf 단계) — 잠금은 부르는 쪽이 이미 쥔다
create or replace function rb_odx_pg_ready(m text) returns jsonb language plpgsql security definer set search_path = public as $f$
declare HEAD constant text[] := array['건ID', '품의번호', '품목명', '발주차수', '브랜드', '담당자', '진행JSON', '메모JSON', '최종수정', '최종수정자', '날짜JSON'];
  pg jsonb; oc jsonb; hc jsonb; i int; om jsonb;
begin
  select c.v->m into pg from rb_conf c where c.k = 'pgConf';
  if pg is null or coalesce(pg->>'on', '') <> '1' then raise exception 'RB_FALLBACK 진행 기록 직접 저장 꺼짐(%)', coalesce(pg->>'why', '설정 없음'); end if;
  select c.v into oc from rb_conf c where c.k = 'odConf';
  om := oc->'steps'->m;
  if oc is null or coalesce(oc->>'on', '') <> '1' or om is null then raise exception 'RB_FALLBACK 발주 직접 저장 꺼짐(%)', coalesce(oc->>'why', '설정 없음'); end if;
  if coalesce(om->>'sh', '') <> coalesce(pg->>'sh', '-') then raise exception 'RB_FALLBACK 단계 정의가 바뀌는 중'; end if;
  if exists (select 1 from jsonb_array_elements(pg->'steps') s0, jsonb_array_elements(case when jsonb_typeof(s0->'items') = 'array' then s0->'items' else '[]'::jsonb end) i0 where jsonb_typeof(i0) <> 'object') then
    raise exception 'RB_FALLBACK 단계 항목 모양';
  end if;
  select r0.cells into hc from sheet_rows r0 where r0.tab = pg->>'tab' and r0."row" = 1;
  for i in 1 .. 11 loop
    if rb_t(hc->(i - 1)) <> HEAD[i] then raise exception 'RB_FALLBACK 진행 기록 머리글이 다름(% 열)', i; end if;
  end loop;
  return pg || jsonb_build_object('full', om->'steps', 'byKey', coalesce(om->'byKey', '{}'::jsonb), 'reqKey', coalesce(om->'reqKey', '{}'::jsonb), 'mode', m);
end $f$;

-- 그 건 줄(마지막 줄) — { row, cx, st, isnew }. new 면 row = 맨 아래 다음(같은 실행에서 이미 새 줄을 만든 건은 부르는 쪽이 기억)
create or replace function rb_odx_pg_get(p_tab text, p_id text) returns jsonb language plpgsql security definer set search_path = public as $f$
declare rw int; cx jsonb;
begin
  select r0."row", r0.cells into rw, cx from sheet_rows r0 where r0.tab = p_tab and r0."row" > 1 and r0.cells->>0 = p_id order by r0."row" desc limit 1 for update;
  if rw is null then
    select coalesce(max(r0."row"), 1) + 1 into rw from sheet_rows r0 where r0.tab = p_tab;
    return jsonb_build_object('row', rw, 'cx', '[]'::jsonb, 'isnew', true, 'st', jsonb_build_object('checks', '{}'::jsonb, 'notes', '{}'::jsonb, 'dates', '{}'::jsonb, 'ownerSet', ''));
  end if;
  if rb_pg_tru(cx->5) and jsonb_typeof(cx->5) <> 'string' and rb_pg_str(cx->5) is null then raise exception 'RB_FALLBACK 담당자 칸 모양'; end if;
  return jsonb_build_object('row', rw, 'cx', cx, 'isnew', false, 'st', jsonb_build_object('checks', rb_pg_json(cx->6), 'notes', rb_pg_json(cx->7), 'dates', rb_pg_json(cx->10),
    'ownerSet', case when rb_pg_tru(cx->5) then rb_pg_trim(rb_pg_str(cx->5)) else '' end));
end $f$;

-- progRowValues_(id, meta, st, who, at) 를 사본 줄로
create or replace function rb_odx_pg_put(p_tab text, rw int, cx jsonb, p_id text, meta jsonb, st jsonb, e text, ms bigint) returns void language plpgsql security definer set search_path = public as $f$
begin
  if meta is not null and jsonb_typeof(meta) not in ('object', 'null') then raise exception 'RB_FALLBACK 건 정보 모양'; end if;
  cx := rb_pad(coalesce(cx, '[]'::jsonb), greatest(11, jsonb_array_length(coalesce(cx, '[]'::jsonb))));
  cx := jsonb_set(cx, '{0}', to_jsonb(p_id));
  cx := jsonb_set(cx, '{1}', rb_pg_mcell(meta->'doc'));
  cx := jsonb_set(cx, '{2}', rb_pg_mcell(meta->'name'));
  cx := jsonb_set(cx, '{3}', rb_pg_mcell(meta->'batch'));
  cx := jsonb_set(cx, '{4}', rb_pg_mcell(meta->'brand'));
  cx := jsonb_set(cx, '{5}', case when coalesce(st->>'ownerSet', '') = '' then 'null'::jsonb else to_jsonb(st->>'ownerSet') end);
  cx := jsonb_set(cx, '{6}', to_jsonb(coalesce(st->'checks', '{}'::jsonb)::text));
  cx := jsonb_set(cx, '{7}', to_jsonb(coalesce(st->'notes', '{}'::jsonb)::text));
  cx := jsonb_set(cx, '{8}', to_jsonb(rb_pg_iso(ms)));
  cx := jsonb_set(cx, '{9}', to_jsonb(e));
  cx := jsonb_set(cx, '{10}', to_jsonb(coalesce(st->'dates', '{}'::jsonb)::text));
  insert into sheet_rows(tab, "row", cells, synced_at) values (p_tab, rw, cx, now())
    on conflict (tab, "row") do update set cells = excluded.cells, synced_at = excluded.synced_at;
end $f$;

-- 행 번호(Number(x) || 0)
create or replace function rb_odx_rownum(v jsonb) returns int language sql immutable as $f$
  select case when v is null then 0
              when jsonb_typeof(v) = 'number' then case when (v #>> '{}')::numeric >= 0 and (v #>> '{}')::numeric < 1e7 then floor((v #>> '{}')::numeric)::int else 0 end
              when jsonb_typeof(v) = 'string' and btrim(v #>> '{}') ~ '^\d{1,7}(\.\d+)?$' then floor(btrim(v #>> '{}')::numeric)::int
              else 0 end $f$;

-- ============================================================
-- 발주 수정 — p_args = [statusRow, expect, patch](apiEditOrder 인자 그대로)
-- ============================================================
create or replace function rb_od_save_do(e text, a jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
declare
  ex jsonb; p jsonb; k text; v jsonb; tv text; ms bigint := rb_pg_ms();
  id text; nm text; rw int; f jsonb; pdc jsonb; oc jsonb; sc int; st0 text;
  c_name int; c_code int; c_batch int; c_cat int; c_brand int; c_channel int; c_vendor int; c_memo int; c_due int; c_owner int; c_ap int;
  c_qty int; c_price int; c_inq int; c_rem int; c_doc int; c_ord int; c_team int; c_reqo int; c_useby int; c_link int; c_amt int;
  qpCh boolean; reason text; lists jsonb; alias jsonb; bad text[] := '{}'; chk jsonb := '{}'; cb jsonb; lbl jsonb := '{"cat":"구분","brand":"브랜드","channel":"채널","team":"발주요청팀"}';
  ref date; audits jsonb := '[]'; qp jsonb := '[]'; cols jsonb := '[]'; nv jsonb; aft jsonb; before jsonb; wrote boolean := false;
  oldQty numeric; oldPrice numeric; newQty numeric; newPrice numeric; inQty numeric; vcode jsonb; vname jsonb; vvendor jsonb; docv text;
  lines jsonb := null; d date; ownerOn boolean := false; owner text; pg jsonb; g jsonb; pst jsonb; prow int; out jsonb;
  REQ constant text[] := array['name', 'batch', 'cat', 'brand', 'channel', 'vendor', 'qty', 'price', 'owner', 'due'];
begin
  if jsonb_typeof(a) <> 'array' then raise exception 'RB_FALLBACK 인자 모양'; end if;
  if a->1 is not null and jsonb_typeof(a->1) not in ('object', 'null') then raise exception 'RB_FALLBACK 확인값 모양'; end if;
  if a->2 is not null and jsonb_typeof(a->2) not in ('object', 'null') then raise exception 'RB_FALLBACK 바꿀 값 모양'; end if;
  ex := case when jsonb_typeof(a->1) = 'object' then a->1 else '{}'::jsonb end;
  p := case when jsonb_typeof(a->2) = 'object' then a->2 else '{}'::jsonb end;
  for k, v in select * from jsonb_each(p) loop
    if jsonb_typeof(v) in ('object', 'array') then raise exception 'RB_FALLBACK % 값 모양', k; end if;
    if rb_odx_s(v) is null or rb_odx_astral(rb_odx_s(v)) then raise exception 'RB_FALLBACK % 값 글자', k; end if;
  end loop;
  -- ① 그 자리 검사(잠금 전 — editOrder_ 와 같은 차례 · 문구)
  if (p ? 'due' and rb_odx_s(p->'due') <> '' and left(rb_odx_s(p->'due'), 100) !~ '^\d{4}-\d{1,2}-\d{1,2}$')
     or (p ? 'useBy' and rb_odx_s(p->'useBy') <> '' and left(rb_odx_s(p->'useBy'), 100) !~ '^\d{4}-\d{1,2}-\d{1,2}$') then
    raise exception '날짜는 달력에서 골라주세요.';
  end if;
  foreach k in array array['qty', 'price', 'pre', 'bal'] loop
    if p ? k and left(rb_odx_s(p->k), 100) <> '' then
      tv := replace(left(rb_odx_s(p->k), 100), ',', '');
      if rb_odx_jsnum(tv) is null then raise exception '수량 · 단가 · 선금 · 잔금은 숫자로 넣어주세요.'; end if;
      if rb_odx_jsnum(tv) = 'x' then raise exception 'RB_FALLBACK 숫자 모양(%)', k; end if;
    end if;
  end loop;
  qpCh := p ? 'qty' or p ? 'price';
  reason := left(rb_odx_s(p->'reason'), 300);
  if qpCh and reason = '' then raise exception '수량 · 단가를 바꾼 사유를 넣어주세요.'; end if;
  if rb_odx_s(ex->'id') is null or rb_odx_s(ex->'name') is null then raise exception 'RB_FALLBACK 확인값 모양'; end if;
  id := rb_odx_s(ex->'id'); nm := rb_odx_s(ex->'name');

  -- ② 잠금 · 켜짐 · 앞선 저장
  ownerOn := p ? 'owner';
  if ownerOn then
    perform pg_advisory_xact_lock(hashtext('rb_tab_pg'));
  end if;
  perform pg_advisory_xact_lock(hashtext('rb_tab_pd'));
  oc := rb_odx_ready('rb_od_save');
  pdc := rb_pd_ready('rb_od_save');
  perform rb_pd_busy(id);
  rw := rb_odx_rownum(a->0);
  f := rb_pd_find(pdc, id, rw, true);
  if f ? 'fb' then raise exception 'RB_FALLBACK %', f->>'fb'; end if;
  if f ? 'err' then raise exception '%', f->>'err'; end if;
  rw := (f->>'row')::int;
  sc := coalesce((oc->>'state')::int, -1);
  if sc >= 0 then
    st0 := rb_odx_cs(rb_odx_cell(oc, rw, sc));
    if st0 in ('종결', '취소') then raise exception '%된 건은 고칠 수 없습니다 — 먼저 %를 해 주세요.', st0, case when st0 = '종결' then '[종결 풀기]' else '[취소 풀기]' end; end if;
  end if;
  c_name := rb_odx_col(oc, 'name'); c_code := rb_odx_col(oc, 'code'); c_batch := rb_odx_col(oc, 'batch'); c_cat := rb_odx_col(oc, 'cat');
  c_brand := rb_odx_col(oc, 'brand'); c_channel := rb_odx_col(oc, 'channel'); c_vendor := rb_odx_col(oc, 'vendor'); c_memo := rb_odx_col(oc, 'memo');
  c_due := rb_odx_col(oc, 'due'); c_owner := rb_odx_col(oc, 'owner'); c_ap := rb_odx_col(oc, 'apNo'); c_qty := rb_odx_col(oc, 'qty');
  c_price := rb_odx_col(oc, 'price'); c_inq := rb_odx_col(oc, 'inQty'); c_rem := rb_odx_col(oc, 'remain'); c_doc := rb_odx_col(oc, 'doc');
  c_ord := rb_odx_col(oc, 'ordered'); c_team := rb_odx_col(oc, 'team'); c_reqo := rb_odx_col(oc, 'reqOwner'); c_useby := rb_odx_col(oc, 'useBy');
  c_link := rb_odx_col(oc, 'link'); c_amt := rb_odx_col(oc, 'amt');
  if p ? 'approvalNo' and c_ap < 0 then raise exception 'RB_FALLBACK 결재문서번호 열 없음(처음 만드는 저장)'; end if;
  if (p ? 'team' or p ? 'reqOwner' or p ? 'useBy' or p ? 'link') and c_team < 0 then raise exception 'RB_FALLBACK 부가정보 탭(옛 양식)'; end if;
  if ownerOn and c_owner >= 0 then
    pg := rb_odx_pg_ready('po');
    perform rb_pg_busy('po', id);
  end if;
  -- 값이 있던 필수 칸은 비울 수 없다
  foreach k in array REQ loop
    if p ? k and rb_odx_s(p->k) = '' and rb_odx_cs(rb_odx_cell(oc, rw, rb_odx_col(oc, k))) <> '' then
      raise exception '필수 칸은 비울 수 없습니다(%).', k;
    end if;
  end loop;
  -- 고정값 목록(바뀐 값만) — checkChoices_
  foreach k in array array['cat', 'brand', 'channel', 'team'] loop
    if p ? k and left(rb_odx_s(p->k), 100) <> '' and left(rb_odx_s(p->k), 100) <> rb_odx_cs(rb_odx_cell(oc, rw, rb_odx_col(oc, k))) then
      chk := chk || jsonb_build_object(k, left(rb_odx_s(p->k), 100));
    end if;
  end loop;
  select rc.v into alias from rb_conf rc where rc.k = 'brandAlias';
  alias := coalesce(alias, '{}'::jsonb);
  if chk <> '{}'::jsonb then
    select rc.v into lists from rb_conf rc where rc.k = 'odLists';
    if lists is null then raise exception 'RB_FALLBACK 목록 없음'; end if;
    if chk ? 'brand' and alias ? (chk->>'brand') then chk := jsonb_set(chk, '{brand}', alias->(chk->>'brand')); end if;
    foreach k in array array['cat', 'brand', 'channel', 'team'] loop
      if chk ? k and chk->>k <> '' and not (coalesce(lists->k, '[]'::jsonb) ? (chk->>k)) then bad := bad || ((lbl->>k) || ' "' || (chk->>k) || '"'); end if;
    end loop;
    if coalesce(chk->>'brand', '') <> '' and coalesce(chk->>'channel', '') <> '' then
      cb := lists->'chByBrand'->(chk->>'brand');
      if jsonb_typeof(cb) = 'array' and not (cb ? (chk->>'channel')) then
        bad := bad || ('채널 "' || (chk->>'channel') || '"(' || (chk->>'brand') || ' 채널은 ' || (select string_agg(x, ', ' order by o) from jsonb_array_elements_text(cb) with ordinality z(x, o)) || ')');
      end if;
    end if;
    if array_length(bad, 1) > 0 then raise exception '% 은(는) 목록에 없는 값입니다. 드롭다운에서 골라 주세요(목록은 관리자 화면에서 바꿉니다).', array_to_string(bad, ' · '); end if;
  end if;
  oldQty := rb_odx_num(rb_odx_cell(oc, rw, c_qty)); oldPrice := rb_odx_num(rb_odx_cell(oc, rw, c_price)); inQty := rb_odx_num(rb_odx_cell(oc, rw, c_inq));
  if oldQty is null or oldPrice is null or inQty is null then raise exception 'RB_FALLBACK 숫자 칸 모양'; end if;
  if p ? 'qty' and c_inq >= 0 and rb_odx_num(to_jsonb(left(rb_odx_s(p->'qty'), 100))) <> oldQty and rb_odx_num(to_jsonb(left(rb_odx_s(p->'qty'), 100))) < inQty then
    raise exception '이미 입고된 수량(%)보다 적게 줄일 수 없습니다.', rb_odx_loc(inQty);
  end if;
  ref := rb_odx_todate(rb_odx_cell(oc, rw, c_ord));
  docv := rb_odx_cs(rb_odx_cell(oc, rw, c_doc));

  -- ③ 칸 쓰기(put — editOrder_ 와 같은 차례 · 같은 칸이 없으면 건너뜀). 이력 after = 시트에 쓴 값(글자 앞 ' · 날짜 {d})
  vcode := rb_odx_cell(oc, rw, c_code); vname := rb_odx_cell(oc, rw, c_name); vvendor := rb_odx_cell(oc, rw, c_vendor);
  for k in select unnest(array['name', 'code', 'batch', 'cat', 'brand', 'channel', 'vendor', 'memo', 'due', 'owner', 'approvalNo', 'qty', 'price']) loop
    if not (p ? k) then continue; end if;
    rw := rw;
    declare cc int := case k when 'name' then c_name when 'code' then c_code when 'batch' then c_batch when 'cat' then c_cat when 'brand' then c_brand
                              when 'channel' then c_channel when 'vendor' then c_vendor when 'memo' then c_memo when 'due' then c_due when 'owner' then c_owner
                              when 'approvalNo' then c_ap when 'qty' then c_qty else c_price end;
            what text := case k when 'name' then '품목명' when 'code' then '품목코드' when 'batch' then '발주차수' when 'cat' then '구분' when 'brand' then '브랜드'
                              when 'channel' then '채널' when 'vendor' then '업체명' when 'memo' then '비고' when 'due' then '입고목표' when 'owner' then '구매 담당'
                              when 'approvalNo' then '결재문서번호' when 'qty' then '발주수량' else '단가' end;
            t0 text;
    begin
      if cc < 0 then continue; end if;
      t0 := rb_odx_s(p->k);
      if k = 'name' then nv := to_jsonb(left(t0, 200)); aft := nv;
      elsif k = 'code' then t0 := left(t0, 100); nv := case when t0 = '' then '""' else to_jsonb(upper(t0)) end; aft := case when t0 = '' then '""' else to_jsonb('''' || upper(t0)) end;
      elsif k = 'batch' then nv := to_jsonb(left(t0, 20)); aft := nv;
      elsif k = 'cat' then nv := to_jsonb(left(t0, 30)); aft := nv;
      elsif k = 'brand' then t0 := left(t0, 100); nv := case when alias ? t0 then alias->t0 else to_jsonb(t0) end; aft := nv;
      elsif k in ('channel', 'vendor') then nv := to_jsonb(left(t0, 100)); aft := nv;
      elsif k = 'memo' then t0 := left(t0, 500); nv := to_jsonb(t0); aft := case when t0 = '' then '""' else to_jsonb('''' || t0) end;
      elsif k = 'due' then t0 := left(t0, 100); nv := to_jsonb(case when t0 = '' then '' else rb_odx_tok(t0, ref) end); aft := nv;
      elsif k = 'owner' then owner := left(t0, 40); nv := to_jsonb(owner); aft := nv;
      elsif k = 'approvalNo' then t0 := left(t0, 100); nv := to_jsonb(t0); aft := case when t0 = '' then '""' else to_jsonb('''' || t0) end;
      elsif k = 'qty' then nv := to_jsonb(rb_odx_num(to_jsonb(left(t0, 100)))); if nv is null or nv = 'null'::jsonb then raise exception 'RB_FALLBACK 수량 모양'; end if; aft := nv;
      else t0 := left(t0, 100); nv := case when t0 = '' then '""' else to_jsonb(rb_odx_num(to_jsonb(t0))) end; if nv is null or nv = 'null'::jsonb then raise exception 'RB_FALLBACK 단가 모양'; end if; aft := nv;
      end if;
      before := rb_odx_cell(oc, rw, cc);
      perform rb_odx_put(oc, rw, cc, nv);
      wrote := true;
      if before is distinct from (case when nv = '""'::jsonb then 'null'::jsonb else nv end) and not (cols @> jsonb_build_array(cc)) then cols := cols || to_jsonb(cc); end if;
      audits := audits || jsonb_build_object('row', rw, 'col', cc + 1, 'what', what, 'before', before, 'after', aft, 'item', nm);
      if k = 'code' then vcode := aft; elsif k = 'name' then vname := aft; elsif k = 'vendor' then vvendor := aft; end if;
    end;
  end loop;
  newQty := rb_odx_num(rb_odx_cell(oc, rw, c_qty)); newPrice := rb_odx_num(rb_odx_cell(oc, rw, c_price));
  if qpCh then
    if c_rem >= 0 then
      before := rb_odx_cell(oc, rw, c_rem);
      perform rb_odx_put(oc, rw, c_rem, to_jsonb(greatest(0, newQty - inQty)));
      wrote := true;
      if before is distinct from to_jsonb(greatest(0, newQty - inQty)) and not (cols @> jsonb_build_array(c_rem)) then cols := cols || to_jsonb(c_rem); end if;
    end if;
    if p ? 'qty' then qp := qp || jsonb_build_object('kind', '수량단가', 'id', id, 'doc', docv, 'code', rb_odx_cs(vcode), 'name', rb_odx_cs(vname), 'item', '발주수량', 'before', oldQty, 'after', newQty, 'reason', reason, 'where', (oc->>'tab') || ' ' || rw || '행'); end if;
    if p ? 'price' then qp := qp || jsonb_build_object('kind', '수량단가', 'id', id, 'doc', docv, 'code', rb_odx_cs(vcode), 'name', rb_odx_cs(vname), 'item', '단가', 'before', oldPrice, 'after', newPrice, 'reason', reason, 'where', (oc->>'tab') || ' ' || rw || '행'); end if;
    -- 지급 줄 따라 고치기(서버 _odLines) — editOrder_ 와 같은 조건 · 같은 인자
    if (p ? 'price' and id <> '' and newPrice > 0 and newPrice <> oldPrice) or (p ? 'qty' and id <> '' and newQty > 0 and newQty <> oldQty) then
      lines := jsonb_build_object('id', id, 'row', rw, 'reason', reason,
        'meta', jsonb_build_object('id', id, 'doc', docv, 'code', rb_odx_cs(vcode), 'name', rb_odx_cs(vname)),
        'price', case when p ? 'price' and newPrice > 0 and newPrice <> oldPrice then jsonb_build_object('vendor', rb_odx_cs(vvendor), 'oldPrice', oldPrice, 'newPrice', newPrice, 'oldQty', oldQty, 'newQty', newQty) end,
        'qty', case when p ? 'qty' and newQty > 0 and newQty <> oldQty then jsonb_build_object('oldQty', oldQty, 'newQty', newQty) end);
    end if;
  end if;
  -- 부가 칸(발주 DB 같은 행 — 머리글 차례 2 · 3 · 4 · 12)
  for k in select unnest(array['team', 'reqOwner', 'useBy', 'link']) loop
    if not (p ? k) then continue; end if;
    declare cc int := case k when 'team' then c_team when 'reqOwner' then c_reqo when 'useBy' then c_useby else c_link end;
            what text := case k when 'team' then '발주요청팀' when 'reqOwner' then '요청팀담당자' when 'useBy' then '소진완료목표일' else '발주요청링크' end;
            t0 text := rb_odx_s(p->k);
    begin
      if k = 'team' then nv := to_jsonb(left(t0, 100)); aft := nv;
      elsif k = 'reqOwner' then nv := to_jsonb(left(t0, 40)); aft := nv;
      elsif k = 'link' then nv := to_jsonb(left(t0, 500)); aft := nv;
      else
        t0 := left(t0, 100);
        d := case when t0 = '' then null else rb_odx_todate(to_jsonb(t0)) end;
        nv := case when d is null then '""' else to_jsonb(rb_odx_diso(d)) end;
        aft := case when d is null then '""' else jsonb_build_object('d', rb_odx_diso(d)) end;
      end if;
      if cc < 0 then continue; end if;
      before := rb_odx_cell(oc, rw, cc);
      perform rb_odx_put(oc, rw, cc, nv);
      wrote := true;
      if before is distinct from (case when nv = '""'::jsonb then 'null'::jsonb else nv end) and not (cols @> jsonb_build_array(cc)) then cols := cols || to_jsonb(cc); end if;
      audits := audits || jsonb_build_object('row', rw, 'col', cc + 1, 'what', what, 'before', before, 'after', aft, 'item', nm);
    end;
  end loop;
  -- 발주금액(시트는 수식 — 사본은 값으로 · tvVirtualCommit_)
  if wrote then perform rb_odx_amt_fix(oc, rw); end if;

  -- ④ 구매 담당 → 진행 기록 담당자(editProgress_ · 메타 = 확인값)
  if ownerOn and c_owner >= 0 and id <> '' then
    g := rb_odx_pg_get(pg->>'tab', id);
    pst := g->'st'; pst := jsonb_set(pst, '{ownerSet}', to_jsonb(coalesce(owner, '')));
    prow := (g->>'row')::int;
    perform rb_odx_pg_put(pg->>'tab', prow, g->'cx', id, ex, pst, e, ms);
    insert into rb_tab_job(tab, job) values ('pgx', jsonb_build_object('mode', 'po', 'id', id, 'row', prow, 'at', ms, 'who', e));
  end if;

  -- ⑤ 뒤처리
  if jsonb_array_length(cols) > 0 then
    insert into rb_tab_job(tab, job) values ('pdx', jsonb_build_object('k', 'pd', 'at', ms, 'who', e, 'rows', jsonb_build_array(jsonb_build_object('id', id, 'row', rw, 'cols', cols))));
  end if;
  if wrote then perform rb_pd_ver(e); end if;
  insert into rb_tab_job(tab, job) values ('pj', jsonb_build_object('fn', case when lines is not null then '_odLines' else '_pgPost' end, 'who', e, 'at', ms, 'args', jsonb_build_array(jsonb_build_object(
    'x', 'edit', 'id', id, 'row', rw, 'expect', ex, 'audits', audits, 'qp', qp, 'lines', lines, 'ap', jsonb_array_length(audits) > 0))));
  out := jsonb_build_object('ok', true, 'row', rw, 'n', jsonb_array_length(audits), 'direct', 1);
  if lines is not null then out := out || jsonb_build_object('linesLater', 1); end if;
  return out;
end $f$;

create or replace function rb_od_save(p_token text, p_args jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
declare e text := rb_me(p_token); ed boolean;
begin
  if e is null then raise exception 'RB_SESSION'; end if;
  select editor into ed from rb_session where token = p_token;
  if not coalesce(ed, false) then raise exception 'RB_SESSION 저장 권한 확인'; end if;
  return rb_od_save_do(e, coalesce(p_args, '[]'::jsonb));
end $f$;

-- ============================================================
-- 진행 기록 묶음 — p_fn = apiSetCur · apiSetFlag · apiBulkHide · apiBulkOwner · apiBulkDate · apiBulkStep, p_args = 예전 인자 그대로
-- ============================================================
-- 모드 인자 → 'sample' | 'po' | null(흔치 않은 모양 — 서버 길)
create or replace function rb_odx_mode(v jsonb) returns text language sql immutable as $f$
  select case when v is null or jsonb_typeof(v) = 'null' then 'po' when v = '"sample"'::jsonb then 'sample' when v in ('"po"'::jsonb, '""'::jsonb) then 'po' else null end $f$;

create or replace function rb_pg_more_do(e text, p_fn text, a jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
declare
  ms bigint := rb_pg_ms(); nows text := rb_pg_kst(rb_pg_ms(), 'YYYY-MM-DD HH24:MI:SS'); nowm text := rb_pg_kst(rb_pg_ms(), 'YYYY-MM-DD HH24:MI');
  rawm jsonb; m text; mpo boolean; pg jsonb; S jsonb := '{}'; ord text[] := '{}'; it jsonb; id text; g jsonb; st jsonb; c jsonb; d jsonb; r jsonb;
  nextRow int := null; n int := 0; kept int := 0; miss jsonb := '[]'; audits jsonb := '[]'; out jsonb; k text; i int;
  cur text; meta jsonb; on_ boolean; was boolean; step jsonb; stp jsonb; sidx int; fl jsonb; key text; v text; fld text; had boolean;
  who text; doMode text; slots jsonb; kk text; x jsonb; ms0 text; fv text; hasOrd boolean; docv text; reqk text; v2 boolean; skipStep boolean;
  pdc jsonb; oc jsonb; f jsonb; prow int; sc int; c_owner int; c_cur int; s0 text; ci int; ti int; SO constant text[] := array['계획', '상신', '승인', '발주'];
  rows int[] := '{}'; rowx jsonb := '{}'; a0 jsonb := a; tgt text; pdx jsonb := '[]'; skipKind boolean := false; stepsAll jsonb; anyItem boolean;
begin
  if jsonb_typeof(a) <> 'array' then raise exception 'RB_FALLBACK 인자 모양'; end if;
  rawm := case p_fn when 'apiSetCur' then a->3 when 'apiSetFlag' then a->6 when 'apiBulkHide' then a->2 when 'apiBulkOwner' then a->2 when 'apiBulkDate' then a->3 when 'apiBulkStep' then a->3 end;
  if p_fn not in ('apiSetCur', 'apiSetFlag', 'apiBulkHide', 'apiBulkOwner', 'apiBulkDate', 'apiBulkStep') then raise exception 'RB_FALLBACK % 는 서버 길', p_fn; end if;
  m := rb_odx_mode(rawm);
  if m is null then raise exception 'RB_FALLBACK 모드 모양'; end if;
  mpo := rawm = '"po"'::jsonb;

  -- ① 여러 건: 빈 목록이면 { n: 0 }(검사보다 먼저 — 예전 그대로)
  if p_fn like 'apiBulk%' then
    if a->0 is null or jsonb_typeof(a->0) = 'null' or (jsonb_typeof(a->0) = 'array' and jsonb_array_length(a->0) = 0) then return jsonb_build_object('n', 0, 'direct', 1); end if;
    if jsonb_typeof(a->0) <> 'array' then raise exception 'RB_FALLBACK 목록 모양'; end if;
    if jsonb_array_length(a->0) > 400 then raise exception 'RB_FALLBACK 너무 많은 건'; end if;
    for it in select q from jsonb_array_elements(a->0) q loop
      if jsonb_typeof(it) not in ('object', 'null') and rb_pg_tru(it) then raise exception 'RB_FALLBACK 건 모양'; end if;
      if jsonb_typeof(it) = 'object' and it->'meta' is not null and jsonb_typeof(it->'meta') not in ('object', 'null') and rb_pg_tru(it->'meta') then raise exception 'RB_FALLBACK 건 정보 모양'; end if;
      if jsonb_typeof(it) = 'object' and rb_pg_tru(it->'id') and rb_pg_str(it->'id') is null then raise exception 'RB_FALLBACK 건ID 모양'; end if;
    end loop;
  end if;

  -- ② 예전 api 의 앞 검사(같은 문구)
  if p_fn = 'apiSetCur' then
    if rb_pg_tru(a->2) and rb_pg_str(a->2) is null then raise exception 'RB_FALLBACK 통화 모양'; end if;
    cur := upper(case when rb_pg_tru(a->2) then rb_pg_str(a->2) else '' end);
    if cur not in ('KRW', 'CNY', 'USD') then raise exception '통화는 원화 · 위안 · 달러 중에서 고르세요.'; end if;
  elsif p_fn = 'apiBulkDate' then
    if not (a->1 in ('"submitted"'::jsonb, '"approved"'::jsonb)) then raise exception '알 수 없는 날짜 항목입니다.'; end if;
    fld := a->>1;
    if rb_pg_tru(a->2) and rb_pg_str(a->2) is null then raise exception 'RB_FALLBACK 날짜 값 모양'; end if;
    v := left(rb_pg_trim(case when rb_pg_tru(a->2) then rb_pg_str(a->2) else '' end), 10);
    if rb_odx_astral(v) then raise exception 'RB_FALLBACK 날짜 글자'; end if;
  elsif p_fn = 'apiBulkOwner' then
    if rb_pg_tru(a->1) and rb_pg_str(a->1) is null then raise exception 'RB_FALLBACK 담당자 모양'; end if;
    who := left(rb_pg_trim(case when rb_pg_tru(a->1) then rb_pg_str(a->1) else '' end), 40);
    if rb_odx_astral(who) then raise exception 'RB_FALLBACK 담당자 글자'; end if;
    if who = '미지정' then who := ''; end if;
  end if;

  -- ③ 잠금 · 켜짐(진행 기록 → 발주 DB 차례)
  perform pg_advisory_xact_lock(hashtext('rb_tab_' || case m when 'sample' then 'sp' else 'pg' end));
  pg := rb_odx_pg_ready(m);
  stp := pg->'full'; v2 := coalesce((pg->>'v2')::boolean, false);

  if p_fn = 'apiSetFlag' then
    if jsonb_typeof(a->2) = 'string' then select q into step from jsonb_array_elements(stp) q where q->>'id' = a->>2 limit 1; end if;
    sidx := case when a->3 is null or jsonb_typeof(a->3) = 'null' or a->3 = '""'::jsonb then 0
                 when jsonb_typeof(a->3) = 'number' and (a->>3) ~ '^(0|[1-9][0-9]{0,5})$' then (a->>3)::int
                 when jsonb_typeof(a->3) = 'string' and (a->>3) ~ '^\s*(0|[1-9][0-9]{0,5})\s*$' then btrim(a->>3)::int else -1 end;
    if a->3 is null or sidx < 0 then raise exception 'RB_FALLBACK 항목 번호 모양'; end if;
    if step is not null and jsonb_typeof(step->'items'->sidx) = 'object' and jsonb_typeof(step->'items'->sidx->'f') = 'array' then
      if rb_pg_str(a->4) is null then raise exception 'RB_FALLBACK 단추 열쇠 모양'; end if;
      select q into fl from jsonb_array_elements(step->'items'->sidx->'f') q where jsonb_typeof(q) = 'object' and coalesce(rb_pg_str(q->'k'), q->>'k') = rb_pg_str(a->4) limit 1;
    end if;
    if fl is null then raise exception '버튼 설정이 바뀌었습니다. 새로고침 후 다시 해 주세요.'; end if;
    key := 'fl:' || rb_pg_ikey(step, sidx) || ':' || coalesce(rb_pg_str(fl->'k'), fl->>'k');
    on_ := rb_pg_tru(a->5);
    if rb_pg_tru(a->1) and jsonb_typeof(a->1) <> 'object' then raise exception 'RB_FALLBACK 건 정보 모양'; end if;
  elsif p_fn = 'apiBulkStep' then
    if jsonb_typeof(a->1) = 'string' then select q into step from jsonb_array_elements(stp) q where q->>'id' = a->>1 limit 1; end if;
    if step is null then raise exception '단계를 찾을 수 없습니다.'; end if;
    doMode := case when a->2 = '"skip"'::jsonb then 'skip' else 'done' end;
    if doMode = 'skip' and not rb_pg_tru(step->'skippable') then raise exception '이 단계는 건너뛸 수 없습니다.'; end if;
  end if;

  -- ④ 건 목록(한 건 api 는 한 건으로)
  if p_fn in ('apiSetCur', 'apiSetFlag') then
    if rb_pg_tru(a->1) and jsonb_typeof(a->1) <> 'object' then raise exception 'RB_FALLBACK 건 정보 모양'; end if;
    if not rb_pg_tru(a->0) then raise exception '건ID가 비어 있습니다.'; end if;
    if jsonb_typeof(a->0) <> 'string' then raise exception 'RB_FALLBACK 건ID 모양'; end if;
    it := jsonb_build_object('id', a->0, 'meta', case when jsonb_typeof(a->1) = 'object' then a->1 else null end);
    a := jsonb_set(a, '{0}', jsonb_build_array(it));
  end if;

  -- ⑤ 건마다(같은 건은 같은 상태에 이어서 — bulkEditProgress_)
  for it in select q from jsonb_array_elements(a->0) q loop
    if jsonb_typeof(it) <> 'object' or not rb_pg_tru(it->'id') then continue; end if;
    id := rb_pg_str(it->'id');
    if m = 'sample' and left(id, 2) = 'p:' and id !~ '^p:P[0-9A-F]{8}$' then raise exception 'RB_FALLBACK 샘플 옛 건ID'; end if;
    meta := case when jsonb_typeof(it->'meta') = 'object' then it->'meta' else null end;
    if not S ? id then
      perform rb_pg_busy(m, id);
      g := rb_odx_pg_get(pg->>'tab', id);
      if (g->>'isnew')::boolean then
        nextRow := coalesce(nextRow, (g->>'row')::int);
        g := jsonb_set(g, '{row}', to_jsonb(nextRow)); nextRow := nextRow + 1;
      end if;
      S := S || jsonb_build_object(id, g || jsonb_build_object('before', g->'st', 'touched', false));
      ord := ord || id;
    end if;
    st := S->id->'st'; c := coalesce(st->'checks', '{}'); d := coalesce(st->'dates', '{}');
    skipKind := false;
    if p_fn = 'apiSetCur' then
      c := c || jsonb_build_object('_cur', cur);
    elsif p_fn = 'apiSetFlag' then
      was := rb_pg_tru(c->key);
      if on_ then c := c || jsonb_build_object(key, case when rb_pg_tru(c->key) then c->key else to_jsonb(nows) end); else c := c - key; end if;
      if was <> on_ then
        audits := audits || jsonb_build_object('tab', pg->>'tab', 'row', (S->id->>'row')::int, 'col', 7,
          'what', '[' || coalesce(rb_pg_str(fl->'t'), fl->>'t', '') || '] ' || case when on_ then '표시' else '표시 해제' end || ' — '
                  || (select o from jsonb_array_elements(stp) with ordinality z(q, o) where q->>'id' = step->>'id' limit 1) || '. ' || coalesce(step->>'title', '') || ' › ' || coalesce(step->'items'->sidx->>'t', ''),
          'before', case when was then '표시' else '' end, 'after', case when on_ then '표시' else '' end,
          'item', case when rb_pg_tru(meta->'name') then rb_pg_str(meta->'name') else '' end || case when rb_pg_tru(meta->'doc') then ' (' || rb_pg_str(meta->'doc') || ')' else '' end);
      end if;
    elsif p_fn = 'apiBulkHide' then
      if rb_pg_tru(a->1) then c := c || '{"_hidden":1}'; else c := c - '_hidden'; end if;
    elsif p_fn = 'apiBulkOwner' then
      st := jsonb_set(st, '{ownerSet}', to_jsonb(who));
    elsif p_fn = 'apiBulkDate' then
      r := rb_pg_apply(jsonb_build_object('steps', stp, 'v2', v2, 'slots', pg->'slots'), jsonb_build_object('checks', c, 'notes', st->'notes', 'dates', d, 'ownerSet', st->'ownerSet'),
        jsonb_build_object('kind', 'date', 'field', fld, 'value', v, 'at', ms, 'who', e));
      c := r->'checks'; d := r->'dates';
    elsif p_fn = 'apiBulkStep' then
      if doMode = 'skip' then
        if exists (select 1 from generate_series(0, coalesce(jsonb_array_length(step->'items'), 0) - 1) gi where rb_pg_tru(c->rb_pg_ikey(step, gi))) then
          kept := kept + 1; skipKind := true;
        else c := c || jsonb_build_object('_skip_' || (step->>'id'), 1); end if;
      else
        hasOrd := rb_pg_tru(it->'ord');
        docv := case when rb_pg_tru(meta->'doc') then coalesce(rb_pg_str(meta->'doc'), '?') else '' end;
        for i in 0 .. coalesce(jsonb_array_length(step->'items'), 0) - 1 loop
          x := step->'items'->i; kk := rb_pg_ikey(step, i);
          ms0 := '';
          if not rb_pg_tru(c->kk) then
            fv := coalesce(pg->'byKey'->>kk, '');
            if fv = 'approved' and mpo and not rb_pg_tru(d->fv) and docv = '' and not hasOrd then ms0 := '품의번호';
            elsif fv in ('submitted', 'approved') then ms0 := case when rb_pg_tru(d->fv) then '' when fv = 'submitted' then '상신일' else '승인일' end;
            elsif fv = 'ordered' then ms0 := case when mpo and not hasOrd then '발주일' else '' end;
            elsif fv = 'req' then reqk := coalesce(pg->'reqKey'->>kk, kk); ms0 := case when rb_pg_tru(d->('req:' || reqk)) then '' else '요청일' end;
            end if;
          end if;
          if ms0 <> '' then
            miss := miss || to_jsonb(coalesce(case when rb_pg_tru(meta->'name') then rb_pg_trim(rb_pg_str(meta->'name')) else rb_pg_trim(rb_pg_str(it->'id')) end, '')
                    || ' · ' || coalesce(rb_pg_trim(case when jsonb_typeof(x->'t') in ('string', 'number') then rb_pg_str(x->'t') else '' end), '') || ' — ' || ms0 || ' 없음');
            continue;
          end if;
          if rb_pg_req(x, c, kk) then
            c := rb_pg_ckset(c, kk, true, false, v2);
            if not rb_pg_tru(d->('ct:' || kk)) then d := d || jsonb_build_object('ct:' || kk, nowm, 'cw:' || kk, split_part(e, '@', 1)); end if;
          elsif not rb_pg_tru(c->kk) then c := c || jsonb_build_object('sk:' || kk, 1);
          end if;
        end loop;
        c := c - ('_skip_' || (step->>'id'));
      end if;
      if not skipKind then
        r := rb_pg_stamp(c, d, stp, nows); c := r->'c'; d := r->'d';
      end if;
    end if;
    if skipKind then continue; end if;
    st := jsonb_set(jsonb_set(st, '{checks}', c), '{dates}', d);
    S := jsonb_set(S, array[id], (S->id) || jsonb_build_object('st', st, 'meta', coalesce(meta, 'null'::jsonb), 'touched', true));
    n := n + 1;
  end loop;

  -- ⑥ 사본 줄 쓰기 · 시트 맞추기 일
  for id in select unnest(ord) loop
    if not (S->id->>'touched')::boolean then continue; end if;
    perform rb_odx_pg_put(pg->>'tab', (S->id->>'row')::int, S->id->'cx', id, case when jsonb_typeof(S->id->'meta') = 'object' then S->id->'meta' else null end, S->id->'st', e, ms);
    insert into rb_tab_job(tab, job) values ('pgx', jsonb_build_object('mode', m, 'id', id, 'row', (S->id->>'row')::int, 'at', ms, 'who', e));
  end loop;

  -- ⑦ 발주 DB 칸: 통화(dbSetCur_) · 구매 담당(writeOwnerCells_) · 진행상태 올리기(bumpStates_)
  if (p_fn = 'apiSetCur' and m = 'po' and (rawm is null or jsonb_typeof(rawm) = 'null' or rawm in ('"po"'::jsonb, '""'::jsonb)))
     or (p_fn = 'apiBulkOwner' and m <> 'sample')
     or (p_fn = 'apiBulkDate' and v <> '' and mpo) then
    anyItem := false;
    for it in select q from jsonb_array_elements(a->0) q loop
      if p_fn = 'apiSetCur' then anyItem := true;
      elsif p_fn = 'apiBulkOwner' and jsonb_typeof(it) = 'object' and rb_pd_num(it->'statusRow') >= 2 then anyItem := true;
      elsif p_fn = 'apiBulkDate' and jsonb_typeof(it) = 'object' then anyItem := true; end if;
    end loop;
    if anyItem then
      perform pg_advisory_xact_lock(hashtext('rb_tab_pd'));
      oc := rb_odx_ready('rb_pg_more');
      pdc := rb_pd_ready('rb_pg_more');
      sc := coalesce((oc->>'state')::int, -1);
      if p_fn = 'apiSetCur' then
        c_cur := rb_odx_col(oc, 'cur'); id := rb_pg_str(a->0->0->'id');
        if c_cur >= 0 and id <> '' then
          perform rb_pd_busy(id);
          f := rb_pd_find(pdc, id, 0, false);
          if not (f ? 'fb' or f ? 'err') then
            prow := (f->>'row')::int;
            if not (sc >= 0 and rb_odx_cs(rb_odx_cell(oc, prow, sc)) in ('종결', '취소')) then
              if rb_odx_cell(oc, prow, c_cur) is distinct from to_jsonb(cur) then
                perform rb_odx_put(oc, prow, c_cur, to_jsonb(cur)); perform rb_odx_amt_fix(oc, prow);
                pdx := pdx || jsonb_build_object('id', id, 'row', prow, 'cols', jsonb_build_array(c_cur));
              end if;
            end if;
          end if;
        end if;
      else
        -- 행 찾기(findStatusRow_): ID 로 · 못 찾으면 건너뜀 · 예전 열쇠(품의번호)만 있으면 서버 길
        for it in select q from jsonb_array_elements(a->0) q loop
          if jsonb_typeof(it) <> 'object' then continue; end if;
          if p_fn = 'apiBulkOwner' and not (rb_pd_num(it->'statusRow') >= 2) then continue; end if;
          meta := case when jsonb_typeof(it->'meta') = 'object' then it->'meta' else null end;
          if p_fn = 'apiBulkDate' then      -- bumpStates_ 의 확인값 = meta(+ id 가 없으면 건ID)
            meta := coalesce(meta, '{}'::jsonb);
            if not rb_pg_tru(meta->'id') then meta := meta || jsonb_build_object('id', coalesce(it->'id', 'null'::jsonb)); end if;
            if rb_odx_s(meta->'id') = '' and rb_odx_s(meta->'doc') = '' then continue; end if;
          end if;
          if meta is null then continue; end if;
          if rb_odx_s(meta->'id') is null or rb_odx_s(meta->'doc') is null or rb_odx_s(meta->'name') is null then raise exception 'RB_FALLBACK 확인값 모양'; end if;
          tgt := rb_odx_s(meta->'id');
          if tgt = '' then
            if rb_odx_s(meta->'doc') <> '' then raise exception 'RB_FALLBACK ID 없는 건(예전 열쇠)'; end if;
            continue;
          end if;
          perform rb_pd_busy(tgt);
          f := rb_pd_find(pdc, tgt, rb_odx_rownum(it->'statusRow'), false);
          if f ? 'fb' then raise exception 'RB_FALLBACK %', f->>'fb'; end if;
          if f ? 'err' then continue; end if;
          prow := (f->>'row')::int;
          if p_fn = 'apiBulkOwner' then
            if not (prow = any(rows)) then rows := rows || prow; end if;
            rowx := rowx || jsonb_build_object(prow::text, meta);       -- 같은 행이 두 번 오면 나중 확인값(by[row] · RB_ROWKEY 모두)
          else
            if not (prow = any(rows)) then rows := rows || prow; rowx := rowx || jsonb_build_object(prow::text, meta); end if;      -- 상태 올리기는 처음 것(who[row])
          end if;
        end loop;
        if p_fn = 'apiBulkOwner' then
          c_owner := rb_odx_col(oc, 'owner');
          if c_owner >= 0 then
            foreach prow in array rows loop
              s0 := rb_odx_cs(rb_odx_cell(oc, prow, c_owner));
              if s0 = who then continue; end if;
              perform rb_odx_put(oc, prow, c_owner, to_jsonb(who)); perform rb_odx_amt_fix(oc, prow);
              pdx := pdx || jsonb_build_object('id', rb_odx_s(rowx->prow::text->'id'), 'row', prow, 'cols', jsonb_build_array(c_owner));
              audits := audits || jsonb_build_object('tab', oc->>'tab', 'row', prow, 'col', c_owner + 1, 'what', '구매 담당', 'before', s0, 'after', who,
                'item', rb_odx_s(rowx->prow::text->'name'), 'id', rb_odx_s(rowx->prow::text->'id'), 'doc', rb_odx_s(rowx->prow::text->'doc'), 'code', coalesce(rb_odx_s(rowx->prow::text->'code'), ''));
            end loop;
          end if;
          out := jsonb_build_object('sheet', (select count(*) from jsonb_array_elements(pdx)));
        else
          ti := array_position(SO, case fld when 'submitted' then '상신' else '승인' end) - 1;
          if sc >= 0 then
            foreach prow in array rows loop
              s0 := rb_odx_cs(rb_odx_cell(oc, prow, sc)); ci := coalesce(array_position(SO, s0), 0) - 1;
              if s0 <> '' and ci < 0 then continue; end if;
              if ci >= ti then continue; end if;
              perform rb_odx_put(oc, prow, sc, to_jsonb(SO[ti + 1])); perform rb_odx_amt_fix(oc, prow);
              pdx := pdx || jsonb_build_object('id', rb_odx_s(rowx->prow::text->'id'), 'row', prow, 'cols', jsonb_build_array(sc));
              audits := audits || jsonb_build_object('tab', oc->>'tab', 'row', prow, 'col', sc + 1, 'what', '진행상태(자동)', 'before', s0, 'after', SO[ti + 1],
                'item', rb_odx_s(rowx->prow::text->'name'), 'id', rb_odx_s(rowx->prow::text->'id'), 'doc', rb_odx_s(rowx->prow::text->'doc'), 'code', coalesce(rb_odx_s(rowx->prow::text->'code'), ''));
            end loop;
          end if;
        end if;
      end if;
      if jsonb_array_length(pdx) > 0 then
        insert into rb_tab_job(tab, job) values ('pdx', jsonb_build_object('k', 'pd', 'at', ms, 'who', e, 'rows', pdx));
        perform rb_pd_ver(e);
      end if;
    end if;
  end if;
  if p_fn = 'apiBulkOwner' and out is null then out := jsonb_build_object('sheet', 0); end if;

  -- ⑧ 뒤처리(이력 · 결과 대조 — 서버가 실제 함수를 before 에 다시 돌림)
  insert into rb_tab_job(tab, job) values ('pj', jsonb_build_object('fn', '_pgPost', 'who', e, 'at', ms, 'args', jsonb_build_array(jsonb_build_object(
    'x', p_fn, 'mode', m, 'args', a0, 'sh', pg->>'sh', 'audits', audits, 'ap', jsonb_array_length(pdx) > 0,
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', q, 'row', (S->q->>'row')::int, 'isnew', S->q->'isnew', 'meta', S->q->'meta', 'touched', S->q->'touched',
                       'before', S->q->'before', 'after', S->q->'st')) from unnest(ord) q), '[]'::jsonb),
    'res', jsonb_build_object('n', n, 'kept', kept, 'miss', miss)))));

  -- ⑨ 결과(예전 모양)
  if p_fn in ('apiSetCur', 'apiSetFlag') then
    return jsonb_build_object('checks', S->(ord[1])->'st'->'checks', 'direct', 1);
  elsif p_fn = 'apiBulkOwner' then return jsonb_build_object('n', n, 'owner', who, 'sheet', (out->>'sheet')::int, 'direct', 1);
  elsif p_fn = 'apiBulkStep' then return jsonb_build_object('n', n, 'kept', kept, 'miss', miss, 'direct', 1);
  end if;
  return jsonb_build_object('n', n, 'direct', 1);
end $f$;

create or replace function rb_pg_more(p_token text, p_fn text, p_args jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
declare e text := rb_me(p_token); ed boolean;
begin
  if e is null then raise exception 'RB_SESSION'; end if;
  select editor into ed from rb_session where token = p_token;
  if not coalesce(ed, false) then raise exception 'RB_SESSION 저장 권한 확인'; end if;
  return rb_pg_more_do(e, coalesce(p_fn, ''), coalesce(p_args, '[]'::jsonb));
end $f$;

-- ---------- 서버(서비스 키)만: 켜짐 · 열 위치 · 단계 정의 — 세 잠금을 잡고(진행 중인 직접 저장이 끝난 뒤 바뀜) ----------
create or replace function rb_odx_conf_put(p_conf jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
begin
  perform pg_advisory_xact_lock(hashtext('rb_tab_pg'));
  perform pg_advisory_xact_lock(hashtext('rb_tab_sp'));
  perform pg_advisory_xact_lock(hashtext('rb_tab_pd'));
  insert into rb_conf (k, v, at) values ('odConf', p_conf, now()) on conflict (k) do update set v = excluded.v, at = excluded.at;
  return jsonb_build_object('ok', true, 'on', p_conf->>'on');
end $f$;

revoke all on function rb_odx_s(jsonb) from public, anon, authenticated;
revoke all on function rb_odx_astral(text) from public, anon, authenticated;
revoke all on function rb_odx_jsnum(text) from public, anon, authenticated;
revoke all on function rb_odx_num(jsonb) from public, anon, authenticated;
revoke all on function rb_odx_cell(jsonb, int, int) from public, anon, authenticated;
revoke all on function rb_odx_put(jsonb, int, int, jsonb) from public, anon, authenticated;
revoke all on function rb_odx_cs(jsonb) from public, anon, authenticated;
revoke all on function rb_odx_todate(jsonb) from public, anon, authenticated;
revoke all on function rb_odx_diso(date) from public, anon, authenticated;
revoke all on function rb_odx_tok(text, date) from public, anon, authenticated;
revoke all on function rb_odx_amt(jsonb, jsonb) from public, anon, authenticated;
revoke all on function rb_odx_amt_fix(jsonb, int) from public, anon, authenticated;
revoke all on function rb_odx_loc(numeric) from public, anon, authenticated;
revoke all on function rb_odx_ready(text) from public, anon, authenticated;
revoke all on function rb_odx_col(jsonb, text) from public, anon, authenticated;
revoke all on function rb_odx_pg_ready(text) from public, anon, authenticated;
revoke all on function rb_odx_pg_get(text, text) from public, anon, authenticated;
revoke all on function rb_odx_pg_put(text, int, jsonb, text, jsonb, jsonb, text, bigint) from public, anon, authenticated;
revoke all on function rb_odx_rownum(jsonb) from public, anon, authenticated;
revoke all on function rb_odx_mode(jsonb) from public, anon, authenticated;
revoke all on function rb_od_save_do(text, jsonb) from public, anon, authenticated;
revoke all on function rb_pg_more_do(text, text, jsonb) from public, anon, authenticated;
revoke all on function rb_odx_conf_put(jsonb) from public, anon, authenticated;
revoke all on function rb_od_save(text, jsonb) from public;
revoke all on function rb_pg_more(text, text, jsonb) from public;
grant execute on function rb_od_save(text, jsonb) to anon, authenticated;
grant execute on function rb_pg_more(text, text, jsonb) to anon, authenticated;
