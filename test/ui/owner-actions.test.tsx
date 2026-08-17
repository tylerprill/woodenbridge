/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { OwnerActionButton } from '@/components/dashboard/owner-action-button';

describe('owner management actions', () => {
  it('uses an account-specific label and a branded confirmation dialog', async () => {
    const user = userEvent.setup();
    const submit = jest.fn((event: React.FormEvent<HTMLFormElement>) =>
      event.preventDefault(),
    );
    const originalRequestSubmit = HTMLFormElement.prototype.requestSubmit;
    HTMLFormElement.prototype.requestSubmit = function requestSubmit() {
      this.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
    };

    try {
      render(
        <form onSubmit={submit}>
          <OwnerActionButton
            accessibleLabel="Revoke sessions for Ada Lovelace (ada@example.com)"
            confirmTitle="Sign Ada Lovelace out everywhere?"
            confirmMessage="Sign ada@example.com out on every device?"
          >
            Revoke sessions
          </OwnerActionButton>
        </form>,
      );

      await user.click(
        screen.getByRole('button', {
          name: 'Revoke sessions for Ada Lovelace (ada@example.com)',
        }),
      );
      expect(
        screen.getByRole('dialog', {
          name: 'Sign Ada Lovelace out everywhere?',
        }),
      ).toBeVisible();
      expect(
        screen.getByText('Sign ada@example.com out on every device?'),
      ).toBeVisible();
      await user.click(screen.getByRole('button', { name: 'Confirm action' }));
      expect(submit).toHaveBeenCalledTimes(1);
    } finally {
      HTMLFormElement.prototype.requestSubmit = originalRequestSubmit;
    }
  });
});
