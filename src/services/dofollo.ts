import { API_BASE, MCP_PREFIX, REQUEST_TIMEOUT_MS } from "../constants.js";

/** Error from the Dofollo API, carrying the HTTP status for actionable messaging. */
export class DofolloError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "DofolloError";
  }
}

type QueryValue = string | number | boolean | undefined | null;
type Query = Record<string, QueryValue>;

/**
 * GET a Dofollo MCP endpoint, authenticating as an internal service on behalf of one user.
 * Unwraps the `{ success, data, message }` response envelope and returns `data`.
 */
export async function dofolloGet<T = unknown>(
  path: string,
  dofolloUserId: string,
  query?: Query,
): Promise<T> {
  const url = new URL(API_BASE + MCP_PREFIX + path);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Dofollo-User-Id": dofolloUserId,
        "X-Internal-Service-Secret": process.env.INTERNAL_SERVICE_SECRET!,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new DofolloError(0, `network error calling ${path}: ${(err as Error).message}`);
  }

  const raw = await resp.text();
  let json: unknown = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    // non-JSON response; leave json as null and fall through
  }

  if (!resp.ok) {
    const apiMsg =
      (json as { error?: string; message?: string } | null)?.error ??
      (json as { error?: string; message?: string } | null)?.message ??
      raw ??
      resp.statusText;
    if (resp.status === 401) {
      throw new DofolloError(
        401,
        "unauthorized - the Dofollo user mapping or internal service authentication was rejected.",
      );
    }
    if (resp.status === 403 || resp.status === 404) {
      throw new DofolloError(
        resp.status,
        `not accessible for this user - the site may not belong to them (${apiMsg}).`,
      );
    }
    throw new DofolloError(resp.status, String(apiMsg));
  }

  if (json && typeof json === "object" && "data" in (json as Record<string, unknown>)) {
    return (json as { data: T }).data;
  }
  return json as T;
}
