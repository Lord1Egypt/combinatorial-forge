import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { loadConfig } from "./config";
import { ApiError, clientAddress } from "./http";
import { adminFailureLimiter } from "./ratelimit";

/** Constant-time comparison independent of input length. */
export function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

/** Fails closed: without a sufficiently long ADMIN_TOKEN the admin API does not exist. */
export function requireAdmin(request: Request): void {
  const { adminToken } = loadConfig();
  if (!adminToken)
    throw new ApiError(503, "admin_disabled", "administration is not configured on this deployment");
  const address = clientAddress(request);
  const key = `admin:${address}`;
  if (adminFailureLimiter.exhausted(key)) throw new ApiError(429, "rate_limited", "too many failed attempts");
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!presented || !safeEqual(presented, adminToken)) {
    adminFailureLimiter.spend(key);
    throw new ApiError(401, "unauthorized", "invalid credentials");
  }
}

/** One-way, salted network identifier; raw addresses are never stored. */
export function networkHash(request: Request): string | null {
  const address = clientAddress(request);
  if (address === "unknown") return null;
  return createHmac("sha256", loadConfig().networkSalt).update(address).digest("hex").slice(0, 16);
}
