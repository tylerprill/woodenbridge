import Image from 'next/image';

import type { AtlasEntry } from '@/app/lib/atlas/definitions';
import { getAtlasPlaceContextLabel } from '@/app/lib/atlas/place';
import { BridgeScene } from '@/components/clean/bridge-scene';

type MemoryArtworkProps = {
  entry: AtlasEntry;
  index?: string;
  tone: 'alpine' | 'cedar' | 'ember';
  sizes?: string;
};

export function MemoryArtwork({
  entry,
  index,
  tone,
  sizes,
}: MemoryArtworkProps) {
  const photo = entry.media[0];
  if (!photo) return <BridgeScene index={index} tone={tone} />;

  const alt =
    photo.altText.trim() ||
    entry.title.trim() ||
    getAtlasPlaceContextLabel(entry);

  return (
    <div className="atlas-memory-artwork">
      <Image
        src={photo.deliveryUrl}
        alt={alt}
        fill
        sizes={sizes ?? '(max-width: 768px) 100vw, 33vw'}
        unoptimized
      />
      {index ? <span>{index}</span> : null}
    </div>
  );
}
