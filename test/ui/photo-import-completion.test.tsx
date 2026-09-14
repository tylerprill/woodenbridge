/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';

import { PhotoImportCompletionStep } from '@/components/atlas/photo-import-completion-step';

jest.mock('@/components/atlas/atlas-map-loader', () => ({
  __esModule: true,
  default: () => <div data-testid="completion-map">Journey map</div>,
}));

const initialView = {
  latitude: 22,
  longitude: -18,
  zoom: 1.65,
  bearing: 0,
  pitch: 0,
};

describe('photo import completion actions', () => {
  it('opens a completed Chapter directly in Journey Lens', () => {
    render(
      <PhotoImportCompletionStep
        completion={{
          entryIds: [
            '00000000-0000-4000-8000-000000000001',
            '00000000-0000-4000-8000-000000000002',
          ],
          chapterId: '00000000-0000-4000-8000-000000000010',
        }}
        mapEntries={[]}
        initialView={initialView}
        onRestart={jest.fn()}
      />,
    );

    expect(
      screen.getByRole('link', { name: 'View journey on Atlas' }),
    ).toHaveAttribute(
      'href',
      '/dashboard?view=journeys&journey=00000000-0000-4000-8000-000000000010',
    );
    expect(screen.getByRole('link', { name: 'Read chapter' })).toHaveAttribute(
      'href',
      '/dashboard/chapters/00000000-0000-4000-8000-000000000010',
    );
  });

  it('offers a prefilled Chapter when several memories were kept without one', () => {
    render(
      <PhotoImportCompletionStep
        completion={{
          entryIds: [
            '00000000-0000-4000-8000-000000000002',
            '00000000-0000-4000-8000-000000000001',
          ],
          chapterId: null,
        }}
        mapEntries={[]}
        initialView={initialView}
        onRestart={jest.fn()}
      />,
    );

    const suggestion = screen.getByRole('link', {
      name: 'Turn these memories into a journey',
    });
    const destination = new URL(
      suggestion.getAttribute('href') ?? '',
      'http://localhost',
    );
    expect(destination.pathname).toBe('/dashboard/chapters/new');
    expect(destination.searchParams.get('source')).toBe('import');
    expect(destination.searchParams.getAll('memory')).toEqual([
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000001',
    ]);
  });

  it('deep-links a single imported memory on Atlas', () => {
    render(
      <PhotoImportCompletionStep
        completion={{
          entryIds: ['00000000-0000-4000-8000-000000000001'],
          chapterId: null,
        }}
        mapEntries={[]}
        initialView={initialView}
        onRestart={jest.fn()}
      />,
    );

    expect(
      screen.getByRole('link', { name: 'View on the Atlas' }),
    ).toHaveAttribute(
      'href',
      '/dashboard?memory=00000000-0000-4000-8000-000000000001',
    );
  });
});
