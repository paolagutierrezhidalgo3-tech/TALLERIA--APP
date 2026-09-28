// Coordinates which of several concurrent, independent reads of
// `metrics` is allowed to apply, for the "aviso de solicitudes nuevas"
// background poll in workspace.tsx. Extracted into a plain, dependency-free
// class specifically so the exact interleavings that matter here can be
// driven directly in a test, instead of only through source-pattern checks
// that can't see actual temporal ordering.
//
// The problem this solves: ordering async reads by "which one started
// first" does not work when one of them (a mutation's own post-write
// reload) is guaranteed fresh regardless of start order, and the others
// (the poll, a manual refresh, navigation, the demo cross-tab sync) can
// resolve in any order relative to each other and to a mutation that starts
// and finishes entirely inside one of their round trips -- a plain
// before/after boolean check can miss that if the flag has already flipped
// back by the time the check runs.
//
// Two independent counters:
// - readGeneration: claimed by every "ordinary read" (the poll, load(),
//   refresh(), page navigation, the demo sync) right as it starts. A read is
//   only still the freshest if nothing else among these has claimed since.
// - mutationGeneration: bumped only when a mutation begins. An ordinary
//   read's claim also records this value; if it has moved by the time the
//   read resolves -- whether the mutation is still running or has already
//   finished -- that read is considered stale, because a mutation's own
//   reload is the one thing guaranteed to reflect at least the write it
//   just made, and nothing else can safely be assumed fresher than it once
//   one has run during the read's lifetime.
//
// A mutation's own reload never calls claimRead()/isFresh() at all: it
// always applies its result unconditionally (that is what makes it safe to
// treat as authoritative here). This class only decides freshness for
// everything else.
//
// `mutatingAtStart` (captured at claim time, not just re-checked at
// isFresh() time) matters separately from `mutationGenerationAtStart`: a
// read that starts *while* a mutation is already in progress and resolves
// only after that same mutation finishes has an unchanged
// mutationGeneration (no *new* mutation started or ended during its
// lifetime) and `mutating` is back to false by the time isFresh() runs --
// both of the generation/flag checks alone would wrongly call it fresh. Its
// own network round trip genuinely overlapped the write, so it can't be
// trusted regardless of what mutationGeneration says afterward.
export interface ReadClaim { attempt: number; mutationGenerationAtStart: number; mutatingAtStart: boolean }
export class ReadCoordinator {
  private readGeneration = 0;
  private mutationGeneration = 0;
  private mutating = false;
  claimRead(): ReadClaim {
    return { attempt: ++this.readGeneration, mutationGenerationAtStart: this.mutationGeneration, mutatingAtStart: this.mutating };
  }
  isFresh(claim: ReadClaim): boolean {
    return claim.attempt === this.readGeneration && claim.mutationGenerationAtStart === this.mutationGeneration && !claim.mutatingAtStart && !this.mutating;
  }
  get mutationInProgress(): boolean {
    return this.mutating;
  }
  beginMutation(): void {
    this.mutating = true;
    ++this.mutationGeneration;
  }
  endMutation(): void {
    this.mutating = false;
  }
  // Used by the second phase of resetDemo(), which -- like a mutation --
  // deliberately rewrites the underlying data and always applies its own
  // result unconditionally, but still needs to invalidate any ordinary read
  // already in flight against the same repository instance it just reset.
  invalidatePendingReads(): void {
    ++this.readGeneration;
  }
}
