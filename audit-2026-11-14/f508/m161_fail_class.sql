-- m161_fail_class — 저장 실패 갈래 바로잡기(현재 정의 그대로 + 고친 줄만)
--  ① rb_bom_fixmany_do · rb_bom_fmshare_do: 안쪽 오류(SQLSTATE ≠ P0001 — 형식 · null · deadlock …)를 '… — 저장하지 않았습니다.'(사람 오류)로 바꾸던 것을 원래 오류 그대로 → 화면이 서버 길로
--  ② 열 위치(사본 설정)가 없어서 막던 것 = 시트에는 있을 수 있음 → RB_FALLBACK(서버 길이 시트 머리글로 판단)
CREATE OR REPLACE FUNCTION public.rb_bom_fixmany_do(e text, a jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare m text; st text;
begin
  if jsonb_typeof(a->'shares') = 'array' and jsonb_array_length(a->'shares') > 0 then raise exception 'RB_FALLBACK 공용 줄 더(shares)'; end if;
  if jsonb_typeof(a->'commons') = 'array' and jsonb_array_length(a->'commons') > 0 then raise exception 'RB_FALLBACK 공용 표시(commons)'; end if;
  if rb_t(a->'why') = '' then raise exception '정정 사유를 적어 주세요.'; end if;
  begin
    return rb_bom_fixmany_core(e, a);
  exception when others then
    get stacked diagnostics m = message_text, st = returned_sqlstate;
      if st <> 'P0001' then raise; end if;      -- m161: 시간 초과 · 잠금 · 형식 같은 안쪽 오류는 그대로(화면이 서버 길로 — '저장하지 않았습니다' 사람 오류로 바꾸지 않음)
    if m like 'RB_FALLBACK%' or m like 'RB_SESSION%' then raise exception '%', m; end if;
    raise exception '% — 저장하지 않았습니다.', m;
  end;
end $function$;
CREATE OR REPLACE FUNCTION public.rb_bom_fmshare_do(e text, a jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  st text;
  P text := upper(btrim(coalesce(a->>'product', ''))); why text := left(coalesce(nullif(rb_t(a->'why'), ''), '반제품 구성에 공용 자재 같이 넣기'), 200);
  op text := left(rb_t(a->'op'), 60); hit text; conf jsonb; head jsonb; sh jsonb; sm jsonb; it jsonb; x jsonb; rid text; sc text;
  semis text[] := '{}'; srcIds text[] := '{}'; has jsonb := '{}'::jsonb; k text; nShared int := 0; si int;
  stamp text := to_char(now() at time zone 'Asia/Seoul', 'YY/MM/DD'); nowiso text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  maxB int; maxSr int; newId text; fm jsonb; ch_ jsonb; ins jsonb := '{}'::jsonb; upd jsonb := '{}'::jsonb; logs jsonb := '[]'::jsonb; copies jsonb; many jsonb; doneCm text[];
  tag text; lsr int; lg jsonb; res jsonb := null; m text; scs text;
begin
  if rb_t(a->'why') = '' then raise exception '정정 사유를 적어 주세요.'; end if;
  conf := rb_bom_guard(false); head := conf->'head';
  if rb_bom_hidx(head, 'semi') is null then raise exception 'RB_FALLBACK 반제품 구성 칸 없음'; end if;
  perform pg_advisory_xact_lock(hashtext('rb_bom'));
  perform rb_bom_guard(true);
  if op <> '' then
    select rv into hit from rb_recent where rk = 'op:bomfs:' || op and rat > now() - interval '30 minutes';
    if hit is not null then return hit::jsonb || '{"duplicate":true}'::jsonb; end if;
  end if;
  select coalesce(max(substring(b.id from '^B(\d+)$')::int), 0) into maxB from bom_rows b where b.id ~ '^B\d+$';
  -- 공용 줄 더(서버 apiBomSemiShare — shares 마다: 반제품 줄 · 자재 줄 → 그 반제품 구성에도 한 줄 더 · 원래 줄도 공용)
  for sh in select y from jsonb_array_elements(coalesce(a->'shares', '[]'::jsonb)) y loop
    semis := '{}'; srcIds := '{}'; copies := '[]'::jsonb; many := '[]'::jsonb; doneCm := '{}';
    for sm in select y from jsonb_array_elements(case when jsonb_typeof(sh->'semi') = 'array' then sh->'semi' else jsonb_build_array(sh->'semi') end) y loop
      if not exists (select 1 from bom_rows b where upper(b.product) = P and upper(b.code) = upper(rb_t(sm->'code')) and b.type = '반제품') then
        raise exception 'BOM 탭이 그사이 바뀌었습니다(반제품 %). BOM 보기를 다시 열어 주세요.', rb_t(sm->'code'); end if;
      semis := semis || upper(rb_t(sm->'code'));
    end loop;
    has := (select coalesce(jsonb_object_agg(upper(b.semi) || '|' || upper(b.code), 1), '{}'::jsonb) from bom_rows b where upper(b.product) = P and coalesce(b.semi, '') <> '');
    for it in select y from jsonb_array_elements(coalesce(sh->'items', '[]'::jsonb)) y loop
      rid := null;
      if rb_t(it->'id') <> '' then select b.id into rid from bom_rows b where b.id = rb_t(it->'id') and upper(b.product) = P and upper(b.code) = upper(rb_t(it->'code')) and coalesce(b.start_round, '') = rb_t(it->'start'); end if;
      if rid is null then select case when count(*) = 1 then min(b.id) end into rid from bom_rows b where upper(b.product) = P and upper(b.code) = upper(rb_t(it->'code')) and coalesce(b.start_round, '') = rb_t(it->'start'); end if;
      if rid is null then raise exception 'BOM 탭이 그사이 바뀌었습니다(%). BOM 보기를 다시 열어 주세요.', rb_t(it->'code'); end if;
      if (select b.type from bom_rows b where b.id = rid) in ('제품', '세트', '반제품') then raise exception '% 는 자재 줄이 아닙니다.', rb_t(it->'code'); end if;
      if not exists (select 1 from sheet_rows s where s.tab = '_bomfml:' || rid and s."row" = 0) then raise exception 'RB_FALLBACK 수식 모름'; end if;
      srcIds := srcIds || rid;
    end loop;
    if coalesce(array_length(srcIds, 1), 0) = 0 then continue; end if;
    scs := array_to_string(semis, ', ');
    for si in 1 .. coalesce(array_length(semis, 1), 0) loop
      sc := semis[si];
      foreach rid in array srcIds loop
        select to_jsonb(b) into x from bom_rows b where b.id = rid;
        k := sc || '|' || upper(rb_t(x->'code'));
        if has ? k then continue; end if;
        has := has || jsonb_build_object(k, 1);
        select cells into fm from sheet_rows s where s.tab = '_bomfml:' || rid and s."row" = 0;
        select coalesce(max(b.sheet_row), 2) into maxSr from bom_rows b;
        maxB := maxB + 1; newId := 'B' || lpad(maxB::text, 6, '0');
        copies := copies || jsonb_build_array(jsonb_build_object('code', upper(rb_t(x->'code')), 'start', rb_t(x->'start_round'), 'semi', sc, 'type', rb_t(x->'type'), 'common', rb_t(x->'common'), 'id', rid));
        ch_ := jsonb_build_object('r', x || jsonb_build_object('id', newId, 'sheet_row', maxSr + 1, 'semi', sc, 'common', '공용', 'first_at', null, 'old_code', null,
          'change', sc || ' 구성에 같이 넣음(공용 · ' || (x->>'sheet_row') || '행과 같은 자재) · ' || stamp), 'f', coalesce(fm, '{}'::jsonb));
        x := rb_bom_evalrow(ch_->'r', ch_->'f', head);
        insert into bom_rows select * from jsonb_populate_record(null::bom_rows, (x - 'synced_at') || jsonb_build_object('synced_at', now()));
        insert into sheet_rows(tab, "row", cells, synced_at) values ('_bomfml:' || newId, 0, coalesce(fm, '{}'::jsonb), now()) on conflict (tab, "row") do update set cells = excluded.cells, synced_at = excluded.synced_at;
        ins := ins || jsonb_build_object(newId, rid);
        if rb_bom_hidx(head, 'common') is not null and coalesce((select b.common from bom_rows b where b.id = rid), '') <> '공용' and not (rid = any(doneCm)) then
          many := many || jsonb_build_array(jsonb_build_object('product', P, 'code', upper(rb_t(x->'code')), 'start', rb_t(x->'start_round'), 'id', rid, 'prev', jsonb_build_object('common', coalesce((select b.common from bom_rows b where b.id = rid), ''))));
          update bom_rows b set common = '공용', synced_at = now() where b.id = rid;
          upd := upd || jsonb_build_object(rid, jsonb_build_object('common', 'v')); doneCm := doneCm || rid;
        end if;
        nShared := nShared + 1;
      end loop;
    end loop;
    if jsonb_array_length(copies) = 0 then continue; end if;
    tag := substr(md5(random()::text || clock_timestamp()::text), 1, 8) || '-sh';
    logs := logs || jsonb_build_array(jsonb_build_array(jsonb_build_object('d', nowiso), e, P, '', '', '반제품 구성 공용', '반제품', scs, scs, '-',
      '같이 넣음 ' || (select string_agg(c->>'type' || ' ' || (c->>'code'), ', ') from jsonb_array_elements(copies) c), why, '', '유효', tag,
      jsonb_build_object('v2', 1, 'copyRefs', (select jsonb_agg(jsonb_build_object('code', c->'code', 'start', c->'start', 'semi', c->'semi')) from jsonb_array_elements(copies) c), 'many', many)::text));
  end loop;
  if nShared = 0 and jsonb_array_length(coalesce(a->'items', '[]'::jsonb)) = 0 then raise exception '고른 자재가 이미 그 반제품 구성에 모두 들어 있습니다.'; end if;
  if jsonb_array_length(logs) > 0 then
    select coalesce(max(sheet_row), 1) into lsr from bom_log;
    for lg in select y from jsonb_array_elements(logs) y loop
      lsr := lsr + 1;
      insert into bom_log select * from jsonb_populate_record(null::bom_log, jsonb_build_object('sheet_row', lsr, 'at', nowiso, 'who', e, 'product', P, 'product_name', '', 'round', '',
        'kind', lg->>5, 'type', lg->>6, 'code_a', lg->>7, 'code_b', lg->>8, 'before', lg->>9, 'after', left(lg->>10, 2000), 'why', why, 'order_ref', '', 'state', '유효', 'change_id', lg->>14, 'synced_at', now()));
    end loop;
    insert into rb_tab_job(tab, job) values ('bom', jsonb_build_object('k', 'bom', 'v', 1, 'at', (extract(epoch from now()) * 1000)::bigint, 'who', e, 'product', P, 'tag', tag,
      'rep', jsonb_build_object('codes', jsonb_build_array(P), 'ins', ins, 'upd', upd, 'del', '{}'::jsonb), 'logs', logs,
      'hist', jsonb_build_array(jsonb_build_object('kind', 'BOM', 'code', P, 'item', P || ' 반제품 구성에 공용 자재 ' || nShared || '줄', 'after', '', 'reason', why, 'at', jsonb_build_object('d', nowiso), 'who', e)),
      'reg', '[]'::jsonb, 'price', '[]'::jsonb, 'unmark', '[]'::jsonb, 'made', '[]'::jsonb));
  end if;
  -- 칸 정정(같은 트랜잭션 — 막히면 공용 줄도 같이 취소). 칸은 그대로이고 공용 줄만 있으면 그것만
  if jsonb_array_length(coalesce(a->'items', '[]'::jsonb)) > 0 then
    begin
      res := rb_bom_fixmany_core(e, (a - 'shares' - 'commons' - 'op') || jsonb_build_object('op', ''));
    exception when others then
      get stacked diagnostics m = message_text, st = returned_sqlstate;
      if st <> 'P0001' then raise; end if;      -- m161: 시간 초과 · 잠금 · 형식 같은 안쪽 오류는 그대로(화면이 서버 길로 — '저장하지 않았습니다' 사람 오류로 바꾸지 않음)
      if not (m like '바뀐 값이 없습니다%' and nShared > 0) then
        if m like 'RB_FALLBACK%' or m like 'RB_SESSION%' then raise exception '%', m; end if;
        raise exception '% — 저장하지 않았습니다.', m;
      end if;
      res := null;
    end;
  end if;
  insert into rb_conf(k, v, at) values ('bomVer', jsonb_build_object('v', substr(md5(random()::text || clock_timestamp()::text), 1, 8), 'at', nowiso, 'by', e), now())
    on conflict on constraint rb_conf_pkey do update set v = excluded.v, at = excluded.at;
  if res is null then
    res := jsonb_build_object('ok', true, 'sb', 1, 'code', P, 'fixed', 0, 'made', '[]'::jsonb, 'saved', 0, 'logTag', '', 'splitMap', '{}'::jsonb,
      'rows', (select coalesce(jsonb_agg(to_jsonb(b) - 'synced_at' order by b.sheet_row, b.id), '[]'::jsonb) from bom_rows b where upper(b.product) = P),
      'log', (select coalesce(jsonb_agg(to_jsonb(l) - 'synced_at' order by l.sheet_row desc), '[]'::jsonb) from (select * from bom_log where upper(product) = P order by sheet_row desc limit 50) l));
  else
    res := res || jsonb_build_object('rows', (select coalesce(jsonb_agg(to_jsonb(b) - 'synced_at' order by b.sheet_row, b.id), '[]'::jsonb) from bom_rows b where upper(b.product) = P),
      'log', (select coalesce(jsonb_agg(to_jsonb(l) - 'synced_at' order by l.sheet_row desc), '[]'::jsonb) from (select * from bom_log where upper(product) = P order by sheet_row desc limit 50) l));
  end if;
  res := res || jsonb_build_object('shared', nShared);
  if op <> '' then
    insert into rb_recent(rk, rby, rv, rat) values ('op:bomfs:' || op, e, (res - 'rows' - 'log')::text, now())
      on conflict on constraint rb_recent_pkey do update set rby = excluded.rby, rv = excluded.rv, rat = excluded.rat;
  end if;
  return res;
end $function$;
CREATE OR REPLACE FUNCTION public.rb_co_create_do(e text, a jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if idc is null or idc < 0 or sc is null or sc < 0 then raise exception 'RB_FALLBACK 발주 DB 열 정보 없음(실행판ID · 진행상태)'; end if;
  S := po->'cols';
  if coalesce((S->>'name')::int, -1) < 0 or coalesce((S->>'qty')::int, -1) < 0 then raise exception 'RB_FALLBACK 발주 DB 열 정보 없음(품목명 · 발주수량)'; end if;
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
end $function$;
CREATE OR REPLACE FUNCTION public.rb_od_state_do(e text, a jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if sc is null or sc < 0 then raise exception 'RB_FALLBACK 진행상태 열 정보 없음'; end if;
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
end $function$;
CREATE OR REPLACE FUNCTION public.rb_od_bulk_do(e text, p_fn text, a jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    if ccode < 0 then raise exception 'RB_FALLBACK 품목코드 열 정보 없음'; end if;
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
  if p_fn = 'apiBulkDoc' and cdoc < 0 then raise exception 'RB_FALLBACK 품의번호 열 정보 없음'; end if;
  if p_fn = 'apiBulkOrderDate' and cord < 0 then raise exception 'RB_FALLBACK 발주일 열 정보 없음'; end if;
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
end $function$;
CREATE OR REPLACE FUNCTION public.rb_po_submit_do(e text, a jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if dc < 0 then raise exception 'RB_FALLBACK 품의번호 열 정보 없음'; end if;
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
end $function$;
CREATE OR REPLACE FUNCTION public.rb_bom_common_do(e text, a jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  C_ text := rb_code_key(rb_t(a->'code')); onv boolean := rb_bom_truthy(a->'on'); want text; op text := left(rb_t(a->'op'), 60); hit text;
  conf jsonb; y jsonb; n int := 0; upd jsonb := '{}'::jsonb; byP jsonb := '{}'::jsonb; ord text[] := '{}'; pc text; logs jsonb := '[]'::jsonb; lsr int; i int := 0; res jsonb; s text;
  tag text := substr(md5(random()::text || clock_timestamp()::text), 1, 8); nowiso text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if C_ = '' then raise exception '자재코드가 비었습니다.'; end if;
  want := case when onv then '공용' else '' end;
  conf := rb_bom_guard(false);
  if rb_bom_hidx(conf->'head', 'common') is null then raise exception 'RB_FALLBACK 공용여부 칸 정보 없음'; end if;
  perform pg_advisory_xact_lock(hashtext('rb_bom'));
  perform rb_bom_guard(true);
  if op <> '' then
    select rv into hit from rb_recent where rk = 'op:bomcm:' || op and rat > now() - interval '30 minutes';
    if hit is not null then return hit::jsonb || '{"duplicate":true}'::jsonb; end if;
  end if;
  for y in select to_jsonb(b) from bom_rows b where rb_code_key(b.code) = C_ order by b.sheet_row, b.id loop
    if rb_t(y->'common') = want then continue; end if;
    if rb_t(y->'id') = '' or rb_t(y->'id') ~ '^R\d' then raise exception 'RB_FALLBACK 줄ID 없는 줄'; end if;
    update bom_rows b set common = (jsonb_populate_record(b, jsonb_build_object('common', nullif(want, '')))).common, synced_at = now() where b.id = y->>'id';
    upd := upd || jsonb_build_object(y->>'id', jsonb_build_object('common', 'v'));
    pc := upper(rb_t(y->'product'));
    if not (byP ? pc) then ord := ord || pc; byP := byP || jsonb_build_object(pc, 0); end if;
    byP := jsonb_set(byP, array[pc], to_jsonb((byP->>pc)::int + 1));
    n := n + 1;
  end loop;
  foreach pc in array ord loop
    s := C_ || case when onv then ' 공용' else ' 공용 아님' end || ' ' || (byP->>pc) || '줄';
    logs := logs || jsonb_build_array(jsonb_build_array(jsonb_build_object('d', nowiso), e, pc, '', '', '공용 표시', '', left(C_, 200), left(C_, 200), '-', left(s, 300), '공용 표시', '', '-', tag || '-cm' || i, ''));
    i := i + 1;
  end loop;
  if n > 0 then
    select coalesce(max(sheet_row), 1) into lsr from bom_log;
    for i in 0 .. jsonb_array_length(logs) - 1 loop
      insert into bom_log select * from jsonb_populate_record(null::bom_log, jsonb_build_object('sheet_row', lsr + i + 1, 'at', nowiso, 'who', e, 'product', logs->i->>2, 'product_name', '', 'round', '',
        'kind', '공용 표시', 'type', '', 'code_a', C_, 'code_b', C_, 'before', '-', 'after', logs->i->>10, 'why', '공용 표시', 'order_ref', '', 'state', '-', 'change_id', logs->i->>14, 'synced_at', now()));
    end loop;
    insert into rb_conf(k, v, at) values ('bomVer', jsonb_build_object('v', tag, 'at', nowiso, 'by', e), now())
      on conflict on constraint rb_conf_pkey do update set v = excluded.v, at = excluded.at;
  end if;
  insert into rb_tab_job(tab, job) values ('bom', jsonb_build_object('k', 'bom', 'v', 1, 'at', (extract(epoch from now()) * 1000)::bigint, 'who', e, 'product', coalesce(ord[1], ''), 'tag', tag,
    'rep', jsonb_build_object('codes', to_jsonb(ord), 'ins', '{}'::jsonb, 'upd', upd, 'del', '{}'::jsonb), 'logs', logs,
    'hist', '[]'::jsonb, 'reg', '[]'::jsonb, 'price', '[]'::jsonb, 'unmark', '[]'::jsonb, 'made', '[]'::jsonb, 'cmoff', jsonb_build_object('codes', jsonb_build_array(C_), 'on', onv)));
  res := jsonb_build_object('ok', true, 'sb', 1, 'code', C_, 'changed', n, 'products', to_jsonb(ord));
  if op <> '' then
    insert into rb_recent(rk, rby, rv, rat) values ('op:bomcm:' || op, e, res::text, now())
      on conflict on constraint rb_recent_pkey do update set rby = excluded.rby, rv = excluded.rv, rat = excluded.rat;
  end if;
  return res;
end $function$;
