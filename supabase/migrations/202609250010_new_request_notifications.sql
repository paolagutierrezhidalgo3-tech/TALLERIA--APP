-- Backing columns for the "you have a new request" owner/staff email
-- notification. The notification itself is sent from a Next.js Route
-- Handler (src/lib/notifications.ts) using the Supabase secret key, not
-- from Postgres -- there is no trigger or webhook here.
--
-- requests.notified_at is the security-relevant piece: the Route Handler
-- can only trigger an email for a specific, real, not-yet-notified public
-- request, claimed with one atomic conditional update (never a separate
-- read then write), so a caller can't manufacture a notification without
-- first having a real request's id -- which is a client-generated UUID,
-- never displayed or logged anywhere public, so learning one means having
-- actually submitted it.
--
-- workshops.notifications_last_sent_at is a secondary, UX-only throttle on
-- top of that: it caps the resulting emails to at most one per workshop
-- per cooldown window during a burst of genuinely real requests, so the
-- owner gets "you have new activity" once rather than once per request.
-- It grants no security property by itself and was the *only* guard in an
-- earlier version of this migration/feature, which independent review
-- correctly flagged as spoofable via the workshop's public slug alone.
--
-- The atomic claim itself has to run as one real SQL statement, not a
-- sequence of PostgREST filter calls from the Route Handler: whether a
-- request came through the public reception link is recorded on its
-- conversation (conversations.channel), not on the request row itself,
-- so checking it means joining through requests.conversation_id.
-- claim_public_request_notification does exactly that update-with-join,
-- atomically, and returns the request's workshop_id only when it actually
-- claimed a row -- null for "already notified", "not found", or "not a
-- public-channel request", collapsed into the same no-op on purpose.
--
-- Every existing table, policy, grant and function other than this new
-- one is unchanged.
begin;
alter table public.requests add column notified_at timestamptz;
alter table public.workshops add column notifications_last_sent_at timestamptz;

create function public.claim_public_request_notification(p_request_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_workshop_id uuid;
begin
  update public.requests r set notified_at = now()
  from public.conversations c
  where r.id = p_request_id
    and r.workshop_id = c.workshop_id
    and r.conversation_id = c.id
    and c.channel = 'public'
    and r.notified_at is null
  returning r.workshop_id into v_workshop_id;
  return v_workshop_id;
end $$;
-- Only the Route Handler's Supabase secret-key connection calls this: that
-- connection runs as service_role, which bypasses row-level security but
-- still needs an explicit grant here, same as any other role -- functions
-- are executable by PUBLIC (i.e. everyone) by default, so revoking that
-- and then granting execute back to service_role only is what actually
-- restricts this, not any inherent privilege service_role would otherwise
-- lack. Revoking from anon/authenticated is defense in depth, matching
-- every other function in this schema.
revoke all on function public.claim_public_request_notification(uuid) from public, anon, authenticated;
grant execute on function public.claim_public_request_notification(uuid) to service_role;
commit;
