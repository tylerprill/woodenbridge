/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { upload } from '@vercel/blob/client';

import { registerAtlasMediaAction } from '@/app/lib/actions/atlas-media';
import { MemoryPhotos } from '@/components/atlas/memory-photos';

jest.mock('@vercel/blob/client', () => ({ upload: jest.fn() }));
jest.mock('@/app/lib/actions/atlas-media', () => ({
  deleteAtlasMediaAction: jest.fn(),
  discardAtlasMediaUploadAction: jest.fn(),
  registerAtlasMediaAction: jest.fn(),
}));

describe('photo upload UI', () => {
  it('prepares, uploads, registers, and returns a valid photo', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    const close = jest.fn();
    Object.defineProperty(window, 'createImageBitmap', {
      configurable: true,
      value: jest.fn().mockResolvedValue({ width: 1200, height: 800, close }),
    });
    Object.defineProperty(window.crypto, 'randomUUID', {
      configurable: true,
      value: jest.fn(() => '00000000-0000-4000-8000-000000000001'),
    });
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: jest.fn(),
    } as unknown as CanvasRenderingContext2D);
    jest
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback) => {
        callback(new Blob(['thumbnail'], { type: 'image/webp' }));
      });
    let resolveOriginal!: (value: { pathname: string }) => void;
    let resolveThumbnail!: (value: { pathname: string }) => void;
    const originalUpload = new Promise<{ pathname: string }>((resolve) => {
      resolveOriginal = resolve;
    });
    const thumbnailUpload = new Promise<{ pathname: string }>((resolve) => {
      resolveThumbnail = resolve;
    });
    jest
      .mocked(upload)
      .mockImplementationOnce(() => originalUpload as never)
      .mockImplementationOnce(() => thumbnailUpload as never);
    const media = {
      id: 'photo-1',
      entryId: 'memory-1',
      mimeType: 'image/png',
      width: 1200,
      height: 800,
      byteSize: 5,
      altText: 'Kyoto at dusk',
      sortOrder: 0,
      createdAt: '2026-08-17T12:00:00.000Z',
      deliveryUrl: '/api/atlas/media/photo-1',
      thumbnailUrl: '/api/atlas/media/photo-1?variant=thumbnail',
    };
    jest
      .mocked(registerAtlasMediaAction)
      .mockResolvedValue({ ok: true, data: media });

    render(
      <MemoryPhotos
        entryId="memory-1"
        title="Kyoto at dusk"
        placeLabel="Kyoto, Japan"
        placeName="Kyoto"
        media={[]}
        loading={false}
        onChange={onChange}
      />,
    );

    const input = screen.getByLabelText('Add photos');
    const uploadInteraction = user.upload(
      input,
      new File(['photo'], 'kyoto.png', { type: 'image/png' }),
    );

    // The thumbnail request starts before the unresolved original finishes.
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    expect(registerAtlasMediaAction).not.toHaveBeenCalled();
    resolveOriginal({ pathname: 'atlas/memory-1/photo.png' });
    resolveThumbnail({ pathname: 'atlas/memory-1/photo.thumb.webp' });
    await uploadInteraction;
    await waitFor(() => expect(registerAtlasMediaAction).toHaveBeenCalled());
    expect(registerAtlasMediaAction).toHaveBeenCalledWith(
      expect.objectContaining({
        entryId: 'memory-1',
        width: 1200,
        height: 800,
        altText: 'Kyoto at dusk',
      }),
    );
    expect(onChange).toHaveBeenCalledWith([media]);
    expect(close).toHaveBeenCalled();
  });

  it('rejects unsupported files before any upload begins', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(
      <MemoryPhotos
        entryId="memory-1"
        title="Memory"
        placeLabel="Place"
        placeName={null}
        media={[]}
        loading={false}
        onChange={jest.fn()}
      />,
    );

    await user.upload(
      screen.getByLabelText('Add photos'),
      new File(['notes'], 'notes.txt', { type: 'text/plain' }),
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Choose a JPG, PNG, or WebP image.',
    );
    expect(upload).not.toHaveBeenCalled();
  });
});
