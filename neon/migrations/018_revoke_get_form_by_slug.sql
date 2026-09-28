-- 018_revoke_get_form_by_slug.sql (ADR-061). The LAST step of shipping 8b, not part of it:
-- apply only after the SPA that loads forms through submitresponse (GET ?op=form) has been live for
-- 24 h with no rollback. After this, a rollback of the SPA to a pre-8b build breaks every public form
-- until the rollback block below is run.
--
-- Closes the slug-oracle for good: anonymous (and signed-in) Data API callers can no longer call
-- get_form_by_slug, so the only lookup is the throttled one. The function itself stays, so the
-- rollback is one GRANT. No Data API cache refresh is needed for a grant change.
begin;
revoke execute on function public.get_form_by_slug(text) from public;
do $$ begin
  revoke execute on function public.get_form_by_slug(text) from anonymous, authenticated;
exception when undefined_object then null; end $$;
commit;

-- Rollback (only if a pre-8b SPA must be served again):
--   grant execute on function public.get_form_by_slug(text) to anonymous, authenticated;
