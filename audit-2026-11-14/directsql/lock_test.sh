#!/bin/bash
# ① GAS 끝맺기(rb_tab_commit pd + p_chk)가 그사이 직접 저장한 줄을 덮지 않는지 ② 같은 잠금(rb_tab_pd)으로 줄 서는지
Q=/tmp/rbq.sh
T="'_실행판_발주'"
# 시험 데이터는 harness 마지막 사례(품의 취소 rb_once) 상태를 그대로 쓴다 — 2행(RB261101-AAA001, 계획)
echo "create temp table if not exists x(a int); 
select 'raw2=' || (select cells::text from sheet_rows where tab=$T and row=2);" | $Q ds -At > /tmp/rb_raw2.txt
RAW=$(sed -n 's/^raw2=//p' /tmp/rb_raw2.txt)
echo "select test_call('rb_od_state','tokE','[2, {\"id\":\"RB261101-AAA001\",\"name\":\"세럼 A\"}, \"상신\"]'::jsonb);" | $Q ds -At
echo "-- GAS 가 읽어 둔 옛 줄로 끝맺기 → RB_ROW_TAKEN 이어야
do \$\$ begin perform rb_tab_commit('_실행판_발주','pd','[]'::jsonb, jsonb_build_array(jsonb_build_object('row',2,'cells','$RAW'::jsonb)), '{}'::int[], null, jsonb_build_object('2','$RAW'::jsonb)); raise notice 'COMMIT 통과(틀림)'; exception when others then raise notice '끝맺기 결과: %', SQLERRM; end \$\$;
select '2행 진행상태 = ' || rb_t(cells->12) from sheet_rows where tab=$T and row=2;" | $Q ds -At 2>&1
# ② 잠금 줄서기: A 가 잠금을 3초 쥔 동안 B(rb_od_state)는 기다렸다가 끝나야
( echo "begin; select pg_advisory_xact_lock(hashtext('rb_tab_pd')); select pg_sleep(3); commit;" | $Q ds -At >/dev/null ) &
sleep 0.5
S=$(date +%s.%N)
echo "select test_call('rb_od_state','tokE','[2, {\"id\":\"RB261101-AAA001\",\"name\":\"세럼 A\"}, \"승인\"]'::jsonb);" | $Q ds -At
E=$(date +%s.%N); echo "rb_od_state 기다린 시간: $(echo "$E - $S" | bc) 초(약 2.5 이어야)"
wait
