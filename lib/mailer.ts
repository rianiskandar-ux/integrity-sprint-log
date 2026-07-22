/**
 * ISL's one and only outbound-email path. There used to be a second one —
 * lib/google-auth.ts's sendEmail() via the owner's connected Gmail — but it
 * was confirmed dead (Gmail API disabled on that OAuth project, 403
 * accessNotConfigured, live-tested 2026-07-21) and never actually delivered
 * anything. This relays through Launcher's /api/nara/send-email instead,
 * which reuses the SAME Brevo SMTP account Nara's own daily dispatch has
 * sent through successfully all session — proven infra, not a fix-pending
 * OAuth path. First caller: Tika's Aufa QA-queue notification
 * (lib/helpdesk.ts); also used by /api/notify's validation-needed alert,
 * which the dead Gmail path had been silently failing on every call.
 */
const LAUNCHER_URL = process.env.LAUNCHER_URL || 'http://host.docker.internal:9000'

export async function sendViaLauncherRelay(to: string, subject: string, html: string): Promise<boolean> {
  try {
    const res = await fetch(`${LAUNCHER_URL}/api/nara/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-kafi-key': process.env.KAFI_API_KEY ?? '' },
      body: JSON.stringify({ to, subject, html }),
      signal: AbortSignal.timeout(20000),
    })
    return res.ok
  } catch {
    return false
  }
}
