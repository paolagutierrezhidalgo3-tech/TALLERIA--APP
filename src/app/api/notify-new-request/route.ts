import { NextResponse } from 'next/server';
import { notifyNewRequest } from '@/lib/notifications';

// Called by the public reception page right after a request is accepted,
// with that exact request's own id (never a workshop slug alone -- see
// notifyNewRequest for why that distinction is what keeps this endpoint
// from being usable to generate notifications without a real request).
// Once given a well-formed requestId, always answers 200/ok regardless of
// what notifyNewRequest actually did with it: the visitor's request
// already succeeded before this is ever called, and this is only a
// best-effort staff notification -- its outcome is never this caller's
// concern. A malformed body still answers 400, since that's this route's
// own input, not notifyNewRequest's business.
export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  const requestId = (body as { requestId?: unknown } | null)?.requestId;
  if (typeof requestId !== 'string' || !requestId.trim()) return NextResponse.json({ ok: false }, { status: 400 });
  await notifyNewRequest(requestId.trim());
  return NextResponse.json({ ok: true });
}
