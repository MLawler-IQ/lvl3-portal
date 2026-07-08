/**
 * Owner notification for submitted reviews. Plain-text body via Resend's
 * HTTP API (same raw-fetch approach as app/actions/deliverables.ts). Sender
 * must be on send.igniteiq.com — the only domain verified on this Resend
 * account. Returns false instead of throwing — a failed email must never
 * fail the submit.
 */
export async function sendReviewNotification({
  subject,
  text,
}: {
  subject: string
  text: string
}): Promise<boolean> {
  const to = process.env.REVIEW_NOTIFY_EMAIL
  if (!to) {
    console.warn('sendReviewNotification: REVIEW_NOTIFY_EMAIL not set — skipping email')
    return false
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'IgniteIQ Reviews <reviews@send.igniteiq.com>',
        to,
        subject,
        text,
      }),
    })
    if (!res.ok) {
      console.error(`sendReviewNotification: Resend API error: ${await res.text()}`)
      return false
    }
    return true
  } catch (err) {
    console.error('sendReviewNotification failed:', err)
    return false
  }
}
