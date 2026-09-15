import type { ConsoleMessage, Page } from '@playwright/test';

import {
  isExpectedMapTeardownWarning,
  monitorBrowserIssues,
} from '../../e2e/support/ui-audit';

jest.mock('@playwright/test', () => ({ expect: jest.fn() }));
jest.mock('@axe-core/playwright', () => jest.fn());

const destination = 'http://127.0.0.1:3100/dashboard/chapters/new?source=atlas';
const warning = {
  kind: 'console' as const,
  level: 'warning' as const,
  message:
    '[JavaScript Warning: "WebGL context was lost." {file: "map.js" line: 1}]',
  documentUrl: destination,
};

describe('Intentional MapLibre removal diagnostics', () => {
  it('keeps an identical live-map warning when a later teardown warning is deduplicated', () => {
    let documentUrl = 'http://127.0.0.1:3100/dashboard?view=journeys';
    const listeners = new Map<string, (message: ConsoleMessage) => void>();
    const page = {
      url: () => documentUrl,
      on: (event: string, listener: (message: ConsoleMessage) => void) => {
        listeners.set(event, listener);
      },
      off: (event: string) => listeners.delete(event),
    } as unknown as Page;
    const monitor = monitorBrowserIssues(page);
    const message = {
      text: () => warning.message,
      type: () => 'warning',
      location: () => ({ url: 'http://127.0.0.1:3100/map.js' }),
    } as unknown as ConsoleMessage;
    listeners.get('console')!(message);
    documentUrl = destination;
    listeners.get('console')!(message);
    listeners.get('console')!(message);
    const captured = monitor.flush();
    expect(captured).toHaveLength(2);
    expect(
      captured.filter(
        (issue) => !isExpectedMapTeardownWarning(issue, destination, 0, true),
      ),
    ).toHaveLength(1);
    expect(monitor.flush()).toEqual([]);
    monitor.stop();
  });

  it('recognizes only the exact Firefox warning after an expected completed teardown', () => {
    expect(isExpectedMapTeardownWarning(warning, destination, 0, true)).toBe(
      true,
    );
  });

  it('fails context loss while a map remains mounted', () => {
    expect(isExpectedMapTeardownWarning(warning, destination, 1, true)).toBe(
      false,
    );
  });

  it('fails context loss captured on the live Atlas even after navigation removed it', () => {
    expect(
      isExpectedMapTeardownWarning(
        {
          ...warning,
          documentUrl: 'http://127.0.0.1:3100/dashboard?view=journeys',
        },
        destination,
        0,
        true,
      ),
    ).toBe(false);
  });

  it('requires the caller to explicitly expect map removal', () => {
    expect(isExpectedMapTeardownWarning(warning, destination, 0)).toBe(false);
  });

  it('fails warnings without a recorded document URL', () => {
    expect(
      isExpectedMapTeardownWarning(
        { ...warning, documentUrl: undefined },
        destination,
        0,
        true,
      ),
    ).toBe(false);
  });

  it('does not suppress console errors', () => {
    expect(
      isExpectedMapTeardownWarning(
        { ...warning, level: 'error' },
        destination,
        0,
        true,
      ),
    ).toBe(false);
  });

  it('does not suppress page errors', () => {
    expect(
      isExpectedMapTeardownWarning(
        { kind: 'page-error', message: warning.message },
        destination,
        0,
        true,
      ),
    ).toBe(false);
  });

  it('does not suppress other warnings', () => {
    expect(
      isExpectedMapTeardownWarning(
        { ...warning, message: 'WebGL rendering failed' },
        destination,
        0,
        true,
      ),
    ).toBe(false);
  });

  it('does not suppress warnings captured on a different query or origin', () => {
    expect(
      isExpectedMapTeardownWarning(
        { ...warning, documentUrl: destination + '&different=1' },
        destination,
        0,
        true,
      ),
    ).toBe(false);
    expect(
      isExpectedMapTeardownWarning(
        {
          ...warning,
          documentUrl: destination.replace('127.0.0.1', 'localhost'),
        },
        destination,
        0,
        true,
      ),
    ).toBe(false);
  });
});
