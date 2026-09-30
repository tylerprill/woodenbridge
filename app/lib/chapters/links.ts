import type { JourneyContinuationDestination } from './definitions';

export function continueJourneyEditorHref(
  chapterId: string,
  options: {
    segmentId?: string | null;
    withoutSegment?: boolean;
  } = {},
) {
  const query = new URLSearchParams({ step: 'continue' });
  if (options.segmentId) {
    query.set('continueSegment', options.segmentId);
  } else if (options.withoutSegment) {
    query.set('continueWithoutSegment', '1');
  }

  return `/dashboard/chapters/${encodeURIComponent(chapterId)}/edit?${query.toString()}`;
}

export function continuedJourneyReaderHref(
  chapterId: string,
  destination: JourneyContinuationDestination,
) {
  const target =
    destination.kind === 'segment'
      ? `journey-segment-${destination.segmentId}`
      : destination.kind === 'unsegmented'
        ? 'journey-segment-unsegmented'
        : 'chapter-memories';

  return `/dashboard/chapters/${encodeURIComponent(chapterId)}?saved=continued#${target}`;
}
