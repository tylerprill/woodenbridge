import type { AtlasMedia } from '@/app/lib/atlas/definitions';
import type { AtlasChapter, SharedAtlasChapter } from './definitions';

export function toSharedAtlasChapter(
  chapter: AtlasChapter,
): SharedAtlasChapter {
  const mapMedia = (media: AtlasMedia) => {
    const sanitizedUrl = `/api/atlas/media/${encodeURIComponent(media.id)}?variant=thumbnail&share=${encodeURIComponent(chapter.shareId)}`;

    return {
      ...media,
      // Public chapters intentionally expose only the metadata-stripped WebP
      // derivative. The original may retain camera metadata for its owner.
      deliveryUrl: sanitizedUrl,
      thumbnailUrl: sanitizedUrl,
    };
  };
  const entriesWithoutCoordinates = chapter.entries.map((entry) => {
    const {
      latitude: _latitude,
      longitude: _longitude,
      ...publicEntry
    } = entry;
    return {
      ...publicEntry,
      media: entry.media.map(mapMedia),
    };
  });
  const sharedCoverMedia = chapter.coverMedia
    ? mapMedia(chapter.coverMedia)
    : null;

  if (!chapter.shareMap) {
    return {
      ...chapter,
      shareMap: false,
      shareLocationPrecision: 'approximate',
      entries: entriesWithoutCoordinates,
      coverMedia: sharedCoverMedia,
    };
  }

  const entries = entriesWithoutCoordinates.map((entry, index) => ({
    ...entry,
    latitude:
      chapter.shareLocationPrecision === 'exact'
        ? chapter.entries[index].latitude
        : Number(chapter.entries[index].latitude.toFixed(1)),
    longitude:
      chapter.shareLocationPrecision === 'exact'
        ? chapter.entries[index].longitude
        : Number(chapter.entries[index].longitude.toFixed(1)),
  }));

  return {
    ...chapter,
    shareMap: true,
    entries,
    coverMedia: sharedCoverMedia,
  };
}
