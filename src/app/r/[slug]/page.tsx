import { PublicReceptionPage } from '@/components/public-reception';
import { getSupabase, isSupabaseMode } from '@/lib/supabase/client';
import type { PublicWorkshopInfo } from '@/lib/reception/public-demo';

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Demo mode has no server-side data at all (no env vars, localStorage
  // only): resolving the workshop happens client-side, in PublicReceptionPage.
  if (!isSupabaseMode) return <PublicReceptionPage slug={slug} />;
  const { data } = await getSupabase().rpc('public_workshop_info', { p_slug: slug });
  return <PublicReceptionPage slug={slug} workshop={(data ?? undefined) as PublicWorkshopInfo | undefined}/>;
}
