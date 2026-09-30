import type { JourneyContinuationDestination } from './definitions';

function journeyReaderTarget(destination: JourneyContinuationDestination) {
  return destination.kind === 'segment'
    ? `journey-segment-${destination.segmentId}`
    : destination.kind === 'unsegmented'
      ? 'journey-segment-unsegmented'
      : 'chapter-memories';
}

export function journeyReaderHref(
  chapterId: string,
  destination?: JourneyContinuationDestination,
) {
  const pathname = `/dashboard/chapters/${encodeURIComponent(chapterId)}`;
  return destination
    ? `${pathname}#${journeyReaderTarget(destination)}`
    : pathname;
}

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
  return `/dashboard/chapters/${encodeURIComponent(chapterId)}?saved=continued#${journeyReaderTarget(destination)}`;
}
