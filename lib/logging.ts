/**
 * Structured server-side logging. Replaces scattered console.error/console.warn
 * so failures are emitted in a consistent, greppable shape and can later be
 * forwarded to an aggregator (e.g. Sentry) from one place.
 *
 * When SENTRY_DSN is set and @sentry/nextjs is installed, errors are also
 * forwarded; otherwise this degrades to structured console output. The dynamic
 * import keeps the dependency optional until the DSN is provisioned.
 */

type Detail = unknown

function emit(level: 'error' | 'warn', scope: string, message: string, detail?: Detail) {
  const line = { level, scope, message, ts: new Date().toISOString() }
  if (level === 'error') console.error(JSON.stringify(line), detail ?? '')
  else console.warn(JSON.stringify(line), detail ?? '')
}

export function logError(scope: string, message: string, detail?: Detail): void {
  emit('error', scope, message, detail)
  // Optional Sentry forwarding — no-op until DSN + @sentry/nextjs are configured.
  // Non-literal specifier keeps the dependency optional (no static resolution).
  if (process.env.SENTRY_DSN) {
    const sentryModule = '@sentry/nextjs'
    import(sentryModule)
      .then((Sentry: { captureException: (e: unknown, ctx?: unknown) => void }) => {
        Sentry.captureException(
          detail instanceof Error ? detail : new Error(`${scope}: ${message}`),
          { extra: { scope, message, detail } },
        )
      })
      .catch(() => {
        /* @sentry/nextjs not installed yet — structured console log already emitted */
      })
  }
}

export function logWarn(scope: string, message: string, detail?: Detail): void {
  emit('warn', scope, message, detail)
}
