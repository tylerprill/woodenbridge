'use client';

import dynamic from 'next/dynamic';

import styles from './atlas.module.css';

const AtlasMap = dynamic(() => import('./atlas-map'), {
  ssr: false,
  loading: () => (
    <div className={styles.mapFallback} aria-label="Opening your atlas">
      <div className={styles.mapFallbackGlobe} aria-hidden="true" />
      <p>Opening your atlas…</p>
    </div>
  ),
});

export default AtlasMap;
