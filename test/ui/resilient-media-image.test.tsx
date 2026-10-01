/**
 * @jest-environment jsdom
 */

/* eslint-disable @next/next/no-img-element */

import { fireEvent, render, screen } from '@testing-library/react';

import { ResilientMediaImage } from '@/components/atlas/resilient-media-image';

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({
    fill: _fill,
    unoptimized: _unoptimized,
    alt,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & {
    fill?: boolean;
    unoptimized?: boolean;
  }) => <img alt={alt ?? ''} {...props} />,
}));

describe('ResilientMediaImage', () => {
  it('preserves a meaningful accessible name when media fails', () => {
    render(
      <div style={{ position: 'relative', width: 200, height: 120 }}>
        <ResilientMediaImage
          src="/missing.jpg"
          alt="Fog over the valley"
          fill
          unoptimized
          fallback={<div aria-hidden="true">Fallback artwork</div>}
        />
      </div>,
    );

    fireEvent.error(screen.getByRole('img'));

    expect(
      screen.getByRole('img', {
        name: 'Fog over the valley — photo unavailable',
      }),
    ).toHaveAttribute('data-media-image-fallback', 'true');
  });

  it('keeps decorative fallbacks out of the accessibility tree', () => {
    const { container } = render(
      <div style={{ position: 'relative', width: 200, height: 120 }}>
        <ResilientMediaImage
          src="/decorative-missing.jpg"
          alt=""
          fill
          unoptimized
          fallback={<div>Decorative fallback</div>}
        />
      </div>,
    );

    fireEvent.error(container.querySelector('img')!);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-media-image-fallback="true"]'),
    ).toHaveAttribute('aria-hidden', 'true');
  });

  it('tries a new source after the previous source failed', () => {
    const view = render(
      <div style={{ position: 'relative', width: 200, height: 120 }}>
        <ResilientMediaImage
          src="/first-missing.jpg"
          alt="Trail photograph"
          fill
          unoptimized
          fallback={<div aria-hidden="true">Fallback artwork</div>}
        />
      </div>,
    );
    fireEvent.error(screen.getByRole('img'));

    view.rerender(
      <div style={{ position: 'relative', width: 200, height: 120 }}>
        <ResilientMediaImage
          src="/second.jpg"
          alt="Trail photograph"
          fill
          unoptimized
          fallback={<div aria-hidden="true">Fallback artwork</div>}
        />
      </div>,
    );

    expect(screen.getByRole('img')).toHaveAttribute('src', '/second.jpg');
  });
});
