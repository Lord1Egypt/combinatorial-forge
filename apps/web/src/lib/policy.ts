export interface PolicySubmission {
  id: string;
  workerId: string;
  networkHash: string | null;
  hash: string;
  trusted: boolean;
}

export interface Verdict {
  status: "submitted" | "verified" | "disputed";
  hash: string | null;
  bestGroup: number;
}

/**
 * Verification policy (mirrored by cli/store.hpp `decide`, checked by database/fixtures/verification_cases.json):
 *  - a trusted submission decides the job alone;
 *  - otherwise `required` matching submissions from distinct workers (and, if enabled, distinct networks) verify it;
 *  - two different hashes with no group reaching `required` leave the job disputed.
 */
export function decide(
  required: number,
  submissions: PolicySubmission[],
  requireDistinctNetworks: boolean,
): Verdict {
  const trusted = submissions.find((s) => s.trusted);
  if (trusted) return { status: "verified", hash: trusted.hash, bestGroup: 1 };
  const groups = new Map<string, Set<string>>();
  for (const s of submissions) {
    const identity = requireDistinctNetworks
      ? (s.networkHash ?? `worker:${s.workerId}`)
      : `worker:${s.workerId}`;
    if (!groups.has(s.hash)) groups.set(s.hash, new Set());
    groups.get(s.hash)!.add(identity);
  }
  let best = 0;
  let verified: string | null = null;
  for (const [hash, identities] of groups) {
    best = Math.max(best, identities.size);
    if (identities.size >= required && verified === null) verified = hash;
  }
  if (verified !== null) return { status: "verified", hash: verified, bestGroup: best };
  return { status: groups.size >= 2 ? "disputed" : "submitted", hash: null, bestGroup: best };
}
