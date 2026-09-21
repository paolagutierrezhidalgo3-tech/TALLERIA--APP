import { databaseMessage } from '../security';
import { getSupabase } from './client';

export interface TeamMember { user_id: string; role: 'owner' | 'staff'; email: string; created_at: string }
export interface TeamInvitation { id: string; email: string; status: string; created_at: string; expires_at: string }
export interface TeamSnapshot { members: TeamMember[]; invitations: TeamInvitation[] }
export interface PendingInvitation { id: string; workshop_id: string; workshop_name: string; invited_by_email: string }

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args);
  if (error) throw new Error(databaseMessage(error));
  return data as T;
}

export const listMembers = (workshopId: string) => call<TeamSnapshot>('list_members', { p_workshop_id: workshopId });
export const inviteMember = (workshopId: string, email: string) => call<string>('invite_member', { p_workshop_id: workshopId, p_email: email });
export const revokeInvitation = (invitationId: string) => call<void>('revoke_invitation', { p_invitation_id: invitationId });
export const removeMember = (workshopId: string, userId: string) => call<void>('remove_member', { p_workshop_id: workshopId, p_user_id: userId });
export const myPendingInvitation = () => call<PendingInvitation | null>('my_pending_invitation');
export const acceptInvitation = (invitationId: string) => call<string>('accept_invitation', { p_invitation_id: invitationId });
export const declineInvitation = (invitationId: string) => call<void>('decline_invitation', { p_invitation_id: invitationId });

export type TeamLoadState = { status: 'ready'; snapshot: TeamSnapshot } | { status: 'error'; message: string };

export async function loadTeam(workshopId: string, fetchMembers: (workshopId: string) => Promise<TeamSnapshot> = listMembers): Promise<TeamLoadState> {
  try { return { status: 'ready', snapshot: await fetchMembers(workshopId) }; }
  catch (err) { return { status: 'error', message: err instanceof Error ? err.message : 'No se ha podido cargar el equipo.' }; }
}
