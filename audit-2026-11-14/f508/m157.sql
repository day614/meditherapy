-- m157_bom_fm_both — rb_bom_fixmany_core: m156(종료만 바뀐 줄 줄ID 로 다시 찾기 · sf2) + m162(지금 값 = 넣을 값이면 충돌 아님 · sf3) 둘 다
CREATE OR REPLACE FUNCTION public.rb_bom_fixmany_core(e text, a jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  P text := upper(btrim(coalesce(a->>'product', '')));
  why text := left(rb_t(a->'why'), 200); op text := left(rb_t(a->'op'), 60); hit text;
  FIXK constant text[] := array['name','vendor','buy','spec','moq','qty','unit','cur','fx','proc','ship','type','start','end','code','semi','common'];
  LAB constant jsonb := '{"name":"품목명","vendor":"업체","buy":"매입정보","spec":"사양","moq":"MOQ","qty":"소요량","unit":"단가","cur":"통화","fx":"환율","proc":"임가공","ship":"배송비","type":"구분","start":"초도","end":"종료","code":"자재코드","semi":"반제품 구성","common":"공용여부"}';
  MAT constant text[] := array['name','vendor','spec','code'];
  m162same int := 0;
  conf jsonb; head jsonb; items jsonb := '[]'::jsonb; it jsonb; x jsonb; y jsonb; prow jsonb; bysr jsonb := '{}'::jsonb; F jsonb; pv jsonb;
  plan jsonb := '[]'::jsonb; q jsonb; o jsonb; k text; nv jsonb; setv jsonb; taken jsonb := '{}'::jsonb; rid text; rr int; same_ids text[]; byid text[];
  s1 int; e1 int; e1v jsonb; i int; j int; found int; ok_ boolean; fresh text[]; o0 jsonb; o1 jsonb; setmap jsonb := '{}'::jsonb;
  W jsonb := '{}'::jsonb; OF jsonb := '{}'::jsonb; ch_ jsonb; prev jsonb; after_ text[]; chg text; logs jsonb := '[]'::jsonb; mates jsonb; changesB text; changesA text;
  stamp text := to_char(now() at time zone 'Asia/Seoul', 'YY/MM/DD'); nowiso text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  batch text := substr(md5(random()::text || clock_timestamp()::text), 1, 8); upd jsonb := '{}'::jsonb; setK jsonb; ov jsonb; nvv jsonb; same_ boolean; touched text[] := '{}';
  prices jsonb := '[]'::jsonb; lsr int; res jsonb; codesAll text; newCodes jsonb := '{}'::jsonb; oldK text; newK text; qs jsonb; fm jsonb; delPlan jsonb := '[]'::jsonb; delIds text[] := '{}'; delRows int[] := '{}'; prowL jsonb; dvals jsonb; dfml jsonb; col int; hk text; dsr int; di int; U jsonb; nvc text; wantV text; wantS text; dy jsonb; regs jsonb := '[]'::jsonb;
begin
  -- ── bomFixManyRun_ / apiBomFixManyCore_ 앞 검사 ──
  if jsonb_typeof(a->'shares') = 'array' and jsonb_array_length(a->'shares') > 0 then raise exception 'RB_FALLBACK 공용 줄 더(shares)'; end if;
  if jsonb_typeof(a->'commons') = 'array' and jsonb_array_length(a->'commons') > 0 then raise exception 'RB_FALLBACK 공용 표시(commons)'; end if;
  if jsonb_typeof(a->'items') = 'array' then items := a->'items'; end if;
  if jsonb_array_length(items) = 0 then raise exception 'RB_FALLBACK 정정 줄 없음'; end if;
  for it in select z from jsonb_array_elements(items) z loop
    if jsonb_typeof(it) <> 'object' then raise exception 'RB_FALLBACK 줄 모양'; end if;
    if jsonb_typeof(it->'fields'->'type') not in ('null') and it->'fields' ? 'type' and rb_t(it->'fields'->'type') = '원재료' then raise exception '원재료 구성은 더 등록하지 않습니다 — 다른 구분으로 넣어 주세요.'; end if;
  end loop;
  conf := rb_bom_guard(false); head := conf->'head';
  perform pg_advisory_xact_lock(hashtext('rb_bom'));
  perform rb_bom_guard(true);
  if op <> '' then
    select rv into hit from rb_recent where rk = 'op:bomfm:' || op and rat > now() - interval '30 minutes';
    if hit is not null then return hit::jsonb || '{"duplicate":true}'::jsonb; end if;
  end if;
  select coalesce(jsonb_agg(to_jsonb(b) order by b.sheet_row, b.id), '[]'::jsonb) into prow from bom_rows b where upper(b.product) = P;
  for x in select z from jsonb_array_elements(prow) z loop
    if rb_t(x->'id') = '' or rb_t(x->'id') ~ '^R\d' then raise exception 'RB_FALLBACK 줄ID 없는 줄'; end if;
    bysr := bysr || jsonb_build_object(x->>'sheet_row', x->>'id');
  end loop;
  -- ── m054: 줄 삭제(잘못 들어간 줄) — 같은 줄의 칸 고치기는 무시 · 줄을 비우고 시트 줄을 지운다(아래 줄이 당겨짐) ──
  for it in select z from jsonb_array_elements(items) z where rb_bom_truthy(z->'del') loop
    rr := case when rb_t(it->'row') ~ '^\d+$' then rb_t(it->'row')::int else null end;
    rid := bysr->>(rr::text); same_ids := '{}'; byid := '{}';
    for x in select z from jsonb_array_elements(prow) z loop
      if upper(rb_t(x->'code')) = upper(rb_t(it->'code')) and rb_t(x->'start_round') = rb_t(it->'start') and (not (it ? 'end') or rb_t(x->'end_round') = rb_t(it->'end')) then
        same_ids := same_ids || (x->>'id');
        if rb_t(it->'id') <> '' and rb_t(x->'id') = rb_t(it->'id') then byid := byid || (x->>'id'); end if;
      end if;
    end loop;
    if rid is not null and rid = any(same_ids) and not (rb_t(it->'id') <> '' and rid <> rb_t(it->'id')) then null;
    elsif coalesce(array_length(byid, 1), 0) = 1 then rid := byid[1];
    elsif coalesce(array_length(same_ids, 1), 0) = 1 then rid := same_ids[1];
    else raise exception 'BOM 시트가 그사이 바뀌었습니다(%). BOM 보기를 다시 열어 주세요.', case when it ? 'code' and jsonb_typeof(it->'code') <> 'null' then rb_t(it->'code') else 'undefined' end;
    end if;
    x := (select z from jsonb_array_elements(prow) z where z->>'id' = rid);
    if rb_t(x->'first_at') <> '' then raise exception 'RB_FALLBACK 초도 발주일이 있는 줄 삭제'; end if;
    delIds := delIds || rid; delRows := delRows || (x->>'sheet_row')::int;
    delPlan := delPlan || jsonb_build_array(jsonb_build_object('id', rid, 'r', (x->>'sheet_row')::int, 'code', rb_t(x->'code'), 'start', rb_t(x->'start_round'), 'end', rb_t(x->'end_round'),
      'type', rb_t(x->'type'), 'vendor', rb_t(x->'vendor'), 'x', x));
  end loop;
  select coalesce(jsonb_agg(z order by n), '[]'::jsonb) into items from jsonb_array_elements(items) with ordinality t(z, n)
    where not rb_bom_truthy(z->'del') and not (case when rb_t(z->'row') ~ '^\d+$' then rb_t(z->'row')::int else -1 end = any(delRows));
  select coalesce(jsonb_agg(z order by n), '[]'::jsonb) into prowL from jsonb_array_elements(prow) with ordinality t(z, n) where not ((z->>'id') = any(delIds));
  -- ── 줄마다 ──
  for it in select z from jsonb_array_elements(items) z loop
    rr := case when rb_t(it->'row') ~ '^\d+$' then rb_t(it->'row')::int else null end;
    rid := bysr->>(rr::text); same_ids := '{}'; byid := '{}';
    for x in select z from jsonb_array_elements(prow) z loop
      if upper(rb_t(x->'code')) = upper(rb_t(it->'code')) and rb_t(x->'start_round') = rb_t(it->'start') and (not (it ? 'end') or rb_t(x->'end_round') = rb_t(it->'end')) then
        same_ids := same_ids || (x->>'id');
        if rb_t(it->'id') <> '' and rb_t(x->'id') = rb_t(it->'id') then byid := byid || (x->>'id'); end if;
      end if;
    end loop;
    if rid is not null and rid = any(same_ids) and not (rb_t(it->'id') <> '' and rid <> rb_t(it->'id')) then null;
    elsif coalesce(array_length(byid, 1), 0) = 1 then rid := byid[1];
    elsif coalesce(array_length(same_ids, 1), 0) = 1 then rid := same_ids[1];
    -- m156(sf2): 종료 차수만 그사이 바뀐 줄(다른 저장이 N차로 나눠 닫음) — 줄ID · 자재코드 · 초도가 같은 한 줄이면 그 줄에 고친다(고치는 칸과 겹치지 않음). 시작/끝/코드를 고치는 줄은 아님
    elsif rb_t(it->'id') <> '' and not (case when jsonb_typeof(it->'fields') = 'object' then it->'fields' else '{}'::jsonb end ?| array['start', 'end', 'code'])
      and (select count(*) from jsonb_array_elements(prow) z where z->>'id' = rb_t(it->'id') and upper(rb_t(z->'code')) = upper(rb_t(it->'code')) and rb_t(z->'start_round') = rb_t(it->'start')) = 1 then rid := rb_t(it->'id');
    else raise exception 'BOM 시트가 그사이 바뀌었습니다(%). BOM 보기를 다시 열어 주세요.', case when it ? 'code' and jsonb_typeof(it->'code') <> 'null' then rb_t(it->'code') else 'undefined' end;
    end if;
    x := (select z from jsonb_array_elements(prow) z where z->>'id' = rid);
    F := case when jsonb_typeof(it->'fields') = 'object' then it->'fields' else '{}'::jsonb end;
    pv := case when jsonb_typeof(it->'prev') = 'object' then it->'prev' else '{}'::jsonb end;
    for k in select jsonb_object_keys(pv) loop
      if rb_bom_c(k) is null or rb_bom_hidx(head, k) is null or not (F ? k) or jsonb_typeof(F->k) = 'null' then continue; end if;
      if not rb_bom_fm_same(k, x->rb_bom_c(k), case when rb_bom_isnum(k) then (case when rb_t(pv->k) = '' then to_jsonb(''::text) else to_jsonb(rb_num(pv->k)) end) else pv->k end)
         and rb_bom_fm_same(k, x->rb_bom_c(k), case when rb_bom_isnum(k) then (case when rb_t(F->k) = '' then to_jsonb(''::text) else to_jsonb(rb_num(F->k)) end) when k = 'cur' then to_jsonb(rb_bom_cur(rb_t(F->k))) when k = 'code' then to_jsonb(rb_code_key(rb_t(F->k))) else to_jsonb(rb_t(F->k)) end) then m162same := m162same + 1; continue;      -- m162: 이미 내가 넣을 값
      end if;
      if not rb_bom_fm_same(k, x->rb_bom_c(k), case when rb_bom_isnum(k) then (case when rb_t(pv->k) = '' then to_jsonb(''::text) else to_jsonb(rb_num(pv->k)) end) else pv->k end) then
        raise exception '% % 칸을 그사이 다른 사람이 고쳤습니다(지금 %). BOM 보기를 다시 열어 확인해 주세요.', rb_bom_js(it->'code'), coalesce(LAB->>k, k), rb_bom_fm_shown(x->rb_bom_c(k));
      end if;
    end loop;
    setv := '{}'::jsonb;
    foreach k in array FIXK loop
      if rb_bom_hidx(head, k) is null or not (F ? k) or jsonb_typeof(F->k) = 'null' then continue; end if;
      nv := case when rb_bom_isnum(k) then (case when rb_t(F->k) = '' then to_jsonb(''::text) else to_jsonb(rb_num(F->k)) end)
                 when k = 'cur' then to_jsonb(rb_bom_cur(rb_t(F->k))) when k = 'code' then to_jsonb(rb_code_key(rb_t(F->k))) else to_jsonb(rb_t(F->k)) end;
      if k = 'cur' and rb_t(nv) = '' then continue; end if;
      if rb_bom_fm_same(k, x->rb_bom_c(k), nv) then continue; end if;
      if k in ('start', 'end') and rb_t(nv) <> '' and rb_t(nv) !~ '^\d+\s*차$|^단종$' then raise exception '% 칸은 "5차" 처럼 넣어 주세요.', LAB->>k; end if;
      if k = 'start' and rb_t(nv) = '' then raise exception '초도 칸은 비울 수 없습니다.'; end if;
      if k = 'common' then raise exception 'RB_FALLBACK % 칸 정정', LAB->>k; end if;
      if k = 'code' then
        nvc := rb_t(nv);
        if nvc = '' then raise exception '자재코드는 비울 수 없습니다.'; end if;
        if rb_t(x->'type') = '제품' or upper(rb_t(x->'code')) = P then raise exception '제품 줄의 코드는 여기서 바꾸지 않습니다(품목코드가 바뀌면 [새 품목코드로 저장]).'; end if;
        -- bomCodeRegistered_: 품목 DB(미사용 빼고) — 옛 신규코드채번 탭은 사본이 없어 품목 DB 로만 본다
        if not exists (select 1 from sheet_rows s where s.tab = '_실행판_품목' and s."row" > 1 and rb_code_key(rb_t(s.cells->0)) = nvc and rb_t(s.cells->11) !~ '미사용') then
          if nvc !~ '^[A-Z]{1,2}\d{4}[A-Z]{2}\d+$' then raise exception '자재코드 % 는 코드 형식이 아닙니다(예: MP0159BL3).', nvc; end if;
          if U is null then U := rb_bom_used(conf); end if;
          if not (U ? nvc) then newCodes := newCodes || jsonb_build_object(rid, nvc);
          else
            wantV := rb_bom_norm(case when F ? 'vendor' and jsonb_typeof(F->'vendor') <> 'null' then rb_t(F->'vendor') else rb_t(x->'vendor') end);
            wantS := rb_bom_norm(case when F ? 'spec' and jsonb_typeof(F->'spec') <> 'null' then rb_t(F->'spec') else rb_t(x->'spec') end);
            select to_jsonb(b) into dy from bom_rows b where b.id <> rid and upper(b.product) = P and rb_code_key(b.code) = nvc      -- 서버는 이 품목 줄만 읽는다(bomReadProduct_)
             
              and (rb_t(to_jsonb(b)->'type') <> rb_t(x->'type') or rb_bom_norm(b.vendor::text) <> wantV or rb_bom_norm(b.spec::text) <> wantS) order by b.sheet_row, b.id limit 1;
            if dy is not null then
              raise exception '% 는 다른 자재(% % · %)가 쓰는 코드입니다. 같은 자재면 업체 · 사양을 그 줄과 맞추고, 다른 자재면 다른 번호로 해 주세요.', nvc, rb_t(dy->'product'), rb_t(dy->'type'), rb_t(dy->'vendor');
            end if;
          end if;
        end if;
      end if;
      setv := setv || jsonb_build_object(k, nv);
    end loop;
    if setv = '{}'::jsonb then continue; end if;
    s1 := rb_bom_rnum(case when setv ? 'start' then rb_t(setv->'start') else rb_t(x->'start_round') end);
    e1v := case when setv ? 'end' then setv->'end' else x->'end_round' end; e1 := rb_bom_rnum(rb_t(e1v));
    if (setv ? 'start' and rb_t(setv->'start') <> '' and not (coalesce(s1, 0) >= 1)) or (setv ? 'end' and rb_t(setv->'end') <> '' and rb_t(setv->'end') <> '단종' and e1 is not null and not (e1 >= 1)) then
      raise exception '% 차수는 1차 이상이어야 합니다(0차는 없음).', rb_bom_js(it->'code'); end if;
    if coalesce(s1, 0) <> 0 and coalesce(e1, 0) <> 0 and rb_t(e1v) <> '단종' and e1 < s1 then
      raise exception '% 종료(%)가 초도(%차)보다 앞입니다. 이러면 어느 차수에도 안 들어갑니다 — 줄을 빼려면 [빼기]를 써 주세요.', rb_bom_js(it->'code'), rb_t(e1v), s1; end if;
    if setv ? 'vendor' and rb_t(setv->'vendor') = '' and rb_t(x->'type') <> '제품' then raise exception '% 업체 칸을 비울 수 없습니다.', rb_bom_js(it->'code'); end if;
    plan := plan || jsonb_build_array(jsonb_build_object('id', rid, 'r', (x->>'sheet_row')::int, 'code', rb_t(x->'code'), 'start', rb_t(x->'start_round'), 'end', rb_t(x->'end_round'),
      'type', rb_t(x->'type'), 'set', setv, 'own', true, 'from', ''));
    taken := taken || jsonb_build_object(rid, 1);
    -- 같은 코드 줄(품목 안) 같이 — 품목명 · 업체 · 사양이 원래 값과 같은 줄만
    for k in select z from jsonb_object_keys(setv) z loop
      if not (k = any(MAT)) then continue; end if;
      if k = 'code' and newCodes ? rid then continue; end if;          -- 새 번호는 이 줄만
      for y in select z from jsonb_array_elements(prow) z loop
        if y->>'id' = rid or upper(rb_t(y->'code')) <> upper(rb_t(x->'code')) or not rb_bom_fm_same(k, y->rb_bom_c(k), x->rb_bom_c(k)) then continue; end if;
        if k = 'code' and rb_bom_norm(rb_t(y->'spec')) <> rb_bom_norm(rb_t(x->'spec')) then continue; end if;      -- 코드 바로잡기는 사양까지 같은 줄만
        found := null;
        for i in 0 .. jsonb_array_length(plan) - 1 loop if plan->i->>'id' = y->>'id' then found := i; exit; end if; end loop;
        if found is not null and (plan->found->>'own')::boolean then continue; end if;
        if found is null then
          plan := plan || jsonb_build_array(jsonb_build_object('id', y->>'id', 'r', (y->>'sheet_row')::int, 'code', rb_t(y->'code'), 'start', rb_t(y->'start_round'), 'end', rb_t(y->'end_round'),
            'type', rb_t(y->'type'), 'set', '{}'::jsonb, 'own', false, 'from', rb_t(x->'code')));
          found := jsonb_array_length(plan) - 1;
        end if;
        plan := jsonb_set(plan, array[found::text, 'set', k], setv->k);
      end loop;
    end loop;
    -- 품목 DB 이름 맞추기(bomRenamesFrom_ · 'wide')가 생기면 서버 길
    if not (setv ? 'code') and exists (select 1 from sheet_rows s, unnest(array['name', 'vendor', 'spec']) kk
               where s.tab = '_실행판_품목' and s."row" > 1 and rb_code_key(rb_t(s.cells->0)) = rb_code_key(rb_t(x->'code'))
                 and setv ? kk and btrim(rb_t(setv->kk)) <> ''
                 and btrim(rb_t(setv->kk)) <> rb_t(s.cells->(case kk when 'name' then 1 when 'vendor' then 4 else 12 end))) then
      raise exception 'RB_FALLBACK 품목 DB 이름 · 업체 · 사양 맞추기';
    end if;
  end loop;
  -- m053: 반제품 줄 코드를 다른 줄기로 바로잡으면 그 구성 자재의 반제품 구성 칸도 새 코드로(같은 반제품의 다른 버전 줄이 남아 있으면 그대로)
  if rb_bom_hidx(head, 'semi') is not null then
    for qs in select z from jsonb_array_elements(plan) z where (z->>'own')::boolean and z->>'type' = '반제품' and z->'set' ? 'code' loop
      oldK := rb_bom_semikey(qs->>'code'); newK := upper(rb_t(qs->'set'->'code'));
      if oldK = rb_bom_semikey(newK) then continue; end if;
      if exists (select 1 from jsonb_array_elements(prow) z where z->>'id' <> qs->>'id' and rb_t(z->'type') = '반제품' and rb_bom_semikey(rb_t(z->'code')) = oldK
                 and not exists (select 1 from jsonb_array_elements(plan) pw where pw->>'id' = z->>'id' and pw->'set' ? 'code')) then continue; end if;
      for y in select z from jsonb_array_elements(prow) z loop
        if rb_bom_semikey(rb_t(y->'semi')) <> oldK or rb_t(y->'semi') = '*' then continue; end if;
        found := null;
        for i in 0 .. jsonb_array_length(plan) - 1 loop if plan->i->>'id' = y->>'id' then found := i; exit; end if; end loop;
        if found is not null and plan->found->'set' ? 'semi' then continue; end if;
        if found is null then
          plan := plan || jsonb_build_array(jsonb_build_object('id', y->>'id', 'r', (y->>'sheet_row')::int, 'code', rb_t(y->'code'), 'start', rb_t(y->'start_round'), 'end', rb_t(y->'end_round'),
            'type', rb_t(y->'type'), 'set', '{}'::jsonb, 'own', false, 'from', qs->>'code'));
          found := jsonb_array_length(plan) - 1;
        end if;
        plan := jsonb_set(plan, array[found::text, 'set', 'semi'], to_jsonb(newK));
      end loop;
    end loop;
  end if;
  select coalesce(jsonb_agg(q2 order by n), '[]'::jsonb) into plan from jsonb_array_elements(plan) with ordinality z(q2, n) where ((q2->>'own')::boolean or not (taken ? (q2->>'id'))) and not ((q2->>'id') = any(delIds));
  if jsonb_array_length(plan) = 0 and jsonb_array_length(delPlan) = 0 and m162same > 0 then      -- m162: 그사이 같은 값이 이미 들어감 — 저장할 것 없이 성공
    return jsonb_build_object('ok', true, 'sb', 1, 'code', P, 'fixed', 0, 'deleted', 0, 'dropped', '[]'::jsonb, 'others', '[]'::jsonb, 'shared', 0, 'commonN', 0, 'made', '[]'::jsonb, 'saved', 0, 'logTag', '', 'splitMap', '{}'::jsonb, 'already', m162same,
      'rows', (select coalesce(jsonb_agg(to_jsonb(b) - 'synced_at' order by b.sheet_row, b.id), '[]'::jsonb) from bom_rows b where upper(b.product) = P),
      'log', (select coalesce(jsonb_agg(to_jsonb(l) - 'synced_at' order by l.sheet_row desc), '[]'::jsonb) from (select * from bom_log where upper(product) = P order by sheet_row desc limit 50) l));
  end if;
  if jsonb_array_length(plan) = 0 and jsonb_array_length(delPlan) = 0 then raise exception '바뀐 값이 없습니다.'; end if;
  -- ── 원가 겹침(초도 · 종료 · 구분을 바꿨을 때 — 새로 생기는 겹침만) ──
  if exists (select 1 from jsonb_array_elements(plan) z where z->'set' ?| array['start', 'end', 'type', 'code']) then
    for q in select z from jsonb_array_elements(plan) z where (z->>'own')::boolean loop setmap := setmap || jsonb_build_object(q->>'id', q->'set'); end loop;
    o0 := rb_bom_fm_ovl(prowL, '{}'::jsonb); o1 := rb_bom_fm_ovl(prowL, setmap);
    select array_agg(z->>'m' order by n) into fresh from jsonb_array_elements(o1) with ordinality t(z, n) where not exists (select 1 from jsonb_array_elements(o0) w0 where w0->>'k' = z->>'k');
    if coalesce(array_length(fresh, 1), 0) > 0 then
      raise exception '같은 자재가 같은 차수에 두 줄이 돼 원가가 두 번 들어갑니다: % — 그 차수에 이미 그 자재 줄이 있습니다. 차수 칸에서 그 차수를 골라 확인해 보세요(이어 쓰려면 뒤 줄을 지우고, 아니면 종료는 그대로).', array_to_string(fresh, ' / ');
    end if;
  end if;
  -- ── 쓰기 ──
  for i in 0 .. jsonb_array_length(plan) - 1 loop
    q := plan->i; x := (select z from jsonb_array_elements(prow) z where z->>'id' = q->>'id');
    if not (W ? (q->>'id')) then OF := OF || jsonb_build_object(q->>'id', rb_bom_fml_of(q->>'id')); W := W || jsonb_build_object(q->>'id', jsonb_build_object('r', x, 'f', OF->(q->>'id'))); end if;
    ch_ := W->(q->>'id');
    prev := jsonb_build_object('change', rb_bom_cell(x, 'change'), 'cost', rb_bom_cell(x, 'cost'));
    after_ := '{}';
    foreach k in array (select array_agg(kk order by array_position(FIXK, kk)) from jsonb_object_keys(q->'set') kk) loop
      prev := prev || jsonb_build_object(k, rb_bom_cell(x, k));
      ch_ := rb_bom_w(ch_, k, q->'set'->k, head);
      after_ := after_ || (coalesce(LAB->>k, k) || ' ' || rb_bom_fm_shown(q->'set'->k));
    end loop;
    chg := rb_t(x->'change');
    ch_ := rb_bom_w(ch_, 'change', to_jsonb(case when chg <> '' then chg || ' / ' else '' end || '정정 ' || array_to_string(after_, ' · ')
      || case when (q->>'own')::boolean then '' else ' (같은 코드 ' || (q->>'from') || ' 정정에 맞춤)' end || ' (' || why || ') · ' || stamp), head);
    if q->'set' ?| array['unit', 'qty', 'proc', 'ship', 'fx'] then ch_ := rb_bom_fixcost(ch_, x, head); end if;
    W := W || jsonb_build_object(q->>'id', ch_); touched := touched || (q->>'id');
    plan := jsonb_set(plan, array[i::text, 'undo'], jsonb_build_object('product', P, 'code', case when q->'set' ? 'code' then rb_t(q->'set'->'code') else q->>'code' end, 'start', case when q->'set' ? 'start' then rb_t(q->'set'->'start') else q->>'start' end, 'id', rb_t(x->'id'), 'prev', prev));
  end loop;
  foreach k in array touched loop ch_ := W->k; W := W || jsonb_build_object(k, jsonb_set(ch_, '{r}', rb_bom_evalrow(ch_->'r', ch_->'f', head))); end loop;
  foreach k in array touched loop
    ch_ := W->k; x := (select z from jsonb_array_elements(prow) z where z->>'id' = k); setK := '{}'::jsonb;
    foreach chg in array rb_bom_keys() loop
      if rb_bom_hidx(head, chg) is null then continue; end if;
      if rb_t(OF->k->chg) <> rb_t(ch_->'f'->chg) then setK := setK || jsonb_build_object(chg, 'f'); continue; end if;
      ov := x->rb_bom_c(chg); nvv := ch_->'r'->rb_bom_c(chg);
      if rb_t(ov) = '' then same_ := rb_t(nvv) = ''; elsif rb_t(nvv) = '' then same_ := false;
      elsif jsonb_typeof(ov) = 'number' or jsonb_typeof(nvv) = 'number' then same_ := abs(rb_num(ov) - rb_num(nvv)) < 0.0000001; else same_ := rb_t(ov) = rb_t(nvv); end if;
      if not same_ then setK := setK || jsonb_build_object(chg, 'v'); end if;
    end loop;
    if setK = '{}'::jsonb then continue; end if;
    upd := upd || jsonb_build_object(k, setK);
    delete from bom_rows where id = k;
    insert into bom_rows select * from jsonb_populate_record(null::bom_rows, (ch_->'r') || jsonb_build_object('synced_at', now()));
    if setK::text ~ '"f"' then
      insert into sheet_rows(tab, "row", cells, synced_at) values ('_bomfml:' || k, 0, coalesce(ch_->'f', '{}'::jsonb), now()) on conflict (tab, "row") do update set cells = excluded.cells, synced_at = excluded.synced_at;
    end if;
  end loop;
  -- ── 이력(제 줄마다 — 같은 코드로 같이 고친 줄은 되돌리기 many 에) ──
  for i in 0 .. jsonb_array_length(plan) - 1 loop
    q := plan->i; if not (q->>'own')::boolean then continue; end if;
    x := (select z from jsonb_array_elements(prow) z where z->>'id' = q->>'id');
    select coalesce(jsonb_agg(z order by n), '[]'::jsonb) into mates from jsonb_array_elements(plan) with ordinality t(z, n) where not (z->>'own')::boolean and z->>'from' = q->>'code';
    select string_agg(coalesce(LAB->>kk, kk) || ' ' || rb_bom_fm_shown(x->rb_bom_c(kk)), ' · ' order by array_position(FIXK, kk)), string_agg(coalesce(LAB->>kk, kk) || ' ' || rb_bom_fm_shown(q->'set'->kk), ' · ' order by array_position(FIXK, kk))
      into changesB, changesA from jsonb_object_keys(q->'set') kk;
    logs := logs || jsonb_build_array(jsonb_build_array(jsonb_build_object('d', nowiso), e, P, '', (q->>'start') || case when q->>'end' <> '' then '~' || (q->>'end') else '~' end, '정정', q->>'type', q->>'code', case when q->'set' ? 'code' then rb_t(q->'set'->'code') else q->>'code' end,
      changesB, changesA || case when jsonb_array_length(mates) > 0 then ' · 같은 코드 ' || jsonb_array_length(mates) || '줄 같이 고침' else '' end, why, '', '유효', batch || '-' || i,
      jsonb_build_object('many', jsonb_build_array(q->'undo') || (select coalesce(jsonb_agg(z->'undo' order by n), '[]'::jsonb) from jsonb_array_elements(mates) with ordinality t(z, n)))::text));
  end loop;
  -- 줄 삭제: 아래 줄부터 · 되돌리기용 줄 값 · 수식(R1C1) 전체
  di := 0;
  for qs in select z from jsonb_array_elements(delPlan) z order by (z->>'r')::int desc loop
    x := qs->'x'; dvals := '[]'::jsonb; dfml := '[]'::jsonb;
    select cells into fm from sheet_rows where tab = '_bomfml:' || (qs->>'id') and "row" = 0;
    for col in 0 .. jsonb_array_length(head) - 1 loop
      hk := rb_bom_hkey(head, col);
      dvals := dvals || jsonb_build_array(case when hk is null then to_jsonb(''::text) else rb_bom_cell(x, hk) end);
      dfml := dfml || jsonb_build_array(case when hk is null then '' else rb_t(fm->hk) end);
    end loop;
    logs := logs || jsonb_build_array(jsonb_build_array(jsonb_build_object('d', nowiso), e, P, '', (qs->>'start') || '~' || (qs->>'end'), '정정 삭제', qs->>'type', qs->>'code', '',
      (qs->>'type') || ' ' || (qs->>'code') || ' ' || (qs->>'vendor'), '줄 삭제', why, '', '유효', batch || '-d' || di,
      jsonb_build_object('v2', 1, 'v3', 1, 'restore', jsonb_build_object('at', (qs->>'r')::int, 'soft', 1, 'vals', dvals, 'fmls', dfml))::text));
    dsr := (qs->>'r')::int;
    delete from bom_rows where id = qs->>'id';
    delete from sheet_rows where tab = '_bomfml:' || (qs->>'id');
    update bom_rows set sheet_row = sheet_row - 1 where sheet_row > dsr;
    di := di + 1;
  end loop;
  select coalesce(max(sheet_row), 1) into lsr from bom_log;
  for i in 0 .. jsonb_array_length(logs) - 1 loop
    insert into bom_log select * from jsonb_populate_record(null::bom_log, jsonb_build_object('sheet_row', lsr + i + 1, 'at', nowiso, 'who', e, 'product', P, 'product_name', '', 'round', logs->i->>4,
      'kind', logs->i->>5, 'type', logs->i->>6, 'code_a', logs->i->>7, 'code_b', logs->i->>8, 'before', left(logs->i->>9, 2000), 'after', left(logs->i->>10, 2000), 'why', left(logs->i->>11, 1000),
      'order_ref', '', 'state', '유효', 'change_id', logs->i->>14, 'synced_at', now()));
  end loop;
  select coalesce(jsonb_agg(to_jsonb(z->>'code') order by n), '[]'::jsonb) into prices from (select case when z->'set' ? 'code' then jsonb_build_object('code', z->'set'->>'code') else z end as z, n from jsonb_array_elements(plan) with ordinality t(z, n) where z->'set' ?| array['unit', 'fx', 'cur', 'code']) t2;
  select coalesce(jsonb_agg(jsonb_build_object('code', v) order by v), '[]'::jsonb) into regs from (select distinct value #>> '{}' as v from jsonb_each(newCodes)) t3;
  select string_agg(z->>'code', ', ' order by n) into codesAll from jsonb_array_elements(plan) with ordinality t(z, n);
  insert into rb_tab_job(tab, job) values ('bom', jsonb_build_object('k', 'bom', 'v', 1, 'at', (extract(epoch from now()) * 1000)::bigint, 'who', e, 'product', P, 'tag', batch,
    'rep', jsonb_build_object('codes', jsonb_build_array(P), 'ins', '{}'::jsonb, 'upd', upd, 'del', (select coalesce(jsonb_object_agg(d, 1), '{}'::jsonb) from unnest(delIds) d)), 'logs', logs,
    'orphans', case when jsonb_array_length(delPlan) > 0 then jsonb_build_object('codes', (select jsonb_agg(z->>'code' order by n) from jsonb_array_elements(delPlan) with ordinality t(z, n)), 'why', why, 'product', P) else null end,
    'hist', jsonb_build_array(jsonb_build_object('kind', 'BOM', 'code', P, 'item', P || ' BOM 정정 ' || jsonb_array_length(plan) || '줄', 'before', '', 'after', coalesce(codesAll, ''), 'reason', why, 'at', jsonb_build_object('d', nowiso), 'who', e)),
    'reg', regs, 'regSrc', 'BOM 정정 · 새 번호', 'price', prices, 'unmark', '[]'::jsonb, 'made', '[]'::jsonb));
  insert into rb_conf(k, v, at) values ('bomVer', jsonb_build_object('v', substr(md5(random()::text || clock_timestamp()::text), 1, 8), 'at', nowiso, 'by', e), now())
    on conflict on constraint rb_conf_pkey do update set v = excluded.v, at = excluded.at;
  res := jsonb_build_object('ok', true, 'sb', 1, 'code', P, 'fixed', jsonb_array_length(plan) + jsonb_array_length(delPlan), 'deleted', jsonb_array_length(delPlan), 'dropped', '[]'::jsonb, 'others', '[]'::jsonb, 'shared', 0, 'commonN', 0,
    'made', '[]'::jsonb, 'saved', jsonb_array_length(logs), 'logTag', batch, 'splitMap', '{}'::jsonb,
    'rows', (select coalesce(jsonb_agg(to_jsonb(b) - 'synced_at' order by b.sheet_row, b.id), '[]'::jsonb) from bom_rows b where upper(b.product) = P),
    'log', (select coalesce(jsonb_agg(to_jsonb(l) - 'synced_at' order by l.sheet_row desc), '[]'::jsonb) from (select * from bom_log where upper(product) = P order by sheet_row desc limit 50) l));
  if op <> '' then
    insert into rb_recent(rk, rby, rv, rat) values ('op:bomfm:' || op, e, (res - 'rows' - 'log')::text, now())
      on conflict on constraint rb_recent_pkey do update set rby = excluded.rby, rv = excluded.rv, rat = excluded.rat;
  end if;
  return res;
end $function$

;
