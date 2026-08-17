import type { Metadata } from 'next';
import {
  CheckBadgeIcon,
  MagnifyingGlassIcon,
  ShieldCheckIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';

import {
  revokeManagedUserSessions,
  setManagedUserRole,
} from '@/app/lib/actions/owner-users';
import { getManagedUsers } from '@/app/lib/owner/users';
import { OwnerActionButton } from '@/components/dashboard/owner-action-button';

export const metadata: Metadata = {
  title: 'Users — Field Atlas',
  description: 'Management tools for Field Atlas user accounts.',
};

const messages = {
  'role-updated': 'The account role was updated and its sessions were revoked.',
  'no-change': 'That account already has the selected role.',
  'sessions-revoked': 'The account must sign in again on every device.',
  'self-protected': 'You cannot change or revoke your current account.',
  'protected-owner': 'The Field Atlas owner account is immutable.',
  'owner-required': 'Only the owner can appoint or remove administrators.',
  'admin-peer-protected': 'Administrators cannot manage another administrator.',
  'not-found': 'That account no longer exists.',
  invalid: 'That account action was not valid.',
  failed: 'The account could not be updated. Please try again.',
} as const;

function getMessage(value?: string | string[]) {
  return typeof value === 'string' && value in messages
    ? messages[value as keyof typeof messages]
    : undefined;
}

export default async function OwnerUsersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | string[];
    notice?: string | string[];
    error?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const search = typeof params.q === 'string' ? params.q : '';
  const notice = getMessage(params.notice);
  const error = getMessage(params.error);
  const { users, counts, currentUserId, currentRole } =
    await getManagedUsers(search);

  return (
    <div className="dashboard-page owner-users-page">
      <header className="dashboard-page-heading owner-users-heading">
        <div>
          <p className="section-kicker">Management tools</p>
          <h1>Users.</h1>
          <p>
            A careful view of the people behind each atlas, with only the
            account controls needed for daily stewardship.
          </p>
        </div>
        <span className="owner-access-badge">
          <ShieldCheckIcon aria-hidden="true" /> {currentRole} access
        </span>
      </header>

      <section className="owner-user-stats" aria-label="Account summary">
        <article>
          <UserGroupIcon aria-hidden="true" />
          <span>
            <strong>{counts.total}</strong>
            Total accounts
          </span>
        </article>
        <article>
          <CheckBadgeIcon aria-hidden="true" />
          <span>
            <strong>{counts.verified}</strong>
            Verified emails
          </span>
        </article>
        <article>
          <ShieldCheckIcon aria-hidden="true" />
          <span>
            <strong>{counts.admins}</strong>
            Administrators
          </span>
        </article>
        <article>
          <ShieldCheckIcon aria-hidden="true" />
          <span>
            <strong>{counts.owners}</strong>
            Protected owner
          </span>
        </article>
      </section>

      <section className="owner-users-panel" aria-labelledby="user-list-title">
        <div className="owner-users-toolbar">
          <div>
            <p className="section-kicker">Account directory</p>
            <h2 id="user-list-title">People and access</h2>
          </div>
          <form className="owner-user-search" method="get">
            <MagnifyingGlassIcon aria-hidden="true" />
            <input
              type="search"
              name="q"
              defaultValue={search}
              placeholder="Search name or email"
              aria-label="Search users"
            />
            <button type="submit">Search</button>
          </form>
        </div>

        {notice ? (
          <p className="owner-users-notice" role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="owner-users-notice owner-users-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="owner-users-table-wrap">
          <table className="owner-users-table">
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">Verification</th>
                <th scope="col">Role</th>
                <th scope="col">Gentle actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isCurrentUser = user.id === currentUserId;
                const isProtectedOwner = user.role === 'owner';
                const canChangeRole =
                  currentRole === 'owner' &&
                  !isCurrentUser &&
                  !isProtectedOwner;
                const canRevokeSessions =
                  !isCurrentUser &&
                  !isProtectedOwner &&
                  (currentRole === 'owner' || user.role === 'user');
                const nextRole = user.role === 'admin' ? 'user' : 'admin';

                return (
                  <tr key={user.id}>
                    <td>
                      <span className="owner-user-identity">
                        <span aria-hidden="true">
                          {user.name.charAt(0).toUpperCase()}
                        </span>
                        <span>
                          <strong>{user.name}</strong>
                          <small>{user.email}</small>
                        </span>
                      </span>
                    </td>
                    <td>
                      <span
                        className={`owner-user-status ${
                          user.emailVerified ? 'is-verified' : 'is-pending'
                        }`}
                      >
                        {user.emailVerified ? 'Verified' : 'Pending'}
                      </span>
                    </td>
                    <td>
                      <span className={`owner-role owner-role-${user.role}`}>
                        {user.role}
                      </span>
                    </td>
                    <td>
                      {isProtectedOwner ? (
                        <span className="owner-current-user">
                          Protected owner
                        </span>
                      ) : isCurrentUser ? (
                        <span className="owner-current-user">
                          Current account
                        </span>
                      ) : !canChangeRole && !canRevokeSessions ? (
                        <span className="owner-current-user">
                          Owner managed
                        </span>
                      ) : (
                        <div className="owner-user-actions">
                          {canChangeRole ? (
                            <form action={setManagedUserRole}>
                              <input
                                type="hidden"
                                name="targetUserId"
                                value={user.id}
                              />
                              <input
                                type="hidden"
                                name="role"
                                value={nextRole}
                              />
                              <OwnerActionButton
                                tone={nextRole === 'admin' ? 'strong' : 'quiet'}
                                accessibleLabel={`Make ${user.name} (${user.email}) ${nextRole}`}
                                confirmTitle={`Make ${user.name} ${nextRole}?`}
                                confirmMessage={`Change ${user.email} to ${nextRole}? This will sign the account out everywhere.`}
                              >
                                Make {nextRole}
                              </OwnerActionButton>
                            </form>
                          ) : null}
                          {canRevokeSessions ? (
                            <form action={revokeManagedUserSessions}>
                              <input
                                type="hidden"
                                name="targetUserId"
                                value={user.id}
                              />
                              <OwnerActionButton
                                accessibleLabel={`Revoke sessions for ${user.name} (${user.email})`}
                                confirmTitle={`Sign ${user.name} out everywhere?`}
                                confirmMessage={`Sign ${user.email} out on every device?`}
                              >
                                Revoke sessions
                              </OwnerActionButton>
                            </form>
                          ) : null}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {users.length === 0 ? (
          <p className="owner-users-empty">No accounts match that search.</p>
        ) : null}
      </section>
    </div>
  );
}
