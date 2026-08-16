export function formatChapterDateRange(
  startDate: string | null,
  endDate: string | null,
) {
  if (!startDate && !endDate) return 'Dates open';

  const start = startDate ? new Date(`${startDate}T12:00:00`) : null;
  const end = endDate ? new Date(`${endDate}T12:00:00`) : null;
  if (!start || Number.isNaN(start.getTime())) return 'Dates open';

  if (!end || Number.isNaN(end.getTime()) || startDate === endDate) {
    return new Intl.DateTimeFormat('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(start);
  }

  if (start.getFullYear() === end.getFullYear()) {
    const startLabel = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
    }).format(start);
    const endLabel = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(end);
    return `${startLabel} – ${endLabel}`;
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${formatter.format(start)} – ${formatter.format(end)}`;
}

export function chapterMemoryLabel(memoryCount: number) {
  return `${memoryCount} ${memoryCount === 1 ? 'memory' : 'memories'}`;
}
