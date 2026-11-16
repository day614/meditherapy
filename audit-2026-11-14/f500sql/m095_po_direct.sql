-- m095_po_direct — 발주 등록(apiCreateOrder) · 품목코드 등록(apiItemRegister) · 업체 추가(apiVendorAdd) 를 Supabase 함수로 바로(할 일 대기열 아님 · 진짜 결과)
-- 규칙 = Keys.js apiCreateOrder0_(writeStatusRows_ · linesForNewOrder_ · replaceLinesFor_ · syncOrderFromLines_ · regItem) · Bom.js apiItemRegister · Vendors.js apiVendorAdd.
-- 발주 DB 사본 = sheet_rows '_실행판_발주'(pdConf · rb_pd_ready · 잠금 rb_tab_pd) · 지급 줄 사본 '_실행판_지급'(잠금 rb_tab_ln) · 품목 DB 사본 '_실행판_품목'(잠금 rb_tab_it).
-- 켜짐 · 열 위치 · 목록(구분 · 브랜드 · 채널 · 발주요청팀 · 브랜드별 채널) · 업체 설정 목록 = rb_conf 'poConf'(서버 poConfPublish_ → rb_po_conf_put, rb_tab_pd 잠금).
-- 시트는 뒤에서: 발주 DB 새 줄 = rb_tab_job 'pdx' {add:[{id,row,w}]}(PdDirect.js pdxDrainIn_) · 지급 줄 = 'ln'(lnDbDrainIn_ — rb_ln_do 와 같은 모양) ·
-- 품목 DB 새 줄 = 'it' {add:{…}}(IssueDb.js itemJobDrainIn_) · 이력 · 통화 기록 · 업체 설정 = 'pj' fn '_poPost'(PoDirect.js poDirectPost_ — 할 일 차례 그대로).
-- 잠금 차례: rb_tab_pd → rb_tab_ln → rb_tab_it (거꾸로 잡는 곳 없음).

-- ---------- 작은 도우미 ----------
-- JS 참/거짓(!!v) — null · false · 0 · '' 만 거짓
create or replace function rb_po_truthy(v jsonb) returns boolean language sql immutable as $f$
  select case when v is null or jsonb_typeof(v) = 'null' then false
              when jsonb_typeof(v) = 'boolean' then (v #>> '{}')::boolean
              when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric <> 0
              when jsonb_typeof(v) = 'string' then (v #>> '{}') <> ''
              else true end
$f$;
-- toDate_(글자) — 날짜가 아니면 null. JS new Date(y, m-1, d) 처럼 넘치는 날(2/31)은 다음 달로
create or replace function rb_po_todate(v text) returns date language plpgsql immutable as $f$
declare raw text := btrim(coalesce(v, '')); s text; m text[]; y int; mo int; dd int;
begin
  if raw = '' then return null; end if;
  if raw ~ '^\d{4}\.?\s+\d{1,2}\.?\s+\d{1,2}\.?$' then raw := regexp_replace(raw, '\.?\s+', '.', 'g'); end if;
  s := regexp_replace(regexp_replace(regexp_replace(raw, '\s+', '', 'g'), '[년월]', '.', 'g'), '일$', '');
  if s = '' then return null; end if;
  m := regexp_match(s, '^(\d{4}|\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})\.?$');
  if m is null then return null; end if;
  y := m[1]::int; if y < 100 then y := y + 2000; end if;
  mo := m[2]::int; dd := m[3]::int;
  if mo < 1 or mo > 12 or dd < 1 or dd > 31 then return null; end if;
  return make_date(y, mo, 1) + (dd - 1);
end $f$;
-- 서울 자정 → ISO(UTC) — 시트 날짜 칸이 사본에 들어가는 모양(sbCell_)
create or replace function rb_po_diso(d date) returns text language sql immutable as $f$
  select to_char((d::timestamp at time zone 'Asia/Seoul') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$f$;
create or replace function rb_po_nowiso() returns text language sql stable as $f$
  select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$f$;
-- ymOf_(payYm_) — '2026-11-30' · '26/11/30' · '11월말일' · '27''1월말일' → 'yy-mm', 못 읽으면 ''
create or replace function rb_po_ym(v text) returns text language plpgsql stable as $f$
declare s text := regexp_replace(btrim(coalesce(v, '')), '\s', '', 'g'); d date; m text[]; y int; mo int; nowk timestamp := now() at time zone 'Asia/Seoul';
begin
  if s = '' then return ''; end if;
  d := rb_po_todate(s);
  if d is not null then return to_char(d, 'YY-MM'); end if;
  m := regexp_match(s, '^(?:(\d{2})[''’])?(\d{1,2})월');
  if m is null then return ''; end if;
  mo := m[2]::int;
  if mo < 1 or mo > 12 then return ''; end if;
  if m[1] is not null then y := 2000 + m[1]::int;
  else y := extract(year from nowk)::int; if mo < extract(month from nowk)::int - 1 then y := y + 1; end if; end if;      -- JS: m < now.getMonth()(0부터)
  return right(y::text, 2) || '-' || lpad(mo::text, 2, '0');
end $f$;
-- sheetDateTok_(날짜, 발주일 없음) — 'yyyy-m-d' → 'YY/MM/DD'(넘친 날도 글자 그대로)
create or replace function rb_po_tok(t text) returns text language plpgsql immutable as $f$
declare m text[] := regexp_match(btrim(coalesce(t, '')), '^(\d{4}|\d{2})[./-](\d{1,2})[./-](\d{1,2})$'); y int;
begin
  if btrim(coalesce(t, '')) = '' then return ''; end if;
  if m is null then return btrim(t); end if;
  y := m[1]::int; if y < 100 then y := y + 2000; end if;
  return substr(y::text, 3) || '/' || lpad(m[2]::int::text, 2, '0') || '/' || lpad(m[3]::int::text, 2, '0');
end $f$;
-- 열 번호(1부터) → 글자(colLetterRB_)
create or replace function rb_po_col(n int) returns text language plpgsql immutable as $f$
declare s text := ''; m int;
begin
  while n > 0 loop m := (n - 1) % 26; s := chr(65 + m) || s; n := (n - m) / 26; end loop;
  return s;
end $f$;
-- 칸 하나 넣기(사본 cells · 0부터)
create or replace function rb_po_set(c jsonb, i int, v jsonb) returns jsonb language sql immutable as $f$
  select case when i is null or i < 0 then c else jsonb_set(rb_pad(c, i + 1), array[i::text], coalesce(v, 'null'::jsonb)) end
$f$;
-- 품목 구분(itemCatNorm_ || 값 || itemCatGuess_)
create or replace function rb_po_cat(v text, code text) returns text language sql immutable as $f$
  select case
    when regexp_replace(coalesce(v, ''), '\s', '', 'g') in ('부재료', '부자재') then '부자재'
    when regexp_replace(coalesce(v, ''), '\s', '', 'g') in ('제품', '완제품') then '완제품'
    when regexp_replace(coalesce(v, ''), '\s', '', 'g') in ('반제품', '원료', '원부자재') then regexp_replace(coalesce(v, ''), '\s', '', 'g')
    when coalesce(v, '') <> '' then v
    when rb_code_key(code) ~ '^[A-Z]P\d{4}' then '부자재'
    when rb_code_key(code) ~ '^[A-Z]X\d{4}' then '반제품'
    when rb_code_key(code) ~ '^[A-Z]\d{4}[A-Z]{2}\d+$' then '완제품'
    else '' end
$f$;

-- 세션 · 저장 권한(편집자)
create or replace function rb_po_me(p_token text) returns text language plpgsql security definer set search_path = public as $f$
declare e text := rb_me(p_token); ed boolean;
begin
  if e is null then raise exception 'RB_SESSION'; end if;
  select editor into ed from rb_session where token = p_token;
  if not coalesce(ed, false) then raise exception 'RB_SESSION 저장 권한 확인'; end if;
  return e;
end $f$;

-- poConf 켜짐 — part: 'co'(발주 등록 · 지급 줄 · 품목 DB) · 'it'(품목 DB) · 'vd'(업체) · 'pp'(상신 대기 · 상신 완료)
create or replace function rb_po_conf(part text) returns jsonb language plpgsql security definer set search_path = public as $f$
declare c jsonb;
begin
  select v into c from rb_conf where k = 'poConf';
  if c is null or coalesce(c->>'on', '') <> '1' then raise exception 'RB_FALLBACK 발주 등록 · 품의 직접 저장 꺼짐(%)', coalesce(c->>'why', '설정 없음'); end if;
  if coalesce(c->'parts'->>part, '') <> '1' then raise exception 'RB_FALLBACK 직접 저장 꺼짐(% · %)', part, coalesce(c->'why_'->>part, ''); end if;
  return c;
end $f$;

-- 품목 DB 사본에 새 줄(appendItems_ — 미사용이 아닌 같은 코드가 있으면 건너뜀). it = {code,name,brand,channel,vendor,price,barcode,spec,cat}. 돌려줌 넣었으면 true
create or replace function rb_po_item_add(e text, it jsonb, src text) returns boolean language plpgsql security definer set search_path = public as $f$
declare T constant text := '_실행판_품목'; code text := rb_code_key(rb_t(it->'code')); nm text := rb_t(it->'name'); r int; nowiso text := rb_po_nowiso(); nc jsonb; pr jsonb;
begin
  if code = '' or nm = '' then return false; end if;
  perform pg_advisory_xact_lock(hashtext('rb_tab_it'));
  if exists (select 1 from sheet_rows where tab = T and "row" > 1 and rb_code_key(rb_t(cells->0)) = code and rb_t(cells->11) not like '%미사용%') then return false; end if;
  if exists (select 1 from rb_tab_job where tab = 'it' and done_at is null and rb_code_key(job->'add'->>'code') = code) then return false; end if;
  select coalesce(max("row"), 1) + 1 into r from sheet_rows where tab = T;
  pr := case when it->'price' is null or jsonb_typeof(it->'price') = 'null' or rb_t(it->'price') = '' then 'null'::jsonb else to_jsonb(rb_num(it->'price')) end;
  nc := jsonb_build_array(code, nm, nullif(rb_t(it->'brand'), ''), nullif(rb_t(it->'channel'), ''), nullif(rb_t(it->'vendor'), ''), pr,
    nullif(rb_t(it->'barcode'), ''), null, null, nowiso, e, nullif(coalesce(src, ''), ''), nullif(rb_t(it->'spec'), ''), nullif(rb_po_cat(rb_t(it->'cat'), code), ''));
  insert into sheet_rows(tab, "row", cells, synced_at) values (T, r, nc, now());
  insert into rb_tab_job(tab, job) values ('it', jsonb_build_object('code', code, 'add', jsonb_build_object('code', code, 'name', nm, 'brand', rb_t(it->'brand'), 'channel', rb_t(it->'channel'),
    'vendor', rb_t(it->'vendor'), 'price', case when pr = 'null'::jsonb then to_jsonb(''::text) else pr end, 'barcode', rb_t(it->'barcode'), 'spec', rb_t(it->'spec'), 'cat', rb_t(it->'cat')),
    'src', coalesce(src, ''), 'row', r, 'who', e, 'at', (extract(epoch from clock_timestamp()) * 1000)::bigint, 'set', '{}'::jsonb, 'hist', '[]'::jsonb));
  return true;
end $f$;

-- =====================================================================
-- 품목코드 등록(apiItemRegister) — p_args = [code, name, brand, vendor, spec]
-- =====================================================================
create or replace function rb_item_reg_do(e text, a jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
declare c text := rb_code_key(rb_t(a->0)); nm text := rb_t(a->1); br text := rb_t(a->2); vd text := rb_t(a->3); sp text := rb_t(a->4);
  out jsonb;
begin
  if jsonb_typeof(a) <> 'array' then raise exception 'RB_FALLBACK 인자 모양'; end if;
  if exists (select 1 from jsonb_array_elements(a) x where jsonb_typeof(x) in ('object', 'array')) or a::text ~ '[\U00010000-\U0010FFFF]' then raise exception 'RB_FALLBACK 흔치 않은 값'; end if;
  if c !~ '^[A-Z0-9-]{4,30}$' then raise exception '품목코드 형식이 아닙니다: %', c; end if;
  if nm = '' then raise exception '품목명을 넣어 주세요.'; end if;
  perform rb_po_conf('it');
  out := jsonb_build_object('code', c, 'name', nm, 'brand', br, 'vendor', vd, 'spec', sp);
  perform pg_advisory_xact_lock(hashtext('rb_tab_it'));
  -- 이미 있음(되돌린 · 미사용 포함 — itemDbAllCodes_) · 반영 전 등록 일
  if exists (select 1 from sheet_rows where tab = '_실행판_품목' and "row" > 1 and rb_code_key(rb_t(cells->0)) = c)
     or exists (select 1 from rb_tab_job where tab = 'it' and done_at is null and rb_code_key(job->'add'->>'code') = c) then
    return out || '{"exists":true,"direct":1}'::jsonb;
  end if;
  if not rb_po_item_add(e, jsonb_build_object('code', c, 'name', nm, 'brand', br, 'vendor', vd, 'spec', sp), 'BOM 보기에서 확인 후 등록') then
    raise exception '등록하지 못했습니다(이미 있거나 이름이 비었음).';
  end if;
  return out || '{"direct":1}'::jsonb;
end $f$;
create or replace function rb_item_reg(p_token text, p_args jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
begin return rb_item_reg_do(rb_po_me(p_token), coalesce(p_args, '[]'::jsonb)); end $f$;

-- =====================================================================
-- 업체 추가(apiVendorAdd) — p_args = [name]
-- 목록 = BOM 업체(bom_rows.vendor · 3행부터) + 발주 DB 업체 + 품목 DB 업체(미사용 빼고) + 설정 list.vendor(poConf.vendorCfg + 반영 전 · 15분 안 추가 일) — 많이 쓴 순
-- =====================================================================
create or replace function rb_vendor_norm(s text) returns text language sql immutable as $f$
  select upper(regexp_replace(coalesce(s, ''), '\(주\)|㈜|주식회사|\s', '', 'g'))
$f$;
create or replace function rb_vendor_list(po jsonb, pc jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
declare vc int := coalesce((po->'cols'->>'vendor')::int, -1); hr int := coalesce((pc->>'hr')::int, 1); r jsonb;
begin
  with src as (
    select btrim(vendor) v, 1::numeric n from bom_rows where sheet_row >= 3 and vendor is not null
    union all
    select rb_t(cells->vc), 1 from sheet_rows where vc >= 0 and tab = pc->>'tab' and "row" > hr
    union all
    select rb_t(cells->4), 1 from sheet_rows where tab = '_실행판_품목' and "row" > 1 and rb_code_key(rb_t(cells->0)) <> '' and rb_t(cells->11) not like '%미사용%'
    union all
    select x, 0.5 from (select distinct btrim(x) x from (
        select jsonb_array_elements_text(coalesce(po->'vendorCfg', '[]'::jsonb)) x
        union all
        select job->'args'->0->>'name' from rb_tab_job where tab = 'pj' and job->>'fn' = '_poPost' and job->'args'->0->>'kind' = 'vendor'
          and (done_at is null or done_at > now() - interval '15 minutes')) q0) q1
  ), cnt as (
    select v, sum(n) c from src where v is not null and v <> '' and v <> '-' and char_length(v) <= 80 group by v
  )
  select coalesce(jsonb_agg(v order by c desc, v collate "C"), '[]'::jsonb) into r from cnt;
  return r;
end $f$;
create or replace function rb_vendor_add_do(e text, a jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
declare nm text; po jsonb; pc jsonb; L jsonb; same text; ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if jsonb_typeof(a) <> 'array' or jsonb_typeof(a->0) in ('object', 'array') or a::text ~ '[\U00010000-\U0010FFFF]' then raise exception 'RB_FALLBACK 인자 모양'; end if;
  nm := left(regexp_replace(rb_t(a->0), '\s+', ' ', 'g'), 80);
  if nm = '' then raise exception '업체명이 비었습니다.'; end if;
  perform pg_advisory_xact_lock(hashtext('rb_tab_pd'));
  po := rb_po_conf('vd');
  select v into pc from rb_conf where k = 'pdConf';
  if pc is null then raise exception 'RB_FALLBACK 발주 DB 설정 없음'; end if;
  L := rb_vendor_list(po, pc);
  select x into same from jsonb_array_elements_text(L) with ordinality t(x, i) where rb_vendor_norm(x) = rb_vendor_norm(nm) order by i limit 1;
  if same is not null then return jsonb_build_object('list', L, 'name', same, 'direct', 1); end if;
  insert into rb_tab_job(tab, job) values ('pj', jsonb_build_object('fn', '_poPost', 'who', e, 'at', ms, 'args', jsonb_build_array(jsonb_build_object('kind', 'vendor', 'name', nm))));
  return jsonb_build_object('list', rb_vendor_list(po, pc), 'name', nm, 'direct', 1);
end $f$;
create or replace function rb_vendor_add(p_token text, p_args jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
begin return rb_vendor_add_do(rb_po_me(p_token), coalesce(p_args, '[]'::jsonb)); end $f$;

-- =====================================================================
-- 새 발주 등록(apiCreateOrder) — p_args = [p](화면이 보낸 등록 값 그대로)
-- =====================================================================
create or replace function rb_co_create_do(e text, a jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
declare
  p jsonb; po jsonb; pc jsonb; S jsonb; ch jsonb; T text; LT constant text := '_실행판_지급'; hr int; idc int; sc int;
  newItem boolean; balAuto boolean; nm text; code text; qty numeric; priceE boolean; price numeric; need text[] := '{}'; bad text[] := '{}';
  x jsonb; brand text; chan text; due text; useBy text; dueD date; useD date; id text; rw int; ex int;
  rc jsonb; raw jsonb := '{}'::jsonb; f text; i int; qv jsonb; pv jsonb; cur text; curDef text; china boolean; mul numeric;
  preAmt numeric; balAmt numeric; preAt text; balAt text; L jsonb := '[]'::jsonb; out jsonb; lines jsonb := '[]'::jsonb; rows_ jsonb := '{}'::jsonb;
  last_ int; free int[]; r int; lid text; seq int := 0; dt text; diso text; nc jsonb; rwv jsonb; nowiso text := rb_po_nowiso(); ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  missed jsonb := '[]'::jsonb; pd date; wadd jsonb := '{}'::jsonb; c int; madeIso text; ref_ jsonb; amt jsonb; remain numeric; eta text; audits jsonb; mt jsonb; hasParts boolean; pm int;
  st_shown jsonb;
begin
  if jsonb_typeof(a) <> 'array' or jsonb_typeof(a->0) <> 'object' then raise exception 'RB_FALLBACK 인자 모양'; end if;
  p := a->0;
  if exists (select 1 from jsonb_each(p) x0 where jsonb_typeof(x0.value) in ('object', 'array')) or p::text ~ '[\U00010000-\U0010FFFF]' then raise exception 'RB_FALLBACK 흔치 않은 값'; end if;
  newItem := rb_po_truthy(p->'newItem'); balAuto := rb_po_truthy(p->'balAuto');
  nm := left(rb_t(p->'name'), 200);
  qty := rb_num(p->'qty');
  priceE := p->'price' is null or jsonb_typeof(p->'price') = 'null' or (jsonb_typeof(p->'price') = 'string' and (p->>'price') = '');
  price := case when priceE then null else rb_num(p->'price') end;
  if nm = '' then raise exception '품목명을 넣어주세요.'; end if;
  if left(rb_t(p->'code'), 100) = '' and not newItem then raise exception '품목코드가 없습니다. 품목을 검색해 고르거나 신제품으로 표시해 주세요.'; end if;
  for x in select * from jsonb_array_elements('[["batch","차수"],["cat","구분"],["brand","브랜드"],["channel","채널"],["vendor","업체"],["owner","구매 담당"],["due","입고목표일"],["useBy","소진완료목표일"],["team","발주요청팀"],["reqOwner","요청팀 담당자"],["link","발주요청 링크"],["balAt","잔금 지급예정"],["bal","잔금"]]'::jsonb) loop
    if left(rb_t(p->(x->>0)), 100) = '' then need := need || (x->>1); end if;
  end loop;
  if '잔금' = any(need) and (price = 0 or (rb_num(p->'pre') > 0 and rb_num(p->'preRate') >= 100)) then need := array_remove(need, '잔금'); end if;
  if priceE then need := need || '단가'::text; end if;
  if newItem then need := '{}'; end if;
  if coalesce(array_length(need, 1), 0) > 0 then raise exception '% 을(를) 넣어주세요.', array_to_string(need, ' · '); end if;
  -- 목록 검사(checkChoices_) — 목록은 poConf.choices(서버 choicesOf_)
  select v into po from rb_conf where k = 'poConf';
  if po is null or jsonb_typeof(po->'choices') <> 'object' then raise exception 'RB_FALLBACK 목록 설정 없음'; end if;
  ch := po->'choices';
  brand := left(rb_t(p->'brand'), 100);
  if coalesce(po->'brandAlias', '{}'::jsonb) ? brand then brand := po->'brandAlias'->>brand; end if;
  chan := left(rb_t(p->'channel'), 100);
  for x in select jsonb_build_array(q.a, q.b, q.c) from (values ('cat', left(rb_t(p->'cat'), 30), '구분', 1), ('brand', brand, '브랜드', 2), ('channel', chan, '채널', 3), ('team', left(rb_t(p->'team'), 100), '발주요청팀', 4)) q(a, b, c, d) order by q.d loop
    if (x->>1) <> '' and not coalesce((ch->(x->>0)) ? (x->>1), false) then bad := bad || ((x->>2) || ' "' || (x->>1) || '"'); end if;
  end loop;
  if brand <> '' and chan <> '' and jsonb_typeof(ch->'chByBrand'->brand) = 'array' and not ((ch->'chByBrand'->brand) ? chan) then
    bad := bad || ('채널 "' || chan || '"(' || brand || ' 채널은 ' || (select string_agg(y, ', ' order by o) from jsonb_array_elements_text(ch->'chByBrand'->brand) with ordinality t(y, o)) || ')');
  end if;
  if coalesce(array_length(bad, 1), 0) > 0 then raise exception '% 은(는) 목록에 없는 값입니다. 드롭다운에서 골라 주세요(목록은 관리자 화면에서 바꿉니다).', array_to_string(bad, ' · '); end if;
  if not (qty > 0) and not (newItem and left(rb_t(p->'qty'), 100) = '') then raise exception '발주수량을 넣어주세요.'; end if;
  if not priceE and not (price >= 0) then raise exception '단가가 올바르지 않습니다.'; end if;
  due := case when rb_po_truthy(p->'due') then btrim(coalesce(p->>'due', rb_t(p->'due'))) else '' end;
  useBy := case when rb_po_truthy(p->'useBy') then btrim(coalesce(p->>'useBy', rb_t(p->'useBy'))) else '' end;
  if (rb_po_truthy(p->'due') and (jsonb_typeof(p->'due') <> 'string' or due !~ '^\d{4}-\d{1,2}-\d{1,2}$'))
     or (rb_po_truthy(p->'useBy') and (jsonb_typeof(p->'useBy') <> 'string' or useBy !~ '^\d{4}-\d{1,2}-\d{1,2}$')) then raise exception '날짜는 달력에서 골라주세요.'; end if;
  code := left(rb_t(p->'code'), 100);

  -- ---- 잠금 · 켜짐 ----
  perform pg_advisory_xact_lock(hashtext('rb_tab_pd'));
  pc := rb_pd_ready('rb_co_create');
  po := rb_po_conf('co');
  if newItem and code <> '' then raise exception 'RB_FALLBACK 신제품 코드 확인(품목 DB · BOM · 채번)은 서버 길'; end if;
  T := pc->>'tab'; hr := coalesce((pc->>'hr')::int, 1); idc := (pc->>'idc')::int; sc := (pc->>'state')::int;
  if idc is null or idc < 0 or sc is null or sc < 0 then raise exception '발주 DB에 [실행판ID] · [진행상태] 열이 없습니다. 관리자에게 알려 주세요.'; end if;
  S := po->'cols';
  if coalesce((S->>'name')::int, -1) < 0 or coalesce((S->>'qty')::int, -1) < 0 then raise exception '발주 DB에서 [품목명] / [발주수량] 열을 찾을 수 없습니다.'; end if;
  if coalesce((S->>'team')::int, -1) < 0 then raise exception 'RB_FALLBACK 발주 DB 에 발주요청팀 열 없음(부가정보 탭 길)'; end if;
  id := case when rb_t(p->'id') ~ '^RB\d{6}-[0-9A-F]{6}$' then rb_t(p->'id')
             else 'RB' || to_char(now() at time zone 'Asia/Seoul', 'YYMMDD') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6)) end;
  china := strpos(left(rb_t(p->'vendor'), 100), coalesce(po->'china'->>'kw', '중국')) > 0;
  mul := case when china then coalesce((po->'china'->>'mul')::numeric, 200) else 1 end;

  -- 이미 저장된 ID(응답만 잃고 다시 보냄) — 그 행을 돌려준다. 지급 줄이 빠졌으면 서버 길(이어 쓰기)
  select "row" into ex from sheet_rows where tab = T and "row" > hr and rb_t(cells->idc) = id order by "row" desc limit 1;
  if ex is not null then
    if not exists (select 1 from sheet_rows where tab = LT and "row" > 1 and rb_t(cells->0) = id) then
      -- 지급 줄이 없어도 되는 건(선금 · 잔금 0)이면 그대로, 아니면 서버 길
      if (rb_num(p->'pre') > 0 and rb_po_ym(left(rb_t(p->'preAt'), 40)) <> '') or (rb_num(p->'bal') > 0 and rb_po_ym(left(rb_t(p->'balAt'), 40)) <> '') then
        raise exception 'RB_FALLBACK 지급 줄 이어 쓰기(서버 길)';
      end if;
    end if;
    if code <> '' and rb_code_key(code) !~ '^[A-Z]Z0000$' and coalesce(po->'parts'->>'it', '') = '1' then
      perform rb_po_item_add(e, jsonb_build_object('code', code, 'name', nm, 'brand', left(rb_t(p->'brand'), 100), 'channel', chan, 'vendor', left(rb_t(p->'vendor'), 100),
        'price', case when priceE then to_jsonb(''::text) else to_jsonb(price) end, 'barcode', left(rb_t(p->'barcode'), 40), 'cat', left(rb_t(p->'cat'), 30)), '실행판 발주 등록 ' || id);
    end if;
    return jsonb_build_object('id', id, 'statusRow', ex, 'already', true, 'warn', '', 'direct', 1);
  end if;

  perform rb_pd_busy(id);      -- 같은 ID 의 앞선 할 일(예전 길로 접수된 같은 등록 등)이 남았으면 서버 길(차례)

  -- ---- 지급 줄 사본 준비(머리글 · 시트 맞추기 중) ----
  if coalesce(po->'parts'->>'ln', '') <> '1' then raise exception 'RB_FALLBACK 지급 줄 직접 저장 꺼짐(%)', coalesce(po->'why_'->>'ln', ''); end if;
  if exists (select 1 from rb_conf g where g.k = 'gate:rb_ln_save' and coalesce(g.v->>'on', '') = '1') then raise exception 'RB_FALLBACK 지급 줄 시트 맞추기 중'; end if;
  if (select cells from sheet_rows where tab = LT and "row" = 1) is distinct from '["실행판ID","줄ID","종류","입고일","수량","금액","지급월","메모","만든곳","수정시각","채널"]'::jsonb then
    raise exception 'RB_FALLBACK 지급 줄 머리글이 다름';
  end if;
  if code <> '' and rb_code_key(code) !~ '^[A-Z]Z0000$' and coalesce(po->'parts'->>'it', '') <> '1' then raise exception 'RB_FALLBACK 품목 DB 직접 저장 꺼짐'; end if;

  -- ---- 발주 DB 새 줄(writeStatusRows_) ----
  rw := coalesce((select max("row") from sheet_rows where tab = T and "row" > hr and rb_t(cells->((S->>'name')::int)) <> ''), hr) + 1;
  select coalesce(sr.cells, '[]'::jsonb) into rc from sheet_rows sr where sr.tab = T and sr."row" = rw;
  rc := coalesce(rc, '[]'::jsonb);
  hasParts := coalesce((S->>'hasParts')::boolean, false); pm := coalesce((S->>'partial')::int, 20);
  dueD := case when due <> '' then rb_po_todate(due) end;
  useD := case when useBy <> '' then rb_po_todate(useBy) end;
  madeIso := nowiso;
  cur := upper(rb_t(p->'cur'));
  cur := case when cur in ('KRW', 'CNY', 'USD') then cur when china then 'CNY' else 'KRW' end;
  qv := to_jsonb(case when newItem and left(rb_t(p->'qty'), 100) = '' then 0 else qty end);      -- writeStatusRows_ 는 num_('') = 0
  pv := case when priceE then to_jsonb(''::text) else to_jsonb(price) end;
  preAt := left(rb_t(p->'preAt'), 40); balAt := left(rb_t(p->'balAt'), 40);
  -- 넣을 칸: [열, 보이는 값(사본), 쓴 값(시트)] — 차례는 writeStatusRows_ 그대로(같은 열이면 뒤가 이김)
  for x in select * from jsonb_array_elements(jsonb_build_array(
      jsonb_build_array(idc, id, id),
      jsonb_build_array(sc, '계획', '계획'),
      jsonb_build_array(S->'doc', '', ''),
      jsonb_build_array(S->'brand', brand, brand),
      jsonb_build_array(S->'channel', chan, chan),
      jsonb_build_array(S->'code', code, case when code = '' then '' else '''' || code end),
      jsonb_build_array(S->'batch', left(rb_t(p->'batch'), 20), case when left(rb_t(p->'batch'), 20) = '' then '' else '''' || left(rb_t(p->'batch'), 20) end),
      jsonb_build_array(S->'name', nm, '''' || nm),
      jsonb_build_array(S->'qty', qv, qv),
      jsonb_build_array(S->'vendor', left(rb_t(p->'vendor'), 100), left(rb_t(p->'vendor'), 100)),
      jsonb_build_array(S->'price', pv, pv),
      jsonb_build_array(S->'owner', left(rb_t(p->'owner'), 40), left(rb_t(p->'owner'), 40)),
      jsonb_build_array(S->'ordered', '', ''),
      jsonb_build_array(S->'due', rb_po_tok(due), rb_po_tok(due)),
      jsonb_build_array(S->'eta', case when dueD is null then '' else to_char(dueD, 'YY/MM/DD') end, case when dueD is null then '' else '''' || to_char(dueD, 'YY/MM/DD') end)
    )) loop
    c := case when jsonb_typeof(x->0) = 'number' then (x->>0)::int else -1 end;
    if c < 0 then continue; end if;
    rc := rb_po_set(rc, c, case when x->1 = '""'::jsonb then 'null'::jsonb else x->1 end);
    raw := raw || jsonb_build_object((c + 1)::text, x->2);
  end loop;
  if hasParts and coalesce((S->>'inQty')::int, -1) >= 0 then
    for i in 1 .. pm loop c := (S->>'inQty')::int + i; rc := rb_po_set(rc, c, 'null'::jsonb); raw := raw || jsonb_build_object((c + 1)::text, ''); end loop;
  end if;
  for x in select * from jsonb_array_elements(jsonb_build_array(
      jsonb_build_array(S->'cur', cur, cur),
      jsonb_build_array(S->'rec', '', ''),
      jsonb_build_array(S->'inQty', 0, 0),
      jsonb_build_array(S->'remain', qv, qv),
      jsonb_build_array(S->'memo', left(rb_t(p->'memo'), 500), case when left(rb_t(p->'memo'), 500) = '' then '' else '''' || left(rb_t(p->'memo'), 500) end),
      jsonb_build_array(S->'cat', left(rb_t(p->'cat'), 30), left(rb_t(p->'cat'), 30)),
      jsonb_build_array(S->'madeAt', madeIso, jsonb_build_object('d', madeIso)),
      jsonb_build_array(S->'team', left(rb_t(p->'team'), 100), left(rb_t(p->'team'), 100)),
      jsonb_build_array(S->'reqOwner', left(rb_t(p->'reqOwner'), 40), left(rb_t(p->'reqOwner'), 40)),
      jsonb_build_array(S->'useBy', case when useD is null then '' else rb_po_diso(useD) end, case when useD is null then to_jsonb(''::text) else jsonb_build_object('d', rb_po_diso(useD)) end),
      jsonb_build_array(S->'preAt', case when preAt ~ '^\d{4}-\d{1,2}-\d{1,2}$' then coalesce(rb_po_diso(rb_po_todate(preAt)), '') else preAt end,
                                     case when preAt ~ '^\d{4}-\d{1,2}-\d{1,2}$' then case when rb_po_todate(preAt) is null then to_jsonb(''::text) else jsonb_build_object('d', rb_po_diso(rb_po_todate(preAt))) end else to_jsonb(preAt) end),
      jsonb_build_array(S->'pre', case when p->'pre' is null or jsonb_typeof(p->'pre') = 'null' or p->'pre' = '""'::jsonb then to_jsonb(''::text) else to_jsonb(rb_num(p->'pre')) end,
                                  case when p->'pre' is null or jsonb_typeof(p->'pre') = 'null' or p->'pre' = '""'::jsonb then to_jsonb(''::text) else to_jsonb(rb_num(p->'pre')) end),
      jsonb_build_array(S->'balAt', case when balAt ~ '^\d{4}-\d{1,2}-\d{1,2}$' then coalesce(rb_po_diso(rb_po_todate(balAt)), '') else balAt end,
                                     case when balAt ~ '^\d{4}-\d{1,2}-\d{1,2}$' then case when rb_po_todate(balAt) is null then to_jsonb(''::text) else jsonb_build_object('d', rb_po_diso(rb_po_todate(balAt))) end else to_jsonb(balAt) end),
      jsonb_build_array(S->'bal', case when p->'bal' is null or jsonb_typeof(p->'bal') = 'null' or p->'bal' = '""'::jsonb then to_jsonb(''::text) else to_jsonb(rb_num(p->'bal')) end,
                                  case when p->'bal' is null or jsonb_typeof(p->'bal') = 'null' or p->'bal' = '""'::jsonb then to_jsonb(''::text) else to_jsonb(rb_num(p->'bal')) end),
      jsonb_build_array(S->'link', left(rb_t(p->'link'), 500), left(rb_t(p->'link'), 500))
    )) loop
    c := case when jsonb_typeof(x->0) = 'number' then (x->>0)::int else -1 end;
    if c < 0 then continue; end if;
    rc := rb_po_set(rc, c, case when x->1 = '""'::jsonb then 'null'::jsonb else x->1 end);
    raw := raw || jsonb_build_object((c + 1)::text, x->2);
  end loop;
  -- 발주금액: 시트는 수식, 사본은 수량 × 단가 값(tvVirtualCommit_)
  if coalesce((S->>'amt')::int, -1) >= 0 and coalesce((S->>'price')::int, -1) >= 0 then
    amt := case when priceE then 'null'::jsonb else to_jsonb((qv #>> '{}')::float8 * price::float8) end;
    rc := rb_po_set(rc, (S->>'amt')::int, amt);
    raw := raw || jsonb_build_object(((S->>'amt')::int + 1)::text, '=IF(OR(' || rb_po_col((S->>'qty')::int + 1) || rw || '="",' || rb_po_col((S->>'price')::int + 1) || rw || '=""),"",'
      || rb_po_col((S->>'qty')::int + 1) || rw || '*' || rb_po_col((S->>'price')::int + 1) || rw || ')');
  end if;

  -- ---- 선금 · 잔금 → 지급 줄(linesForNewOrder_) ----
  preAmt := case when p->'pre' is null or jsonb_typeof(p->'pre') = 'null' or p->'pre' = '""'::jsonb then 0 else rb_num(p->'pre') end;
  balAmt := case when p->'bal' is null or jsonb_typeof(p->'bal') = 'null' or p->'bal' = '""'::jsonb then 0 else rb_num(p->'bal') end;
  if balAuto then balAmt := balAmt * mul; end if;
  if preAmt > 0 then
    pd := rb_po_todate(preAt);
    L := L || jsonb_build_array(jsonb_build_object('kind', '선금', 'date', case when pd is null then '' else to_char(pd, 'YYYY-MM-DD') end, 'qty', '', 'amt', round(preAmt), 'payYm', rb_po_ym(preAt), 'memo', '등록 때 선금'));
  end if;
  if balAmt > 0 then
    L := L || jsonb_build_array(jsonb_build_object('kind', '예정', 'date', due, 'qty', (qv #>> '{}')::numeric, 'amt', round(balAmt), 'payYm', rb_po_ym(balAt), 'memo', '등록 때 잔금'));
  end if;
  L := (select coalesce(jsonb_agg(y order by o), '[]'::jsonb) from jsonb_array_elements(L) with ordinality t(y, o) where y->>'payYm' <> '');
  if preAmt > 0 and rb_po_ym(preAt) = '' then missed := missed || to_jsonb('선금 지급예정을 날짜로 못 읽음'::text); end if;
  if balAmt > 0 and rb_po_ym(balAt) = '' then missed := missed || to_jsonb('잔금 지급예정을 날짜로 못 읽음'::text); end if;

  perform pg_advisory_xact_lock(hashtext('rb_tab_ln'));
  if exists (select 1 from sheet_rows where tab = LT and "row" > 1 and rb_t(cells->0) = id) then raise exception 'RB_FALLBACK 이 ID 의 지급 줄이 이미 있음'; end if;
  select coalesce(max("row"), 1) into last_ from sheet_rows where tab = LT;
  select coalesce(array_agg(g order by g), '{}') into free from generate_series(2, last_) g
    where not exists (select 1 from sheet_rows s where s.tab = LT and s."row" = g and rb_t(s.cells->0) <> '');
  for x in select * from jsonb_array_elements(L) loop
    seq := seq + 1; lid := id || '-n' || seq;
    if coalesce(array_length(free, 1), 0) > 0 then r := free[1]; free := free[2:]; else last_ := last_ + 1; r := last_; end if;
    dt := rb_t(x->'date'); diso := '';
    if rb_po_todate(dt) is not null then diso := rb_po_diso(rb_po_todate(dt)); end if;
    nc := jsonb_build_array(id, lid, x->'kind', case when diso <> '' then to_jsonb(diso) when dt <> '' then to_jsonb(dt) else 'null'::jsonb end,
      case when rb_t(x->'qty') = '' then 'null'::jsonb else to_jsonb(rb_num(x->'qty')) end, to_jsonb(rb_num(x->'amt')), x->'payYm', x->'memo', '실행판 등록', nowiso, null);
    rwv := jsonb_build_array(id, lid, x->'kind', case when diso <> '' then jsonb_build_object('d', diso) when dt <> '' then to_jsonb(dt) else to_jsonb(''::text) end,
      case when rb_t(x->'qty') = '' then to_jsonb(''::text) else to_jsonb(rb_num(x->'qty')) end, to_jsonb(rb_num(x->'amt')), x->'payYm', to_jsonb('''' || (x->>'memo')), '실행판 등록', jsonb_build_object('d', nowiso), '');
    insert into sheet_rows(tab, "row", cells, synced_at) values (LT, r, nc, now()) on conflict (tab, "row") do update set cells = excluded.cells, synced_at = excluded.synced_at;
    rows_ := rows_ || jsonb_build_object(r::text, jsonb_build_object('c', 1, 'v', rwv, 'f', 1));
    lines := lines || jsonb_build_array(jsonb_build_object('id', id, 'lineId', lid, 'kind', x->'kind',
      'date', case when diso <> '' then to_char(rb_po_todate(dt), 'YYYY-MM-DD') else dt end,
      'qty', case when rb_t(x->'qty') = '' then to_jsonb(''::text) else to_jsonb(rb_num(x->'qty')) end, 'amt', rb_num(x->'amt'), 'payYm', x->'payYm', 'memo', x->'memo', 'ch', ''));
  end loop;

  -- ---- 발주 행 맞추기(syncOrderFromLines_) — 새 건: 입고 0 · 잔량 = 수량 · 다 받았으면(수량 0) 입고일정 비움 ----
  remain := greatest(0, (qv #>> '{}')::numeric);
  if remain = 0 or exists (select 1 from jsonb_array_elements(lines) y where y->>'kind' = '예정' and rb_t(y->'date') <> '') then
    select coalesce(string_agg(d, ', ' order by d0), '') into eta from (
      select distinct on (dd) dd as d, dd as d0 from (select case when rb_po_todate(rb_t(y->'date')) is not null then to_char(rb_po_todate(rb_t(y->'date')), 'YY/MM/DD') else rb_t(y->'date') end dd
        from jsonb_array_elements(lines) y where y->>'kind' = '예정' and rb_t(y->'date') <> '') q) q2;
    if coalesce((S->>'eta')::int, -1) >= 0 then
      rc := rb_po_set(rc, (S->>'eta')::int, case when eta = '' then 'null'::jsonb else to_jsonb(eta) end);
      raw := raw || jsonb_build_object(((S->>'eta')::int + 1)::text, case when eta = '' then '' else '''' || eta end);
    end if;
  end if;
  if coalesce((S->>'arr')::int, -1) >= 0 and rb_t(rc->((S->>'arr')::int)) <> '' then
    rc := rb_po_set(rc, (S->>'arr')::int, 'null'::jsonb); raw := raw || jsonb_build_object(((S->>'arr')::int + 1)::text, '');
  end if;

  insert into sheet_rows(tab, "row", cells, synced_at) values (T, rw, rc, now()) on conflict (tab, "row") do update set cells = excluded.cells, synced_at = excluded.synced_at;
  -- 시트 맞추기: 쓴 칸만(빈 값은 안 씀 — 빈 줄에 미리 걸린 수식 · 서식을 지우지 않게 · tvVirtualCommit_ 새 줄과 같게)
  select coalesce(jsonb_object_agg(kk, vv), '{}'::jsonb) into wadd from jsonb_each(raw) t(kk, vv) where vv <> '""'::jsonb and jsonb_typeof(vv) <> 'null';
  insert into rb_tab_job(tab, job) values ('pdx', jsonb_build_object('k', 'pd', 'at', ms, 'who', e, 'rows', '[]'::jsonb, 'add', jsonb_build_array(jsonb_build_object('id', id, 'row', rw, 'w', wadd))));
  if jsonb_array_length(lines) > 0 then
    insert into rb_tab_job(tab, job) values ('ln', jsonb_build_object('k', 'ln', 'at', ms, 'rows', rows_, 'post', jsonb_build_object('id', id, 'changed', true, 'hist', '[]'::jsonb, 'who', e)));
  end if;

  -- ---- 품목 DB(regItem — 일회성 코드 빼고 · 없으면 넣고 · 바코드가 비었으면 채움) ----
  if code <> '' and rb_code_key(code) !~ '^[A-Z]Z0000$' then
    perform rb_po_item_add(e, jsonb_build_object('code', code, 'name', nm, 'brand', left(rb_t(p->'brand'), 100), 'channel', chan, 'vendor', left(rb_t(p->'vendor'), 100),
      'price', pv, 'barcode', left(rb_t(p->'barcode'), 40), 'cat', left(rb_t(p->'cat'), 30)), '실행판 발주 등록 ' || id);
    if left(rb_t(p->'barcode'), 40) <> '' then
      select "row" into i from sheet_rows where tab = '_실행판_품목' and "row" > 1 and rb_code_key(rb_t(cells->0)) = rb_code_key(code) order by "row" limit 1;
      if i is not null and rb_t((select cells->6 from sheet_rows where tab = '_실행판_품목' and "row" = i)) = '' then
        update sheet_rows set cells = rb_po_set(cells, 6, to_jsonb(left(rb_t(p->'barcode'), 40))), synced_at = now() where tab = '_실행판_품목' and "row" = i;
        insert into rb_tab_job(tab, job) values ('it', jsonb_build_object('code', rb_code_key(code), 'set', jsonb_build_object('barcode', left(rb_t(p->'barcode'), 40)), 'hist', '[]'::jsonb, 'nsync', false, 'who', e));
      end if;
    end if;
  end if;

  -- ---- 뒷정리(이력 '실행판 신규 등록' · 통화 기록 · 캐시 · AP) — 할 일 차례 ----
  curDef := case when china then 'CNY' else 'KRW' end;
  audits := jsonb_build_array(jsonb_build_object('row', rw, 'col', idc + 1, 'what', '실행판 신규 등록', 'before', '', 'after', id, 'item', nm, 'id', id, 'doc', '',
    'code', case when coalesce((S->>'code')::int, -1) >= 0 then code else '' end));
  mt := jsonb_build_object('kind', 'create', 'id', id, 'row', rw, 'audits', audits, 'ap', true);
  if upper(rb_t(p->'cur')) in ('KRW', 'CNY', 'USD') and upper(rb_t(p->'cur')) <> curDef then
    mt := mt || jsonb_build_object('cur', upper(rb_t(p->'cur')), 'meta', jsonb_build_object('name', nm, 'batch', left(rb_t(p->'batch'), 20), 'brand', left(rb_t(p->'brand'), 100), 'code', code));
  end if;
  insert into rb_tab_job(tab, job) values ('pj', jsonb_build_object('fn', '_poPost', 'who', e, 'at', ms, 'args', jsonb_build_array(mt)));
  perform rb_pd_ver(e);

  out := jsonb_build_object('lines', lines, 'pay', jsonb_build_object('missed', missed), 'warn', '', 'id', id, 'statusRow', rw, 'direct', 1);
  return out;
end $f$;
create or replace function rb_co_create(p_token text, p_args jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
begin return rb_co_create_do(rb_po_me(p_token), coalesce(p_args, '[]'::jsonb)); end $f$;

-- 서버(서비스 키)만: 켜짐 · 열 위치 · 목록 올리기 — rb_tab_pd 잠금(진행 중인 직접 저장이 끝난 뒤 바뀜)
create or replace function rb_po_conf_put(p_conf jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
begin
  perform pg_advisory_xact_lock(hashtext('rb_tab_pd'));
  insert into rb_conf (k, v, at) values ('poConf', p_conf, now()) on conflict (k) do update set v = excluded.v, at = excluded.at;
  return jsonb_build_object('ok', true, 'on', p_conf->>'on');
end $f$;

revoke all on function rb_po_truthy(jsonb) from public, anon, authenticated;
revoke all on function rb_po_todate(text) from public, anon, authenticated;
revoke all on function rb_po_diso(date) from public, anon, authenticated;
revoke all on function rb_po_nowiso() from public, anon, authenticated;
revoke all on function rb_po_ym(text) from public, anon, authenticated;
revoke all on function rb_po_tok(text) from public, anon, authenticated;
revoke all on function rb_po_col(int) from public, anon, authenticated;
revoke all on function rb_po_set(jsonb, int, jsonb) from public, anon, authenticated;
revoke all on function rb_po_cat(text, text) from public, anon, authenticated;
revoke all on function rb_po_me(text) from public, anon, authenticated;
revoke all on function rb_po_conf(text) from public, anon, authenticated;
revoke all on function rb_po_item_add(text, jsonb, text) from public, anon, authenticated;
revoke all on function rb_item_reg_do(text, jsonb) from public, anon, authenticated;
revoke all on function rb_vendor_norm(text) from public, anon, authenticated;
revoke all on function rb_vendor_list(jsonb, jsonb) from public, anon, authenticated;
revoke all on function rb_vendor_add_do(text, jsonb) from public, anon, authenticated;
revoke all on function rb_co_create_do(text, jsonb) from public, anon, authenticated;
revoke all on function rb_po_conf_put(jsonb) from public, anon, authenticated;
revoke all on function rb_item_reg(text, jsonb) from public;
revoke all on function rb_vendor_add(text, jsonb) from public;
revoke all on function rb_co_create(text, jsonb) from public;
grant execute on function rb_item_reg(text, jsonb) to anon, authenticated;
grant execute on function rb_vendor_add(text, jsonb) to anon, authenticated;
grant execute on function rb_co_create(text, jsonb) to anon, authenticated;
