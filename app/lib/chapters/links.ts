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
