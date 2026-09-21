import type { PendingInvitation } from './team';

export type SessionResolution =
  | { screen: 'auth'; error?: string }
  | { screen: 'app'; workshopId: string }
  | { screen: 'invitation'; pending: PendingInvitation }
  | { screen: 'onboarding' };

export interface SessionDeps {
  getUser(): Promise<{ user: { id: string } | null; error: unknown }>;
  getMembership(userId: string): Promise<{ data: { workshop_id: string } | null; error: unknown }>;
  getPendingInvitation(): Promise<PendingInvitation | null>;
}

export async function resolveSession(deps: SessionDeps): Promise<SessionResolution> {
  try {
    const { user, error: authError } = await deps.getUser();
    if (authError || !user) return { screen: 'auth' };
    const membership = await deps.getMembership(user.id);
    if (membership.error) throw membership.error;
    if (membership.data) return { screen: 'app', workshopId: membership.data.workshop_id };
    // A failed lookup here must never be read as "no invitation": that would
    // route an invited person into onboarding, where creating their own
    // workshop permanently blocks accept_invitation ("ya pertenece a un
    // taller") with no self-service way to undo it. Let the failure fall
    // through to the catch below instead of defaulting to onboarding.
    const pending = await deps.getPendingInvitation();
    return pending ? { screen: 'invitation', pending } : { screen: 'onboarding' };
  } catch (err) {
    return { screen: 'auth', error: err instanceof Error ? err.message : 'Error de conexión' };
  }
}
