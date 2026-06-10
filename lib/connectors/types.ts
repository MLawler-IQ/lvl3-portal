/**
 * Standard return contract for third-party connectors. An API failure
 * (bad key, quota, network) is `{ ok: false, error }` — never a silent
 * null/empty that reads as "no data" in the UI. "Genuinely no rows" is
 * `{ ok: true, data: ... }` with an empty/null payload.
 */
export type ConnectorResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

export function connectorOk<T>(data: T): ConnectorResult<T> {
  return { ok: true, data }
}

export function connectorErr<T>(err: unknown): ConnectorResult<T> {
  return { ok: false, error: err instanceof Error ? err.message : String(err) }
}

/** Wrap a throwing fetcher into the ConnectorResult contract. */
export async function tryConnector<T>(fn: () => Promise<T>): Promise<ConnectorResult<T>> {
  try {
    return connectorOk(await fn())
  } catch (err) {
    return connectorErr(err)
  }
}
