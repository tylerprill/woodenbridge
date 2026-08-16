import Image from 'next/image';

import type { AtlasEntry } from '@/app/lib/atlas/definitions';
import { BridgeScene } from '@/components/clean/bridge-scene';

type MemoryArtworkProps = {
  entry: AtlasEntry;
  index?: string;
  tone: 'alpine' | 'cedar' | 'ember';
};

export function MemoryArtwork({ entry, index, tone }: MemoryArtworkProps) {
  const photo = entry.media[0];
  if (!photo) return <BridgeScene index={index} tone={tone} />;

  return (
    <div className="atlas-memory-artwork">
      <Image
        src={photo.deliveryUrl}
        alt={photo.altText}
        fill
        sizes="(max-width: 768px) 100vw, 33vw"
        unoptimized
      />
      {index ? <span>{index}</span> : null}
    </div>
  );
}
