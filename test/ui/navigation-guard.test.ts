/**
 * @jest-environment jsdom
 */

import { waitFor } from '@testing-library/react';

import { installNavigationGuard } from '@/app/lib/navigation-guard';

describe('early navigation guard', () => {
  it('restores rejected Back and Forward traversals without adding history entries', async () => {
    const cleanup = installNavigationGuard();
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    const firstLeave = jest.fn();

    window.history.replaceState({ route: 'journeys' }, '', '/journeys');
    window.history.pushState({ route: 'editor' }, '', '/journeys/edit');
    const originalLength = window.history.length;
    window.__FIELD_ATLAS_NAVIGATION_GUARD__?.set({
      id: 'back-guard',
      message: 'Discard the draft?',
      onLeave: firstLeave,
    });

    window.history.back();
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(window.location.pathname).toBe('/journeys/edit'),
    );
    expect(window.history.length).toBe(originalLength);
    expect(window.history.state).toMatchObject({ route: 'editor' });
    expect(firstLeave).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    window.history.back();
    await waitFor(() => expect(firstLeave).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(window.location.pathname).toBe('/journeys'));

    window.history.forward();
    await waitFor(() =>
      expect(window.location.pathname).toBe('/journeys/edit'),
    );
    expect(confirm).toHaveBeenCalledTimes(2);

    window.history.pushState({ route: 'reader' }, '', '/journeys/read');
    window.history.back();
    await waitFor(() =>
      expect(window.location.pathname).toBe('/journeys/edit'),
    );

    const forwardLeave = jest.fn();
    confirm.mockReturnValue(false);
    window.__FIELD_ATLAS_NAVIGATION_GUARD__?.set({
      id: 'forward-guard',
      message: 'Leave the editor?',
      onLeave: forwardLeave,
    });
    window.history.forward();
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(3));
    await waitFor(() =>
      expect(window.location.pathname).toBe('/journeys/edit'),
    );
    expect(window.history.length).toBe(originalLength + 1);
    expect(forwardLeave).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    window.history.forward();
    await waitFor(() => expect(forwardLeave).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(window.location.pathname).toBe('/journeys/read'),
    );

    confirm.mockRestore();
    cleanup?.();
  });
});
