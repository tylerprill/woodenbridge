type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
};

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 5_000;
const RESEND_MAX_ATTEMPTS = 2;

function isRetryableDeliveryStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function waitBeforeDeliveryRetry(attempt: number) {
  return new Promise((resolve) => setTimeout(resolve, attempt * 250));
}

function getAppUrl() {
  const vercelPreviewUrl =
    process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : undefined;
  const configuredUrl =
    vercelPreviewUrl ??
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

function getBrandedSender(configuredFrom: string) {
  const displayAddress = configuredFrom.match(/<([^<>]+)>\s*$/)?.[1];
  const address = displayAddress ?? configuredFrom.trim();

  return `Field Atlas <${address}>`;
}

async function deliverEmail(message: EmailMessage) {
  const useConsoleDelivery =
    process.env.EMAIL_DELIVERY === 'console' ||
    process.env.PASSWORD_RESET_DELIVERY === 'console' ||
    (!process.env.RESEND_API_KEY && process.env.NODE_ENV !== 'production');

  if (useConsoleDelivery) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Console email delivery is disabled in production.');
    }

    console.info(`[transactional-email] ${message.text}`);
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  const configuredFrom = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !configuredFrom) {
    throw new Error(
      'RESEND_API_KEY and RESEND_FROM_EMAIL are required for transactional email.',
    );
  }

  const from = getBrandedSender(configuredFrom);
  const replyTo = process.env.RESEND_REPLY_TO_EMAIL;
  const body = JSON.stringify({
    from,
    to: [message.to],
    subject: message.subject,
    text: message.text,
    html: message.html,
    ...(replyTo ? { reply_to: replyTo } : {}),
  });

  let lastFailure: unknown;

  for (let attempt = 1; attempt <= RESEND_MAX_ATTEMPTS; attempt += 1) {
    let response: Response;

    try {
      response = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': message.idempotencyKey,
          'User-Agent': 'field-atlas-transactional-email/1.0',
        },
        body,
        cache: 'no-store',
        signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
      });
    } catch (error) {
      lastFailure = error;

      if (attempt === RESEND_MAX_ATTEMPTS) break;

      await waitBeforeDeliveryRetry(attempt);
      continue;
    }

    if (response.ok) return;

    lastFailure = new Error(
      `Transactional email provider returned HTTP ${response.status}.`,
    );

    if (
      !isRetryableDeliveryStatus(response.status) ||
      attempt === RESEND_MAX_ATTEMPTS
    ) {
      break;
    }

    await response.body?.cancel().catch(() => undefined);
    await waitBeforeDeliveryRetry(attempt);
  }

  throw new Error('Transactional email delivery failed.', {
    cause: lastFailure,
  });
}

export async function sendWelcomeEmail({
  to,
  firstName,
  userId,
}: {
  to: string;
  firstName: string;
  userId: string;
}) {
  const dashboardUrl = new URL('/dashboard', getAppUrl());
  const safeName = escapeHtml(firstName || 'Explorer');
  const safeDashboardUrl = escapeHtml(dashboardUrl.toString());

  await deliverEmail({
    to,
    subject: 'Welcome to Field Atlas',
    idempotencyKey: `welcome-${userId}`,
    text: `Hello ${firstName || 'Explorer'},\n\nWelcome to Field Atlas. Your personal travel journal is ready.\n\nOpen your atlas:\n${dashboardUrl.toString()}\n\nPin the places you have traveled, preserve the moments that mattered, and keep the next journey close.`,
    html: `
      <div style="background:#f5f2e9;padding:32px;font-family:Arial,sans-serif;color:#10231d">
        <div style="max-width:560px;margin:0 auto;background:#fbfaf5;border:1px solid #d8d8cd;border-radius:18px;padding:32px">
          <p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#4c6a5b;font-weight:700">Field Atlas</p>
          <h1 style="font-family:Georgia,serif;font-size:32px;font-weight:400;margin:18px 0">Your atlas is ready</h1>
          <p>Hello ${safeName},</p>
          <p>Welcome to Field Atlas. A place to pin where you have traveled, preserve what happened there, and keep the next journey close.</p>
          <p style="margin:28px 0"><a href="${safeDashboardUrl}" style="display:inline-block;background:#10231d;color:#fbfaf5;text-decoration:none;padding:14px 20px;border-radius:12px;font-weight:700">Open your atlas</a></p>
          <p style="font-size:13px;line-height:1.6;color:#4c6a5b">Go far. Remember well.</p>
        </div>
      </div>
    `,
  });
}

export async function sendEmailVerificationEmail({
  to,
  firstName,
  code,
  challengeId,
}: {
  to: string;
  firstName: string;
  code: string;
  challengeId: string;
}) {
  const safeName = escapeHtml(firstName || 'Explorer');
  const safeCode = escapeHtml(code);

  await deliverEmail({
    to,
    subject: `${code} is your Field Atlas verification code`,
    idempotencyKey: `email-verification-${challengeId}`,
    text: `Hello ${firstName || 'Explorer'},\n\nUse this code to verify your Field Atlas email address:\n\n${code}\n\nThe code expires in 10 minutes and can only be used once. If you did not create this account, you can ignore this email.`,
    html: `
      <div style="background:#f5f2e9;padding:32px;font-family:Arial,sans-serif;color:#10231d">
        <div style="max-width:560px;margin:0 auto;background:#fbfaf5;border:1px solid #d8d8cd;border-radius:18px;padding:32px">
          <p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#4c6a5b;font-weight:700">Field Atlas</p>
          <h1 style="font-family:Georgia,serif;font-size:32px;font-weight:400;margin:18px 0">Confirm your atlas</h1>
          <p>Hello ${safeName},</p>
          <p>Enter this code to verify your email address and open your atlas.</p>
          <p style="margin:28px 0;padding:18px 20px;background:#f5f2e9;border:1px solid #d8d8cd;border-radius:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:32px;font-weight:700;letter-spacing:.22em;text-align:center;color:#10231d">${safeCode}</p>
          <p style="font-size:13px;line-height:1.6;color:#4c6a5b">This code expires in 10 minutes and works once. If you did not create this account, no action is needed.</p>
        </div>
      </div>
    `,
  });
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
    subject: 'Reset your Field Atlas password',
    idempotencyKey: `password-reset-${tokenHash}`,
    text: `Hello ${firstName || 'there'},\n\nUse this link to reset your Field Atlas password:\n${resetUrl.toString()}\n\nThis link expires in 30 minutes and can only be used once. If you did not request it, you can ignore this email.`,
    html: `
      <div style="background:#f5f2e9;padding:32px;font-family:Arial,sans-serif;color:#10231d">
        <div style="max-width:560px;margin:0 auto;background:#fbfaf5;border:1px solid #d8d8cd;border-radius:18px;padding:32px">
          <p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#4c6a5b;font-weight:700">Field Atlas</p>
          <h1 style="font-family:Georgia,serif;font-size:32px;font-weight:400;margin:18px 0">Find your way back</h1>
          <p>Hello ${safeName},</p>
          <p>We received a request to reset your Field Atlas password.</p>
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
  const recoveryUrl = new URL('/forgot-password', getAppUrl());
  const safeRecoveryUrl = escapeHtml(recoveryUrl.toString());

  await deliverEmail({
    to,
    subject: 'Your Field Atlas password was changed',
    idempotencyKey: `password-changed-${changeId}`,
    text: `Hello ${firstName || 'there'},\n\nYour Field Atlas password was changed successfully. All existing sessions have been revoked.\n\nIf you did not make this change, secure your account immediately:\n${recoveryUrl.toString()}`,
    html: `
      <div style="background:#f5f2e9;padding:32px;font-family:Arial,sans-serif;color:#10231d">
        <div style="max-width:560px;margin:0 auto;background:#fbfaf5;border:1px solid #d8d8cd;border-radius:18px;padding:32px">
          <p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#4c6a5b;font-weight:700">Field Atlas</p>
          <h1 style="font-family:Georgia,serif;font-size:32px;font-weight:400;margin:18px 0">Password changed</h1>
          <p>Hello ${safeName},</p>
          <p>Your Field Atlas password was changed successfully. All existing sessions have been revoked.</p>
          <p style="font-size:13px;line-height:1.6;color:#4c6a5b">If you did not make this change, <a href="${safeRecoveryUrl}" style="color:#10231d;font-weight:700">secure your account immediately</a>.</p>
        </div>
      </div>
    `,
  });
}

export async function sendPasskeyChangedEmail({
  to,
  firstName,
  passkeyLabel,
  changeId,
  action,
}: {
  to: string;
  firstName: string;
  passkeyLabel: string;
  changeId: string;
  action: 'added' | 'removed';
}) {
  const securityUrl = new URL('/dashboard/security', getAppUrl());
  const recoveryUrl = new URL('/forgot-password', getAppUrl());
  const safeName = escapeHtml(firstName || 'there');
  const safeLabel = escapeHtml(passkeyLabel);
  const safeSecurityUrl = escapeHtml(securityUrl.toString());
  const safeRecoveryUrl = escapeHtml(recoveryUrl.toString());
  const actionLabel = action === 'added' ? 'added to' : 'removed from';

  await deliverEmail({
    to,
    subject: `A passkey was ${action} on your Field Atlas account`,
    idempotencyKey: `passkey-${action}-${changeId}`,
    text: `Hello ${firstName || 'there'},\n\nThe passkey “${passkeyLabel}” was ${actionLabel} your Field Atlas account.\n\nReview account security:\n${securityUrl.toString()}\n\nIf this was not you, reset your password immediately to revoke every session:\n${recoveryUrl.toString()}`,
    html: `
      <div style="background:#f5f2e9;padding:32px;font-family:Arial,sans-serif;color:#10231d">
        <div style="max-width:560px;margin:0 auto;background:#fbfaf5;border:1px solid #d8d8cd;border-radius:18px;padding:32px">
          <p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#4c6a5b;font-weight:700">Field Atlas security</p>
          <h1 style="font-family:Georgia,serif;font-size:32px;font-weight:400;margin:18px 0">Passkey ${action}</h1>
          <p>Hello ${safeName},</p>
          <p>The passkey <strong>${safeLabel}</strong> was ${actionLabel} your Field Atlas account.</p>
          <p style="margin:28px 0"><a href="${safeSecurityUrl}" style="display:inline-block;background:#10231d;color:#fbfaf5;text-decoration:none;padding:14px 20px;border-radius:12px;font-weight:700">Review account security</a></p>
          <p style="font-size:13px;line-height:1.6;color:#4c6a5b">If this was not you, <a href="${safeRecoveryUrl}" style="color:#10231d;font-weight:700">reset your password immediately</a> to revoke every session.</p>
        </div>
      </div>
    `,
  });
}

export async function sendAccountStatusChangedEmail({
  to,
  firstName,
  status,
  changeId,
}: {
  to: string;
  firstName: string;
  status: 'active' | 'suspended';
  changeId: string;
}) {
  const safeName = escapeHtml(firstName || 'there');
  const isSuspended = status === 'suspended';
  const heading = isSuspended ? 'Account access paused' : 'Account reactivated';
  const explanation = isSuspended
    ? 'Your Field Atlas account was suspended and every signed-in session was revoked. You will not be able to sign in until an administrator reactivates it.'
    : 'Your Field Atlas account was reactivated. You can sign in again; previously revoked sessions remain signed out.';

  await deliverEmail({
    to,
    subject: `${heading} — Field Atlas`,
    idempotencyKey: `account-status-${changeId}-${status}`,
    text: `Hello ${firstName || 'there'},\n\n${explanation}\n\nIf this change is unexpected, contact the Field Atlas owner.`,
    html: `
      <div style="background:#f5f2e9;padding:32px;font-family:Arial,sans-serif;color:#10231d">
        <div style="max-width:560px;margin:0 auto;background:#fbfaf5;border:1px solid #d8d8cd;border-radius:18px;padding:32px">
          <p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#4c6a5b;font-weight:700">Field Atlas security</p>
          <h1 style="font-family:Georgia,serif;font-size:32px;font-weight:400;margin:18px 0">${heading}</h1>
          <p>Hello ${safeName},</p>
          <p>${explanation}</p>
          <p style="font-size:13px;line-height:1.6;color:#4c6a5b">If this change is unexpected, contact the Field Atlas owner.</p>
        </div>
      </div>
    `,
  });
}

export async function sendPrivilegedRecoveryEmail({
  to,
  firstName,
  event,
  changeId,
  remainingCodes,
}: {
  to: string;
  firstName: string;
  event: 'codes-created' | 'code-used' | 'recovery-completed';
  changeId: string;
  remainingCodes?: number;
}) {
  const securityUrl = new URL('/dashboard/security', getAppUrl());
  const recoveryUrl = new URL('/forgot-password', getAppUrl());
  const safeName = escapeHtml(firstName || 'there');
  const safeSecurityUrl = escapeHtml(securityUrl.toString());
  const safeRecoveryUrl = escapeHtml(recoveryUrl.toString());
  const content =
    event === 'codes-created'
      ? {
          subject: 'New recovery codes were created — Field Atlas',
          heading: 'Recovery codes created',
          explanation:
            'A new offline recovery-code set was created for protected management. Every previous code is now invalid.',
        }
      : event === 'code-used'
        ? {
            subject: 'A recovery code was used — Field Atlas',
            heading: 'Recovery code used',
            explanation: `A saved recovery code and the account password opened a 10-minute window to add a replacement passkey.${
              typeof remainingCodes === 'number'
                ? ` ${remainingCodes} unused recovery codes remain.`
                : ''
            }`,
          }
        : {
            subject: 'Passkey recovery completed — Field Atlas',
            heading: 'Passkey recovery completed',
            explanation:
              'A replacement passkey was added, every other browser session was revoked, and a new recovery-code set was created.',
          };

  await deliverEmail({
    to,
    subject: content.subject,
    idempotencyKey: `privileged-recovery-${event}-${changeId}`,
    text: `Hello ${firstName || 'there'},\n\n${content.explanation}\n\nReview account security:\n${securityUrl.toString()}\n\nIf this was not you, reset your password immediately to revoke the active recovery session:\n${recoveryUrl.toString()}`,
    html: `
      <div style="background:#f5f2e9;padding:32px;font-family:Arial,sans-serif;color:#10231d">
        <div style="max-width:560px;margin:0 auto;background:#fbfaf5;border:1px solid #d8d8cd;border-radius:18px;padding:32px">
          <p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#4c6a5b;font-weight:700">Field Atlas security</p>
          <h1 style="font-family:Georgia,serif;font-size:32px;font-weight:400;margin:18px 0">${content.heading}</h1>
          <p>Hello ${safeName},</p>
          <p>${content.explanation}</p>
          <p style="margin:28px 0"><a href="${safeSecurityUrl}" style="display:inline-block;background:#10231d;color:#fbfaf5;text-decoration:none;padding:14px 20px;border-radius:12px;font-weight:700">Review account security</a></p>
          <p style="font-size:13px;line-height:1.6;color:#4c6a5b">If this was not you, <a href="${safeRecoveryUrl}" style="color:#10231d;font-weight:700">reset your password immediately</a> to revoke the active recovery session.</p>
        </div>
      </div>
    `,
  });
}
