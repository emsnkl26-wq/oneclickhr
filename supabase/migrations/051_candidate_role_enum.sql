-- ============================================================================
-- 051_candidate_role_enum.sql — new enum VALUES, and nothing else.
--
-- RUN THIS FILE ON ITS OWN, BEFORE 052.
--
-- Postgres refuses to USE an enum value in the same transaction that added it
-- ("unsafe use of new value"), and the SQL editor runs a pasted file as one
-- transaction. So the values are added here, committed, and only then
-- referenced by 052's policies and functions.
--
--   user_role  + candidate        a person looking for a job (052). Signs up on
--                                 the job portal, belongs to no workspace, and
--                                 can see only their own profile and
--                                 applications.
--   job_type   + contract_to_hire, c2c, w2
--                                 the US staffing engagement types the portal
--                                 filters on alongside full/part time/contract.
--
-- Re-runnable: `add value if not exists`.
-- ============================================================================

alter type public.user_role add value if not exists 'candidate';

alter type public.job_type add value if not exists 'contract_to_hire';
alter type public.job_type add value if not exists 'c2c';
alter type public.job_type add value if not exists 'w2';
