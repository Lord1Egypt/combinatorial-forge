# Security model

Browser compute is voluntary: the compute page does nothing until Start is
pressed. Workers run the shared C++ engine as WebAssembly and keep unfinished
claims in IndexedDB. Stop preserves work locally; Discard releases claims.

The browser receives only public job definitions, lease tokens for its own
claims, and public results. Database and admin credentials are server-side
environment variables. Admin routes fail closed without a sufficiently long
token and use a constant-time token comparison. Public submissions are never
trusted on receipt: jobs require independent matching results according to
policy, and disputes remain visible until resolved. A trusted recomputation is
available to administrators.

SQL queries use bound values; query filters are allowlisted. JSON requests have
size limits and schema checks. Checkpoints have a 64 KiB cap. Lease tokens are
random and stored as hashes; stale and foreign leases are rejected. Submission
replay and duplicate worker credit have explicit checks. Snapshot download
names are allowlisted. React escapes dynamic content, while the native local
explorer inserts API text with `textContent`. The web app sends a restrictive
CSP and other security headers; its own Next.js bootstrap still requires
`unsafe-inline` scripts, and WASM needs `wasm-unsafe-eval`.

The native remote worker runs `curl` with an argument vector, without a shell.
Temporary request bodies containing lease tokens live in an owner-only
directory and are removed after the request.

The public API has a best-effort in-memory token bucket. On serverless hosting,
each instance has its own bucket, so deployers should also configure edge
rate limiting for adversarial traffic. Network identity is a salted hash of
the address supplied by the trusted reverse proxy; it is a policy signal, not
proof of distinct people. A malicious party with separate workers and networks
can still submit matching false results; trusted recomputation is the stronger
check for high-value claims. Never publish the admin token or database token.
