/**
 * OAuth2 client-credentials authentication for Easor's public B2B API
 * gateway (apim.talenom.com).
 *
 * Easor issues a SEPARATE app registration (client_id/secret/scope) AND a
 * separate gateway subscription key per API — not one shared client for
 * everything. Each credential set is identified by a short prefix (e.g.
 * "ORG", "GL_FI", "SALES_FI") and read from env vars named
 * EASOR_<PREFIX>_CLIENT_ID / _CLIENT_SECRET / _SCOPE — see .env.example
 * for the full list and httpClient.ts for how callers pick a prefix.
 *
 * Token endpoint is `https://id.talenom.com/api/b2b/oauth2/v1.0/token`
 * (the hostname still says "talenom", pre-dating the February 2026
 * Talenom/Easor split) — shared across all credential sets. A
 * sandbox/testing identity-provider variant may exist — override
 * EASOR_TOKEN_URL if Easor support provides one.
 */

import { Agent, fetch } from "undici";
import { withTransientRetry } from "./retry.js";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import tls from "node:tls";

const DEFAULT_TOKEN_URL = "https://id.talenom.com/api/b2b/oauth2/v1.0/token";

const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Certificates Windows trusts but Node's bundled list does not: e.g. the root an
 * antivirus (AVG/Avast HTTPS scanning) or a company proxy uses to re-sign TLS, and
 * intermediates a server leaves out of its chain. Read once from the Windows
 * certificate stores via PowerShell. Set EASOR_WINDOWS_CERTS=0 in .env to skip.
 */
function windowsCertificates(): string[] {
  if (process.platform !== "win32" || process.env.EASOR_WINDOWS_CERTS === "0") return [];
  try {
    const script =
      "$ErrorActionPreference='SilentlyContinue';" +
      "foreach($s in 'Cert:\\LocalMachine\\Root','Cert:\\CurrentUser\\Root','Cert:\\LocalMachine\\CA','Cert:\\CurrentUser\\CA')" +
      "{ Get-ChildItem $s | ForEach-Object { [Convert]::ToBase64String($_.RawData) } }";
    const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 20_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const pems: string[] = [];
    for (const b64 of new Set(out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))) {
      const pem = `-----BEGIN CERTIFICATE-----\n${b64.match(/.{1,64}/g)!.join("\n")}\n-----END CERTIFICATE-----\n`;
      try {
        new X509Certificate(pem);
        pems.push(pem);
      } catch {
        /* skip anything Node cannot parse */
      }
    }
    console.error(`easor-mcp: ${pems.length} certificates added from the Windows certificate store`);
    return pems;
  } catch (exc) {
    console.error("easor-mcp: could not read the Windows certificate store:", (exc as Error).message);
    return [];
  }
}

/** Optional extra CA file (PEM) named by EASOR_CA_FILE in .env. */
function extraCaFile(): string[] {
  const file = process.env.EASOR_CA_FILE;
  if (!file) return [];
  try {
    return [readFileSync(file, "utf8")];
  } catch (exc) {
    console.error(`easor-mcp: EASOR_CA_FILE ${file} could not be read:`, (exc as Error).message);
    return [];
  }
}

// Shared by every Easor API call. allowH2 only *permits* HTTP/2 ALPN
// negotiation — harmless against a server that only speaks HTTP/1.1.
// Built on first use, after index.ts has loaded .env.
let agent: Agent | undefined;
export function getAgent(): Agent {
  if (!agent) {
    const extra = [...windowsCertificates(), ...extraCaFile()];
    agent = extra.length
      ? new Agent({ allowH2: true, connect: { ca: [...tls.rootCertificates, ...extra] } })
      : new Agent({ allowH2: true });
  }
  return agent;
}

interface CachedToken {
  token: string;
  expiryMs: number;
}

const tokenCache = new Map<string, CachedToken>();

/** Flattens a fetch() failure's cause chain (e.g. TLS or DNS error code) into one line. */
function describeCause(exc: unknown): string {
  const parts: string[] = [];
  let e: any = exc;
  for (let i = 0; e && i < 5; i++, e = e.cause) {
    const bit = [e.code, e.message].filter(Boolean).join(" ");
    if (bit && !parts.includes(bit)) parts.push(bit);
  }
  return parts.join(" <- ") || String(exc);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Returns a cached client-credentials access token for the given
 * credential-set prefix (e.g. "ORG", "GL_FI"), refreshing it once it's
 * within 60 seconds of expiry. Each prefix is cached independently.
 */
export async function getAccessToken(prefix: string): Promise<string> {
  const cached = tokenCache.get(prefix);
  if (cached && Date.now() < cached.expiryMs - 60_000) {
    return cached.token;
  }

  const clientId = requireEnv(`EASOR_${prefix}_CLIENT_ID`);
  if (!GUID_RE.test(clientId)) {
    // Azure AD's client_credentials grant requires the app registration's
    // GUID "Application (client) ID", not its human-readable Name.
    throw new Error(
      `EASOR_${prefix}_CLIENT_ID (${JSON.stringify(clientId)}) is not a GUID. Azure AD ` +
        "needs the app registration's 'Application (client) ID' GUID, not its Name.",
    );
  }

  const tokenUrl = process.env.EASOR_TOKEN_URL ?? DEFAULT_TOKEN_URL;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: requireEnv(`EASOR_${prefix}_CLIENT_SECRET`),
    scope: requireEnv(`EASOR_${prefix}_SCOPE`),
  });

  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    // Token requests are idempotent (client_credentials grant) — safe to retry.
    response = await withTransientRetry(() =>
      fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        dispatcher: getAgent(),
      }),
    );
  } catch (exc) {
    // This gateway resets the HTTP/2 stream right after an error (4xx) body
    // instead of closing it cleanly, which can surface as a raw stream/socket
    // error instead of a normal HTTP error response.
    throw new Error(
      "Token request failed at the transport level — the server likely sent " +
        "an error response with a malformed stream close. Run the equivalent " +
        "request via curl to see the actual error body. Cause: " + describeCause(exc),
      { cause: exc },
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "<no body>");
    throw new Error(`Token request failed for ${prefix}: ${response.status} ${response.statusText} — ${text}`);
  }

  const payload = (await response.json()) as { access_token: string; expires_in?: number };
  tokenCache.set(prefix, {
    token: payload.access_token,
    expiryMs: Date.now() + (payload.expires_in ?? 3600) * 1000,
  });
  return payload.access_token;
}
