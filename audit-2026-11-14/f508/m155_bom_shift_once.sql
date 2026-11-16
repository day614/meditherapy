-- m155_bom_shift_once (sf2): 반제품 연결 · 되돌리기의 줄 당기기를 한 번에
create or replace function rb_bom_semilink_do(e text, a jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
declare
  P text := upper(btrim(coalesce(a->>'product', ''))); S text := upper(btrim(coalesce(a->>'semi', '')));
  N int := greatest(coalesce(rb_num(a->'round')::int, 0), 1); why text := left(coalesce(nullif(rb_t(a->'why'), ''), '반제품 BOM 으로 연결'), 200);
  semiStart int := coalesce(rb_num(a->'semiStart')::int, 0); op text := left(rb_t(a->'op'), 60); hit text;
  conf jsonb; head jsonb; it jsonb; x jsonb; rid text; ids text[] := '{}'; headId text; matIds text[] := '{}'; has boolean;
  stamp text := to_char(now() at time zone 'Asia/Seoul', 'YY/MM/DD'); nowiso text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  tag text := substr(md5(random()::text || clock_timestamp()::text), 1, 8) || '-sl';
  maxB int; maxSr int; newId text; semiName text; ch_ jsonb; fm jsonb; made int := 0; ended int := 0; endTo text := (N - 1) || '차';
  newRefs jsonb := '[]'::jsonb; many jsonb := '[]'::jsonb; logs jsonb := '[]'::jsonb; ins jsonb := '{}'::jsonb; upd jsonb := '{}'::jsonb;
  delIds text[] := '{}'; delSr int[] := '{}'; sr int; di int := 0; dvals jsonb; dfml jsonb; i int; hk text; pe text; lsr int; res jsonb; pins jsonb; pl jsonb; lg jsonb;
begin
  conf := rb_bom_guard(false); head := conf->'head';
  if S !~ '^[A-Z]X\d{4}[A-Z]{2}\d+$' then raise exception '반제품 코드 형식이 아닙니다: %', S; end if;
  if P = '' or P = S then raise exception '완제품 코드가 없습니다.'; end if;
  if jsonb_typeof(a->'items') <> 'array' or jsonb_array_length(a->'items') = 0 then raise exception '이 반제품 구성 줄이 없습니다.'; end if;
  perform pg_advisory_xact_lock(hashtext('rb_bom'));
  perform rb_bom_guard(true);
  if op <> '' then
    select rv into hit from rb_recent where rk = 'op:bomsl:' || op and rat > now() - interval '30 minutes';
    if hit is not null then return hit::jsonb || '{"duplicate":true}'::jsonb; end if;
  end if;
  -- 줄 찾기(서버 bomReRow_: 줄ID 가 하나면 그 줄 · 아니면 품목 · 코드 · 초도가 하나인 줄)
  for it in select y from jsonb_array_elements(a->'items') y loop
    rid := null;
    if rb_t(it->'id') <> '' then
      select b.id into rid from bom_rows b where b.id = rb_t(it->'id') and upper(b.product) = P and upper(b.code) = upper(rb_t(it->'code')) and rb_t(to_jsonb(b.start_round)) = rb_t(it->'start');
    end if;
    if rid is null then
      select case when count(*) = 1 then min(b.id) end into rid from bom_rows b where upper(b.product) = P and upper(b.code) = upper(rb_t(it->'code')) and coalesce(b.start_round, '') = rb_t(it->'start');
    end if;
    if rid is null or rid = any(ids) then raise exception 'BOM 시트가 그사이 바뀌었습니다(%). BOM 을 다시 열어 주세요.', rb_t(it->'code'); end if;
    if not exists (select 1 from sheet_rows s where s.tab = '_bomfml:' || rid and s."row" = 0) then raise exception 'RB_FALLBACK 수식 모름'; end if;
    ids := ids || rid;
  end loop;
  select b.id into headId from bom_rows b where b.id = any(ids) and b.type = '반제품' and upper(b.code) = S limit 1;
  if headId is null then raise exception '% BOM 에서 반제품 % 줄을 찾지 못했습니다.', P, S; end if;
  matIds := array(select v from unnest(ids) v where v <> headId);
  has := exists (select 1 from bom_rows b where upper(b.product) = S);
  if not has and coalesce(array_length(matIds, 1), 0) = 0 then raise exception 'RB_FALLBACK 반제품 BOM 없음 · 구성 없음(옛 코드 확인)'; end if;
  -- ① 반제품 BOM 이 없으면: 묶인 줄을 그대로 복사해 반제품 BOM 을 만든다(맨 아래)
  if not has then
    if semiStart < 1 then raise exception 'RB_FALLBACK 반제품 발주 차수(서버가 발주 DB 에서)'; end if;
    select coalesce(max(substring(b.id from '^B(\d+)$')::int), 0) into maxB from bom_rows b where b.id ~ '^B\d+$';
    select coalesce(max(b.sheet_row), 2) into maxSr from bom_rows b;
    select coalesce(nullif(b.name, ''), S) into semiName from bom_rows b where b.id = headId;
    for rid in select v from unnest(array[headId] || matIds) v loop
      select to_jsonb(b) into x from bom_rows b where b.id = rid;
      select cells into fm from sheet_rows s where s.tab = '_bomfml:' || rid and s."row" = 0;
      maxB := maxB + 1; maxSr := maxSr + 1; newId := 'B' || lpad(maxB::text, 6, '0');
      x := x || jsonb_build_object('id', newId, 'sheet_row', maxSr, 'product', S, 'product_name', semiName, 'start_round', semiStart || '차', 'end_round', null,
        'first_at', null, 'old_code', null, 'seq', null, 'semi', null, 'cost_key', case when rb_t(x->'cost_key') <> '' then S else null end,
        'change', semiStart || '차 반제품 BOM (' || P || ' ' || N || '차 구성에서 복사 · ' || why || ') · ' || stamp);
      ch_ := jsonb_build_object('r', x, 'f', coalesce(fm, '{}'::jsonb));
      x := rb_bom_evalrow(ch_->'r', ch_->'f', head);
      insert into bom_rows select * from jsonb_populate_record(null::bom_rows, (x - 'synced_at') || jsonb_build_object('synced_at', now()));
      insert into sheet_rows(tab, "row", cells, synced_at) values ('_bomfml:' || newId, 0, coalesce(fm, '{}'::jsonb), now()) on conflict (tab, "row") do update set cells = excluded.cells, synced_at = excluded.synced_at;
      ins := ins || jsonb_build_object(newId, headId);      -- 본보기는 지우지 않는 반제품 줄(N차 이후 줄은 아래에서 지움)
      newRefs := newRefs || jsonb_build_array(jsonb_build_object('code', upper(rb_t(x->'code')), 'start', semiStart || '차'));
      made := made + 1;
    end loop;
    logs := logs || jsonb_build_array(jsonb_build_array(jsonb_build_object('d', nowiso), e, S, semiName, semiStart || '차', '신제품 BOM', '반제품', '', S, '',
      '반제품 BOM ' || semiStart || '차 ' || made || '줄 (' || P || ' ' || N || '차 구성 복사)', why, '', '유효', tag || '-n', jsonb_build_object('newRefs', newRefs)::text));
  end if;
  -- ② 완제품 BOM 의 묶인 구성 줄: N차 전에 시작한 줄은 N-1차로 종료 · N차부터 시작한 줄은 지운다(되살리기 정보와 함께)
  for rid in select v from unnest(matIds) v loop
    select to_jsonb(b) into x from bom_rows b where b.id = rid;
    if coalesce(rb_bom_rnum(rb_t(x->'start_round')), 1) >= N then
      select cells into fm from sheet_rows s where s.tab = '_bomfml:' || rid and s."row" = 0;
      dvals := '[]'::jsonb; dfml := '[]'::jsonb;
      for i in 0 .. jsonb_array_length(head) - 1 loop
        hk := rb_bom_hkey(head, i);
        dvals := dvals || jsonb_build_array(case when hk is null then to_jsonb(''::text) else rb_bom_cell(x, hk) end);
        dfml := dfml || jsonb_build_array(case when hk is null then '' else rb_t(fm->hk) end);
      end loop;
      delIds := delIds || rid; delSr := delSr || (x->>'sheet_row')::int; ended := ended + 1;
      logs := logs || jsonb_build_array(jsonb_build_array(jsonb_build_object('d', nowiso), e, P, '', rb_t(x->'start_round') || '~' || rb_t(x->'end_round'), '정정 삭제', rb_t(x->'type'), upper(rb_t(x->'code')), '',
        rb_t(x->'type') || ' ' || rb_t(x->'code') || ' ' || rb_t(x->'vendor'), '줄 삭제 — ' || N || '차부터 반제품 ' || S || ' BOM 으로', why, '', '유효', tag || '-d' || di,
        jsonb_build_object('v2', 1, 'v3', 1, 'restore', jsonb_build_object('at', (x->>'sheet_row')::int, 'soft', 1, 'vals', dvals, 'fmls', dfml))::text));
      di := di + 1;
      continue;
    end if;
    pe := rb_t(x->'end_round');
    if pe <> '' and coalesce(rb_bom_rnum(pe), 0) <= N - 1 then continue; end if;
    many := many || jsonb_build_array(jsonb_build_object('product', P, 'code', upper(rb_t(x->'code')), 'start', rb_t(x->'start_round'), 'id', rid, 'prev', jsonb_build_object('end', pe, 'change', coalesce(x->'change', to_jsonb(''::text)))));
    update bom_rows b set end_round = endTo, change = case when coalesce(b.change, '') <> '' then b.change || ' / ' else '' end || '종료 ' || endTo || ' — ' || N || '차부터 반제품 ' || S || ' BOM 으로 · ' || stamp, synced_at = now() where b.id = rid;
    upd := upd || jsonb_build_object(rid, jsonb_build_object('end', 'v', 'change', 'v'));
    ended := ended + 1;
  end loop;
  if jsonb_array_length(many) > 0 then
    logs := logs || jsonb_build_array(jsonb_build_array(jsonb_build_object('d', nowiso), e, P, '', N || '차~', '정정', '반제품', S, S, '반제품 구성 ' || jsonb_array_length(many) || '줄 이 BOM 에',
      N || '차부터 반제품 ' || S || ' BOM 따라감(구성 줄 종료 ' || endTo || ')', why, '', '유효', tag || '-e', jsonb_build_object('many', many)::text));
  end if;
  -- 지운 줄(아래 줄 행 번호 당김 — 다른 줄을 건너보는 수식이 있으면 서버 길)
  if coalesce(array_length(delSr, 1), 0) > 0 then
    if exists (
      select 1 from sheet_rows s join bom_rows b on s.tab = '_bomfml:' || b.id and s."row" = 0, jsonb_each_text(s.cells) q(kk, ff),
           regexp_matches(ff, 'R(\[-?\d+\]|\d+)', 'g') m(g)
      where case when left(m.g[1], 1) = '[' then substring(m.g[1] from 2 for length(m.g[1]) - 2)::int <> 0 else true end
        and exists (select 1 from unnest(delSr) d(v) where
              case when left(m.g[1], 1) = '[' then d.v between least(b.sheet_row, b.sheet_row + substring(m.g[1] from 2 for length(m.g[1]) - 2)::int) and greatest(b.sheet_row, b.sheet_row + substring(m.g[1] from 2 for length(m.g[1]) - 2)::int)
                   else d.v <= greatest(b.sheet_row, m.g[1]::int) end))
    then raise exception 'RB_FALLBACK 줄 지우기 — 다른 줄을 보는 수식'; end if;
    -- m155(sf2): 한 번에 — 예전엔 지운 줄마다 아래 줄 전체를 한 칸씩 당겼다(k줄 × 2천 줄 update → statement timeout)
    if coalesce(array_length(delSr, 1), 0) > 0 then
      delSr := array(select distinct v from unnest(delSr) v order by v);
      delete from sheet_rows where "row" = 0 and tab in (select '_bomfml:' || b.id from bom_rows b where b.sheet_row = any(delSr));
      delete from bom_rows where sheet_row = any(delSr);
      update bom_rows b set sheet_row = b.sheet_row - (select count(*) from unnest(delSr) d(v) where d.v < b.sheet_row)::int where b.sheet_row > delSr[1];
    end if;
  end if;
  -- 이력(bom_log · 되돌리기 표는 일의 logs 로 트리거가)
  select coalesce(max(sheet_row), 1) into lsr from bom_log;
  for lg in select y from jsonb_array_elements(logs) y loop
    lsr := lsr + 1;
    insert into bom_log select * from jsonb_populate_record(null::bom_log, jsonb_build_object('sheet_row', lsr, 'at', nowiso, 'who', e, 'product', lg->>2, 'product_name', lg->>3, 'round', lg->>4,
      'kind', lg->>5, 'type', lg->>6, 'code_a', lg->>7, 'code_b', lg->>8, 'before', left(lg->>9, 2000), 'after', left(lg->>10, 2000), 'why', left(lg->>11, 1000), 'order_ref', lg->>12, 'state', lg->>13, 'change_id', lg->>14, 'synced_at', now()));
  end loop;
  -- 연결 기록(반제품 차수 고르기 사본 bomConf.semipins — 서버 속성 rb.semipin 은 1분 작업이 일의 semiPinAdd 로)
  pins := coalesce(conf->'semipins', '{}'::jsonb);
  pl := coalesce(pins->P->S, '[]'::jsonb);
  if not exists (select 1 from jsonb_array_elements(pl) y where (y->>0)::int = N) then
    pl := (select coalesce(jsonb_agg(y order by (y->>0)::int), '[]'::jsonb) from jsonb_array_elements(pl || jsonb_build_array(jsonb_build_array(N, 0))) y);
    pins := jsonb_set(pins, array[P], coalesce(pins->P, '{}'::jsonb) || jsonb_build_object(S, pl));
    update rb_conf set v = jsonb_set(v, '{semipins}', pins), at = now() where k = 'bomConf';
  end if;
  insert into rb_tab_job(tab, job) values ('bom', jsonb_build_object('k', 'bom', 'v', 1, 'at', (extract(epoch from now()) * 1000)::bigint, 'who', e, 'product', P, 'tag', tag,
    'rep', jsonb_build_object('codes', jsonb_build_array(P, S), 'ins', ins, 'upd', upd, 'del', (select coalesce(jsonb_object_agg(d, 1), '{}'::jsonb) from unnest(delIds) d)),
    'logs', logs, 'semiPinAdd', jsonb_build_object('product', P, 'semi', S, 'round', N),
    'hist', jsonb_build_array(jsonb_build_object('kind', 'BOM', 'code', P, 'item', S || ' 반제품 BOM 연결 ' || N || '차부터', 'before', '',
      'after', case when made > 0 then '반제품 BOM ' || made || '줄 만듦 · ' else '' end || '구성 줄 ' || ended || '개 종료', 'reason', why, 'at', jsonb_build_object('d', nowiso), 'who', e)),
    'reg', '[]'::jsonb, 'price', '[]'::jsonb, 'unmark', '[]'::jsonb, 'made', '[]'::jsonb));
  insert into rb_conf(k, v, at) values ('bomVer', jsonb_build_object('v', substr(md5(random()::text || clock_timestamp()::text), 1, 8), 'at', nowiso, 'by', e), now())
    on conflict on constraint rb_conf_pkey do update set v = excluded.v, at = excluded.at;
  res := jsonb_build_object('ok', true, 'sb', 1, 'code', P, 'name', '', 'made', '[]'::jsonb, 'saved', 0, 'logTag', '', 'splitMap', '{}'::jsonb,
    'semiLink', jsonb_build_object('semi', S, 'made', made, 'ended', ended, 'round', N, 'semiStart', semiStart),
    'rows', (select coalesce(jsonb_agg(to_jsonb(b) - 'synced_at' order by b.sheet_row, b.id), '[]'::jsonb) from bom_rows b where upper(b.product) = P),
    'log', (select coalesce(jsonb_agg(to_jsonb(l) - 'synced_at' order by l.sheet_row desc), '[]'::jsonb) from (select * from bom_log where upper(product) = P order by sheet_row desc limit 50) l));
  if op <> '' then
    insert into rb_recent(rk, rby, rv, rat) values ('op:bomsl:' || op, e, (res - 'rows' - 'log')::text, now())
      on conflict on constraint rb_recent_pkey do update set rby = excluded.rby, rv = excluded.rv, rat = excluded.rat;
  end if;
  return res;
end $f$;
create or replace function rb_bom_undo_do(e text, a jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
declare
  P text := upper(btrim(coalesce(a->>'product', '')));
  cid text := rb_t(a->'id'); why text := rb_t(a->'why'); op text := left(rb_t(a->'op'), 60); hit text;
  conf jsonb; head jsonb; t rb_bom_chg; o rb_bom_chg; u jsonb; k text; mine text[]; theirs text[]; hitc text[];
  vrows jsonb; claimed jsonb := '{}'::jsonb; W jsonb := '{}'::jsonb; OR_ jsonb := '{}'::jsonb; OF jsonb := '{}'::jsonb;
  rNew text; rOld text; rIn text; done text[] := '{}'; ch_ jsonb; x jsonb; fixRows text[] := '{}'; costSet text[] := '{}'; touched text[] := '{}';
  delIds text[] := '{}'; delSr int[] := '{}'; mIds text[] := '{}'; mIx int[] := '{}'; rsR jsonb; rsF jsonb := '{}'::jsonb; rsId text; rsI int; rsK text; rsTmpl text; rsMaxB int; rsSr int; insJ jsonb := '{}'::jsonb; rsCode text := ''; mi int; mm jsonb; rM text; codesP text[] := '{}'; sr int; reg text := ''; upd jsonb := '{}'::jsonb; setK jsonb; ov jsonb; nv jsonb; same_ boolean;
  nowiso text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'); logRow jsonb; lsr int; res jsonb; st jsonb := '{}'::jsonb; uf text; prev jsonb; f text;
begin
  conf := rb_bom_guard(false); head := conf->'head';
  perform pg_advisory_xact_lock(hashtext('rb_bom'));
  perform rb_bom_guard(true);
  if op <> '' then
    select rv into hit from rb_recent where rk = 'op:bomun:' || op and rat > now() - interval '30 minutes';
    if hit is not null then return hit::jsonb || '{"duplicate":true}'::jsonb; end if;
  end if;
  -- ── 이력 줄(bomUndoCore_: 변경ID · 제품코드가 같은 첫 줄) ──
  select * into t from rb_bom_chg c where c.change_id = cid and upper(c.product) = P;
  if not found then raise exception 'RB_FALLBACK 되돌리기 기록이 Supabase 에 없음'; end if;
  if t.at is null or t.at < now() - interval '330 days' then raise exception 'RB_FALLBACK 오래된 변경(기록 보관으로 옮겨졌을 수 있음)'; end if;
  if coalesce(t.state, '') <> '유효' then raise exception '이미 되돌린 변경입니다.'; end if;
  if t.undo_bad then raise exception 'RB_FALLBACK 되돌리기 정보 모양'; end if;
  u := coalesce(t.undo, '{}'::jsonb);
  if jsonb_typeof(u) <> 'object' or u = '{}'::jsonb then raise exception '이 변경은 되돌릴 내용이 기록되지 않았습니다. BOM 화면에서 직접 고쳐 주세요.'; end if;
  -- ── 이 뒤에 같은 자재를 또 고친 유효한 기록(같은 품목) ──
  mine := rb_bom_chg_codes(t);
  for o in select * from rb_bom_chg c where upper(c.product) = P and c.state = '유효' and (c.at, c.seq) > (t.at, t.seq) order by c.at, c.seq loop
    theirs := rb_bom_chg_codes(o);
    select coalesce(array_agg(q order by n), '{}') into hitc from unnest(theirs) with ordinality z(q, n) where q = any(mine);
    if coalesce(array_length(hitc, 1), 0) > 0 then raise exception '이 뒤에 같은 자재(%)를 또 고친 기록이 있습니다. 최근 변경부터 차례로 되돌려 주세요.', array_to_string(hitc, ', '); end if;
  end loop;
  -- ── 옮기지 않은 되돌리기 → 서버 길 ──
  foreach k in array array(select jsonb_object_keys(u)) loop
    if k not in ('newRef', 'oldRef', 'inPlace', 'reg', 'regs', 'v2', 'v3', 'many', 'dbPrev', 'restore', 'newRefs', 'copyRefs', 'recodeFrom') then raise exception 'RB_FALLBACK 되돌리기 종류 %', k; end if;
  end loop;
  -- ── 줄 찾기(find — 줄ID 먼저 · 아니면 코드 · 초도(· 종료)) ──
  select coalesce(jsonb_agg(to_jsonb(b) order by b.sheet_row, b.id), '[]'::jsonb) into vrows from bom_rows b;
  if jsonb_typeof(u->'newRef') = 'object' then rNew := rb_bom_undo_find(vrows, claimed, u->'newRef'->'code', u->'newRef'->'start', null, u->'newRef'->'id', null, P); if rNew is not null then claimed := claimed || jsonb_build_object(rNew, 1); end if; end if;
  -- f405: 신제품 BOM 되돌리기(newRefs — 그때 넣은 줄 여럿을 지움 · 못 찾은 줄은 건너뜀 · 서버와 같게)
  if jsonb_typeof(u->'newRefs') = 'array' then
    for mm in select y from jsonb_array_elements(u->'newRefs') y loop
      rM := rb_bom_undo_find(vrows, claimed, mm->'code', mm->'start', null, null, null, P);
      if rM is null then continue; end if;
      claimed := claimed || jsonb_build_object(rM, 1);
      delIds := delIds || rM;
      select (y->>'sheet_row')::int into sr from jsonb_array_elements(vrows) y where y->>'id' = rM;
      delSr := delSr || sr;
      done := done || (rb_bom_js(mm->'code') || ' 줄 지움');
    end loop;
  end if;
  -- f408: 반제품 공용 줄 더 되돌리기(copyRefs — 같은 코드 · 초도 · 반제품 구성 줄을 아래부터 하나씩 지움)
  if jsonb_typeof(u->'copyRefs') = 'array' then
    for mm in select y from jsonb_array_elements(u->'copyRefs') y loop
      if not (mm ? 'semi') then raise exception 'RB_FALLBACK 옛 양식 공용 줄'; end if;
      select y->>'id' into rM from jsonb_array_elements(vrows) y
        where not (claimed ? (y->>'id')) and upper(rb_t(y->'product')) = P and upper(rb_t(y->'code')) = upper(rb_t(mm->'code')) and rb_t(y->'start_round') = rb_t(mm->'start') and upper(rb_t(y->'semi')) = upper(rb_t(mm->'semi'))
        order by (y->>'sheet_row')::int desc limit 1;
      if rM is null then continue; end if;
      claimed := claimed || jsonb_build_object(rM, 1);
      delIds := delIds || rM;
      select (y->>'sheet_row')::int into sr from jsonb_array_elements(vrows) y where y->>'id' = rM;
      delSr := delSr || sr;
      done := done || (rb_bom_js(mm->'code') || ' (' || rb_bom_js(mm->'semi') || ' 구성) 줄 지움');
    end loop;
  end if;
  if jsonb_typeof(u->'oldRef') = 'object' then
    rOld := rb_bom_undo_find(vrows, claimed, u->'oldRef'->'code', u->'oldRef'->'start', u->'oldRef'->'endNow', u->'oldRef'->'id', null, P);
    if rOld is null then raise exception '원래 줄(% %~%)을 찾지 못했습니다. BOM 시트에서 직접 확인해 주세요.', rb_bom_js(u->'oldRef'->'code'), rb_bom_js(u->'oldRef'->'start'), rb_bom_js(u->'oldRef'->'endNow'); end if;
    claimed := claimed || jsonb_build_object(rOld, 1);
  end if;
  if jsonb_typeof(u->'inPlace') = 'object' then
    rIn := rb_bom_undo_find(vrows, claimed, u->'inPlace'->'code', u->'inPlace'->'start', null, u->'inPlace'->'id', to_jsonb(P), P);
    if rIn is null then raise exception '고친 줄(%)을 찾지 못했습니다.', rb_bom_js(u->'inPlace'->'code'); end if;
    claimed := claimed || jsonb_build_object(rIn, 1);
  end if;
  -- f404: 정정(여러 줄 이전 값 · many) — 서버 bomUndoCore_ 처럼 뒤에서부터 찾는다
  if jsonb_typeof(u->'many') = 'array' then
    for mi in select g from generate_series(jsonb_array_length(u->'many') - 1, 0, -1) g loop
      mm := u->'many'->mi;
      if jsonb_typeof(mm->'prev') <> 'object' then raise exception 'RB_FALLBACK many.prev 모양'; end if;
      rM := rb_bom_undo_find(vrows, claimed, mm->'code', mm->'start', null, mm->'id', case when rb_bom_truthy(mm->'product') then mm->'product' else to_jsonb(P) end, P);
      if rM is null then raise exception '정정한 줄(% % %~)을 찾지 못했습니다. BOM 시트에서 직접 확인해 주세요.', rb_bom_js(mm->'product'), rb_bom_js(mm->'code'), rb_bom_js(mm->'start'); end if;
      claimed := claimed || jsonb_build_object(rM, 1);
      mIds := mIds || rM; mIx := mIx || mi;
    end loop;
  end if
  ;
  -- 고칠 줄들(+ 수식)
  for x in select y from jsonb_array_elements(vrows) y where y->>'id' in (rNew, rOld, rIn) or (y->>'id') = any(mIds) loop
    OR_ := OR_ || jsonb_build_object(x->>'id', x);
    select cells into f from (select cells::text as cells from sheet_rows where tab = '_bomfml:' || (x->>'id') and "row" = 0) z;
    if f is null then raise exception 'RB_FALLBACK 수식 모름(% 행)', x->>'sheet_row'; end if;
    OF := OF || jsonb_build_object(x->>'id', (select coalesce(jsonb_object_agg(kk, vv), '{}'::jsonb) from jsonb_each(f::jsonb) q(kk, vv) where rb_t(vv) <> ''));
    W := W || jsonb_build_object(x->>'id', jsonb_build_object('r', x, 'f', OF->(x->>'id')));
  end loop;
  -- ── 쓰기 ──
  if rNew is not null then
    delIds := delIds || rNew; delSr := delSr || ((OR_->rNew->>'sheet_row')::int);
    done := done || ('새 줄(' || rb_bom_js(u->'newRef'->'code') || ' ' || rb_bom_js(u->'newRef'->'start') || '~) 지움');
  end if;
  if rOld is not null then
    ch_ := W->rOld;
    ch_ := rb_bom_undo_cell(ch_, 'end', to_jsonb(case when rb_bom_truthy(u->'oldRef'->'prevEnd') then rb_bom_js(u->'oldRef'->'prevEnd') else '' end), head);
    ch_ := rb_bom_undo_cell(ch_, 'costKey', to_jsonb(case when rb_bom_truthy(u->'oldRef'->'prevF') then rb_bom_js(u->'oldRef'->'prevF') else '' end), head);
    if u->'oldRef' ? 'prevCh' then ch_ := rb_bom_undo_cell(ch_, 'change', u->'oldRef'->'prevCh', head); end if;
    W := W || jsonb_build_object(rOld, ch_); touched := touched || rOld;
    done := done || (rb_bom_js(u->'oldRef'->'code') || ' 종료 ' || rb_bom_js(u->'oldRef'->'endNow') || ' → ' || case when rb_bom_truthy(u->'oldRef'->'prevEnd') then rb_bom_js(u->'oldRef'->'prevEnd') else '없음(계속 사용)' end);
  end if;
  if rIn is not null then
    ch_ := W->rIn; prev := coalesce(u->'inPlace'->'prev', '{}'::jsonb);
    if jsonb_typeof(prev) <> 'object' then raise exception 'RB_FALLBACK inPlace.prev 모양'; end if;
    for k in select key from jsonb_each(prev) loop       -- 칸 순서는 상관없다(칸마다 따로)
      if rb_bom_c(k) is null then raise exception 'RB_FALLBACK 되돌릴 칸 %', k; end if;
      if k = 'cost' then
        if rb_bom_hidx(head, 'cost') is null then continue; end if;
        uf := rb_t(ch_->'f'->'cost');
        if uf <> '' and rb_bom_frefs(uf, head, 'cost') ? 'unit' then continue; end if;      -- 단가를 보는 계산식이면 그대로(스스로 다시 계산)
        if rb_t(prev->'cost') like '=%' then raise exception 'RB_FALLBACK 소요원가 손수식 되살리기'; end if;
        ch_ := rb_bom_w(ch_, 'cost', prev->'cost', head); costSet := costSet || rIn;
        continue;
      end if;
      ch_ := rb_bom_undo_cell(ch_, k, prev->k, head);
      if k in ('unit', 'qty', 'proc', 'ship', 'fx') and rb_bom_hidx(head, k) is not null then fixRows := fixRows || rIn; end if;
    end loop;
    if rIn = any(fixRows) and not (rIn = any(costSet)) then ch_ := rb_bom_fixcost(ch_, null, head); end if;
    W := W || jsonb_build_object(rIn, ch_); if not (rIn = any(touched)) then touched := touched || rIn; end if;
    done := done || (rb_bom_js(u->'inPlace'->'code') || ' 원래 값으로');
  end if;
  -- f404: many 쓰기(inPlace 와 같은 칸 규칙 · 줄마다)
  for mi in select g from generate_series(1, coalesce(array_length(mIds, 1), 0)) g loop
    rM := mIds[mi]; mm := u->'many'->(mIx[mi]); ch_ := W->rM; prev := mm->'prev';
    if not (upper(rb_t(ch_->'r'->'product')) = any(codesP)) then codesP := codesP || upper(rb_t(ch_->'r'->'product')); end if;      -- f411: 제품코드 바꾸기 되돌리기 — 지금 코드 품목도 다시
    for k in select key from jsonb_each(prev) loop
      if k = 'place' and not rb_bom_truthy(u->'v2') then      -- f411: 새 양식 전 [구성 고르기] 이력 — 입고지 표시 '업체 (MX… 구성)' → 반제품 구성 칸 · 입고지
        ch_ := rb_bom_undo_cell(ch_, 'semi', to_jsonb(case when rb_t(prev->'place') ~ '반제품 공용' then '*' else coalesce(substring(rb_t(prev->'place') from '\(([A-Z]X\d{4}[A-Z]{2}\d+) 구성\)'), '') end), head);
        ch_ := rb_bom_undo_cell(ch_, 'place', to_jsonb(btrim(regexp_replace(rb_t(prev->'place'), '\s*\((?:[A-Z]X\d{4}[A-Z]{2}\d+ 구성|반제품 공용)\)\s*$', ''))), head);
        continue;
      end if;
      if rb_bom_c(k) is null then raise exception 'RB_FALLBACK 되돌릴 칸 %', k; end if;
      if k = 'cost' then
        if rb_bom_hidx(head, 'cost') is null then continue; end if;
        uf := rb_t(ch_->'f'->'cost');
        if uf <> '' and rb_bom_frefs(uf, head, 'cost') ? 'unit' then continue; end if;
        if rb_t(prev->'cost') like '=%' then raise exception 'RB_FALLBACK 소요원가 손수식 되살리기'; end if;
        ch_ := rb_bom_w(ch_, 'cost', prev->'cost', head); costSet := costSet || rM;
        continue;
      end if;
      ch_ := rb_bom_undo_cell(ch_, k, prev->k, head);
      if k in ('unit', 'qty', 'proc', 'ship', 'fx') and rb_bom_hidx(head, k) is not null and not (rM = any(fixRows)) then fixRows := fixRows || rM; end if;
    end loop;
    if rM = any(fixRows) and not (rM = any(costSet)) then ch_ := rb_bom_fixcost(ch_, null, head); end if;
    W := W || jsonb_build_object(rM, ch_); if not (rM = any(touched)) then touched := touched || rM; end if;
    if not (upper(rb_t(ch_->'r'->'product')) = any(codesP)) then codesP := codesP || upper(rb_t(ch_->'r'->'product')); end if;
    done := done || ((case when rb_bom_truthy(mm->'product') and upper(rb_t(mm->'product')) <> P then upper(rb_t(mm->'product')) || ' ' else '' end) || rb_bom_js(mm->'code') || ' 원래 값으로');
  end loop;
  -- f404: 지운 줄 되살리기(restore — 지금 양식 v3 만) · 맨 아래에 새 줄로(시트 맞추기가 그 품목 줄 뒤 · 아니면 맨 아래에 붙임)
  if jsonb_typeof(u->'restore') = 'object' then
    if not rb_bom_truthy(u->'v3') then      -- f411: 새 양식 전에 지운 줄 — 서버(apiBomUndoPrep)가 지금 양식 칸 순서로 바꿔 준 값으로(수식은 소요원가 계산값)
      if coalesce(jsonb_typeof(a->'restoreV3'), '') <> 'array' then raise exception 'RB_NEEDV3 옛 양식에서 지운 줄'; end if;
      u := jsonb_set(u, '{restore}', (u->'restore') || jsonb_build_object('vals', a->'restoreV3', 'fmls', '[]'::jsonb, 'v1fix', true));
    end if;
    if jsonb_typeof(u->'restore'->'vals') <> 'array' or jsonb_array_length(u->'restore'->'vals') = 0 then raise exception 'RB_FALLBACK 되살릴 값 없음'; end if;
    rsR := '{}'::jsonb;
    for rsI in 0 .. jsonb_array_length(u->'restore'->'vals') - 1 loop
      rsK := rb_bom_hkey(head, rsI); if rsK is null then continue; end if;
      rsR := rb_bom_set(rsR, rsK, u->'restore'->'vals'->rsI);
      if jsonb_typeof(u->'restore'->'fmls') = 'array' and rb_t(u->'restore'->'fmls'->rsI) <> '' then rsF := rsF || jsonb_build_object(rsK, rb_t(u->'restore'->'fmls'->rsI)); end if;
    end loop;
    if upper(rb_t(rsR->'product')) <> P then raise exception 'RB_FALLBACK 다른 품목 줄 되살리기'; end if;
    rsId := rb_t(rsR->'id');
    if rsId = '' or exists (select 1 from bom_rows b where b.id = rsId) then
      select coalesce(max(substring(b.id from '^B(\d+)$')::int), 0) into rsMaxB from bom_rows b where b.id ~ '^B\d+$';
      rsId := 'B' || lpad((rsMaxB + 1)::text, 6, '0');
    end if;
    select coalesce(max(b.sheet_row), 2) + 1 into rsSr from bom_rows b;
    select b.id into rsTmpl from bom_rows b where upper(b.product) = P order by b.sheet_row desc limit 1;
    rsR := rsR || jsonb_build_object('id', rsId, 'sheet_row', rsSr, 'product', P);
    ch_ := jsonb_build_object('r', rsR, 'f', rsF);
    if rb_bom_truthy(u->'restore'->'v1fix') then ch_ := rb_bom_fixcost(ch_, null, head); end if;
    ch_ := jsonb_set(ch_, '{r}', rb_bom_evalrow(ch_->'r', ch_->'f', head));
    insert into bom_rows select * from jsonb_populate_record(null::bom_rows, (ch_->'r') || jsonb_build_object('synced_at', now()));
    insert into sheet_rows(tab, "row", cells, synced_at) values ('_bomfml:' || rsId, 0, rsF, now())
      on conflict (tab, "row") do update set cells = excluded.cells, synced_at = excluded.synced_at;
    insJ := insJ || jsonb_build_object(rsId, coalesce(rsTmpl, ''));
    rsCode := upper(rb_t(rsR->'code'));
    done := done || ('지운 줄(' || rsCode || ' ' || rb_t(rsR->'start_round') || '~) 되살림');
  end if;
  -- 고친 줄 수식 다시 계산(흉내 시트처럼)
  foreach k in array touched loop
    ch_ := W->k; W := W || jsonb_build_object(k, jsonb_set(ch_, '{r}', rb_bom_evalrow(ch_->'r', ch_->'f', head)));
  end loop;
  if rb_t(u->'recodeFrom') <> '' then done := done || ('옛 제품코드 ' || rb_t(u->'recodeFrom') || ' 가 품목 DB 에 미사용이면 품목 정보에서 직접 되살려 주세요'); end if;
  -- 새 코드(reg): BOM 어디서든 아직 쓰면 품목 DB 는 그대로
  reg := upper(rb_t(u->'reg'));
  if reg <> '' and exists (select 1 from jsonb_array_elements(vrows) y where not ((y->>'id') = any(delIds)) and upper(rb_t(coalesce(W->(y->>'id')->'r', y)->'code')) = reg) then reg := ''; end if;
  -- ── Supabase 에 쓰기: 지운 줄(아래 줄 행 번호 당김 — 다른 줄을 건너보는 수식이 있으면 서버 길) · 고친 줄 ──
  if coalesce(array_length(delSr, 1), 0) > 0 then
    if exists (
      select 1 from sheet_rows s join bom_rows b on s.tab = '_bomfml:' || b.id and s."row" = 0, jsonb_each_text(s.cells) q(kk, ff),
           regexp_matches(ff, 'R(\[-?\d+\]|\d+)', 'g') m(g)
      where case when left(m.g[1], 1) = '[' then substring(m.g[1] from 2 for length(m.g[1]) - 2)::int <> 0 else true end
        and exists (select 1 from unnest(delSr) d(v) where
              case when left(m.g[1], 1) = '[' then d.v between least(b.sheet_row, b.sheet_row + substring(m.g[1] from 2 for length(m.g[1]) - 2)::int) and greatest(b.sheet_row, b.sheet_row + substring(m.g[1] from 2 for length(m.g[1]) - 2)::int)
                   else d.v <= greatest(b.sheet_row, m.g[1]::int) end))
    then raise exception 'RB_FALLBACK 줄 지우기 — 다른 줄을 보는 수식'; end if;
  end if;
  foreach k in array touched loop
    if k = any(delIds) then continue; end if;
    ch_ := W->k; x := OR_->k; setK := '{}'::jsonb;
    foreach f in array rb_bom_keys() loop
      if rb_bom_hidx(head, f) is null then continue; end if;
      if rb_t(OF->k->f) <> rb_t(ch_->'f'->f) then setK := setK || jsonb_build_object(f, 'f'); continue; end if;
      ov := x->rb_bom_c(f); nv := ch_->'r'->rb_bom_c(f);
      if rb_t(ov) = '' then same_ := rb_t(nv) = '';
      elsif rb_t(nv) = '' then same_ := false;
      elsif jsonb_typeof(ov) = 'number' or jsonb_typeof(nv) = 'number' then same_ := abs(rb_num(ov) - rb_num(nv)) < 0.0000001;
      else same_ := rb_t(ov) = rb_t(nv); end if;
      if not same_ then setK := setK || jsonb_build_object(f, 'v'); end if;
    end loop;
    if setK = '{}'::jsonb then continue; end if;
    upd := upd || jsonb_build_object(k, setK);
    delete from bom_rows where id = k;
    insert into bom_rows select * from jsonb_populate_record(null::bom_rows, (ch_->'r') || jsonb_build_object('synced_at', now()));
    if setK::text ~ '"f"' then
      insert into sheet_rows(tab, "row", cells, synced_at) values ('_bomfml:' || k, 0, coalesce(ch_->'f', '{}'::jsonb), now())
        on conflict (tab, "row") do update set cells = excluded.cells, synced_at = excluded.synced_at;
    end if;
  end loop;
  -- m155(sf2): 한 번에 — 예전엔 지운 줄마다 아래 줄 전체를 한 칸씩 당겼다(k줄 × 2천 줄 update → statement timeout)
  if coalesce(array_length(delSr, 1), 0) > 0 then
    delSr := array(select distinct v from unnest(delSr) v order by v);
    delete from sheet_rows where "row" = 0 and tab in (select '_bomfml:' || b.id from bom_rows b where b.sheet_row = any(delSr));
    delete from bom_rows where sheet_row = any(delSr);
    update bom_rows b set sheet_row = b.sheet_row - (select count(*) from unnest(delSr) d(v) where d.v < b.sheet_row)::int where b.sheet_row > delSr[1];
  end if;
  -- ── 이력: 그 변경 · 딸린 '참고' 줄 → 되돌림, 되돌림 줄 하나 ──
  update rb_bom_chg c set state = '되돌림', synced_at = now() where c.change_id = cid;
  st := jsonb_build_object(cid, '되돌림');
  select st || coalesce(jsonb_object_agg(c.change_id, '되돌림'), '{}'::jsonb) into st from rb_bom_chg c where c.state = '참고' and left(c.change_id, length(cid) + 1) = cid || '-';
  update rb_bom_chg c set state = '되돌림', synced_at = now() where c.state = '참고' and left(c.change_id, length(cid) + 1) = cid || '-';
  update bom_log l set state = '되돌림' where l.change_id in (select jsonb_object_keys(st));
  logRow := jsonb_build_array(jsonb_build_object('d', nowiso), e, P, coalesce(t.product_name, ''), coalesce(t.round, ''), '되돌림', coalesce(t.type, ''), coalesce(t.code_b, ''), coalesce(t.code_a, ''),
    coalesce(t.after, ''), coalesce(t.before, ''), case when why <> '' then why else array_to_string(done, ' · ') end, coalesce(t.order_ref, ''), '-', cid || '-되돌림', '');
  select coalesce(max(sheet_row), 1) + 1 into lsr from bom_log;
  insert into bom_log select * from jsonb_populate_record(null::bom_log, jsonb_build_object('sheet_row', lsr, 'at', nowiso, 'who', e, 'product', P, 'product_name', logRow->>3, 'round', logRow->>4,
    'kind', '되돌림', 'type', logRow->>6, 'code_a', logRow->>7, 'code_b', logRow->>8, 'before', left(logRow->>9, 2000), 'after', left(logRow->>10, 2000), 'why', left(logRow->>11, 1000),
    'order_ref', logRow->>12, 'state', '-', 'change_id', logRow->>14, 'synced_at', now()));
  insert into rb_tab_job(tab, job) values ('bom', jsonb_build_object('k', 'bom', 'v', 1, 'at', (extract(epoch from now()) * 1000)::bigint, 'who', e, 'product', P, 'tag', cid || '-되돌림',
    'rep', jsonb_build_object('codes', (select to_jsonb(array_agg(distinct c)) from unnest(array[P] || codesP) c where c <> ''), 'ins', insJ, 'upd', upd, 'del', (select coalesce(jsonb_object_agg(d, 1), '{}'::jsonb) from unnest(delIds) d)),
    'logs', jsonb_build_array(logRow), 'logState', st,
    'hist', jsonb_build_array(jsonb_build_object('kind', 'BOM', 'code', P, 'item', P || ' BOM 변경 되돌림', 'after', array_to_string(done, ' · '), 'reason', why, 'at', jsonb_build_object('d', nowiso), 'who', e)),
    'undoReg', jsonb_build_object('product', P, 'reg', reg), 'itemRestore', case when rsCode <> '' then jsonb_build_array(rsCode) else '[]'::jsonb end,
    'undoRegsList', (select coalesce(jsonb_agg(upper(rb_t(g))), '[]'::jsonb) from jsonb_array_elements(case when jsonb_typeof(u->'regs') = 'array' then u->'regs' else '[]'::jsonb end) g
      where not exists (select 1 from jsonb_array_elements(vrows) y where not ((y->>'id') = any(delIds)) and upper(rb_t(coalesce(W->(y->>'id')->'r', y)->'code')) = upper(rb_t(g)))),
    'reg', '[]'::jsonb, 'price', '[]'::jsonb, 'unmark', '[]'::jsonb, 'made', '[]'::jsonb));
  insert into rb_conf(k, v, at) values ('bomVer', jsonb_build_object('v', substr(md5(random()::text || clock_timestamp()::text), 1, 8), 'at', nowiso, 'by', e), now())
    on conflict on constraint rb_conf_pkey do update set v = excluded.v, at = excluded.at;
  res := jsonb_build_object('dbPrev', coalesce(u->'dbPrev', 'null'::jsonb), 'others', to_jsonb(array(select c from unnest(codesP) c where c <> P)), 'ok', true, 'sb', 1, 'code', P, 'name', coalesce(t.product_name, ''), 'undone', to_jsonb(done), 'made', '[]'::jsonb, 'saved', 0, 'logTag', '', 'splitMap', '{}'::jsonb,
    'rows', (select coalesce(jsonb_agg(to_jsonb(b) - 'synced_at' order by b.sheet_row, b.id), '[]'::jsonb) from bom_rows b where upper(b.product) = P),
    'log', (select coalesce(jsonb_agg(to_jsonb(l) - 'synced_at' order by l.sheet_row desc), '[]'::jsonb) from (select * from bom_log where upper(product) = P order by sheet_row desc limit 50) l));
  if op <> '' then
    insert into rb_recent(rk, rby, rv, rat) values ('op:bomun:' || op, e, (res - 'rows' - 'log')::text, now())
      on conflict on constraint rb_recent_pkey do update set rby = excluded.rby, rv = excluded.rv, rat = excluded.rat;
  end if;
  return res;
end $f$;
