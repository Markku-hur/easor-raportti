/**
 * Shared HTTP client for Easor's public API gateway (apim.talenom.com).
 *
 * Every request needs BOTH an OAuth2 bearer token AND a gateway
 * subscription key in the `Ocp-Apim-Subscription-Key` header — API
 * Management checks the subscription key first, then the backend API
 * verifies the bearer token with the identity provider. Easor issues one key per
 * company that covers every API (older setups have one per API), so every call
 * site picks its credential prefix with credentialsFor() or
 * resolveSharedCredentials().
 */

import { fetch } from "undici";
import { getAccessToken, getAgent } from "./auth.js";
import { withTransientRetry } from "./retry.js";

export const GATEWAY_BASE_URL = "https://apim.talenom.com";

export type EasorApi = "GL_FI" | "SALES_FI";

const hasCredentials = (prefix: string) => Boolean(process.env[`EASOR_${prefix}_CLIENT_ID`]);

/**
 * The organizations that have credentials of their own in .env, read from the
 * variable names only (never their values): the one-key form EASOR_ORG_<n>_* and
 * the older per-API form EASOR_ORG_<n>_<API>_*. Shared credentials cover
 * organizations that .env does not name, so they cannot be listed and only show
 * up as `sharedApis`.
 */
export function configuredOrganizations(): {
  organizations: { organizationNumber: number }[];
  sharedApis: EasorApi[];
} {
  const orgs = new Set<number>();
  for (const key of Object.keys(process.env)) {
    const m = /^EASOR_ORG_(\d+)(?:_GL_FI|_SALES_FI)?_CLIENT_ID$/.exec(key);
    if (m && process.env[key]) orgs.add(Number(m[1]));
  }
  const apis: EasorApi[] = ["GL_FI", "SALES_FI"];
  return {
    organizations: [...orgs].sort((a, b) => a - b).map((organizationNumber) => ({ organizationNumber })),
    sharedApis: apis.filter(hasCredentials),
  };
}

/**
 * The credential sets to try for one organization and API, in order:
 * 1. the company's one key (EASOR_ORG_<organizationNumber>_*), which covers every API,
 * 2. the company's older per-API set for this API (EASOR_ORG_<organizationNumber>_<API>_*),
 * 3. its per-API set for the other API, since those are often the same registration,
 * 4. the set without an organization number (EASOR_<API>_*), for credentials that
 *    cover several companies.
 * easorRequest moves to the next set only when Easor refuses one (401/403), so a
 * company's own credentials always win when they work. Never another company's.
 */
export function credentialsFor(organizationNumber: number, api: EasorApi): string[] {
  const other: EasorApi = api === "GL_FI" ? "SALES_FI" : "GL_FI";
  const org = `ORG_${organizationNumber}`;
  const candidates = [org, `${org}_${api}`, `${org}_${other}`, api].filter(hasCredentials);
  if (candidates.length) return candidates;
  throw new Error(
    `Organisaatiolle ${organizationNumber} ei ole Easor-tunnuksia. Lisää EASOR_${org}_CLIENT_ID ja muut sen tunnukset .env-tiedostoon ja käynnistä Claude uudelleen.`,
  );
}

/** Which of a candidate list last worked, so a refused set is not retried on every call. */
const workingCredentials = new Map<string, string>();

/**
 * Organization and Accounting Settings accept any valid Easor credential set and
 * have none of their own, so they use whichever set this organization has.
 */
export function resolveSharedCredentials(organizationNumber: number): string {
  for (const prefix of [`ORG_${organizationNumber}`, `ORG_${organizationNumber}_GL_FI`, `ORG_${organizationNumber}_SALES_FI`, "GL_FI", "SALES_FI"]) {
    if (hasCredentials(prefix)) return prefix;
  }
  throw new Error(
    `Organisaatiolle ${organizationNumber} ei ole Easor-tunnuksia. Lisää EASOR_ORG_${organizationNumber}_CLIENT_ID ja muut sen tunnukset .env-tiedostoon ja käynnistä Claude uudelleen.`,
  );
}

/**
 * FI is the only gateway region this project supports — every client
 * module states its own service path once instead of re-deriving this
 * prefix.
 */
export function fiBasePath(servicePath: string): string {
  return `/fi/${servicePath}`;
}

/** Converts a plain object's defined values to strings for use as a query
 * string or header map — numbers/booleans stringified, undefined dropped. */
export function toQuery(obj: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null) out[key] = String(value);
  }
  return out;
}

function subscriptionKey(prefix: string): string {
  const key = process.env[`EASOR_${prefix}_SUBSCRIPTION_KEY`];
  if (!key) {
    throw new Error(
      `Missing required environment variable: EASOR_${prefix}_SUBSCRIPTION_KEY. Request one from ` +
        "integration.support@easor.com — see .env.example.",
    );
  }
  return key;
}

async function baseHeaders(credentials: string, extra?: Record<string, string>): Promise<Record<string, string>> {
  return {
    Authorization: `Bearer ${await getAccessToken(credentials)}`,
    "Content-Type": "application/json",
    "Ocp-Apim-Subscription-Key": subscriptionKey(credentials),
    ...extra,
  };
}

/**
 * One line to stderr per gateway call — method/path/status/duration only,
 * deliberately never request/response bodies (financial data, PII).
 * stderr is safe: stdout is the JSON-RPC wire, stderr is not.
 */
function logGatewayCall(method: string, path: string, status: number | "ERR", startedAtMs: number): void {
  console.error(`easor-mcp ${method} ${path} ${status} ${Date.now() - startedAtMs}ms`);
}

export class GatewayError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function handle<T = unknown>(response: Awaited<ReturnType<typeof fetch>>, url: string): Promise<T> {
  if (!response.ok) {
    const text = await response.text().catch(() => "<no body>");
    throw new GatewayError(`${url} failed: ${response.status} ${response.statusText} — ${text}`, response.status);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }
  // Binary responses (e.g. voucher images) — caller decides how to encode.
  return Buffer.from(await response.arrayBuffer()) as T;
}

/**
 * @param T The response's real shape — the caller's job to get right, same
 * as any other `as`-cast HTTP client; nothing here validates it at runtime.
 * @param credentials Credential-set prefix (e.g. "ORG", "GL_FI") — picks
 * which EASOR_<PREFIX>_* env vars to authenticate with.
 */
export async function easorGet<T = unknown>(
  credentials: string | string[],
  path: string,
  params: Record<string, string | undefined> = {},
  extraHeaders?: Record<string, string>,
): Promise<T> {
  return easorRequest<T>(credentials, "GET", path, { query: params, extraHeaders });
}

/**
 * @param T The response's real shape — the caller's job to get right, same
 * as any other `as`-cast HTTP client; nothing here validates it at runtime.
 * @param credentials Credential-set prefix (e.g. "ORG", "GL_FI") — picks
 * which EASOR_<PREFIX>_* env vars to authenticate with.
 */
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/;

/**
 * Ids from tool arguments (contactId, invoiceId, voucherId, ...) are
 * interpolated into gateway paths. Every segment must be a plain token, so
 * an id such as "../invoices/<id>" or "x?y" cannot make fetch normalise or
 * re-route the request to a different endpoint than the tool describes.
 */
export function assertSafeGatewayPath(path: string): void {
  const segments = path.split("/");
  const valid = segments[0] === "" && segments.slice(1).every((segment) => SAFE_PATH_SEGMENT.test(segment));
  if (!valid) {
    throw new Error(`Refusing an Easor request with an unsafe path: ${JSON.stringify(path)}. Ids may contain only letters, digits, "-", "_", "." and "~".`);
  }
}

/**
 * This package only reads: GET is the only method it can send to the Easor API.
 * `credentials` is one prefix, or a candidate list from credentialsFor(): the
 * candidates are tried in order, moving on only when Easor refuses one (401/403),
 * starting from the one that last worked for the same list.
 */
export async function easorRequest<T = unknown>(
  credentials: string | string[],
  method: "GET",
  path: string,
  options: { query?: Record<string, string | undefined>; extraHeaders?: Record<string, string> } = {},
): Promise<T> {
  if (typeof credentials === "string") return requestWith<T>(credentials, method, path, options);
  const key = credentials.join("|");
  const last = workingCredentials.get(key);
  const order = last ? [last, ...credentials.filter((c) => c !== last)] : credentials;
  let refused: unknown;
  for (const prefix of order) {
    try {
      const result = await requestWith<T>(prefix, method, path, options);
      workingCredentials.set(key, prefix);
      return result;
    } catch (err) {
      if (!(err instanceof GatewayError && (err.status === 401 || err.status === 403))) throw err;
      refused = err;
    }
  }
  throw refused;
}

async function requestWith<T>(
  credentials: string,
  method: "GET",
  path: string,
  options: { query?: Record<string, string | undefined>; extraHeaders?: Record<string, string> },
): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) query.set(key, value);
  }
  const queryString = query.toString();
  assertSafeGatewayPath(path);
  const url = `${GATEWAY_BASE_URL}${path}${queryString ? `?${queryString}` : ""}`;

  const startedAt = Date.now();
  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    const headers = await baseHeaders(credentials, options.extraHeaders);
    response = await withTransientRetry(() => fetch(url, { method, headers, dispatcher: getAgent() }));
  } catch (err) {
    logGatewayCall(method, path, "ERR", startedAt);
    throw err;
  }
  logGatewayCall(method, path, response.status, startedAt);
  return handle<T>(response, url);
}
