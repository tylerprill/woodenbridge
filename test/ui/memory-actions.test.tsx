/**
 * @jest-environment jsdom
 */

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { archiveAtlasEntryAction } from '@/app/lib/actions/atlas';
import { archiveAtlasEntryFromKeepsakeAction } from '@/app/lib/actions/atlas';
import {
  MemoryActionGroup,
  MemoryActions,
} from '@/components/atlas/memory-actions';

const mockReplace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock('@/app/lib/actions/atlas', () => ({
  archiveAtlasEntryAction: jest.fn(),
  archiveAtlasEntryFromKeepsakeAction: jest.fn(),
}));

const ENTRY_ID = '00000000-0000-4000-8000-000000000001';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function openConfirmation(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole('button', { name: 'Delete Kyoto at dusk' }),
  );
  return screen.getByRole('alertdialog', { name: 'Delete this memory?' });
}

describe('memory card actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('offers compact edit and delete actions before showing the destructive details', async () => {
    const user = userEvent.setup();
    render(
      <MemoryActions entryId={ENTRY_ID} title="Kyoto at dusk" variant="card" />,
    );

    expect(
      screen.getByRole('link', { name: 'Edit Kyoto at dusk' }),
    ).toHaveAttribute('href', `/dashboard?memory=${ENTRY_ID}`);

    const confirmation = await openConfirmation(user);
    expect(confirmation).toHaveAttribute('aria-busy', 'false');
    expect(
      within(confirmation).getByText(
        'It disappears from journeys, and its photos are deleted. This can’t be undone.',
      ),
    ).toBeVisible();
    expect(
      within(confirmation).getByRole('button', { name: 'Keep memory' }),
    ).toHaveFocus();
    expect(archiveAtlasEntryAction).not.toHaveBeenCalled();
  });

  it('cancels with either action or Escape and restores focus to delete', async () => {
    const user = userEvent.setup();
    render(
      <MemoryActions entryId={ENTRY_ID} title="Kyoto at dusk" variant="card" />,
    );

    let confirmation = await openConfirmation(user);
    await user.click(
      within(confirmation).getByRole('button', { name: 'Keep memory' }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Delete Kyoto at dusk' }),
      ).toHaveFocus(),
    );

    confirmation = await openConfirmation(user);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Delete Kyoto at dusk' }),
      ).toHaveFocus(),
    );
    expect(archiveAtlasEntryAction).not.toHaveBeenCalled();
  });

  it('keeps a failed deletion open with a retryable local error', async () => {
    const user = userEvent.setup();
    jest.mocked(archiveAtlasEntryAction).mockResolvedValue({
      ok: false,
      error: 'failed',
      message: 'The memory could not be deleted just now.',
    });
    render(
      <MemoryActions entryId={ENTRY_ID} title="Kyoto at dusk" variant="card" />,
    );

    const confirmation = await openConfirmation(user);
    await user.click(
      within(confirmation).getByRole('button', {
        name: 'Delete Kyoto at dusk permanently',
      }),
    );

    expect(await within(confirmation).findByRole('alert')).toHaveTextContent(
      'The memory could not be deleted just now.',
    );
    expect(
      within(confirmation).getByRole('button', {
        name: 'Delete Kyoto at dusk permanently',
      }),
    ).toBeEnabled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('disables the confirmation and prevents a double submit while deleting', async () => {
    const user = userEvent.setup();
    const archive =
      deferred<Awaited<ReturnType<typeof archiveAtlasEntryAction>>>();
    jest.mocked(archiveAtlasEntryAction).mockReturnValue(archive.promise);
    render(
      <MemoryActions entryId={ENTRY_ID} title="Kyoto at dusk" variant="card" />,
    );

    const confirmation = await openConfirmation(user);
    const confirm = within(confirmation).getByRole('button', {
      name: 'Delete Kyoto at dusk permanently',
    });
    fireEvent.click(confirm);

    const pendingConfirm = within(confirmation).getByRole('button', {
      name: 'Deleting Kyoto at dusk',
    });
    expect(confirmation).toHaveAttribute('aria-busy', 'true');
    expect(pendingConfirm).toBeDisabled();
    expect(
      within(confirmation).getByRole('button', { name: 'Keep memory' }),
    ).toBeDisabled();
    fireEvent.click(pendingConfirm);
    expect(archiveAtlasEntryAction).toHaveBeenCalledTimes(1);

    archive.resolve({ ok: true, data: { id: ENTRY_ID } });
    expect(await screen.findByRole('status', { name: '' })).toHaveTextContent(
      'Kyoto at dusk deleted.',
    );
  });

  it('announces successful collection deletion while the revalidated tree commits', async () => {
    const user = userEvent.setup();
    jest.mocked(archiveAtlasEntryAction).mockResolvedValue({
      ok: true,
      data: { id: ENTRY_ID },
    });
    render(
      <MemoryActions entryId={ENTRY_ID} title="Kyoto at dusk" variant="card" />,
    );

    const confirmation = await openConfirmation(user);
    await user.click(
      within(confirmation).getByRole('button', {
        name: 'Delete Kyoto at dusk permanently',
      }),
    );

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Kyoto at dusk deleted.',
    );
    expect(archiveAtlasEntryAction).toHaveBeenCalledWith(ENTRY_ID);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('keeps only one card confirmation open within a collection', async () => {
    const user = userEvent.setup();
    render(
      <MemoryActionGroup>
        <MemoryActions
          entryId={ENTRY_ID}
          title="Kyoto at dusk"
          variant="card"
        />
        <MemoryActions
          entryId="00000000-0000-4000-8000-000000000002"
          title="Lisbon at dawn"
          variant="card"
        />
      </MemoryActionGroup>,
    );

    await user.click(
      screen.getByRole('button', { name: 'Delete Kyoto at dusk' }),
    );
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);

    await user.click(
      screen.getByRole('button', { name: 'Delete Lisbon at dawn' }),
    );
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
    expect(
      screen.queryByRole('button', {
        name: 'Delete Kyoto at dusk permanently',
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Delete Lisbon at dawn permanently' }),
    ).toBeVisible();
  });

  it('replaces an empty paginated collection after successful deletion', async () => {
    const user = userEvent.setup();
    jest.mocked(archiveAtlasEntryAction).mockResolvedValue({
      ok: true,
      data: { id: ENTRY_ID },
    });
    render(
      <MemoryActions
        entryId={ENTRY_ID}
        title="Kyoto at dusk"
        variant="card"
        returnTo="/dashboard/places"
      />,
    );

    const confirmation = await openConfirmation(user);
    await user.click(
      within(confirmation).getByRole('button', {
        name: 'Delete Kyoto at dusk permanently',
      }),
    );

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith('/dashboard/places'),
    );
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('uses the redirecting server action from the full detail controls', async () => {
    const user = userEvent.setup();
    jest.mocked(archiveAtlasEntryFromKeepsakeAction).mockResolvedValue({
      ok: false,
      error: 'failed',
      message: 'The memory could not be removed. Please try again.',
    });
    render(
      <MemoryActions
        entryId={ENTRY_ID}
        title="Kyoto at dusk"
        variant="detail"
      />,
    );

    expect(screen.getByRole('link', { name: 'Edit memory' })).toHaveAttribute(
      'href',
      `/dashboard?memory=${ENTRY_ID}`,
    );
    await user.click(screen.getByRole('button', { name: 'Delete memory' }));
    const confirmation = screen.getByRole('alertdialog', {
      name: 'Delete this memory?',
    });
    await user.click(
      within(confirmation).getByRole('button', {
        name: 'Delete Kyoto at dusk permanently',
      }),
    );

    expect(archiveAtlasEntryFromKeepsakeAction).toHaveBeenCalledWith(ENTRY_ID);
    expect(archiveAtlasEntryAction).not.toHaveBeenCalled();
    expect(await within(confirmation).findByRole('alert')).toHaveTextContent(
      'The memory could not be removed. Please try again.',
    );
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
