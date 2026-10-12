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

// The same passive discovery for the agenda: a customer booking from the
// public link arrives as a request already "cita creada" (not counted as a
// new solicitud), so the only sign of it is one more upcoming appointment.
// Worded neutrally because another team member's appointment looks the
// same. Best effort: an appointment passing in the meantime can hide one.
export function newAppointmentsMessage(previousCount: number | null, currentCount: number | undefined): string | null {
  if (currentCount === undefined || previousCount === null || currentCount <= previousCount) return null;
  const arrived = currentCount - previousCount;
  return arrived === 1 ? 'Hay una cita nueva en la agenda.' : `Hay ${arrived} citas nuevas en la agenda.`;
}
