// Bounds how long the caller waits for `promise`: if it hasn't settled
// within `ms`, the returned promise rejects instead of waiting forever. Used
// by the background poll in workspace.tsx so a hung network request can't
// leave its `pollInFlight` guard stuck at true (and the poll permanently
// disabled) for the rest of the session.
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}
