import { lockCurrentPrivilegedActor } from '@/app/lib/auth/privileged-action-authorization';

describe('privileged mutation actor authorization', () => {
  it('locks and verifies the exact current passkey-stepped session', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ role: 'owner' }] });

    await expect(
      lockCurrentPrivilegedActor({ query } as never, {
        authenticatedAt: 1_765_000_000,
        sessionReference: 'b'.repeat(64),
        sessionVersion: 7,
        userId: '3d006a3a-671f-44a2-819c-ad817c4c1d74',
      }),
    ).resolves.toEqual({ role: 'owner' });

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toContain('pg_advisory_xact_lock');
    const [authorizationSql, values] = query.mock.calls[1] as [
      string,
      unknown[],
    ];
    expect(authorizationSql).toContain("users.account_status = 'active'");
    expect(authorizationSql).toContain('users.email_verified_at IS NOT NULL');
    expect(authorizationSql).toContain('auth_sessions.session_hash = $2');
    expect(authorizationSql).toContain('auth_sessions.revoked_at IS NULL');
    expect(authorizationSql).toContain(
      'auth_sessions.absolute_expires_at > NOW()',
    );
    expect(authorizationSql).toContain("auth_sessions.mfa_method = 'passkey'");
    expect(authorizationSql).toContain('FOR UPDATE OF users, auth_sessions');
    expect(values).toEqual([
      '3d006a3a-671f-44a2-819c-ad817c4c1d74',
      'b'.repeat(64),
      1_765_000_000,
      600,
      7,
    ]);
  });

  it('rejects an invalid session reference before acquiring locks', async () => {
    const query = jest.fn();

    await expect(
      lockCurrentPrivilegedActor({ query } as never, {
        authenticatedAt: 1_765_000_000,
        sessionReference: 'not-a-session-reference',
        sessionVersion: 7,
        userId: '3d006a3a-671f-44a2-819c-ad817c4c1d74',
      }),
    ).resolves.toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });
});
