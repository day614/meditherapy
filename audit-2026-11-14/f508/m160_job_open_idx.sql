-- m160_job_open_idx — rb_tab_job 의 '안 끝난 일'(done_at is null)만 담는 부분 인덱스. rb_pd_busy · rb_pg_busy · rb_sm2_sbusy · rb_dly_ready · rb_item_reg_do · rb_po_item_add 가 저장마다 7일 치 일을 다 훑었다(statement timeout 원인 후보).
create index if not exists rb_tab_job_open on rb_tab_job (tab, id) where done_at is null;
analyze rb_tab_job;
