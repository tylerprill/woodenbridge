/**
 * @jest-environment jsdom
 */

import { act, render, screen } from '@testing-library/react';

import { ChapterMapLoader } from '@/components/chapters/chapter-map-loader';

jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => {
    const MockDeferredChapterMap = ({ entries }: { entries: unknown[] }) => {
      const React = jest.requireActual<typeof import('react')>('react');
      return React.createElement(
        'div',
        { 'data-testid': 'deferred-chapter-map' },
        `${entries.length} stops`,
      );
    };
    return MockDeferredChapterMap;
  },
}));

const entries = [
  {
    id: 'memory-1',
    title: 'Petra at dawn',
    placeLabel: 'Petra, Jordan',
    placeName: 'Petra',
    latitude: 30.3285,
    longitude: 35.4444,
  },
];

describe('ChapterMapLoader', () => {
  const originalObserver = global.IntersectionObserver;

  afterEach(() => {
    global.IntersectionObserver = originalObserver;
  });

  it('holds MapLibre until the route approaches the viewport', () => {
    let onIntersection: IntersectionObserverCallback = () => undefined;
    const disconnect = jest.fn();
    const observe = jest.fn();
    global.IntersectionObserver = jest.fn((callback) => {
      onIntersection = callback;
      return { disconnect, observe } as unknown as IntersectionObserver;
    }) as unknown as typeof IntersectionObserver;

    render(<ChapterMapLoader entries={entries} />);

    expect(screen.getByRole('status')).toHaveTextContent('Route map ahead');
    expect(
      screen.queryByTestId('deferred-chapter-map'),
    ).not.toBeInTheDocument();
    expect(observe).toHaveBeenCalledTimes(1);

    act(() => {
      onIntersection(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    expect(screen.getByTestId('deferred-chapter-map')).toHaveTextContent(
      '1 stops',
    );
    expect(disconnect).toHaveBeenCalled();
  });

  it('loads immediately when IntersectionObserver is unavailable', () => {
    global.IntersectionObserver = undefined as never;

    render(<ChapterMapLoader entries={entries} />);

    expect(screen.getByTestId('deferred-chapter-map')).toBeInTheDocument();
  });
});
