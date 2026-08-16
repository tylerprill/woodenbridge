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
  title: 'Users — Wooden Bridge',
  description: 'Owner tools for Wooden Bridge user accounts.',
};

const messages = {
  'role-updated': 'The account role was updated and its sessions were revoked.',
  'no-change': 'That account already has the selected role.',
  'sessions-revoked': 'The account must sign in again on every device.',
  'self-protected': 'Use another owner account to change your active account.',
  'last-owner-protected': 'Wooden Bridge must retain at least one owner.',
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
  const { users, counts, currentUserId } = await getManagedUsers(search);

  return (
    <div className="dashboard-page owner-users-page">
      <header className="dashboard-page-heading owner-users-heading">
        <div>
          <p className="section-kicker">Owner tools</p>
          <h1>Users.</h1>
          <p>
            A careful view of the people behind each atlas, with only the
            account controls needed for daily stewardship.
          </p>
        </div>
        <span className="owner-access-badge">
          <ShieldCheckIcon aria-hidden="true" /> Owner only
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
            <strong>{counts.owners}</strong>
            Company owners
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
                const nextRole = user.role === 'owner' ? 'user' : 'owner';

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
                      {isCurrentUser ? (
                        <span className="owner-current-user">
                          Current account
                        </span>
                      ) : (
                        <div className="owner-user-actions">
                          <form action={setManagedUserRole}>
                            <input
                              type="hidden"
                              name="targetUserId"
                              value={user.id}
                            />
                            <input type="hidden" name="role" value={nextRole} />
                            <OwnerActionButton
                              tone={nextRole === 'owner' ? 'strong' : 'quiet'}
                              confirmMessage={`Change ${user.email} to ${nextRole}? This will sign the account out everywhere.`}
                            >
                              Make {nextRole}
                            </OwnerActionButton>
                          </form>
                          <form action={revokeManagedUserSessions}>
                            <input
                              type="hidden"
                              name="targetUserId"
                              value={user.id}
                            />
                            <OwnerActionButton
                              confirmMessage={`Sign ${user.email} out on every device?`}
                            >
                              Revoke sessions
                            </OwnerActionButton>
                          </form>
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
