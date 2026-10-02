import { NextResponse } from "next/server";
import { DatabaseNotConfigured } from "./db";
import { ValidationError } from "./validate";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/** Public, cacheable read responses. */
export function cached(body: unknown, seconds = 30): NextResponse {
  return NextResponse.json(body, {
    headers: { "Cache-Control": `public, s-maxage=${seconds}, stale-while-revalidate=${seconds * 4}` },
  });
}

/** Reads a JSON object body, refusing anything larger than `maxBytes` before it is fully buffered. */
export async function readJson(request: Request, maxBytes = 64 * 1024): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new ApiError(413, "payload_too_large", `body exceeds ${maxBytes} bytes`);
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json"))
    throw new ApiError(415, "unsupported_media_type", "send application/json");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "empty_body", "a JSON body is required");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ApiError(413, "payload_too_large", `body exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "invalid_json", "body is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new ApiError(400, "invalid_body", "body must be a JSON object");
  return parsed as Record<string, unknown>;
}

/** Converts any thrown value into a safe response: internal details are logged, never returned. */
export function handleError(error: unknown): NextResponse {
  if (error instanceof ApiError)
    return json({ error: { code: error.code, message: error.message, ...error.extra } }, error.status);
  if (error instanceof ValidationError)
    return json({ error: { code: "invalid_request", message: error.message } }, 400);
  if (error instanceof DatabaseNotConfigured)
    return json({ error: { code: "database_not_configured", message: error.message } }, 503);
  console.error("unhandled API error", error instanceof Error ? error.message : "unknown");
  return json({ error: { code: "internal_error", message: "internal error" } }, 500);
}

export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

type Handler<C> = (request: Request, context: C) => Promise<Response>;

export function route<C>(handler: Handler<C>): Handler<C> {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      return handleError(error);
    }
  };
}
