import type { PendingInvitation } from './team';

export type SessionResolution =
  | { screen: 'auth'; error?: string }
  | { screen: 'app'; userId: string; workshopId: string }
  | { screen: 'invitation'; userId: string; pending: PendingInvitation }
  | { screen: 'onboarding'; userId: string };

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
    if (membership.data) return { screen: 'app', userId: user.id, workshopId: membership.data.workshop_id };
    // A failed lookup here must never be read as "no invitation": that would
    // route an invited person into onboarding, where creating their own
    // workshop permanently blocks accept_invitation ("ya pertenece a un
    // taller") with no self-service way to undo it. Let the failure fall
    // through to the catch below instead of defaulting to onboarding.
    const pending = await deps.getPendingInvitation();
    return pending ? { screen: 'invitation', userId: user.id, pending } : { screen: 'onboarding', userId: user.id };
  } catch (err) {
    return { screen: 'auth', error: err instanceof Error ? err.message : 'Error de conexión' };
  }
}

/** The user and workshop the panel is currently showing, recorded only when
 * a load() actually puts the screen on 'app' and cleared on every way out
 * of it. */
export interface AppSession { userId: string; workshopId: string }

/** True when an auth event resolved -- after resolveSession's own server
 * checks (getUser + membership) -- to exactly the session already on
 * screen: Supabase re-validating it (a token refresh, a tab regaining
 * focus), not a change. Any other user, any other workshop, a removed
 * membership (no longer 'app') or no session on screen is a real change. */
export function isSameAppSession(current: AppSession | null, resolution: SessionResolution): boolean {
  return current !== null && resolution.screen === 'app' && resolution.userId === current.userId && resolution.workshopId === current.workshopId;
}

/** The session on screen plus the repository it was loaded through. */
export interface ShownSession<R> extends AppSession { repo: R }

/** Skipping the reload is only safe when nothing has started replacing what
 * is on screen: load() swaps the active repository the moment it starts, so
 * a different active repository means a load() for some other session is
 * still in flight (e.g. another tab switched to a second account and back),
 * and the panel must be reloaded for the session that is current now. */
export function canSkipReload<R>(shown: ShownSession<R> | null, activeRepo: R | null, resolution: SessionResolution): boolean {
  return shown !== null && shown.repo === activeRepo && isSameAppSession(shown, resolution);
}
