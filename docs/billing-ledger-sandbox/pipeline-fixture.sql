-- Disposable CI-only fixtures for the combined application -> SQL pipeline.
create role dlkt_pipeline_fixture_ingress nologin noinherit nobypassrls;
grant usage on schema dlkt_info_billing to dlkt_pipeline_fixture_ingress;
grant execute on function dlkt_info_billing.ingest_notice(text,text,text,text,bigint) to dlkt_pipeline_fixture_ingress;
insert into auth.users(id) values('00000000-0000-4000-8000-000000000018');
insert into dlkt_info_billing.catalog_accounts(account_id,product_id) values('acct_PipelineIntegration','prod_PipelineIntegration');
insert into dlkt_info_billing.catalog_prices(account_id,price_id,plan,amount_cents) values
 ('acct_PipelineIntegration','price_PipelineMonth','monthly',699),('acct_PipelineIntegration','price_PipelineYear','annual',6900);
insert into dlkt_info_billing.customer_bindings(account_id,customer_id,owner_id) values
 ('acct_PipelineIntegration','cus_PipelineIntegration','00000000-0000-4000-8000-000000000018');
insert into dlkt_info_billing.subscription_bindings(account_id,customer_id,subscription_id,item_id,price_id) values
 ('acct_PipelineIntegration','cus_PipelineIntegration','sub_PipelineIntegration','si_PipelineIntegration','price_PipelineMonth');
select 'BILLING_PIPELINE_FIXTURE_READY';
