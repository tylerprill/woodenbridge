type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
};

function getAppUrl() {
  const configuredUrl =
    process.env.APP_URL ??
    process.env.AUTH_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined) ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);

  if (!configuredUrl && process.env.NODE_ENV !== 'production') {
    return new URL('http://localhost:3000');
  }

  if (!configuredUrl) {
    throw new Error('APP_URL is required to create password reset links.');
  }

  const url = new URL(configuredUrl);
  const isLocalDevelopment =
    process.env.NODE_ENV !== 'production' &&
    ['localhost', '127.0.0.1'].includes(url.hostname);

  if (url.protocol !== 'https:' && !isLocalDevelopment) {
    throw new Error('APP_URL must use HTTPS outside local development.');
  }

  return url;
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#039;',
        '"': '&quot;',
      })[character] ?? character,
  );
}

async function deliverEmail(message: EmailMessage) {
  const useConsoleDelivery =
    process.env.PASSWORD_RESET_DELIVERY === 'console' ||
    (!process.env.RESEND_API_KEY && process.env.NODE_ENV !== 'production');

  if (useConsoleDelivery) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Console password reset delivery is disabled in production.',
      );
    }

    console.info(`[password-recovery] ${message.text}`);
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !from) {
    throw new Error(
      'RESEND_API_KEY and RESEND_FROM_EMAIL are required for password recovery.',
    );
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': message.idempotencyKey,
      'User-Agent': 'wooden-bridge-password-recovery/1.0',
    },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Password recovery email failed (${response.status}): ${errorBody.slice(0, 300)}`,
    );
  }
}

export async function sendPasswordResetEmail({
  to,
  firstName,
  token,
  tokenHash,
}: {
  to: string;
  firstName: string;
  token: string;
  tokenHash: string;
}) {
  const resetUrl = new URL('/reset-password', getAppUrl());
  resetUrl.searchParams.set('token', token);
  const safeName = escapeHtml(firstName || 'there');
  const safeUrl = escapeHtml(resetUrl.toString());

  await deliverEmail({
    to,
    subject: 'Reset your Wooden Bridge password',
    idempotencyKey: `password-reset-${tokenHash}`,
    text: `Hello ${firstName || 'there'},\n\nUse this link to reset your Wooden Bridge password:\n${resetUrl.toString()}\n\nThis link expires in 30 minutes and can only be used once. If you did not request it, you can ignore this email.`,
    html: `
      <div style="background:#f5f2e9;padding:32px;font-family:Arial,sans-serif;color:#10231d">
        <div style="max-width:560px;margin:0 auto;background:#fbfaf5;border:1px solid #d8d8cd;border-radius:18px;padding:32px">
          <p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#4c6a5b;font-weight:700">Wooden Bridge Field Atlas</p>
          <h1 style="font-family:Georgia,serif;font-size:32px;font-weight:400;margin:18px 0">Find your way back</h1>
          <p>Hello ${safeName},</p>
          <p>We received a request to reset your Wooden Bridge password.</p>
          <p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;background:#10231d;color:#fbfaf5;text-decoration:none;padding:14px 20px;border-radius:12px;font-weight:700">Reset password</a></p>
          <p style="font-size:13px;line-height:1.6;color:#4c6a5b">This link expires in 30 minutes and can only be used once. If you did not request it, no action is needed.</p>
        </div>
      </div>
    `,
  });
}

export async function sendPasswordChangedEmail({
  to,
  firstName,
  changeId,
}: {
  to: string;
  firstName: string;
  changeId: string;
}) {
  const safeName = escapeHtml(firstName || 'there');

  await deliverEmail({
    to,
    subject: 'Your Wooden Bridge password was changed',
    idempotencyKey: `password-changed-${changeId}`,
    text: `Hello ${firstName || 'there'},\n\nYour Wooden Bridge password was changed successfully. All existing sessions have been revoked. If you did not make this change, contact the site owner immediately.`,
    html: `
      <div style="background:#f5f2e9;padding:32px;font-family:Arial,sans-serif;color:#10231d">
        <div style="max-width:560px;margin:0 auto;background:#fbfaf5;border:1px solid #d8d8cd;border-radius:18px;padding:32px">
          <p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#4c6a5b;font-weight:700">Wooden Bridge Field Atlas</p>
          <h1 style="font-family:Georgia,serif;font-size:32px;font-weight:400;margin:18px 0">Password changed</h1>
          <p>Hello ${safeName},</p>
          <p>Your Wooden Bridge password was changed successfully. All existing sessions have been revoked.</p>
          <p style="font-size:13px;line-height:1.6;color:#4c6a5b">If you did not make this change, contact the site owner immediately.</p>
        </div>
      </div>
    `,
  });
}
