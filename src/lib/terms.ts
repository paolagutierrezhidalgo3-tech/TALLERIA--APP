// Version of the terms of service a workshop accepts when signing up. Bump
// it whenever the text of /terminos changes in substance, so a later
// re-acceptance can tell who accepted which text: the publication date,
// plus a .N suffix for a second revision published the same day.
export const TERMS_VERSION = '2026-10-02';

/** What signUp() stores in the new user's metadata as proof of acceptance.
 * Deliberately just user metadata, no table or migration: it is weak
 * evidence (the user can edit their own metadata, the timestamp comes from
 * the browser, and calling Supabase's signUp API directly skips the
 * checkbox entirely -- it's a UI barrier, not a server-side rule), accepted
 * as such for the pilot stage -- see the plan. */
export function termsAcceptanceMetadata(now = new Date()) {
  return { terms_version: TERMS_VERSION, terms_accepted_at: now.toISOString() };
}
