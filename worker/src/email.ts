/**
 * Email sending + unsubscribe plumbing for the daily streak reminder cron.
 *
 * Provider: Resend (https://resend.com). Requires `mathiq.io` (or whichever
 * sender domain) to be verified in Resend with SPF + DKIM DNS records in
 * place. Set RESEND_API_KEY via `wrangler secret put`.
 *
 * Unsubscribes are opaque KV tokens. We mint one per outgoing email; the
 * recipient clicks the unsubscribe link, the token resolves to a userId,
 * we set a `noReminder:<userId>` flag, and future cron runs skip them.
 */

const UNSUB_TOKEN_PREFIX = 'unsubToken:';
const UNSUB_FLAG_PREFIX = 'noReminder:';
const UNSUB_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export async function mintUnsubscribeToken(
  kv: KVNamespace,
  userId: string,
): Promise<string> {
  const token = crypto.randomUUID();
  await kv.put(`${UNSUB_TOKEN_PREFIX}${token}`, userId, {
    expirationTtl: UNSUB_TOKEN_TTL_SECONDS,
  });
  return token;
}

/** Returns the userId that was unsubscribed, or null if the token was
 *  invalid or already used. Side-effect: sets the noReminder flag. */
export async function consumeUnsubscribeToken(
  kv: KVNamespace,
  token: string,
): Promise<string | null> {
  const userId = await kv.get(`${UNSUB_TOKEN_PREFIX}${token}`);
  if (!userId) return null;
  await kv.put(`${UNSUB_FLAG_PREFIX}${userId}`, '1');
  await kv.delete(`${UNSUB_TOKEN_PREFIX}${token}`);
  return userId;
}

export async function isUnsubscribed(
  kv: KVNamespace,
  userId: string,
): Promise<boolean> {
  const flag = await kv.get(`${UNSUB_FLAG_PREFIX}${userId}`);
  return flag === '1';
}

export interface SendReminderArgs {
  to: string;
  firstName: string | null;
  streakDays: number;
  unsubscribeUrl: string;
  resendApiKey: string;
  fromEmail: string;
}

export async function sendReminderEmail(args: SendReminderArgs): Promise<boolean> {
  const subject = `Your ${args.streakDays}-day MathIQ streak ends tonight`;
  const greeting = args.firstName ? `Hey ${args.firstName},` : 'Hey,';
  const dayLabel = `${args.streakDays}-day`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',sans-serif;max-width:540px;margin:0 auto;padding:24px;color:#1a2b1a;background:#d4e26a;">
  <div style="font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;letter-spacing:0.18em;color:rgba(26,43,26,0.6);text-transform:uppercase;margin-bottom:8px;">
    MATHIQ · DAILY STREAK
  </div>
  <h1 style="font-size:22px;font-weight:700;line-height:1.2;letter-spacing:-0.01em;margin:0 0 14px;">
    ${greeting}
  </h1>
  <p style="font-size:16px;line-height:1.55;margin:0 0 8px;">
    Your <strong>${dayLabel} streak</strong> is alive. Today's MathIQ Daily Challenge
    isn't done yet — and the day ends at midnight UTC.
  </p>
  <p style="font-size:16px;line-height:1.55;margin:0 0 24px;">
    One problem, two minutes, streak intact.
  </p>
  <p style="margin:24px 0;">
    <a href="https://mathiq.io/daily" style="display:inline-block;background:#1a4d6e;color:#d4e26a;padding:14px 26px;text-decoration:none;font-weight:600;font-size:15px;">
      Solve today's challenge &rarr;
    </a>
  </p>
  <hr style="border:none;border-top:1px solid rgba(26,43,26,0.12);margin:32px 0 14px;" />
  <p style="font-size:12px;color:rgba(26,43,26,0.6);line-height:1.5;margin:0;">
    Don't want streak reminders? <a href="${args.unsubscribeUrl}" style="color:rgba(26,43,26,0.6);">Unsubscribe with one click</a>.
  </p>
</body>
</html>`;

  const text = `${greeting}

Your ${dayLabel} MathIQ streak is alive. Today's Daily Challenge isn't done yet — and the day ends at midnight UTC.

Solve today's challenge: https://mathiq.io/daily

Don't want streak reminders? Unsubscribe: ${args.unsubscribeUrl}
`;

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: args.fromEmail,
      to: args.to,
      subject,
      html,
      text,
      headers: {
        // RFC 8058 one-click unsubscribe — required by Gmail/Outlook for bulk senders.
        'List-Unsubscribe': `<${args.unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    console.error('[email] resend failed', resp.status, detail.slice(0, 300));
    return false;
  }
  return true;
}
