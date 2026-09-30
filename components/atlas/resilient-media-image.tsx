'use client';

import Image, { type ImageProps } from 'next/image';
import { type ReactNode, useState } from 'react';
import styles from './resilient-media-image.module.css';

type ResilientMediaImageProps = Omit<ImageProps, 'onError'> & {
  fallback: ReactNode;
};

function imageSourceKey(source: ImageProps['src']) {
  if (typeof source === 'string') return source;
  return 'src' in source ? source.src : source.default.src;
}

/**
 * Keeps a missing private-media object from exposing the browser's broken-image
 * treatment. The failed source is remembered rather than the whole component,
 * so carousels and editors recover as soon as they move to another photograph.
 */
export function ResilientMediaImage({
  alt,
  fallback,
  src,
  ...imageProps
}: ResilientMediaImageProps) {
  const sourceKey = imageSourceKey(src);
  const [failedSource, setFailedSource] = useState<string | null>(null);

  if (failedSource === sourceKey) {
    const accessibleName = alt ? `${alt} — photo unavailable` : undefined;
    return (
      <div
        className={styles.fallback}
        role={accessibleName ? 'img' : undefined}
        aria-label={accessibleName}
        aria-hidden={accessibleName ? undefined : 'true'}
        data-media-image-fallback="true"
      >
        {fallback}
      </div>
    );
  }

  return (
    <Image
      {...imageProps}
      alt={alt}
      src={src}
      onError={() => setFailedSource(sourceKey)}
    />
  );
}
