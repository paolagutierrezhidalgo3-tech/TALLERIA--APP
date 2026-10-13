import { PUBLIC_BOOKING, applyCommand, freeSlots, type Command } from '@/lib/domain';
import { upgradeDemo } from '@/lib/demo-migration';
import { createDemo } from '@/lib/demo';
import { KEY, LEGACY, saveDemo } from '@/lib/repository';
import type { IntakeSubmission } from './use-intake-wizard';
export interface PublicWorkshopInfo { name: string; address: string; hours: string; timezone?: string }
/** What public_availability returns: free start times only, never who
 * booked what. */
export interface PublicAvailability { timezone: string; duration_minutes: number; slots: string[] }
/** Demo-mode counterpart of the real public_workshop_info/public_intake
 * RPCs: same slug-gated entry point, but reading/writing this browser's
 * localStorage demo state directly instead of Postgres. Lets the "recepción
 * digital" link be demoed with no Supabase project configured, at the cost
 * of not syncing across devices -- the same limitation the rest of demo
 * mode already has. */
function readDemoState(slug?: string) {
  const saved = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY);
  if (!saved) {
    // A visitor who opens the sample workshop's public link first (it is
    // shared from the demo's landing page) gets the same sample demo the
    // "Explorar demo" button creates, instead of "No encontramos este
    // taller". Any other slug, or a demo already saved, is left as is.
    const sample = upgradeDemo(createDemo());
    if (!slug || sample.workshop.slug !== slug) return null;
    saveDemo(sample);
    return sample;
  }
  try { return upgradeDemo(JSON.parse(saved)); } catch { return null; }
}
export function publicDemoWorkshop(slug: string): PublicWorkshopInfo | null {
  const state = readDemoState(slug);
  if (!state || state.workshop.slug !== slug) return null;
  const { name, address, hours, timezone } = state.workshop;
  return { name, address, hours, timezone };
}
export function publicDemoAvailability(slug: string, now = new Date()): PublicAvailability | null {
  const state = readDemoState(slug);
  if (!state || state.workshop.slug !== slug) return null;
  const from = new Date(now.getTime() + PUBLIC_BOOKING.listLeadMinutes * 60000);
  const to = new Date(now.getTime() + PUBLIC_BOOKING.listDays * 86400000);
  return { timezone: state.workshop.timezone, duration_minutes: state.workshop.appointment_minutes, slots: freeSlots(state, from, to).slice(0, 400).map(f => f.starts_at) };
}
export async function publicDemoIntake(slug: string, submission: IntakeSubmission, consent: boolean): Promise<boolean> {
  // Same read/modify/write serialization as DemoRepository.execute(): the
  // dashboard can be open in one tab while a customer submits through the
  // public link in another, and without this lock the later write of either
  // one silently clobbers the other instead of applying on top of it.
  const save = () => {
    const state = readDemoState(slug);
    if (!state || state.workshop.slug !== slug) return false;
    const command: Command = { type: 'intake', ...submission, channel: 'public', consent };
    const next = applyCommand(state, command);
    saveDemo(next);
    return true;
  };
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(KEY, () => save());
  return save();
}
