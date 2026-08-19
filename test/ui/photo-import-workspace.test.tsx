/**
 * @jest-environment jsdom
 */

/* eslint-disable @next/next/no-img-element */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { upload } from '@vercel/blob/client';
import {
  cancelAtlasImportBatchAction,
  createAtlasImportBatchAction,
  finalizeAtlasImportBatchAction,
  prepareAtlasImportItemAction,
  resolveAtlasImportPlaceAction,
} from '@/app/lib/actions/atlas-import';
import {
  getAtlasImportMediaPairStatusAction,
  registerAtlasMediaAction,
} from '@/app/lib/actions/atlas-media';
import type {
  AtlasImportBatch,
  CreateAtlasImportBatchInput,
} from '@/app/lib/atlas/import-definitions';
import {
  analyzeAtlasImportPhoto,
  prepareAtlasImportPhoto,
  prepareAtlasImportPreview,
} from '@/app/lib/atlas/photo-import-client';
import { PhotoImportWorkspace } from '@/components/atlas/photo-import-workspace';

const mockPush = jest.fn();
const mockRefresh = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({
    fill: _fill,
    priority: _priority,
    unoptimized: _unoptimized,
    alt,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & {
    fill?: boolean;
    priority?: boolean;
    unoptimized?: boolean;
  }) => <img alt={alt ?? ''} {...props} />,
}));

jest.mock('@/components/atlas/atlas-map-loader', () => ({
  __esModule: true,
  default: ({
    placementMode,
    onPlace,
    onViewChange,
  }: {
    placementMode?: boolean;
    onPlace: (coordinates: { latitude: number; longitude: number }) => void;
    onViewChange: (view: {
      latitude: number;
      longitude: number;
      zoom: number;
      bearing: number;
      pitch: number;
    }) => void;
  }) => (
    <div data-testid="atlas-map">
      Journey map
      {placementMode ? (
        <>
          <button
            type="button"
            onClick={() => onPlace({ latitude: 43.4203, longitude: -82.8297 })}
          >
            Place Michigan pin
          </button>
          <button
            type="button"
            onClick={() => onPlace({ latitude: 35.0116, longitude: 135.7681 })}
          >
            Place Kyoto pin
          </button>
          <button
            type="button"
            onClick={() =>
              onViewChange({
                latitude: 35.0116,
                longitude: 135.7681,
                zoom: 8,
                bearing: 0,
                pitch: 0,
              })
            }
          >
            Move map center to Kyoto
          </button>
        </>
      ) : null}
    </div>
  ),
}));

jest.mock('@vercel/blob/client', () => ({ upload: jest.fn() }));

jest.mock('@/app/lib/actions/atlas-import', () => ({
  cancelAtlasImportBatchAction: jest.fn(),
  createAtlasImportBatchAction: jest.fn(),
  finalizeAtlasImportBatchAction: jest.fn(),
  prepareAtlasImportItemAction: jest.fn(),
  resolveAtlasImportPlaceAction: jest.fn(),
}));

jest.mock('@/app/lib/actions/atlas-media', () => ({
  getAtlasImportMediaPairStatusAction: jest.fn(),
  registerAtlasMediaAction: jest.fn(),
}));

jest.mock('@/app/lib/atlas/photo-import-client', () => {
  const actual = jest.requireActual('@/app/lib/atlas/photo-import-client');
  return {
    ...actual,
    analyzeAtlasImportPhoto: jest.fn(),
    prepareAtlasImportPhoto: jest.fn(),
    prepareAtlasImportPreview: jest.fn(),
  };
});

const NOW = '2026-08-18T12:00:00.000Z';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function successfulPlace({
  placeName,
  locality,
  region,
  country,
  countryCode,
}: {
  placeName: string;
  locality: string | null;
  region: string | null;
  country: string;
  countryCode: string;
}) {
  return {
    ok: true as const,
    data: {
      placeName,
      locality,
      region,
      country,
      countryCode,
      geocoder: 'test',
      geocodedAt: NOW,
    },
  };
}

function analyzedPhoto(file: File) {
  return {
    file,
    name: file.name,
    byteSize: file.size,
    sourceHash: `hash-${file.name}`,
    declaredMimeType: 'image/jpeg',
    format: 'jpeg' as const,
    isHeic: false,
    canPrepare: true,
    orientation: 1,
    location: {
      latitude: 39.1176695,
      longitude: -106.4454117,
      accuracyMeters: 5,
      altitudeMeters: null,
      source: 'exif-gps' as const,
      confidence: 'high' as const,
    },
    capture: {
      localDate: '2023-06-18',
      localDateTime: '2023-06-18T11:11:31',
      offset: '-06:00',
      instant: '2023-06-18T17:11:31.000Z',
      source: 'date-time-original' as const,
      confidence: 'high' as const,
    },
    issues: [],
  };
}

function analyzedFileDatePhoto(file: File) {
  return {
    ...analyzedPhoto(file),
    capture: {
      localDate: '2024-06-18',
      localDateTime: null,
      offset: null,
      instant: null,
      source: 'file-last-modified' as const,
      confidence: 'low' as const,
    },
  };
}

function preparedPhoto(file: File) {
  const analysis = analyzedPhoto(file);
  return {
    analysis,
    master: new Blob([`master-${file.name}`], { type: 'image/jpeg' }),
    thumbnail: new Blob([`thumbnail-${file.name}`], { type: 'image/jpeg' }),
    dimensions: {
      sourceWidth: 3024,
      sourceHeight: 4032,
      masterWidth: 1920,
      masterHeight: 2560,
      thumbnailWidth: 768,
      thumbnailHeight: 1024,
    },
  };
}

function batchFromInput(input: CreateAtlasImportBatchInput): AtlasImportBatch {
  return {
    id: 'batch-1',
    clientRequestId: input.clientRequestId,
    status: 'uploading',
    version: 1,
    chapterTitle: input.chapterTitle,
    chapterIntroduction: input.chapterIntroduction,
    coverClientItemId: input.coverClientItemId,
    items: input.items.map((item, index) => ({
      ...item,
      id: `item-${index + 1}`,
      entryId: `entry-${index + 1}`,
      mediaId: `media-${index + 1}`,
      position: index,
      status: 'pending',
      placeSource: 'geocoder',
      pathname: `atlas/entry-${index + 1}/media-${index + 1}.jpg`,
      thumbnailPathname: `atlas/entry-${index + 1}/media-${index + 1}.thumb.webp`,
      thumbnailUrl: null,
      uploadedAt: null,
    })),
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
  };
}

function recoveredBatch(status: 'uploading' | 'ready'): AtlasImportBatch {
  const input: CreateAtlasImportBatchInput = {
    clientRequestId: '00000000-0000-4000-8000-000000000099',
    chapterTitle: 'Above the tree line',
    chapterIntroduction: 'A recovered chapter.',
    coverClientItemId: 'client-recovered-2',
    items: [
      {
        clientItemId: 'client-recovered',
        latitude: 39.1176695,
        longitude: -106.4454117,
        title: 'Clouds over the pass',
        description: '',
        placeLabel: 'Black Cloud Trail, Colorado',
        placeName: 'Black Cloud Trail',
        placeLocality: null,
        placeRegion: 'Colorado',
        placeCountry: 'United States',
        placeCountryCode: 'US',
        placeGeocoder: 'test',
        placeGeocodedAt: NOW,
        visitedOn: '2023-06-18',
        locationSource: 'photo_gps',
        dateSource: 'photo_metadata',
        dateConfirmed: true,
        sourceName: 'clouds.jpg',
        sourceMimeType: 'image/jpeg',
        sourceByteSize: 5,
        sourceHash: 'hash-clouds.jpg',
        sourceWidth: 3024,
        sourceHeight: 4032,
        mediaWidth: 1920,
        mediaHeight: 2560,
        preparedByteSize: 6,
        thumbnailByteSize: 9,
      },
      {
        clientItemId: 'client-recovered-2',
        latitude: 35.0116,
        longitude: 135.7681,
        title: 'Lanterns after rain',
        description: '',
        placeLabel: 'Kyoto, Japan',
        placeName: 'Kyoto',
        placeLocality: 'Kyoto',
        placeRegion: null,
        placeCountry: 'Japan',
        placeCountryCode: 'JP',
        placeGeocoder: 'test',
        placeGeocodedAt: NOW,
        visitedOn: '2023-06-21',
        locationSource: 'photo_gps',
        dateSource: 'photo_metadata',
        dateConfirmed: true,
        sourceName: 'kyoto.jpg',
        sourceMimeType: 'image/jpeg',
        sourceByteSize: 5,
        sourceHash: 'hash-kyoto.jpg',
        sourceWidth: 3024,
        sourceHeight: 4032,
        mediaWidth: 1920,
        mediaHeight: 2560,
        preparedByteSize: 6,
        thumbnailByteSize: 9,
      },
    ],
  };
  return {
    ...batchFromInput(input),
    id: 'batch-recovered',
    version: 4,
    status,
    items: batchFromInput(input).items.map((item) => ({
      ...item,
      status: status === 'ready' ? 'uploaded' : 'pending',
      uploadedAt: status === 'ready' ? NOW : null,
    })),
  };
}

function installSuccessfulBackend() {
  jest
    .mocked(analyzeAtlasImportPhoto)
    .mockImplementation(async (file) => analyzedPhoto(file));
  jest
    .mocked(prepareAtlasImportPhoto)
    .mockImplementation(async (file, options) => {
      options?.onProgress?.({
        stage: 'rendering',
        percent: 70,
        message: `Preparing ${file.name}`,
      });
      return preparedPhoto(file);
    });
  jest.mocked(prepareAtlasImportPreview).mockImplementation(async (file) => ({
    blob: new Blob([`preview-${file.name}`], { type: 'image/webp' }),
    width: 768,
    height: 1024,
  }));
  jest.mocked(resolveAtlasImportPlaceAction).mockResolvedValue({
    ok: true,
    data: {
      placeName: 'Black Cloud Trail',
      locality: null,
      region: 'Colorado',
      country: 'United States',
      countryCode: 'US',
      geocoder: 'test',
      geocodedAt: NOW,
    },
  });
  jest
    .mocked(createAtlasImportBatchAction)
    .mockImplementation(async (input) => ({
      ok: true,
      data: batchFromInput(input),
    }));
  jest.mocked(prepareAtlasImportItemAction).mockResolvedValue({
    ok: true,
    data: { batchId: 'batch-1', itemId: 'item-1', prepared: true },
  });
  jest.mocked(upload).mockImplementation(async (pathname, _blob, options) => {
    options.onUploadProgress?.({
      loaded: 1,
      total: 1,
      percentage: 100,
    });
    return { pathname } as never;
  });
  jest.mocked(registerAtlasMediaAction).mockResolvedValue({
    ok: true,
    data: {
      id: 'media-1',
      entryId: 'entry-1',
      mimeType: 'image/jpeg',
      width: 1920,
      height: 2560,
      byteSize: 6,
      altText: 'Memory',
      sortOrder: 0,
      createdAt: NOW,
      deliveryUrl: '/api/atlas/media/media-1',
      thumbnailUrl: '/api/atlas/media/media-1?variant=thumbnail',
    },
  });
  jest.mocked(getAtlasImportMediaPairStatusAction).mockResolvedValue({
    ok: true,
    data: {
      originalCommitted: false,
      thumbnailCommitted: false,
      registered: false,
    },
  });
  jest.mocked(finalizeAtlasImportBatchAction).mockResolvedValue({
    ok: true,
    data: {
      batchId: 'batch-1',
      version: 2,
      entryIds: ['entry-1'],
      chapterId: null,
      shareId: null,
    },
  });
  jest.mocked(cancelAtlasImportBatchAction).mockResolvedValue({
    ok: true,
    data: { batchId: 'batch-1', cleanupPending: true },
  });
}

async function selectPhotos(files: File[]) {
  fireEvent.change(screen.getByLabelText('Choose photos'), {
    target: { files },
  });
  await waitFor(() =>
    expect(
      screen.getByText(
        files.length === 1
          ? '1 photo is ready to review.'
          : `${files.length} photos are ready to review.`,
      ),
    ).toBeVisible(),
  );
}

async function reachStories(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Find the journey' }));
  expect(
    screen.getByRole('heading', {
      level: 1,
      name: 'See where the journey took shape.',
    }),
  ).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Tell the stories' }));
  expect(
    screen.getByRole('heading', {
      level: 1,
      name: 'Give every place its voice.',
    }),
  ).toBeVisible();
}

async function titleCurrentStory(
  user: ReturnType<typeof userEvent.setup>,
  title: string,
) {
  const input = screen.getByRole('textbox', { name: /^Title/ });
  await user.clear(input);
  await user.type(input, title);
}

describe('bulk photo import workspace', () => {
  let uuidNumber = 0;

  beforeEach(() => {
    jest.resetAllMocks();
    uuidNumber = 0;
    Object.defineProperty(window.crypto, 'randomUUID', {
      configurable: true,
      value: jest.fn(
        () =>
          `00000000-0000-4000-8000-${String(++uuidNumber).padStart(12, '0')}`,
      ),
    });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: jest.fn((file: File) => `blob:${file.name}`),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: jest.fn(),
    });
    installSuccessfulBackend();
  });

  it('takes one selected photo through review and creates a memory without a chapter step', async () => {
    const user = userEvent.setup();
    render(<PhotoImportWorkspace />);

    await selectPhotos([
      new File(['summit'], 'summit.jpg', { type: 'image/jpeg' }),
    ]);
    expect(
      screen.getByRole('button', { name: 'Remove summit.jpg' }),
    ).toBeVisible();
    await reachStories(user);
    await titleCurrentStory(user, 'Clouds over the pass');

    expect(
      screen.queryByRole('button', { name: /Shape the chapter/i }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create memory' }));

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Your atlas has a new memory.' }),
      ).toBeVisible(),
    );
    expect(createAtlasImportBatchAction).toHaveBeenCalledWith(
      expect.objectContaining({
        chapterTitle: '',
        chapterIntroduction: '',
        items: [
          expect.objectContaining({
            title: 'Clouds over the pass',
            placeLabel: 'Black Cloud Trail, Colorado',
            locationSource: 'photo_gps',
            dateSource: 'photo_metadata',
          }),
        ],
      }),
    );
    expect(finalizeAtlasImportBatchAction).toHaveBeenCalledWith(
      expect.objectContaining({ createChapter: false, coverMediaId: null }),
    );
  });

  it('blocks finalization until a filesystem fallback date is explicitly accepted', async () => {
    const user = userEvent.setup();
    jest
      .mocked(analyzeAtlasImportPhoto)
      .mockImplementation(async (file) => analyzedFileDatePhoto(file));
    render(<PhotoImportWorkspace />);

    await selectPhotos([
      new File(['summit'], 'summit.jpg', { type: 'image/jpeg' }),
    ]);
    await reachStories(user);
    await titleCurrentStory(user, 'Clouds over the pass');
    const confirmDate = screen.getByRole('button', { name: 'Use this date' });
    await user.click(screen.getByRole('button', { name: 'Create memory' }));

    expect(createAtlasImportBatchAction).not.toHaveBeenCalled();
    expect(confirmDate).toHaveFocus();
    expect(
      screen.getByText(/Confirm this low-confidence file date/i),
    ).toBeVisible();
    await user.click(confirmDate);
    expect(screen.queryByRole('button', { name: 'Use this date' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Create memory' }));

    await waitFor(() =>
      expect(createAtlasImportBatchAction).toHaveBeenCalled(),
    );
    expect(
      jest.mocked(createAtlasImportBatchAction).mock.calls[0][0].items[0],
    ).toMatchObject({
      visitedOn: '2024-06-18',
      dateSource: 'file_date',
      dateConfirmed: true,
    });
  });

  it('blocks advancing an individual file-date memory until its date is accepted', async () => {
    const user = userEvent.setup();
    jest
      .mocked(analyzeAtlasImportPhoto)
      .mockImplementation(async (file) => analyzedFileDatePhoto(file));
    render(<PhotoImportWorkspace />);

    await selectPhotos([
      new File(['first'], 'first.jpg', { type: 'image/jpeg' }),
      new File(['second'], 'second.jpg', { type: 'image/jpeg' }),
    ]);
    await reachStories(user);
    await titleCurrentStory(user, 'First light');
    await user.click(screen.getByRole('button', { name: 'Next memory' }));

    expect(screen.getByText('Memory 1 of 2')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Use this date' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Use this date' }));
    await user.click(screen.getByRole('button', { name: 'Next memory' }));
    expect(screen.getByText('Memory 2 of 2')).toBeVisible();
  });

  it.each([
    ['photo metadata', 'photo_metadata', null],
    ['a manually edited date', 'manual', '2025-02-03'],
    ['an intentionally missing date', 'missing', ''],
  ] as const)(
    'allows %s to continue without file-date confirmation',
    async (_label, expectedSource, replacement) => {
      const user = userEvent.setup();
      if (replacement !== null) {
        jest
          .mocked(analyzeAtlasImportPhoto)
          .mockImplementation(async (file) => analyzedFileDatePhoto(file));
      }
      render(<PhotoImportWorkspace />);

      await selectPhotos([
        new File(['summit'], 'summit.jpg', { type: 'image/jpeg' }),
      ]);
      await reachStories(user);
      await titleCurrentStory(user, 'Clouds over the pass');
      if (replacement !== null) {
        fireEvent.change(screen.getByLabelText('Date visited'), {
          target: { value: replacement },
        });
      }
      expect(
        screen.queryByRole('button', { name: 'Use this date' }),
      ).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Create memory' }));

      await waitFor(() =>
        expect(createAtlasImportBatchAction).toHaveBeenCalled(),
      );
      expect(
        jest.mocked(createAtlasImportBatchAction).mock.calls[0][0].items[0]
          .dateSource,
      ).toBe(expectedSource);
    },
  );

  it('keeps the same idempotency key when batch creation is retried', async () => {
    const user = userEvent.setup();
    jest
      .mocked(createAtlasImportBatchAction)
      .mockResolvedValueOnce({
        ok: false,
        error: 'failed',
        message: 'The private draft could not be opened. Try again.',
      })
      .mockImplementation(async (input) => ({
        ok: true,
        data: batchFromInput(input),
      }));
    render(<PhotoImportWorkspace />);

    await selectPhotos([
      new File(['summit'], 'summit.jpg', { type: 'image/jpeg' }),
    ]);
    await reachStories(user);
    await titleCurrentStory(user, 'Clouds over the pass');
    await user.click(screen.getByRole('button', { name: 'Create memory' }));

    expect(
      await screen.findByText(
        'The private draft could not be opened. Try again.',
      ),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Create memory' }));

    await waitFor(() =>
      expect(createAtlasImportBatchAction).toHaveBeenCalledTimes(2),
    );
    const firstRequest = jest.mocked(createAtlasImportBatchAction).mock
      .calls[0][0];
    const secondRequest = jest.mocked(createAtlasImportBatchAction).mock
      .calls[1][0];
    expect(firstRequest.clientRequestId).toBe(secondRequest.clientRequestId);
    expect(firstRequest.items[0].clientItemId).toBe(
      secondRequest.items[0].clientItemId,
    );
  });

  it('prepares and registers each photo before preparing the next one', async () => {
    const user = userEvent.setup();
    const events: string[] = [];
    jest.mocked(prepareAtlasImportPhoto).mockImplementation(async (file) => {
      events.push(`prepare:${file.name}`);
      return preparedPhoto(file);
    });
    jest.mocked(upload).mockImplementation(async (pathname) => {
      events.push(`upload:${pathname}`);
      return { pathname } as never;
    });
    jest.mocked(registerAtlasMediaAction).mockImplementation(async (input) => {
      events.push(`register:${input.mediaId}`);
      return {
        ok: true,
        data: {
          id: input.mediaId,
          entryId: input.entryId,
          mimeType: 'image/jpeg',
          width: input.width,
          height: input.height,
          byteSize: 6,
          altText: input.altText,
          sortOrder: 0,
          createdAt: NOW,
          deliveryUrl: `/api/atlas/media/${input.mediaId}`,
          thumbnailUrl: `/api/atlas/media/${input.mediaId}?variant=thumbnail`,
        },
      };
    });
    render(<PhotoImportWorkspace />);

    await selectPhotos([
      new File(['first'], 'first.jpg', { type: 'image/jpeg' }),
      new File(['second'], 'second.jpg', { type: 'image/jpeg' }),
    ]);
    await reachStories(user);
    await titleCurrentStory(user, 'First light');
    await user.click(screen.getByRole('button', { name: 'Next memory' }));
    await titleCurrentStory(user, 'The path home');
    await user.click(screen.getByRole('button', { name: 'Shape the chapter' }));

    expect(
      screen.getByRole('textbox', { name: /^Chapter title/ }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Create memories only' }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', {
        name: 'Create 2 memories and 1 chapter',
      }),
    ).toBeDisabled();
    await user.click(
      screen.getByRole('button', { name: 'Create memories only' }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Your atlas has a new memory.' }),
      ).toBeVisible(),
    );
    expect(events.indexOf('prepare:first.jpg')).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('register:media-1')).toBeGreaterThan(
      events.findIndex((event) => event.includes('entry-1/media-1.thumb.webp')),
    );
    expect(events.indexOf('prepare:second.jpg')).toBeGreaterThan(
      events.indexOf('register:media-1'),
    );
    expect(events.indexOf('register:media-2')).toBeGreaterThan(
      events.indexOf('prepare:second.jpg'),
    );
    expect(finalizeAtlasImportBatchAction).toHaveBeenCalledWith(
      expect.objectContaining({ createChapter: false }),
    );
  });

  it('persists the selected chapter cover identity through creation and finalization', async () => {
    const user = userEvent.setup();
    render(<PhotoImportWorkspace />);

    await selectPhotos([
      new File(['first'], 'first.jpg', { type: 'image/jpeg' }),
      new File(['second'], 'second.jpg', { type: 'image/jpeg' }),
    ]);
    await reachStories(user);
    await titleCurrentStory(user, 'First light');
    await user.click(screen.getByRole('button', { name: 'Next memory' }));
    await titleCurrentStory(user, 'Lanterns after rain');
    await user.click(screen.getByRole('button', { name: 'Shape the chapter' }));
    await user.click(
      screen.getByRole('button', {
        name: 'Use Lanterns after rain as chapter cover',
      }),
    );
    await user.type(
      screen.getByRole('textbox', { name: /^Chapter title/ }),
      'A road through light',
    );
    await user.click(
      screen.getByRole('button', {
        name: 'Create 2 memories and 1 chapter',
      }),
    );

    await waitFor(() =>
      expect(createAtlasImportBatchAction).toHaveBeenCalled(),
    );
    const input = jest.mocked(createAtlasImportBatchAction).mock.calls[0][0];
    expect(input.coverClientItemId).toBe(input.items[1].clientItemId);
    await waitFor(() =>
      expect(finalizeAtlasImportBatchAction).toHaveBeenCalledWith(
        expect.objectContaining({
          createChapter: true,
          coverMediaId: 'media-2',
        }),
      ),
    );
  });

  it('preserves the private draft and retries a failed upload without recreating the batch', async () => {
    const user = userEvent.setup();
    jest
      .mocked(upload)
      .mockRejectedValueOnce(new Error('Connection lost during upload.'))
      .mockRejectedValueOnce(new Error('Connection lost during upload.'))
      .mockImplementation(async (pathname) => ({ pathname }) as never);
    render(<PhotoImportWorkspace />);

    await selectPhotos([
      new File(['summit'], 'summit.jpg', { type: 'image/jpeg' }),
    ]);
    await reachStories(user);
    await titleCurrentStory(user, 'Clouds over the pass');
    await user.click(screen.getByRole('button', { name: 'Create memory' }));

    expect(
      await screen.findByText('Connection lost during upload.'),
    ).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Connection lost during upload.',
    );
    await user.click(screen.getByRole('button', { name: 'Create memory' }));

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Your atlas has a new memory.' }),
      ).toBeVisible(),
    );
    expect(createAtlasImportBatchAction).toHaveBeenCalledTimes(1);
    expect(prepareAtlasImportPhoto).toHaveBeenCalledTimes(2);
    expect(finalizeAtlasImportBatchAction).toHaveBeenCalledTimes(1);
  });

  it('keeps multi-photo memories-only creation retryable after the private batch locks', async () => {
    const user = userEvent.setup();
    jest
      .mocked(upload)
      .mockRejectedValueOnce(new Error('Connection lost during upload.'))
      .mockRejectedValueOnce(new Error('Connection lost during upload.'))
      .mockImplementation(async (pathname) => ({ pathname }) as never);
    render(<PhotoImportWorkspace />);

    await selectPhotos([
      new File(['first'], 'first.jpg', { type: 'image/jpeg' }),
      new File(['second'], 'second.jpg', { type: 'image/jpeg' }),
    ]);
    await reachStories(user);
    await titleCurrentStory(user, 'First light');
    await user.click(screen.getByRole('button', { name: 'Next memory' }));
    await titleCurrentStory(user, 'The road home');
    await user.click(screen.getByRole('button', { name: 'Shape the chapter' }));
    const memoriesOnly = screen.getByRole('button', {
      name: 'Create memories only',
    });

    await user.click(memoriesOnly);
    expect(
      await screen.findByText('Connection lost during upload.'),
    ).toBeVisible();
    expect(memoriesOnly).toBeEnabled();
    expect(
      screen.queryByRole('button', {
        name: 'Create 2 memories and 1 chapter',
      }),
    ).not.toBeInTheDocument();
    await user.click(memoriesOnly);

    await waitFor(() =>
      expect(finalizeAtlasImportBatchAction).toHaveBeenCalledWith(
        expect.objectContaining({ createChapter: false }),
      ),
    );
    expect(createAtlasImportBatchAction).toHaveBeenCalledTimes(1);
  });

  it('keeps a locked chapter retryable without offering memories-only finalization', async () => {
    const user = userEvent.setup();
    jest
      .mocked(upload)
      .mockRejectedValueOnce(new Error('Connection lost during upload.'))
      .mockRejectedValueOnce(new Error('Connection lost during upload.'))
      .mockImplementation(async (pathname) => ({ pathname }) as never);
    render(<PhotoImportWorkspace />);

    await selectPhotos([
      new File(['first'], 'first.jpg', { type: 'image/jpeg' }),
      new File(['second'], 'second.jpg', { type: 'image/jpeg' }),
    ]);
    await reachStories(user);
    await titleCurrentStory(user, 'First light');
    await user.click(screen.getByRole('button', { name: 'Next memory' }));
    await titleCurrentStory(user, 'The road home');
    await user.click(screen.getByRole('button', { name: 'Shape the chapter' }));
    await user.type(
      screen.getByRole('textbox', { name: /^Chapter title/ }),
      'Two roads north',
    );
    const createChapter = screen.getByRole('button', {
      name: 'Create 2 memories and 1 chapter',
    });

    await user.click(createChapter);
    expect(
      await screen.findByText('Connection lost during upload.'),
    ).toBeVisible();
    expect(createChapter).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: 'Create memories only' }),
    ).not.toBeInTheDocument();
    await user.click(createChapter);

    await waitFor(() =>
      expect(finalizeAtlasImportBatchAction).toHaveBeenCalledWith(
        expect.objectContaining({
          createChapter: true,
          coverMediaId: 'media-1',
        }),
      ),
    );
    expect(createAtlasImportBatchAction).toHaveBeenCalledTimes(1);
  });

  it('finishes a ready recovered chapter without asking for original files again', async () => {
    const user = userEvent.setup();
    jest.mocked(finalizeAtlasImportBatchAction).mockResolvedValue({
      ok: true,
      data: {
        batchId: 'batch-recovered',
        version: 5,
        entryIds: ['entry-1'],
        chapterId: 'chapter-recovered',
        shareId: 'share-recovered',
      },
    });
    render(<PhotoImportWorkspace recoveredBatch={recoveredBatch('ready')} />);

    expect(
      screen.getByRole('heading', {
        name: 'An interrupted private import is waiting.',
      }),
    ).toBeVisible();
    expect(screen.queryByLabelText('Choose photos')).not.toBeInTheDocument();
    expect(screen.getByText('Lanterns after rain')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Finish journey' }));

    await waitFor(() =>
      expect(finalizeAtlasImportBatchAction).toHaveBeenCalledWith({
        batchId: 'batch-recovered',
        version: 4,
        createChapter: true,
        coverMediaId: 'media-2',
      }),
    );
    expect(mockPush).toHaveBeenCalledWith(
      '/dashboard/chapters/chapter-recovered',
    );
  });

  it('clears an incomplete recovered draft before accepting another selection', async () => {
    const user = userEvent.setup();
    jest.mocked(cancelAtlasImportBatchAction).mockResolvedValue({
      ok: true,
      data: { batchId: 'batch-recovered', cleanupPending: true },
    });
    render(
      <PhotoImportWorkspace recoveredBatch={recoveredBatch('uploading')} />,
    );

    expect(screen.queryByLabelText('Choose photos')).not.toBeInTheDocument();
    expect(
      screen.getByText(/original files are not retained by the browser/i),
    ).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: 'Clear private draft' }),
    );

    await waitFor(() =>
      expect(cancelAtlasImportBatchAction).toHaveBeenCalledWith({
        batchId: 'batch-recovered',
        version: 4,
      }),
    );
    expect(screen.getByLabelText('Choose photos')).toBeVisible();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('exposes progress, removal, and leave confirmation with named accessible controls', async () => {
    const user = userEvent.setup();
    render(<PhotoImportWorkspace />);

    expect(
      screen.getByRole('navigation', { name: 'Photo import progress' }),
    ).toBeVisible();
    await selectPhotos([
      new File(['summit'], 'summit.jpg', { type: 'image/jpeg' }),
    ]);
    expect(
      screen.getByRole('button', { name: 'Remove summit.jpg' }),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Leave import' }));

    const dialog = screen.getByRole('alertdialog', {
      name: 'Your unfinished review will close.',
    });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'Keep working' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });

  it('uses the last rapidly selected pin and replaces every detected place field together', async () => {
    const user = userEvent.setup();
    render(<PhotoImportWorkspace />);

    await selectPhotos([
      new File(['summit'], 'summit.jpg', { type: 'image/jpeg' }),
    ]);
    const michigan = deferred<ReturnType<typeof successfulPlace>>();
    const kyoto = deferred<ReturnType<typeof successfulPlace>>();
    jest
      .mocked(resolveAtlasImportPlaceAction)
      .mockImplementation(({ latitude }) =>
        latitude === 43.4203 ? michigan.promise : kyoto.promise,
      );

    await user.click(screen.getByRole('button', { name: 'Find the journey' }));
    await user.click(screen.getByRole('button', { name: 'Review pin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Place Michigan pin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Place Kyoto pin' }));

    await act(async () => {
      kyoto.resolve(
        successfulPlace({
          placeName: 'Kyoto',
          locality: 'Kyoto',
          region: null,
          country: 'Japan',
          countryCode: 'JP',
        }),
      );
      await kyoto.promise;
    });
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: /choose where|black cloud/i }),
      ).not.toBeInTheDocument(),
    );
    await act(async () => {
      michigan.resolve(
        successfulPlace({
          placeName: 'Sandusky',
          locality: 'Sandusky',
          region: 'Michigan',
          country: 'United States',
          countryCode: 'US',
        }),
      );
      await michigan.promise;
    });

    await user.click(screen.getByRole('button', { name: 'Tell the stories' }));
    expect(screen.getByRole('textbox', { name: /^Place/ })).toHaveValue(
      'Kyoto, Japan',
    );
    await titleCurrentStory(user, 'Lantern light');
    await user.click(screen.getByRole('button', { name: 'Create memory' }));

    await waitFor(() =>
      expect(createAtlasImportBatchAction).toHaveBeenCalled(),
    );
    expect(
      jest.mocked(createAtlasImportBatchAction).mock.calls[0][0].items[0],
    ).toMatchObject({
      latitude: 35.0116,
      longitude: 135.7681,
      placeLabel: 'Kyoto, Japan',
      placeName: 'Kyoto',
      placeLocality: 'Kyoto',
      placeRegion: null,
      placeCountry: 'Japan',
      placeCountryCode: 'JP',
      locationSource: 'manual',
    });
  });

  it('does not let late background recognition overwrite a pin placed during progressive review', async () => {
    const user = userEvent.setup();
    const originalRecognition = deferred<ReturnType<typeof successfulPlace>>();
    jest
      .mocked(resolveAtlasImportPlaceAction)
      .mockImplementationOnce(() => originalRecognition.promise)
      .mockResolvedValue(
        successfulPlace({
          placeName: 'Sandusky',
          locality: 'Sandusky',
          region: 'Michigan',
          country: 'United States',
          countryCode: 'US',
        }),
      );
    render(<PhotoImportWorkspace />);

    fireEvent.change(screen.getByLabelText('Choose photos'), {
      target: {
        files: [new File(['summit'], 'summit.jpg', { type: 'image/jpeg' })],
      },
    });
    await waitFor(() =>
      expect(resolveAtlasImportPlaceAction).toHaveBeenCalledTimes(1),
    );
    const continueButton = screen.getByRole('button', {
      name: 'Find the journey',
    });
    await waitFor(() => expect(continueButton).toBeEnabled());
    await user.click(continueButton);
    await user.click(screen.getByRole('button', { name: 'Review pin' }));
    await user.click(
      screen.getByRole('button', { name: 'Place Michigan pin' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );

    await act(async () => {
      originalRecognition.resolve(
        successfulPlace({
          placeName: 'Black Cloud Trail',
          locality: null,
          region: 'Colorado',
          country: 'United States',
          countryCode: 'US',
        }),
      );
      await originalRecognition.promise;
    });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Tell the stories' }),
      ).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Tell the stories' }));
    expect(screen.getByRole('textbox', { name: /^Place/ })).toHaveValue(
      'Sandusky, Michigan',
    );
  });

  it('preserves a traveler-edited place label while refreshing the pin and structured place', async () => {
    const user = userEvent.setup();
    render(<PhotoImportWorkspace />);

    await selectPhotos([
      new File(['summit'], 'summit.jpg', { type: 'image/jpeg' }),
    ]);
    await reachStories(user);
    const placeInput = screen.getByRole('textbox', { name: /^Place/ });
    await user.clear(placeInput);
    await user.type(placeInput, 'Grandma’s favorite overlook');
    jest.mocked(resolveAtlasImportPlaceAction).mockResolvedValue(
      successfulPlace({
        placeName: 'Sandusky',
        locality: 'Sandusky',
        region: 'Michigan',
        country: 'United States',
        countryCode: 'US',
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Review pin' }));
    await user.click(
      screen.getByRole('button', { name: 'Place Michigan pin' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('textbox', { name: /^Place/ })).toHaveValue(
      'Grandma’s favorite overlook',
    );
    await titleCurrentStory(user, 'The overlook');
    await user.click(screen.getByRole('button', { name: 'Create memory' }));

    await waitFor(() =>
      expect(createAtlasImportBatchAction).toHaveBeenCalled(),
    );
    expect(
      jest.mocked(createAtlasImportBatchAction).mock.calls[0][0].items[0],
    ).toMatchObject({
      latitude: 43.4203,
      longitude: -82.8297,
      placeLabel: 'Grandma’s favorite overlook',
      placeName: 'Sandusky',
      placeLocality: 'Sandusky',
      placeRegion: 'Michigan',
      placeCountry: 'United States',
      placeCountryCode: 'US',
      locationSource: 'manual',
    });
  });

  it('clears stale detected place data after a failed move and preserves only a traveler label', async () => {
    const user = userEvent.setup();
    render(<PhotoImportWorkspace />);

    await selectPhotos([
      new File(['summit'], 'summit.jpg', { type: 'image/jpeg' }),
    ]);
    await reachStories(user);
    jest.mocked(resolveAtlasImportPlaceAction).mockResolvedValue({
      ok: false,
      error: 'failed',
      message: 'Atlas could not identify this place.',
    });

    await user.click(screen.getByRole('button', { name: 'Review pin' }));
    await user.click(
      screen.getByRole('button', { name: 'Place Michigan pin' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    const placeInput = screen.getByRole('textbox', { name: /^Place/ });
    expect(placeInput).toHaveValue('');
    await user.type(placeInput, 'The quiet side of town');

    await user.click(screen.getByRole('button', { name: 'Review pin' }));
    await user.click(screen.getByRole('button', { name: 'Place Kyoto pin' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('textbox', { name: /^Place/ })).toHaveValue(
      'The quiet side of town',
    );
    await titleCurrentStory(user, 'Stillness at dusk');
    await user.click(screen.getByRole('button', { name: 'Create memory' }));

    await waitFor(() =>
      expect(createAtlasImportBatchAction).toHaveBeenCalled(),
    );
    expect(
      jest.mocked(createAtlasImportBatchAction).mock.calls[0][0].items[0],
    ).toMatchObject({
      latitude: 35.0116,
      longitude: 135.7681,
      placeLabel: 'The quiet side of town',
      placeName: null,
      placeLocality: null,
      placeRegion: null,
      placeCountry: null,
      placeCountryCode: null,
      placeGeocoder: null,
      placeGeocodedAt: null,
      locationSource: 'manual',
    });
  });

  it('settles a manually moved pin when the location dialog closes mid-lookup', async () => {
    const user = userEvent.setup();
    const recognition = deferred<ReturnType<typeof successfulPlace>>();
    render(<PhotoImportWorkspace />);

    await selectPhotos([
      new File(['summit'], 'summit.jpg', { type: 'image/jpeg' }),
    ]);
    jest
      .mocked(resolveAtlasImportPlaceAction)
      .mockImplementation(() => recognition.promise);
    await user.click(screen.getByRole('button', { name: 'Find the journey' }));
    await user.click(screen.getByRole('button', { name: 'Review pin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Place Michigan pin' }));
    expect(
      await screen.findByRole('button', { name: 'Finding this place…' }),
    ).toBeDisabled();
    await user.click(
      screen.getByRole('button', { name: 'Close location editor' }),
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Pin placed by you')).toBeVisible();
    expect(
      screen.queryByText('Finding city and region'),
    ).not.toBeInTheDocument();
    await act(async () => {
      recognition.resolve(
        successfulPlace({
          placeName: 'Sandusky',
          locality: 'Sandusky',
          region: 'Michigan',
          country: 'United States',
          countryCode: 'US',
        }),
      );
      await recognition.promise;
    });
    expect(screen.getByText('Pin placed by you')).toBeVisible();
  });

  it('offers a keyboard-operable map-center path for photographs without GPS', async () => {
    const user = userEvent.setup();
    jest.mocked(analyzeAtlasImportPhoto).mockImplementation(async (file) => ({
      ...analyzedPhoto(file),
      location: null,
      issues: [
        {
          code: 'missing-location',
          severity: 'info',
          message: 'No location was embedded in this photograph.',
        },
      ],
    }));
    jest.mocked(resolveAtlasImportPlaceAction).mockResolvedValue(
      successfulPlace({
        placeName: 'Kyoto',
        locality: 'Kyoto',
        region: null,
        country: 'Japan',
        countryCode: 'JP',
      }),
    );
    render(<PhotoImportWorkspace />);

    await selectPhotos([
      new File(['kyoto'], 'kyoto.jpg', { type: 'image/jpeg' }),
    ]);
    await user.click(screen.getByRole('button', { name: 'Find the journey' }));
    await user.click(screen.getByRole('button', { name: 'Choose place' }));
    const moveCenter = screen.getByRole('button', {
      name: 'Move map center to Kyoto',
    });
    moveCenter.focus();
    await user.keyboard('{Enter}');
    const useCenter = screen.getByRole('button', { name: 'Use map center' });
    useCenter.focus();
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(resolveAtlasImportPlaceAction).toHaveBeenCalledWith({
        latitude: 35.0116,
        longitude: 135.7681,
      }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('protects browser Back while leaving modified and middle-click navigation native', async () => {
    window.history.replaceState({}, '', '/dashboard/import');
    render(<PhotoImportWorkspace />);
    await selectPhotos([
      new File(['summit'], 'summit.jpg', { type: 'image/jpeg' }),
    ]);

    window.history.pushState({}, '', '/dashboard/places');
    fireEvent.popState(window);
    expect(
      await screen.findByRole('alertdialog', {
        name: 'Your unfinished review will close.',
      }),
    ).toBeVisible();
    expect(window.location.pathname).toBe('/dashboard/import');
    fireEvent.click(screen.getByRole('button', { name: 'Keep working' }));

    const anchor = document.createElement('a');
    anchor.href = '/dashboard/places';
    anchor.textContent = 'My places';
    const observedAtTarget: boolean[] = [];
    anchor.addEventListener('click', (event) => {
      observedAtTarget.push(event.defaultPrevented);
      event.preventDefault();
    });
    document.body.append(anchor);
    anchor.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 0,
        ctrlKey: true,
      }),
    );
    anchor.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 1,
      }),
    );

    expect(observedAtTarget).toEqual([false, false]);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    anchor.remove();
  });

  it('opens a 50-photo review while bounded previews and place names continue progressively', async () => {
    const user = userEvent.setup();
    const firstPreview = deferred<{
      blob: Blob;
      width: number;
      height: number;
    }>();
    const place = deferred<ReturnType<typeof successfulPlace>>();
    jest
      .mocked(prepareAtlasImportPreview)
      .mockImplementationOnce(() => firstPreview.promise)
      .mockImplementation(async (file) => ({
        blob: new Blob([`preview-${file.name}`], { type: 'image/webp' }),
        width: 768,
        height: 1024,
      }));
    jest
      .mocked(resolveAtlasImportPlaceAction)
      .mockImplementation(() => place.promise);
    render(<PhotoImportWorkspace />);
    const files = Array.from(
      { length: 50 },
      (_, index) =>
        new File([`photo-${index}`], `photo-${index}.jpg`, {
          type: 'image/jpeg',
        }),
    );

    fireEvent.change(screen.getByLabelText('Choose photos'), {
      target: { files },
    });
    await waitFor(() =>
      expect(analyzeAtlasImportPhoto).toHaveBeenCalledTimes(50),
    );
    const continueButton = screen.getByRole('button', {
      name: 'Find the journey',
    });
    await waitFor(() => expect(continueButton).toBeEnabled());
    await user.click(continueButton);

    expect(
      screen.getByRole('heading', {
        name: 'See where the journey took shape.',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Finishing photo review…' }),
    ).toBeDisabled();
    await waitFor(() =>
      expect(prepareAtlasImportPreview).toHaveBeenCalledTimes(1),
    );
    expect(URL.createObjectURL).not.toHaveBeenCalled();

    await act(async () => {
      firstPreview.resolve({
        blob: new Blob(['preview-first'], { type: 'image/webp' }),
        width: 768,
        height: 1024,
      });
      place.resolve(
        successfulPlace({
          placeName: 'Black Cloud Trail',
          locality: null,
          region: 'Colorado',
          country: 'United States',
          countryCode: 'US',
        }),
      );
      await Promise.all([firstPreview.promise, place.promise]);
    });
    await waitFor(() =>
      expect(prepareAtlasImportPreview).toHaveBeenCalledTimes(50),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Tell the stories' }),
      ).toBeEnabled(),
    );
    const previewSources = jest
      .mocked(URL.createObjectURL)
      .mock.calls.map(([source]) => source);
    expect(previewSources).toHaveLength(50);
    for (const source of previewSources) expect(files).not.toContain(source);
  });

  it('re-sorts the full journey when earlier photographs are added later', async () => {
    jest.mocked(analyzeAtlasImportPhoto).mockImplementation(async (file) => {
      const analysis = analyzedPhoto(file);
      const early = file.name === 'early.jpg';
      analysis.capture = {
        ...analysis.capture!,
        localDate: early ? '2021-04-02' : '2024-09-18',
        localDateTime: early ? '2021-04-02T08:00:00' : '2024-09-18T08:00:00',
        instant: early
          ? '2021-04-02T12:00:00.000Z'
          : '2024-09-18T12:00:00.000Z',
      };
      return analysis;
    });
    render(<PhotoImportWorkspace />);

    await selectPhotos([
      new File(['late'], 'late.jpg', { type: 'image/jpeg' }),
    ]);
    fireEvent.change(screen.getByLabelText('Add more photos'), {
      target: {
        files: [new File(['early'], 'early.jpg', { type: 'image/jpeg' })],
      },
    });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Remove early.jpg' }),
      ).toBeVisible(),
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Add more photos')).toBeEnabled(),
    );

    expect(
      screen
        .getAllByRole('button', { name: /^Remove / })
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Remove early.jpg', 'Remove late.jpg']);
  });

  it('keeps nearby coordinate cells distinct at the server five-decimal precision', async () => {
    const user = userEvent.setup();
    jest.mocked(analyzeAtlasImportPhoto).mockImplementation(async (file) => {
      const analysis = analyzedPhoto(file);
      analysis.location = {
        ...analysis.location!,
        latitude: file.name === 'west.jpg' ? 42.00011 : 42.00042,
        longitude: -83.00011,
      };
      return analysis;
    });
    jest
      .mocked(resolveAtlasImportPlaceAction)
      .mockImplementation(async ({ latitude }) =>
        successfulPlace(
          latitude === 42.00011
            ? {
                placeName: 'Westfield',
                locality: 'Westfield',
                region: 'Michigan',
                country: 'United States',
                countryCode: 'US',
              }
            : {
                placeName: 'Eastfield',
                locality: 'Eastfield',
                region: 'Michigan',
                country: 'United States',
                countryCode: 'US',
              },
        ),
      );
    render(<PhotoImportWorkspace />);

    await selectPhotos([
      new File(['west'], 'west.jpg', { type: 'image/jpeg' }),
      new File(['east'], 'east.jpg', { type: 'image/jpeg' }),
    ]);
    await user.click(screen.getByRole('button', { name: 'Find the journey' }));

    expect(resolveAtlasImportPlaceAction).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole('heading', { level: 3, name: 'Westfield, Michigan' }),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { level: 3, name: 'Eastfield, Michigan' }),
    ).toBeVisible();
  });

  it('retries a short server-directed place limit while enriching distinct locations', async () => {
    const user = userEvent.setup();
    jest.mocked(analyzeAtlasImportPhoto).mockImplementation(async (file) => {
      const analysis = analyzedPhoto(file);
      if (file.name === 'kyoto.jpg') {
        analysis.location = {
          ...analysis.location!,
          latitude: 35.0116,
          longitude: 135.7681,
        };
      }
      return analysis;
    });
    jest
      .mocked(resolveAtlasImportPlaceAction)
      .mockResolvedValueOnce(
        successfulPlace({
          placeName: 'Sandusky',
          locality: 'Sandusky',
          region: 'Michigan',
          country: 'United States',
          countryCode: 'US',
        }),
      )
      .mockResolvedValueOnce({
        ok: false,
        error: 'limit',
        message: 'Atlas is pacing place lookups.',
        retryAfterMs: 1,
      })
      .mockResolvedValueOnce(
        successfulPlace({
          placeName: 'Kyoto',
          locality: 'Kyoto',
          region: null,
          country: 'Japan',
          countryCode: 'JP',
        }),
      );
    render(<PhotoImportWorkspace />);

    await selectPhotos([
      new File(['michigan'], 'michigan.jpg', { type: 'image/jpeg' }),
      new File(['kyoto'], 'kyoto.jpg', { type: 'image/jpeg' }),
    ]);
    await user.click(screen.getByRole('button', { name: 'Find the journey' }));

    expect(resolveAtlasImportPlaceAction).toHaveBeenCalledTimes(3);
    expect(
      screen.getByRole('heading', { level: 3, name: 'Sandusky, Michigan' }),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { level: 3, name: 'Kyoto, Japan' }),
    ).toBeVisible();
  });

  it('does not retry an hourly place limit and guides the traveler to name the place', async () => {
    const user = userEvent.setup();
    jest.mocked(resolveAtlasImportPlaceAction).mockResolvedValue({
      ok: false,
      error: 'limit',
      message: 'The hourly place lookup limit has been reached.',
    });
    render(<PhotoImportWorkspace />);

    await selectPhotos([
      new File(['summit'], 'summit.jpg', { type: 'image/jpeg' }),
    ]);
    await user.click(screen.getByRole('button', { name: 'Find the journey' }));

    expect(resolveAtlasImportPlaceAction).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(
        'The hourly place lookup limit has been reached. You can still name this place yourself.',
      ),
    ).toBeVisible();
  });

  it('opens a batch circuit after three provider outages instead of retrying every photograph', async () => {
    const files = Array.from(
      { length: 5 },
      (_, index) =>
        new File([`outage-${index}`], `outage-${index}.jpg`, {
          type: 'image/jpeg',
        }),
    );
    jest.mocked(analyzeAtlasImportPhoto).mockImplementation(async (file) => {
      const analysis = analyzedPhoto(file);
      const index = Number(file.name.match(/\d+/)?.[0] ?? 0);
      analysis.location = {
        ...analysis.location!,
        latitude: 39 + index * 0.01,
        longitude: -106 - index * 0.01,
      };
      return analysis;
    });
    jest.mocked(resolveAtlasImportPlaceAction).mockResolvedValue({
      ok: false,
      error: 'provider',
      message: 'The place service needs another moment.',
      retryAfterMs: 1,
    });
    render(<PhotoImportWorkspace />);

    fireEvent.change(screen.getByLabelText('Choose photos'), {
      target: { files },
    });

    await waitFor(() =>
      expect(resolveAtlasImportPlaceAction).toHaveBeenCalledTimes(6),
    );
    expect(
      await screen.findByText(
        '5 photos are ready. Place recognition is temporarily paused. Every pin is safe; name places yourself or try them again later.',
      ),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Find the journey' }),
    ).toBeEnabled();

    await userEvent.click(
      screen.getByRole('button', { name: 'Find the journey' }),
    );
    expect(
      screen.getAllByText(
        /You can still name this place yourself|Every pin is safe/,
      ),
    ).toHaveLength(5);
  });

  it('probes a retry and uploads only the missing sibling after an upload response is lost', async () => {
    const user = userEvent.setup();
    jest
      .mocked(upload)
      .mockRejectedValueOnce(new Error('Original response was lost.'))
      .mockRejectedValueOnce(new Error('Thumbnail upload failed.'))
      .mockImplementation(async (pathname) => ({ pathname }) as never);
    jest.mocked(getAtlasImportMediaPairStatusAction).mockResolvedValue({
      ok: true,
      data: {
        originalCommitted: true,
        thumbnailCommitted: false,
        registered: false,
      },
    });
    render(<PhotoImportWorkspace />);

    await selectPhotos([
      new File(['summit'], 'summit.jpg', { type: 'image/jpeg' }),
    ]);
    await reachStories(user);
    await titleCurrentStory(user, 'Clouds over the pass');
    await user.click(screen.getByRole('button', { name: 'Create memory' }));
    expect(
      await screen.findByText('Original response was lost.'),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Create memory' }));
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Your atlas has a new memory.' }),
      ).toBeVisible(),
    );
    expect(getAtlasImportMediaPairStatusAction).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(3);
    expect(jest.mocked(upload).mock.calls[2][0]).toMatch(/\.thumbnail\.jpg$/);
    expect(registerAtlasMediaAction).toHaveBeenCalledTimes(1);
  });
});
