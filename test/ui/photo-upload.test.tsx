/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  deleteAtlasMediaAction,
  discardAtlasMediaUploadAction,
  registerAtlasMediaAction,
} from '@/app/lib/actions/atlas-media';
import { uploadAtlasMedia } from '@/app/lib/atlas/media-upload-client';
import {
  analyzeAtlasImportPhoto,
  prepareAtlasImportPhoto,
} from '@/app/lib/atlas/photo-import-client';
import { MemoryPhotos } from '@/components/atlas/memory-photos';

jest.mock('@/app/lib/atlas/media-upload-client', () => ({
  uploadAtlasMedia: jest.fn(),
}));
jest.mock('@/app/lib/actions/atlas-media', () => ({
  deleteAtlasMediaAction: jest.fn(),
  discardAtlasMediaUploadAction: jest.fn(),
  registerAtlasMediaAction: jest.fn(),
}));
jest.mock('@/app/lib/atlas/photo-import-client', () => ({
  ...jest.requireActual('@/app/lib/atlas/photo-import-client'),
  analyzeAtlasImportPhoto: jest.fn(),
  prepareAtlasImportPhoto: jest.fn(),
}));

describe('photo upload UI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(discardAtlasMediaUploadAction).mockResolvedValue({
      ok: true,
      data: { discarded: true },
    });
  });

  it('prepares, uploads, registers, and returns a valid photo', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    const onBusyChange = jest.fn();
    Object.defineProperty(window.crypto, 'randomUUID', {
      configurable: true,
      value: jest.fn(() => '00000000-0000-4000-8000-000000000001'),
    });
    const source = new File(['photo'], 'kyoto.png', { type: 'image/png' });
    const analysis = {
      file: source,
      name: source.name,
      byteSize: source.size,
      sourceHash: 'source-hash',
      declaredMimeType: source.type,
      format: 'png' as const,
      isHeic: false,
      canPrepare: true,
      orientation: 1,
      location: null,
      capture: null,
      issues: [],
    };
    const master = new Blob(['private-metadata-removed'], {
      type: 'image/jpeg',
    });
    const thumbnail = new Blob(['thumbnail'], { type: 'image/webp' });
    jest.mocked(analyzeAtlasImportPhoto).mockResolvedValue(analysis);
    jest.mocked(prepareAtlasImportPhoto).mockResolvedValue({
      analysis,
      master,
      thumbnail,
      dimensions: {
        sourceWidth: 2400,
        sourceHeight: 1600,
        masterWidth: 1200,
        masterHeight: 800,
        thumbnailWidth: 600,
        thumbnailHeight: 400,
      },
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
      .mocked(uploadAtlasMedia)
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
        onBusyChange={onBusyChange}
      />,
    );

    const input = screen.getByLabelText('Upload photos');
    const uploadInteraction = user.upload(input, source);

    // The thumbnail request starts before the unresolved original finishes.
    await waitFor(() => expect(uploadAtlasMedia).toHaveBeenCalledTimes(2));
    expect(registerAtlasMediaAction).not.toHaveBeenCalled();
    const originalOptions = jest.mocked(uploadAtlasMedia).mock.calls[0][2];
    const thumbnailOptions = jest.mocked(uploadAtlasMedia).mock.calls[1][2];
    const originalPayload = JSON.parse(originalOptions.clientPayload ?? '{}');
    expect(originalPayload).toMatchObject({
      entryId: 'memory-1',
      mediaId: '00000000-0000-4000-8000-000000000001',
    });
    expect(originalPayload).toEqual(
      JSON.parse(thumbnailOptions.clientPayload ?? '{}'),
    );
    expect(jest.mocked(uploadAtlasMedia).mock.calls[0][1]).toBe(master);
    expect(jest.mocked(uploadAtlasMedia).mock.calls[1][1]).toBe(thumbnail);
    resolveOriginal({ pathname: 'atlas/memory-1/photo.png' });
    resolveThumbnail({ pathname: 'atlas/memory-1/photo.thumb.webp' });
    await uploadInteraction;
    await waitFor(() => expect(registerAtlasMediaAction).toHaveBeenCalled());
    expect(registerAtlasMediaAction).toHaveBeenCalledWith(
      expect.objectContaining({
        entryId: 'memory-1',
        mediaId: '00000000-0000-4000-8000-000000000001',
        width: 1200,
        height: 800,
        altText: 'Kyoto at dusk',
      }),
    );
    expect(onChange).toHaveBeenCalledWith([media]);
    expect(onBusyChange).toHaveBeenCalledWith(true);
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
    expect(screen.getByRole('status')).toHaveTextContent(
      '1 photo was added and saved privately.',
    );
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
        onBusyChange={jest.fn()}
      />,
    );

    await user.upload(
      screen.getByLabelText('Upload photos'),
      new File(['notes'], 'notes.txt', { type: 'text/plain' }),
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Choose a JPG, PNG, WebP, HEIC, or HEIF photograph.',
    );
    expect(uploadAtlasMedia).not.toHaveBeenCalled();
  });

  it('preserves the registration error when upload cleanup also fails', async () => {
    const user = userEvent.setup();
    const onBusyChange = jest.fn();
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    Object.defineProperty(window.crypto, 'randomUUID', {
      configurable: true,
      value: jest.fn(() => '00000000-0000-4000-8000-000000000001'),
    });
    const source = new File(['photo'], 'kyoto.png', { type: 'image/png' });
    const analysis = {
      file: source,
      name: source.name,
      byteSize: source.size,
      sourceHash: 'source-hash',
      declaredMimeType: source.type,
      format: 'png' as const,
      isHeic: false,
      canPrepare: true,
      orientation: 1,
      location: null,
      capture: null,
      issues: [],
    };
    jest.mocked(analyzeAtlasImportPhoto).mockResolvedValue(analysis);
    jest.mocked(prepareAtlasImportPhoto).mockResolvedValue({
      analysis,
      master: new Blob(['master'], { type: 'image/jpeg' }),
      thumbnail: new Blob(['thumbnail'], { type: 'image/webp' }),
      dimensions: {
        sourceWidth: 2400,
        sourceHeight: 1600,
        masterWidth: 1200,
        masterHeight: 800,
        thumbnailWidth: 600,
        thumbnailHeight: 400,
      },
    });
    jest
      .mocked(uploadAtlasMedia)
      .mockResolvedValueOnce({ pathname: 'atlas/memory-1/photo.jpg' } as never)
      .mockResolvedValueOnce({
        pathname: 'atlas/memory-1/photo.thumb.webp',
      } as never);
    jest.mocked(registerAtlasMediaAction).mockResolvedValue({
      ok: false,
      error: 'invalid',
      message: 'The photo could not be registered.',
    });
    jest
      .mocked(discardAtlasMediaUploadAction)
      .mockRejectedValue(new Error('cleanup unavailable'));

    render(
      <MemoryPhotos
        entryId="memory-1"
        title="Kyoto at dusk"
        placeLabel="Kyoto, Japan"
        placeName="Kyoto"
        media={[]}
        loading={false}
        onChange={jest.fn()}
        onBusyChange={onBusyChange}
      />,
    );

    await user.upload(screen.getByLabelText('Upload photos'), source);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The photo could not be registered. The uploaded files could not be fully cleaned up. Please try again.',
    );
    expect(discardAtlasMediaUploadAction).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
    expect(screen.getByLabelText('Upload photos')).toBeEnabled();
    consoleError.mockRestore();
  });

  it('recovers and reports an error when photo removal throws', async () => {
    const user = userEvent.setup();
    const onBusyChange = jest.fn();
    const onChange = jest.fn();
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const media = {
      id: 'photo-1',
      entryId: 'memory-1',
      mimeType: 'image/jpeg',
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
      .mocked(deleteAtlasMediaAction)
      .mockRejectedValue(new Error('network down'));

    render(
      <MemoryPhotos
        entryId="memory-1"
        title="Kyoto at dusk"
        placeLabel="Kyoto, Japan"
        placeName="Kyoto"
        media={[media]}
        loading={false}
        onChange={onChange}
        onBusyChange={onBusyChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Remove photo' }));
    await user.click(
      screen.getByRole('button', { name: 'Confirm remove photo' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The photo could not be removed. Please try again.',
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(onBusyChange).toHaveBeenCalledWith(true);
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
    expect(screen.getByRole('button', { name: 'Remove photo' })).toBeEnabled();
    consoleError.mockRestore();
  });
});
