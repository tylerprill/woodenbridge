import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { db } from '@vercel/postgres';
import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from 'simplewebauthn-server';

import {
  MAX_PASSKEYS_PER_USER,
  completePasskeyRegistrationCeremony,
  completePasskeyStepUpCeremony,
  getPasskeyConfiguration,
  removeUserPasskey,
} from '@/app/lib/auth/passkeys';

const clientSqlMock = jest.fn();
const clientQueryMock = jest.fn();
const releaseMock = jest.fn();

jest.mock('@vercel/postgres', () => ({
  db: { connect: jest.fn() },
  sql: jest.fn(),
}));

jest.mock('simplewebauthn-server', () => ({
  generateAuthenticationOptions: jest.fn(),
  generateRegistrationOptions: jest.fn(),
  verifyAuthenticationResponse: jest.fn(),
  verifyRegistrationResponse: jest.fn(),
}));

const connectMock = jest.mocked(db.connect);
const verifyAuthenticationMock = jest.mocked(verifyAuthenticationResponse);
const verifyRegistrationMock = jest.mocked(verifyRegistrationResponse);
const userId = 'cc248324-3a37-4112-be21-5b7e64a1e027';
const sessionReference = 'a'.repeat(64);
const userHandle = Buffer.alloc(32, 7);

function queryText(parts: TemplateStringsArray) {
  return Array.from(parts).join(' ');
}

function authenticationResponse(
  handle = userHandle.toString('base64url'),
): AuthenticationResponseJSON {
  return {
    id: 'credential-id',
    rawId: 'credential-id',
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      authenticatorData: 'authenticator-data',
      clientDataJSON: 'client-data',
      signature: 'signature',
      userHandle: handle,
    },
  };
}

function registrationResponse(): RegistrationResponseJSON {
  return {
    id: 'new-credential',
    rawId: 'new-credential',
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      attestationObject: 'attestation',
      clientDataJSON: 'client-data',
      transports: ['internal'],
    },
  };
}

function installStepUpDatabase() {
  clientSqlMock.mockImplementation(async (parts: TemplateStringsArray) => {
    const query = queryText(parts);

    if (query.includes('SELECT id, challenge')) {
      return {
        rowCount: 1,
        rows: [{ id: 'challenge-id', challenge: 'challenge' }],
      };
    }
    if (
      query.includes('FROM user_passkeys') &&
      query.includes('INNER JOIN users')
    ) {
      return {
        rowCount: 1,
        rows: [
          {
            id: 'passkey-id',
            credential_id: 'credential-id',
            public_key: Buffer.from('public-key'),
            counter: '4',
            device_type: 'singleDevice',
            backed_up: false,
            transports: ['internal'],
            label: 'Primary passkey',
            created_at: new Date(),
            last_used_at: null,
            webauthn_user_handle: userHandle,
          },
        ],
      };
    }
    if (query.includes('UPDATE auth_sessions')) {
      return { rowCount: 1, rows: [{ session_hash: sessionReference }] };
    }

    return { rowCount: 1, rows: [] };
  });
}

describe('passkey ceremony invariants', () => {
  beforeEach(() => {
    process.env.APP_URL = 'https://field-atlas.example';
    connectMock.mockResolvedValue({
      query: clientQueryMock,
      release: releaseMock,
      sql: clientSqlMock,
    } as never);
    installStepUpDatabase();
    verifyAuthenticationMock.mockResolvedValue({
      verified: true,
      authenticationInfo: {
        credentialID: 'credential-id',
        newCounter: 5,
        userVerified: true,
        credentialDeviceType: 'multiDevice',
        credentialBackedUp: true,
        origin: 'https://field-atlas.example',
        rpID: 'field-atlas.example',
      },
    });
  });

  it('binds preview ceremonies to the exact Vercel preview origin', () => {
    const original = {
      appUrl: process.env.APP_URL,
      passkeyOrigin: process.env.PASSKEY_ORIGIN,
      passkeyRpId: process.env.PASSKEY_RP_ID,
      vercelEnv: process.env.VERCEL_ENV,
      vercelUrl: process.env.VERCEL_URL,
    };

    try {
      delete process.env.PASSKEY_ORIGIN;
      process.env.APP_URL = 'https://field-atlas.example';
      process.env.PASSKEY_RP_ID = 'field-atlas.example';
      process.env.VERCEL_ENV = 'preview';
      process.env.VERCEL_URL = 'feature-atlas-example.vercel.app';

      expect(getPasskeyConfiguration()).toEqual({
        origin: 'https://feature-atlas-example.vercel.app',
        rpID: 'feature-atlas-example.vercel.app',
      });
    } finally {
      for (const [name, value] of Object.entries({
        APP_URL: original.appUrl,
        PASSKEY_ORIGIN: original.passkeyOrigin,
        PASSKEY_RP_ID: original.passkeyRpId,
        VERCEL_ENV: original.vercelEnv,
        VERCEL_URL: original.vercelUrl,
      })) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it('binds a returned user handle and refreshes authenticator metadata', async () => {
    await expect(
      completePasskeyStepUpCeremony({
        userId,
        sessionReference,
        response: authenticationResponse(),
      }),
    ).resolves.toBe(true);

    expect(verifyAuthenticationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedOrigin: 'https://field-atlas.example',
        expectedRPID: 'field-atlas.example',
        requireUserVerification: true,
      }),
    );
    const metadataUpdate = clientSqlMock.mock.calls.find(([parts]) =>
      queryText(parts).includes('UPDATE user_passkeys'),
    );
    expect(metadataUpdate?.slice(1)).toEqual(
      expect.arrayContaining([5, 'multiDevice', true]),
    );
    const lockKeys = clientSqlMock.mock.calls
      .filter(([parts]) => queryText(parts).includes('pg_advisory_xact_lock'))
      .map((call) => call[1]);
    expect(lockKeys).toEqual([
      `passkey-user:${userId}`,
      `auth-session-user:${userId}`,
    ]);
  });

  it('consumes but rejects an assertion carrying another account handle', async () => {
    await expect(
      completePasskeyStepUpCeremony({
        userId,
        sessionReference,
        response: authenticationResponse(
          Buffer.alloc(32, 9).toString('base64url'),
        ),
      }),
    ).resolves.toBe(false);

    expect(verifyAuthenticationMock).not.toHaveBeenCalled();
    expect(
      clientSqlMock.mock.calls.some(([parts]) =>
        queryText(parts).includes('UPDATE webauthn_challenges'),
      ),
    ).toBe(true);
    expect(
      clientSqlMock.mock.calls.some(([parts]) =>
        queryText(parts).includes('COMMIT'),
      ),
    ).toBe(true);
  });

  it('serializes completion and refuses a concurrent enrollment above the cap', async () => {
    clientSqlMock.mockImplementation(async (parts: TemplateStringsArray) => {
      const query = queryText(parts);

      if (query.includes('SELECT id, challenge')) {
        return {
          rowCount: 1,
          rows: [{ id: 'challenge-id', challenge: 'challenge' }],
        };
      }
      if (query.includes('AS passkey_count')) {
        return {
          rowCount: 1,
          rows: [
            {
              has_recent_step_up: false,
              passkey_count: String(MAX_PASSKEYS_PER_USER),
              role: 'user',
            },
          ],
        };
      }

      return { rowCount: 1, rows: [] };
    });
    verifyRegistrationMock.mockResolvedValue({
      verified: true,
      registrationInfo: {
        fmt: 'none',
        aaguid: '00000000-0000-0000-0000-000000000000',
        credential: {
          id: 'new-credential',
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 0,
          transports: ['internal'],
        },
        credentialType: 'public-key',
        attestationObject: new Uint8Array(),
        userVerified: true,
        credentialDeviceType: 'multiDevice',
        credentialBackedUp: true,
        origin: 'https://field-atlas.example',
        rpID: 'field-atlas.example',
      },
    });

    await expect(
      completePasskeyRegistrationCeremony({
        userId,
        sessionReference,
        response: registrationResponse(),
        label: 'Another passkey',
      }),
    ).resolves.toBe(false);

    const statements = clientSqlMock.mock.calls.map(([parts]) =>
      queryText(parts),
    );
    expect(
      statements.some((query) => query.includes('pg_advisory_xact_lock')),
    ).toBe(true);
    expect(clientQueryMock).not.toHaveBeenCalled();
  });

  it('does not let a password-only privileged session add a second credential', async () => {
    clientSqlMock.mockImplementation(async (parts: TemplateStringsArray) => {
      const query = queryText(parts);

      if (query.includes('SELECT id, challenge')) {
        return {
          rowCount: 1,
          rows: [{ id: 'challenge-id', challenge: 'challenge' }],
        };
      }
      if (query.includes('AS passkey_count')) {
        return {
          rowCount: 1,
          rows: [
            {
              has_recent_step_up: false,
              passkey_count: '1',
              role: 'admin',
            },
          ],
        };
      }

      return { rowCount: 1, rows: [] };
    });
    verifyRegistrationMock.mockResolvedValue({
      verified: true,
      registrationInfo: {
        fmt: 'none',
        aaguid: '00000000-0000-0000-0000-000000000000',
        credential: {
          id: 'new-credential',
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 0,
          transports: ['internal'],
        },
        credentialType: 'public-key',
        attestationObject: new Uint8Array(),
        userVerified: true,
        credentialDeviceType: 'multiDevice',
        credentialBackedUp: true,
        origin: 'https://field-atlas.example',
        rpID: 'field-atlas.example',
      },
    });

    await expect(
      completePasskeyRegistrationCeremony({
        userId,
        sessionReference,
        response: registrationResponse(),
        label: 'Untrusted passkey',
      }),
    ).resolves.toBe(false);

    expect(clientQueryMock).not.toHaveBeenCalled();
  });

  it('keeps one active challenge per session and purpose in the schema', async () => {
    const migration = await readFile(
      resolve(process.cwd(), 'migrations/017_passkey_step_up.sql'),
      'utf8',
    );

    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS webauthn_challenges_active_session_purpose_idx[\s\S]*WHERE used_at IS NULL;/,
    );
  });

  it('protects the final privileged credential inside the removal transaction', async () => {
    clientSqlMock.mockImplementation(async (parts: TemplateStringsArray) => {
      const query = queryText(parts);

      if (query.includes('SELECT role')) {
        return { rowCount: 1, rows: [{ role: 'owner' }] };
      }
      if (query.includes('SELECT id, label, backed_up, created_at')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: '68038b48-4d24-4601-a83f-6fbc4280158a',
              label: 'Only passkey',
              backed_up: true,
              created_at: new Date('2026-08-17T12:00:00.000Z'),
            },
          ],
        };
      }

      return { rowCount: 1, rows: [] };
    });

    await expect(
      removeUserPasskey({
        userId,
        passkeyId: '68038b48-4d24-4601-a83f-6fbc4280158a',
        authorization: 'passkey',
      }),
    ).resolves.toEqual({ status: 'last_privileged_passkey' });

    const statements = clientSqlMock.mock.calls.map(([parts]) =>
      queryText(parts),
    );
    expect(
      statements.some((query) => query.includes('DELETE FROM user_passkeys')),
    ).toBe(false);
  });

  it('rechecks privileged removal authorization after locking the account', async () => {
    clientSqlMock.mockImplementation(async (parts: TemplateStringsArray) => {
      const query = queryText(parts);

      if (query.includes('SELECT role')) {
        return { rowCount: 1, rows: [{ role: 'admin' }] };
      }

      return { rowCount: 1, rows: [] };
    });

    await expect(
      removeUserPasskey({
        userId,
        passkeyId: '68038b48-4d24-4601-a83f-6fbc4280158a',
        authorization: 'password',
      }),
    ).resolves.toEqual({ status: 'step_up_required' });

    const statements = clientSqlMock.mock.calls.map(([parts]) =>
      queryText(parts),
    );
    expect(
      statements.some((query) => query.includes('DELETE FROM user_passkeys')),
    ).toBe(false);
  });

  it('removes only the owned credential and clears elevation across sessions', async () => {
    clientQueryMock.mockResolvedValue({ rowCount: 1, rows: [] });
    clientSqlMock.mockImplementation(async (parts: TemplateStringsArray) => {
      const query = queryText(parts);

      if (query.includes('SELECT role')) {
        return { rowCount: 1, rows: [{ role: 'admin' }] };
      }
      if (query.includes('SELECT id, label, backed_up, created_at')) {
        return {
          rowCount: 2,
          rows: [
            {
              id: '68038b48-4d24-4601-a83f-6fbc4280158a',
              label: 'Retired laptop',
              backed_up: false,
              created_at: new Date('2026-08-17T12:00:00.000Z'),
            },
            {
              id: 'eebff02d-aeb0-4345-9619-c04623036369',
              label: 'Phone',
              backed_up: true,
              created_at: new Date('2026-08-17T13:00:00.000Z'),
            },
          ],
        };
      }

      return { rowCount: 1, rows: [] };
    });

    await expect(
      removeUserPasskey({
        userId,
        passkeyId: '68038b48-4d24-4601-a83f-6fbc4280158a',
        authorization: 'passkey',
      }),
    ).resolves.toMatchObject({
      status: 'removed',
      passkey: { label: 'Retired laptop' },
      remainingPasskeys: 1,
    });

    const statements = clientSqlMock.mock.calls.map(([parts]) =>
      queryText(parts),
    );
    expect(
      statements.some((query) => query.includes('DELETE FROM user_passkeys')),
    ).toBe(true);
    expect(
      statements.some(
        (query) =>
          query.includes('UPDATE auth_sessions') &&
          query.includes('mfa_verified_at = NULL') &&
          query.includes('mfa_method = NULL'),
      ),
    ).toBe(true);
    expect(
      statements.some((query) => query.includes('UPDATE webauthn_challenges')),
    ).toBe(true);
    expect(
      clientQueryMock.mock.calls.some(([query]) =>
        String(query).includes('INSERT INTO security_notification_outbox'),
      ),
    ).toBe(true);
  });
});
