'use client';

import { useEffect, useRef } from 'react';

export function AmbientBackground() {
  const backgroundRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const background = backgroundRef.current;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const precisePointer = window.matchMedia('(pointer: fine)');

    if (!background || reducedMotion.matches || !precisePointer.matches) {
      return;
    }

    let animationFrame = 0;

    const handlePointerMove = (event: PointerEvent) => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const horizontal = event.clientX / window.innerWidth - 0.5;
        const vertical = event.clientY / window.innerHeight - 0.5;

        background.style.setProperty('--pointer-x', `${event.clientX}px`);
        background.style.setProperty('--pointer-y', `${event.clientY}px`);
        background.style.setProperty('--drift-x', `${horizontal * 36}px`);
        background.style.setProperty('--drift-y', `${vertical * 28}px`);
        background.style.setProperty(
          '--drift-x-reverse',
          `${horizontal * -25}px`,
        );
        background.style.setProperty(
          '--drift-y-reverse',
          `${vertical * -20}px`,
        );
      });
    };

    window.addEventListener('pointermove', handlePointerMove, {
      passive: true,
    });

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener('pointermove', handlePointerMove);
    };
  }, []);

  return (
    <div ref={backgroundRef} className="ambient-background" aria-hidden="true">
      <div className="ambient-spotlight" />
      <div className="ambient-orb ambient-orb-one" />
      <div className="ambient-orb ambient-orb-two" />
      <div className="ambient-grid" />
    </div>
  );
}
