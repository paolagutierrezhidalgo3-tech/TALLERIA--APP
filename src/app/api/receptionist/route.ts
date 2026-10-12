import { NextResponse } from 'next/server';
import { clientKey, handleReceptionist } from '@/lib/receptionist/handler';
import { LIMITS } from '@/lib/receptionist/agent';
import { RateLimiter, providerFor, readReceptionistConfig } from '@/lib/receptionist/config';
import { getSupabase } from '@/lib/supabase/client';

// Conversational receptionist for the public page. Off unless the server
// sets RECEPTIONIST_PROVIDER (see src/lib/receptionist/config.ts); the logic
// and its safety rules live in src/lib/receptionist/handler.ts.
const limiter = new RateLimiter(40, 10 * 60 * 1000);

export async function POST(request: Request) {
  const provider = providerFor(readReceptionistConfig());
  // Nothing is read while it is off; otherwise the size is checked before
  // the body is parsed (declared length first, then the actual text).
  if (provider && Number(request.headers.get('content-length') ?? 0) > LIMITS.bodyBytes) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  const raw = provider ? await request.text() : '';
  const result = await handleReceptionist(raw, clientKey(request.headers), {
    provider, limiter,
    rpc: async (fn, args) => { const { data, error } = await getSupabase().rpc(fn, args); return { data, error }; },
  });
  return NextResponse.json(result.body, { status: result.status });
}
