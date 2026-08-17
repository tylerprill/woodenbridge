/**
 * @jest-environment jsdom
 */

import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRouter } from 'next/navigation';
import { startAuthentication, startRegistration } from 'simplewebauthn-browser';

import {
  beginPasskeyRegistration,
  beginPasskeyStepUp,
  finishPasskeyRegistration,
  finishPasskeyStepUp,
  removePasskey,
} from '@/app/lib/actions/passkeys';
import {
  beginPasskeyRecoveryRegistration,
  redeemPrivilegedRecoveryCode,
  regeneratePrivilegedRecoveryCodes,
} from '@/app/lib/actions/recovery-codes';
import { RECENT_MFA_WINDOW_SECONDS } from '@/app/lib/auth/session-policy';
import { PasskeySecurityPanel } from '@/components/auth/passkey-security-panel';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

jest.mock('simplewebauthn-browser', () => ({
  startAuthentication: jest.fn(),
  startRegistration: jest.fn(),
}));

jest.mock('@/app/lib/actions/passkeys', () => ({
  beginPasskeyRegistration: jest.fn(),
  beginPasskeyStepUp: jest.fn(),
  finishPasskeyRegistration: jest.fn(),
  finishPasskeyStepUp: jest.fn(),
  removePasskey: jest.fn(),
}));

jest.mock('@/app/lib/actions/recovery-codes', () => ({
  beginPasskeyRecoveryRegistration: jest.fn(),
  redeemPrivilegedRecoveryCode: jest.fn(),
  regeneratePrivilegedRecoveryCodes: jest.fn(),
}));

const beginRegistrationMock = jest.mocked(beginPasskeyRegistration);
const beginRecoveryRegistrationMock = jest.mocked(
  beginPasskeyRecoveryRegistration,
);
const beginStepUpMock = jest.mocked(beginPasskeyStepUp);
const finishRegistrationMock = jest.mocked(finishPasskeyRegistration);
const finishStepUpMock = jest.mocked(finishPasskeyStepUp);
const removePasskeyMock = jest.mocked(removePasskey);
const redeemRecoveryCodeMock = jest.mocked(redeemPrivilegedRecoveryCode);
const regenerateRecoveryCodesMock = jest.mocked(
  regeneratePrivilegedRecoveryCodes,
);
const startAuthenticationMock = jest.mocked(startAuthentication);
const startRegistrationMock = jest.mocked(startRegistration);
const useRouterMock = jest.mocked(useRouter);
const pushMock = jest.fn();
const refreshMock = jest.fn();
const passkeys = [
  {
    id: '68038b48-4d24-4601-a83f-6fbc4280158a',
    label: 'Primary passkey',
    createdAt: '2026-08-17T12:00:00.000Z',
    lastUsedAt: null,
    backedUp: true,
  },
];
const backupPasskey = {
  id: 'eebff02d-aeb0-4345-9619-c04623036369',
  label: 'Phone passkey',
  createdAt: '2026-08-17T13:00:00.000Z',
  lastUsedAt: null,
  backedUp: false,
};

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof PasskeySecurityPanel>> = {},
) {
  return render(
    <PasskeySecurityPanel
      isPrivileged
      isRecentlyVerified={false}
      mfaVerifiedAt={null}
      passkeys={passkeys}
      recoveryCodeSummary={null}
      recoveryGrant={null}
      {...overrides}
    />,
  );
}

describe('passkey security experience', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'PublicKeyCredential', {
      configurable: true,
      value: class PublicKeyCredential {},
    });
    useRouterMock.mockReturnValue({
      push: pushMock,
      refresh: refreshMock,
    } as never);
  });

  it('expires the unlocked presentation when the server policy window closes', () => {
    jest.useFakeTimers();
    const now = Date.parse('2026-08-17T12:00:00.000Z');
    jest.setSystemTime(now);

    try {
      renderPanel({
        isRecentlyVerified: true,
        mfaVerifiedAt: now / 1_000,
      });
      expect(
        screen.getByRole('button', { name: 'Protected actions unlocked' }),
      ).toBeDisabled();

      act(() => {
        jest.advanceTimersByTime(RECENT_MFA_WINDOW_SECONDS * 1_000 + 100);
      });

      expect(
        screen.getByRole('button', { name: 'Verify with a passkey' }),
      ).toBeEnabled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('finishes a step-up and returns only to the server-approved dashboard path', async () => {
    const user = userEvent.setup();
    beginStepUpMock.mockResolvedValue({
      status: 'success',
      options: { challenge: 'challenge' } as never,
    });
    startAuthenticationMock.mockResolvedValue({ id: 'credential-id' } as never);
    finishStepUpMock.mockResolvedValue({
      status: 'success',
      message: 'Identity confirmed.',
    });
    renderPanel({ returnTo: '/dashboard/owner/users?q=Ada' });

    await user.click(
      screen.getByRole('button', { name: 'Verify with a passkey' }),
    );

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Identity confirmed.',
    );
    expect(pushMock).toHaveBeenCalledWith('/dashboard/owner/users?q=Ada');
    expect(finishStepUpMock).toHaveBeenCalledWith({ id: 'credential-id' });
  });

  it('drops the current password from client state before opening the device prompt', async () => {
    const user = userEvent.setup();
    beginRegistrationMock.mockResolvedValue({
      status: 'success',
      options: { challenge: 'challenge' } as never,
    });
    startRegistrationMock.mockRejectedValue(
      new DOMException('Canceled', 'NotAllowedError'),
    );
    finishRegistrationMock.mockResolvedValue({
      status: 'success',
      message: 'Passkey added.',
      passkey: {
        id: passkeys[0].id,
        label: passkeys[0].label,
        backedUp: passkeys[0].backedUp,
        createdAt: passkeys[0].createdAt,
      },
    });
    renderPanel({ passkeys: [] });
    const password = screen.getByLabelText('Current password');

    await user.type(password, 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Create passkey' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'canceled or timed out',
    );
    expect(password).toHaveValue('');
  });

  it('requires an existing passkey check before adding another privileged credential', () => {
    renderPanel({ passkeys: [...passkeys, backupPasskey] });

    expect(
      screen.getByRole('button', {
        name: 'Verify above to add a passkey',
      }),
    ).toBeDisabled();
    expect(
      screen.getByText(/confirm an existing passkey above/i),
    ).toBeVisible();
  });

  it('prevents a protected account from retiring its final credential', () => {
    renderPanel();

    expect(
      screen.getByRole('button', { name: 'Remove Primary passkey' }),
    ).toBeDisabled();
    expect(
      screen.getByText(/add a second passkey before retiring/i),
    ).toBeVisible();
  });

  it('removes a privileged credential only after recent step-up confirmation', async () => {
    const user = userEvent.setup();
    const now = Math.floor(Date.now() / 1_000);
    removePasskeyMock.mockResolvedValue({
      status: 'success',
      message:
        'Primary passkey was removed. Protected actions are locked until you verify again.',
      passkey: {
        ...passkeys[0],
        createdAt: passkeys[0].createdAt,
      },
      remainingPasskeys: 1,
    });
    renderPanel({
      isRecentlyVerified: true,
      mfaVerifiedAt: now,
      passkeys: [...passkeys, backupPasskey],
    });

    await user.click(
      screen.getByRole('button', { name: 'Remove Primary passkey' }),
    );
    const dialog = screen.getByRole('dialog', {
      name: 'Remove Primary passkey?',
    });
    expect(within(dialog).queryByLabelText('Current password')).toBeNull();
    await user.click(
      within(dialog).getByRole('button', { name: 'Remove passkey' }),
    );

    expect(removePasskeyMock).toHaveBeenCalledWith(passkeys[0].id, undefined);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Protected actions are locked',
    );
    expect(refreshMock).toHaveBeenCalled();
  });

  it('requires current-password confirmation for a regular user removal', async () => {
    const user = userEvent.setup();
    removePasskeyMock.mockResolvedValue({
      status: 'success',
      message: 'Primary passkey was removed.',
      passkey: {
        ...passkeys[0],
        createdAt: passkeys[0].createdAt,
      },
      remainingPasskeys: 0,
    });
    renderPanel({ isPrivileged: false });

    await user.click(
      screen.getByRole('button', { name: 'Remove Primary passkey' }),
    );
    const dialog = screen.getByRole('dialog', {
      name: 'Remove Primary passkey?',
    });
    const confirm = within(dialog).getByRole('button', {
      name: 'Remove passkey',
    });
    expect(confirm).toBeDisabled();
    await user.type(
      within(dialog).getByLabelText('Current password'),
      'correct horse battery staple',
    );
    await user.click(confirm);

    expect(removePasskeyMock).toHaveBeenCalledWith(
      passkeys[0].id,
      'correct horse battery staple',
    );
  });

  it('truthfully presents legacy credentials as inactive for regular users', () => {
    renderPanel({ isPrivileged: false });

    expect(screen.getByText('Inactive passkeys')).toBeVisible();
    expect(screen.getByText(/members cannot use passkeys/i)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /create passkey/i }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: /verify with a passkey/i }),
    ).toBeNull();
  });

  it('uses recovery only to open a short replacement-passkey window', async () => {
    const user = userEvent.setup();
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    redeemRecoveryCodeMock.mockResolvedValue({
      status: 'success',
      message:
        'Recovery confirmed. Add a replacement passkey within 10 minutes.',
      grant: {
        grantId: '42de1870-e697-4500-99fd-21616cc71667',
        expiresAt,
      },
      remainingCodes: 8,
      notification: {
        changeId: '9b9db771-350c-4784-ad90-bc5d6dcbfc68',
        occurredAt: new Date().toISOString(),
        remainingCodes: 8,
      },
    });
    renderPanel({
      recoveryCodeSummary: {
        createdAt: '2026-08-17T12:00:00.000Z',
        remainingCodes: 9,
        totalCodes: 10,
      },
    });

    const codeField = screen.getByLabelText('Saved recovery code');
    const passwordField = screen.getByLabelText('Account password');
    await user.type(codeField, 'FA-1234-5678-9ABC-DEFG-HJKM-NPQR');
    await user.type(passwordField, 'correct horse battery staple');
    await user.click(
      screen.getByRole('button', { name: 'Recover a lost passkey' }),
    );

    expect(redeemRecoveryCodeMock).toHaveBeenCalledWith(
      'FA-1234-5678-9ABC-DEFG-HJKM-NPQR',
      'correct horse battery staple',
    );
    expect(codeField).toHaveValue('');
    expect(passwordField).toHaveValue('');
    expect(await screen.findByText('Replacement window ready.')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Create replacement passkey' }),
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Verify with a passkey' }),
    ).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: 'Protected actions unlocked' }),
    ).toBeNull();
    expect(screen.getByText('8 of 10 codes remain')).toBeVisible();
  });

  it('rotates codes only after passkey step-up and password confirmation', async () => {
    const user = userEvent.setup();
    const now = Math.floor(Date.now() / 1_000);
    regenerateRecoveryCodesMock.mockResolvedValue({
      status: 'success',
      message: 'New recovery codes created.',
      codes: ['FA-1111-2222-3333-4444-5555-6666'],
      createdAt: new Date().toISOString(),
      remainingCodes: 10,
      setId: '9765d5f6-3e3b-4de0-a510-b8db3080d63a',
      totalCodes: 10,
      notification: {
        changeId: '0619fcae-cd74-4e89-afb8-5df7a3e61e39',
        occurredAt: new Date().toISOString(),
        reason: 'regenerate',
        setId: '9765d5f6-3e3b-4de0-a510-b8db3080d63a',
      },
    });
    renderPanel({
      isRecentlyVerified: true,
      mfaVerifiedAt: now,
      recoveryCodeSummary: {
        createdAt: '2026-08-17T12:00:00.000Z',
        remainingCodes: 7,
        totalCodes: 10,
      },
    });

    await user.click(screen.getByRole('button', { name: 'Replace codes' }));
    const confirmation = screen.getByRole('dialog', {
      name: 'Create a new set?',
    });
    expect(
      within(confirmation).getByText(/previously saved recovery code/i),
    ).toBeVisible();
    await user.type(
      within(confirmation).getByLabelText('Current password'),
      'correct horse battery staple',
    );
    await user.click(
      within(confirmation).getByRole('button', { name: 'Replace all codes' }),
    );

    expect(regenerateRecoveryCodesMock).toHaveBeenCalledWith(
      'correct horse battery staple',
    );
    const saveDialog = await screen.findByRole('dialog', {
      name: 'Save your recovery codes.',
    });
    expect(
      within(saveDialog).getByText('FA-1111-2222-3333-4444-5555-6666'),
    ).toBeVisible();

    await user.click(
      within(saveDialog).getByRole('button', {
        name: 'I have saved these codes',
      }),
    );
    expect(screen.queryByText('FA-1111-2222-3333-4444-5555-6666')).toBeNull();
  });

  it('completes replacement enrollment through the scoped recovery action', async () => {
    const user = userEvent.setup();
    beginRecoveryRegistrationMock.mockResolvedValue({
      status: 'success',
      options: { challenge: 'challenge' } as never,
      grant: {
        grantId: '4dd20471-84ad-4134-b712-28ebf05af9ea',
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      },
    });
    startRegistrationMock.mockResolvedValue({ id: 'credential-id' } as never);
    finishRegistrationMock.mockResolvedValue({
      status: 'success',
      message: 'Passkey added.',
      passkey: {
        id: backupPasskey.id,
        label: backupPasskey.label,
        backedUp: backupPasskey.backedUp,
        createdAt: backupPasskey.createdAt,
      },
      recoveryCodes: {
        codes: ['FA-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF'],
        createdAt: new Date().toISOString(),
        remainingCodes: 10,
        setId: '1276af98-4fb0-4365-b957-0aaf4ca2c7b3',
        totalCodes: 10,
      },
      recoveryNotification: {
        changeId: 'f49e4383-aaaf-4918-b0ec-b23154695bb3',
        occurredAt: new Date().toISOString(),
        recoveryGrantId: '4dd20471-84ad-4134-b712-28ebf05af9ea',
        setId: '1276af98-4fb0-4365-b957-0aaf4ca2c7b3',
      },
    });
    renderPanel({
      recoveryGrant: {
        grantId: '4dd20471-84ad-4134-b712-28ebf05af9ea',
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      },
    });

    await user.clear(screen.getByLabelText('Passkey name'));
    await user.type(screen.getByLabelText('Passkey name'), 'Replacement key');
    await user.click(
      screen.getByRole('button', { name: 'Create replacement passkey' }),
    );

    expect(beginRecoveryRegistrationMock).toHaveBeenCalledTimes(1);
    expect(beginRegistrationMock).not.toHaveBeenCalled();
    expect(finishRegistrationMock).toHaveBeenCalledWith(
      { id: 'credential-id' },
      'Replacement key',
    );
    expect(
      await screen.findByText('FA-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF'),
    ).toBeVisible();
  });
});
