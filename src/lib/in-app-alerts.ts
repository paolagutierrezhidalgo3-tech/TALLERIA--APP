// The text for a passive discovery of new solicitudes -- one that arrived
// while the user was already in the app (via the background poll in
// workspace.tsx, or a routine data refresh triggered by navigation), never
// for a solicitud the user's own action (Reception's manual intake, or any
// other execute()) just created, which already gets its own contextual
// confirmation elsewhere.
export function newRequestsMessage(previousCount: number | null, currentCount: number | undefined): string | null {
  if (currentCount === undefined || previousCount === null || currentCount <= previousCount) return null;
  const arrived = currentCount - previousCount;
  return arrived === 1 ? 'Ha llegado una solicitud nueva.' : `Han llegado ${arrived} solicitudes nuevas.`;
}
