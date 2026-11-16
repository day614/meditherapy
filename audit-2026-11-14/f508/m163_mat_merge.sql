-- m163_mat_merge — rb_mat_do 'set': 화면이 본 판(ver) ≠ 지금 판이면 예전엔 RB_MAT_CHANGED. 이제 그 판의 값(rb_mat_log 'set' 의 before — 또는 화면이 준 prev)을 찾아
--  칸(입고일 · 수량 · 메모)마다 3-way: 내가 안 바꾼 칸 = 지금 값 그대로 · 남이 안 바꾼 칸 = 내 값 · 둘 다 같은 값 = 그대로. 같은 칸을 서로 다르게 바꾼 것만 RB_MAT_CHANGED(칸 · 지금 값 · 누가).
CREATE OR REPLACE FUNCTION public.rb_mat_do(p_email text, p_op text, p_a jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  a jsonb := coalesce(p_a, '{}'::jsonb);
  v_oid text := rb_mat_txt(a->'oid');
  v_id text := rb_mat_txt(a->'id');
  v_code text := upper(regexp_replace(rb_mat_txt(a->'code'), '\s', '', 'g'));
  v_memo text;
  v_d date; q numeric; base int;
  cur rb_mat_inb%rowtype;
  lk text; n int;
  bef jsonb; aft jsonb;
  m_ov jsonb; m_v0 int; m_ns int; o_d date; o_q numeric; o_m text; m_bad text[] := '{}'; m_kept text[] := '{}';
begin
  if coalesce(p_email, '') = '' then raise exception 'RB_SESSION'; end if;
  if v_oid = '' or length(v_oid) > 80 then raise exception 'RB_MAT_BAD 발주 건을 알 수 없습니다.'; end if;
  if p_op not in ('add', 'set', 'del', 'link') then raise exception 'RB_MAT_BAD 모르는 저장(%).', p_op; end if;
  perform pg_advisory_xact_lock(hashtext('rb_mat:' || v_oid));
  if a ? 'ver' and rb_mat_txt(a->'ver') ~ '^\d+$' then base := rb_mat_txt(a->'ver')::int; end if;

  if p_op in ('add', 'set') then
    v_memo := rb_mat_txt(a->'memo');
    if length(v_memo) > 300 then raise exception 'RB_MAT_BAD 메모는 300자까지입니다.'; end if;
    v_d := rb_mat_day(rb_mat_txt(a->'d'));
    q := rb_mat_num(rb_mat_txt(a->'qty'));
  end if;
  if p_op in ('add', 'set', 'del') and (v_id = '' or v_id !~ '^[A-Za-z0-9_-]{6,64}$') then raise exception 'RB_MAT_BAD 입고 줄 ID 가 이상합니다.'; end if;

  if p_op = 'add' then
    if v_code = '' or length(v_code) > 40 then raise exception 'RB_MAT_BAD 자재코드가 없습니다.'; end if;
    select * into cur from rb_mat_inb where rb_mat_inb.id = v_id;
    if found then
      -- 같은 요청이 다시 온 것(응답만 잃음) — 같은 값이면 그대로 성공
      if cur.oid = v_oid and cur.code = v_code and cur.d = v_d and cur.qty = q and cur.memo = v_memo then
        return rb_mat_state(v_oid) || jsonb_build_object('op', p_op, 'id', v_id, 'again', 1);
      end if;
      raise exception 'RB_MAT_BAD 같은 입고 줄 ID 가 이미 있습니다 — 다시 불러온 뒤 적어 주세요.';
    end if;
    select l.link into lk from rb_mat_link l where l.oid = v_oid and l.code = v_code;
    if coalesce(lk, '') not in ('', '-') then
      raise exception 'RB_MAT_LINKED 이 자재는 사급 발주(%)에 연결돼 있어 여기서 입고를 적지 않습니다 — 그 발주에서 입고를 등록하거나 연결을 풀어 주세요.', lk;
    end if;
    insert into rb_mat_inb (id, oid, code, d, qty, memo, by_email, at, ver) values (v_id, v_oid, v_code, v_d, q, v_memo, p_email, now(), 1);
    aft := jsonb_build_object('d', to_char(v_d, 'YYYY-MM-DD'), 'qty', q, 'memo', v_memo);
  elsif p_op = 'set' then
    select * into cur from rb_mat_inb where rb_mat_inb.id = v_id for update;
    if not found or cur.oid <> v_oid then raise exception 'RB_MAT_GONE 그사이 지워진 입고 줄입니다 — 다시 불러왔습니다.'; end if;
    v_code := cur.code;
    if cur.d = v_d and cur.qty = q and cur.memo = v_memo then
      return rb_mat_state(v_oid) || jsonb_build_object('op', p_op, 'id', v_id, 'same', 1);      -- 바뀐 것 없음(다시 보낸 저장 포함)
    end if;
    if base is not null and base <> cur.ver then
      -- m163: 화면이 본 판의 값 → 칸마다 3-way
      m_ov := null;
      if jsonb_typeof(a->'prev') = 'object' then m_ov := a->'prev';
      else
        select count(*) into m_ns from rb_mat_log l where l.line_id = v_id and l.oid = v_oid and l.op = 'set';
        m_v0 := cur.ver - m_ns;                      -- 첫 판(시트에서 옮긴 줄은 1이 아닐 수 있음)
        if base >= m_v0 and base < cur.ver then
          select l.before into m_ov from rb_mat_log l where l.line_id = v_id and l.oid = v_oid and l.op = 'set' order by l.id offset (base - m_v0) limit 1;
        end if;
      end if;
      if m_ov is null or jsonb_typeof(m_ov) <> 'object' then
        raise exception 'RB_MAT_CHANGED 그사이 %님이 이 입고 줄을 고쳤습니다 — 다시 불러왔으니 확인 후 다시 고쳐 주세요.', coalesce(nullif(cur.upd_by, ''), cur.by_email);
      end if;
      o_d := rb_mat_day(rb_mat_txt(m_ov->'d')); o_q := rb_mat_num(rb_mat_txt(m_ov->'qty')); o_m := rb_mat_txt(m_ov->'memo');
      if v_d <> o_d and cur.d <> o_d and cur.d <> v_d then m_bad := m_bad || ('입고일(지금 ' || to_char(cur.d, 'YYYY-MM-DD') || ')'); end if;
      if q <> o_q and cur.qty <> o_q and cur.qty <> q then m_bad := m_bad || ('수량(지금 ' || trim_scale(cur.qty)::text || ')'); end if;
      if v_memo <> o_m and cur.memo <> o_m and cur.memo <> v_memo then m_bad := m_bad || ('메모(지금 "' || left(cur.memo, 40) || '")'); end if;
      if array_length(m_bad, 1) > 0 then
        raise exception 'RB_MAT_CHANGED 그사이 %님이 같은 칸을 고쳤습니다: % — 다시 불러왔으니 확인 후 다시 고쳐 주세요.', coalesce(nullif(cur.upd_by, ''), cur.by_email), array_to_string(m_bad, ' · ');
      end if;
      if v_d = o_d and cur.d <> o_d then v_d := cur.d; m_kept := m_kept || 'd'::text; end if;
      if q = o_q and cur.qty <> o_q then q := cur.qty; m_kept := m_kept || 'qty'::text; end if;
      if v_memo = o_m and cur.memo <> o_m then v_memo := cur.memo; m_kept := m_kept || 'memo'::text; end if;
      if cur.d = v_d and cur.qty = q and cur.memo = v_memo then
        return rb_mat_state(v_oid) || jsonb_build_object('op', p_op, 'id', v_id, 'same', 1, 'merged', to_jsonb(m_kept));
      end if;
    end if;
    bef := jsonb_build_object('d', to_char(cur.d, 'YYYY-MM-DD'), 'qty', cur.qty, 'memo', cur.memo);
    update rb_mat_inb set d = v_d, qty = q, memo = v_memo, upd_by = p_email, upd_at = now(), ver = cur.ver + 1 where rb_mat_inb.id = v_id;
    aft := jsonb_build_object('d', to_char(v_d, 'YYYY-MM-DD'), 'qty', q, 'memo', v_memo);
  elsif p_op = 'del' then
    select * into cur from rb_mat_inb where rb_mat_inb.id = v_id for update;
    if not found then return rb_mat_state(v_oid) || jsonb_build_object('op', p_op, 'id', v_id, 'again', 1); end if;      -- 이미 지움
    if cur.oid <> v_oid then raise exception 'RB_MAT_BAD 다른 발주 건의 입고 줄입니다.'; end if;
    if base is not null and base <> cur.ver then
      raise exception 'RB_MAT_CHANGED 그사이 %님이 이 입고 줄을 고쳤습니다 — 다시 불러왔으니 확인 후 지워 주세요.', coalesce(nullif(cur.upd_by, ''), cur.by_email);
    end if;
    v_code := cur.code;
    bef := jsonb_build_object('d', to_char(cur.d, 'YYYY-MM-DD'), 'qty', cur.qty, 'memo', cur.memo);
    delete from rb_mat_inb where rb_mat_inb.id = v_id;
  else -- link
    if v_code = '' or length(v_code) > 40 then raise exception 'RB_MAT_BAD 자재코드가 없습니다.'; end if;
    lk := rb_mat_txt(a->'link');
    if length(lk) > 80 then raise exception 'RB_MAT_BAD 연결할 발주가 이상합니다.'; end if;
    if lk = v_oid then raise exception 'RB_MAT_BAD 자기 발주에는 연결할 수 없습니다.'; end if;
    select to_jsonb(l.link) into bef from rb_mat_link l where l.oid = v_oid and l.code = v_code;
    if lk not in ('', '-') then
      select count(*) into n from rb_mat_inb i where i.oid = v_oid and i.code = v_code;
      if n > 0 then
        raise exception 'RB_MAT_HAS_LINES 이 자재에 여기서 적은 입고가 %줄 있습니다 — 같은 입고가 두 번 세어지지 않게 먼저 지운 뒤 연결해 주세요.', n;
      end if;
    end if;
    if coalesce(bef #>> '{}', '') = lk then return rb_mat_state(v_oid) || jsonb_build_object('op', p_op, 'same', 1); end if;
    if lk = '' then delete from rb_mat_link l where l.oid = v_oid and l.code = v_code;
    else insert into rb_mat_link (oid, code, link, by_email, at) values (v_oid, v_code, lk, p_email, now())
           on conflict (oid, code) do update set link = excluded.link, by_email = excluded.by_email, at = excluded.at;
    end if;
    aft := to_jsonb(lk);
  end if;

  insert into rb_mat_log (oid, code, op, line_id, before, after, by_email) values (v_oid, v_code, p_op, nullif(v_id, ''), bef, aft, p_email);
  insert into rb_tab_job (tab, job) values ('mi', jsonb_build_object('oid', v_oid, 'op', p_op, 'code', v_code, 'who', p_email, 'at', now()));
  if p_email <> 'selftest@rb.local' then
    insert into rb_ver (k, v, at) values ('mi', (floor(extract(epoch from clock_timestamp()) * 1000))::bigint::text || ':' || p_email, now())
      on conflict (k) do update set v = excluded.v, at = excluded.at;
  end if;
  return rb_mat_state(v_oid) || jsonb_build_object('op', p_op, 'id', nullif(v_id, '')) || case when array_length(m_kept, 1) > 0 then jsonb_build_object('merged', to_jsonb(m_kept)) else '{}'::jsonb end;
end $function$;
