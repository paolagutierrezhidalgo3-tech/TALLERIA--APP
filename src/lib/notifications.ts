import 'server-only';
import { Resend } from 'resend';
import { getSupabaseAdmin } from './supabase/admin';

const COOLDOWN_MS = 2 * 60 * 1000;

// Best-effort: the public request this follows already succeeded before
// this runs, so a failure here must never surface to the anonymous visitor
// or affect their request -- this function never throws.
//
// requestId must be a real, existing, not-yet-notified public-channel
// request's id: claim_public_request_notification (a Postgres function,
// so the join with conversations that "public-channel" requires and the
// atomic conditional update both happen in one real SQL statement, never
// a separate read then write) claims it, or returns null for "already
// notified", "doesn't exist" or "not a public request" -- collapsed into
// the same no-op on purpose. Request ids are client-generated UUIDs that
// are never displayed or logged anywhere public, so the only way to learn
// a valid, unclaimed one is to have just submitted that exact request;
// this is what actually prevents a caller from manufacturing
// notifications without ever creating a real request. The per-workshop
// cooldown further below is a separate, secondary throttle with no
// security role of its own -- it only caps a burst of genuinely real
// requests to one email rather than one per request.
export async function notifyNewRequest(requestId: string): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    const { data: workshopId, error: claimError } = await admin.rpc('claim_public_request_notification', { p_request_id: requestId });
    if (claimError) { console.error('claim_public_request_notification failed', claimError); return; }
    if (!workshopId) return;
    const cooldownBefore = new Date(Date.now() - COOLDOWN_MS).toISOString();
    const { data: workshop, error: cooldownError } = await admin.from('workshops')
      .update({ notifications_last_sent_at: new Date().toISOString() })
      .eq('id', workshopId)
      .or(`notifications_last_sent_at.is.null,notifications_last_sent_at.lt.${cooldownBefore}`)
      .select('id, name')
      .maybeSingle();
    if (cooldownError) { console.error('workshop notification cooldown update failed', cooldownError); return; }
    if (!workshop) return;
    const { data: members, error: membersError } = await admin.from('workshop_members').select('user_id').eq('workshop_id', workshop.id);
    if (membersError) { console.error('workshop_members lookup failed', membersError); return; }
    if (!members?.length) return;
    const emails: string[] = [];
    for (const { user_id } of members) {
      const { data, error } = await admin.auth.admin.getUserById(user_id);
      if (error) { console.error('getUserById failed for a workshop member', error); continue; }
      if (data?.user?.email) emails.push(data.user.email);
    }
    if (!emails.length) return;
    await sendNewRequestEmail(emails, workshop.name);
  } catch (err) {
    console.error('notifyNewRequest failed', err);
  }
}

// Deliberately minimal: no customer name, phone, plate or reason in the
// email body -- email is a less controlled channel than the app itself,
// so the notice only points staff back to the panel to see the actual
// details there. workshopName comes from this workshop's own row, never
// from the caller.
async function sendNewRequestEmail(to: string[], workshopName: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) { console.error('RESEND_API_KEY no está configurada; no se envía el aviso de solicitud nueva.'); return; }
  // ?? only falls back for null/undefined, not for "" (an env var set to
  // an empty string, as .env.example documents for the unconfigured case);
  // trim first so a blank value falls back the same way an absent one does.
  const from = process.env.NOTIFICATIONS_FROM_EMAIL?.trim() || 'TALLERIA <onboarding@resend.dev>';
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to,
    subject: 'Tienes una solicitud nueva',
    text: `Ha llegado una solicitud nueva en la recepción de ${workshopName}. Revísala en tu panel de TALLERIA.`,
  });
  if (error) console.error('Resend error al enviar el aviso de solicitud nueva', error);
}
