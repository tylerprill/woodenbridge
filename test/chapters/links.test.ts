import {
  continueJourneyEditorHref,
  continuedJourneyReaderHref,
  journeyReaderHref,
} from '@/app/lib/chapters/links';

describe('Journey links', () => {
  it('scopes the editor to an existing Segment', () => {
    expect(
      continueJourneyEditorHref('journey id', { segmentId: 'segment-id' }),
    ).toBe(
      '/dashboard/chapters/journey%20id/edit?step=continue&continueSegment=segment-id',
    );
  });

  it.each([
    ['the Journey overview', undefined, ''],
    [
      'an existing Segment',
      { kind: 'segment', segmentId: 'segment-id' } as const,
      '#journey-segment-segment-id',
    ],
    [
      'memories outside a Segment',
      { kind: 'unsegmented' } as const,
      '#journey-segment-unsegmented',
    ],
  ])('opens %s from a contextual reader link', (_label, destination, hash) => {
    expect(journeyReaderHref('journey id', destination)).toBe(
      `/dashboard/chapters/journey%20id${hash}`,
    );
  });

  it.each([
    [
      'an existing Segment',
      { kind: 'segment', segmentId: 'segment-id' } as const,
      '#journey-segment-segment-id',
    ],
    [
      'memories outside a Segment',
      { kind: 'unsegmented' } as const,
      '#journey-segment-unsegmented',
    ],
    [
      'a newly created latest Segment',
      { kind: 'new-segment' } as const,
      '#chapter-memories',
    ],
  ])('returns to %s after a continuation save', (_label, destination, hash) => {
    expect(continuedJourneyReaderHref('journey id', destination)).toBe(
      `/dashboard/chapters/journey%20id?saved=continued${hash}`,
    );
  });
});
