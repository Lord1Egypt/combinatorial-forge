interface Bucket {
  tokens: number;
  updated: number;
}

/**
 * Best-effort in-memory token bucket. On serverless each instance keeps its own buckets, so this
 * blunts bursts and accidental loops; it is not a substitute for Vercel Firewall rate limiting
 * (documented in docs/security.md).
 */
export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  constructor(
    private capacity: number,
    private refillPerSecond: number,
    private maxKeys = 10_000,
  ) {}

  /** True when the bucket has no tokens left (does not consume). */
  exhausted(key: string, now = Date.now()): boolean {
    const bucket = this.buckets.get(key);
    if (!bucket) return false;
    return (
      Math.min(this.capacity, bucket.tokens + ((now - bucket.updated) / 1000) * this.refillPerSecond) < 1
    );
  }

  /** Consumes a token unconditionally (used to count failures). */
  spend(key: string, now = Date.now()): void {
    this.allow(key, now);
  }

  allow(key: string, now = Date.now()): boolean {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= this.maxKeys) this.buckets.clear();
      bucket = { tokens: this.capacity, updated: now };
      this.buckets.set(key, bucket);
    }
    bucket.tokens = Math.min(
      this.capacity,
      bucket.tokens + ((now - bucket.updated) / 1000) * this.refillPerSecond,
    );
    bucket.updated = now;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }
}

export const contributionLimiter = new RateLimiter(60, 2);
export const adminFailureLimiter = new RateLimiter(5, 0.1);
