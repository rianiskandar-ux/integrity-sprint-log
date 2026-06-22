// Next.js instrumentation — tangkap SEMUA error server-side secara terpusat.
// onRequestError dipanggil tiap ada error di route/server component.

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  try {
    const { logger } = await import('./lib/logger')
    logger.info('isl-startup', { at: new Date().toISOString() })
  } catch { /* ignore */ }
}

export async function onRequestError(
  err: unknown,
  request: { path?: string; method?: string },
  context: { routeType?: string },
) {
  // Hanya di runtime nodejs (logger pakai fs)
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  try {
    const { logger, alertCritical } = await import('./lib/logger')
    const e = err as Error
    const title = `${request?.method ?? '?'} ${request?.path ?? '?'}`
    logger.error('request-error', {
      path: request?.path,
      method: request?.method,
      routeType: context?.routeType,
      message: e?.message,
      stack: e?.stack,
    })
    // Alert kritis hanya untuk API routes (bukan tiap render glitch)
    if (context?.routeType === 'route') {
      await alertCritical(title, e?.message ?? String(err))
    }
  } catch { /* never throw from error handler */ }
}
