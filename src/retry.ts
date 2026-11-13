/**
 * Retries a transient network-level failure (a `fetch()` call that threw —
 * DNS/connection/TLS/timeout — not an HTTP error response, which resolves
 * normally and is handled by the caller) with a short backoff.
 *
 * Only ever wrap IDEMPOTENT requests with this — GET reads and the OAuth2
 * client-credentials token request. Retrying a POST/PUT/DELETE after a
 * transport-level failure is unsafe: the first attempt may have already
 * reached the server and been applied before the response was lost, so a
 * blind retry risks a duplicate write. For this project's financial writes
 * (invoices, vouchers) that's worse than surfacing the error and letting
 * the caller check state by hand before retrying — so writes deliberately
 * do NOT go through this helper.
 */
const RETRY_DELAYS_MS = [250, 750];

export async function withTransientRetry<T>(attempt: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await attempt();
    } catch (exc) {
      if (i >= RETRY_DELAYS_MS.length) throw exc;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[i]));
    }
  }
}
