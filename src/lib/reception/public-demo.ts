import { applyCommand, type Command } from '@/lib/domain';
import { upgradeDemo } from '@/lib/demo-migration';
import { KEY, LEGACY } from '@/lib/repository';
import type { IntakeSubmission } from './use-intake-wizard';
export interface PublicWorkshopInfo { name: string; address: string; hours: string }
/** Demo-mode counterpart of the real public_workshop_info/public_intake
 * RPCs: same slug-gated entry point, but reading/writing this browser's
 * localStorage demo state directly instead of Postgres. Lets the "recepción
 * digital" link be demoed with no Supabase project configured, at the cost
 * of not syncing across devices -- the same limitation the rest of demo
 * mode already has. */
function readDemoState() {
  const saved = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY);
  if (!saved) return null;
  try { return upgradeDemo(JSON.parse(saved)); } catch { return null; }
}
export function publicDemoWorkshop(slug: string): PublicWorkshopInfo | null {
  const state = readDemoState();
  if (!state || state.workshop.slug !== slug) return null;
  const { name, address, hours } = state.workshop;
  return { name, address, hours };
}
export async function publicDemoIntake(slug: string, submission: IntakeSubmission, consent: boolean): Promise<boolean> {
  // Same read/modify/write serialization as DemoRepository.execute(): the
  // dashboard can be open in one tab while a customer submits through the
  // public link in another, and without this lock the later write of either
  // one silently clobbers the other instead of applying on top of it.
  const save = () => {
    const state = readDemoState();
    if (!state || state.workshop.slug !== slug) return false;
    const command: Command = { type: 'intake', ...submission, channel: 'public', consent };
    const next = applyCommand(state, command);
    localStorage.setItem(KEY, JSON.stringify(next));
    return true;
  };
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(KEY, () => save());
  return save();
}
