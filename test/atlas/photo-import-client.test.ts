/**
 * @jest-environment jsdom
 */

import { createHash, webcrypto } from 'node:crypto';

import { parse } from 'exifr';

import {
  ATLAS_IMPORT_PHOTO_LIMITS,
  AtlasImportPhotoError,
  type AnalyzedImportPhoto,
  analyzeAtlasImportPhoto,
  createPreparedImportPhotoObjectUrls,
  prepareAtlasImportPhoto,
  prepareAtlasImportPreview,
} from '@/app/lib/atlas/photo-import-client';

jest.mock('exifr', () => ({
  __esModule: true,
  parse: jest.fn(),
}));

const parseMock = jest.mocked(parse);

type WorkerListener = (event: MessageEvent<unknown> | Event) => void;

class MockHeicWorker {
  static instances: MockHeicWorker[] = [];

  readonly listeners = new Map<string, Set<WorkerListener>>();
  readonly postMessage = jest.fn();
  readonly terminate = jest.fn();

  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    MockHeicWorker.instances.push(this);
  }

  addEventListener(type: string, listener: WorkerListener) {
    const listeners = this.listeners.get(type) ?? new Set<WorkerListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: WorkerListener) {
    this.listeners.get(type)?.delete(listener);
  }

  emitMessage(data: unknown) {
    for (const listener of Array.from(this.listeners.get('message') ?? [])) {
      listener({ data } as MessageEvent<unknown>);
    }
  }

  emitError() {
    for (const listener of Array.from(this.listeners.get('error') ?? [])) {
      listener(new Event('error'));
    }
  }
}

function setAscii(bytes: Uint8Array, value: string, offset: number) {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index);
  }
}

function formatBytes(format: 'heic' | 'jpeg' | 'png' | 'webp') {
  const bytes = new Uint8Array(format === 'heic' ? 64 : 32);
  if (format === 'jpeg') bytes.set([0xff, 0xd8, 0xff, 0xe1]);
  if (format === 'png') {
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (format === 'webp') {
    setAscii(bytes, 'RIFF', 0);
    setAscii(bytes, 'WEBP', 8);
  }
  if (format === 'heic') {
    new DataView(bytes.buffer).setUint32(0, 16);
    setAscii(bytes, 'ftyp', 4);
    setAscii(bytes, 'heic', 8);
  }
  return bytes;
}

function makeFile(
  format: 'heic' | 'jpeg' | 'png' | 'webp',
  {
    name = `photograph.${format}`,
    type = format === 'heic' ? 'image/heic' : `image/${format}`,
    lastModified = 0,
  }: { name?: string; type?: string; lastModified?: number } = {},
) {
  const bytes = formatBytes(format);
  const file = new File([bytes], name, { type, lastModified });

  // Older jsdom Blob implementations do not expose arrayBuffer(). Keep the
  // generated fixture bytes available without checking in a binary fixture.
  Object.defineProperty(file, 'arrayBuffer', {
    configurable: true,
    value: async () => bytes.slice().buffer,
  });
  Object.defineProperty(file, 'slice', {
    configurable: true,
    value: (start = 0, end = bytes.length, contentType = '') => {
      const part = bytes.slice(start, end);
      const blob = new Blob([part], { type: contentType });
      Object.defineProperty(blob, 'arrayBuffer', {
        configurable: true,
        value: async () => part.slice().buffer,
      });
      return blob;
    },
  });
  return { file, bytes };
}

function makeFileWithIntrinsicDimensions(
  format: 'heic' | 'jpeg' | 'png' | 'webp',
  width: number,
  height: number,
) {
  const result = makeFile(format);
  const { bytes } = result;
  const view = new DataView(bytes.buffer);

  if (format === 'jpeg') {
    view.setUint16(4, 2);
    bytes.set([0xff, 0xc0], 6);
    view.setUint16(8, 7);
    bytes[10] = 8;
    view.setUint16(11, height);
    view.setUint16(13, width);
  } else if (format === 'png') {
    setAscii(bytes, 'IHDR', 12);
    view.setUint32(16, width);
    view.setUint32(20, height);
  } else if (format === 'webp') {
    setAscii(bytes, 'VP8X', 12);
    const encodedWidth = width - 1;
    const encodedHeight = height - 1;
    bytes[24] = encodedWidth & 0xff;
    bytes[25] = (encodedWidth >>> 8) & 0xff;
    bytes[26] = (encodedWidth >>> 16) & 0xff;
    bytes[27] = encodedHeight & 0xff;
    bytes[28] = (encodedHeight >>> 8) & 0xff;
    bytes[29] = (encodedHeight >>> 16) & 0xff;
  } else {
    view.setUint32(16, 48);
    setAscii(bytes, 'meta', 20);
    view.setUint32(28, 36);
    setAscii(bytes, 'iprp', 32);
    view.setUint32(36, 28);
    setAscii(bytes, 'ipco', 40);
    view.setUint32(44, 20);
    setAscii(bytes, 'ispe', 48);
    view.setUint32(56, width);
    view.setUint32(60, height);
  }
  return result;
}

function analyzedHeic(file: File): AnalyzedImportPhoto {
  return {
    file,
    name: file.name,
    byteSize: file.size,
    sourceHash: '0'.repeat(64),
    declaredMimeType: 'image/heic',
    format: 'heic',
    isHeic: true,
    canPrepare: true,
    orientation: 6,
    location: null,
    capture: null,
    issues: [],
  };
}

function installCanvas({
  width = 4000,
  height = 3000,
  nativeDecodeFails = false,
} = {}) {
  const close = jest.fn();
  Object.defineProperty(window, 'createImageBitmap', {
    configurable: true,
    value: nativeDecodeFails
      ? jest.fn().mockRejectedValue(new Error('Native decode unavailable.'))
      : jest.fn().mockResolvedValue({ width, height, close }),
  });
  if (nativeDecodeFails) {
    jest.spyOn(window, 'Image').mockImplementation(() => {
      const image = document.createElement('img');
      Object.defineProperties(image, {
        decode: {
          configurable: true,
          value: jest.fn().mockRejectedValue(new Error('Decode rejected.')),
        },
        src: {
          configurable: true,
          set: () => {
            image.dispatchEvent(new Event('error'));
          },
        },
      });
      return image;
    });
  }
  const fillRect = jest.fn();
  const drawImage = jest.fn();
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillStyle: '',
    fillRect,
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  jest
    .spyOn(HTMLCanvasElement.prototype, 'toBlob')
    .mockImplementation((callback, type) => {
      const outputType = type ?? 'image/png';
      callback(
        new Blob(
          [
            outputType === 'image/jpeg'
              ? new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
              : 'prepared',
          ],
          { type: outputType },
        ),
      );
    });
  return { close, drawImage, fillRect };
}

function jpegWithPrivateMetadata() {
  const segment = (marker: number, payload: number[]) =>
    new Uint8Array([0xff, marker, 0, payload.length + 2, ...payload]);
  return new Blob(
    [
      new Uint8Array([0xff, 0xd8]),
      segment(0xe0, [0x4a, 0x46]),
      segment(0xe1, [0x45, 0x78, 0x69, 0x66]),
      segment(0xed, [0x49, 0x50, 0x54, 0x43]),
      segment(0xfe, [0x6e, 0x6f, 0x74, 0x65]),
      new Uint8Array([0xff, 0xda, 0, 2, 0x11, 0x22, 0xff, 0xd9]),
    ],
    { type: 'image/jpeg' },
  );
}

async function blobBytes(blob: Blob) {
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener(
      'load',
      () =>
        reader.result instanceof ArrayBuffer
          ? resolve(new Uint8Array(reader.result))
          : reject(new Error('Blob did not resolve to bytes.')),
      { once: true },
    );
    reader.addEventListener('error', () => reject(reader.error), {
      once: true,
    });
    reader.readAsArrayBuffer(blob);
  });
}

describe('Atlas bulk-import photo preprocessing', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: webcrypto,
    });
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      value: MockHeicWorker,
    });
  });

  beforeEach(() => {
    parseMock.mockReset();
    jest.restoreAllMocks();
  });

  it('extracts signed, accurate GPS and preserves the original local calendar date', async () => {
    const { file, bytes } = makeFile('heic');
    parseMock.mockResolvedValue({
      Orientation: 6,
      DateTimeOriginal: '2023:06:18 11:11:31',
      OffsetTimeOriginal: '-06:00',
      SubSecTimeOriginal: '020',
      GPSLatitudeRef: 'N',
      GPSLatitude: [39, 7, 3.61],
      GPSLongitudeRef: 'W',
      GPSLongitude: [106, 26, 43.48],
      GPSAltitudeRef: new Uint8Array([0]),
      GPSAltitude: 4402.12777284827,
      GPSHPositioningError: 4.591833262441514,
    });

    const analyzed = await analyzeAtlasImportPhoto(file);

    expect(analyzed).toMatchObject({
      format: 'heic',
      isHeic: true,
      canPrepare: true,
      orientation: 6,
      location: {
        latitude: 39.117669444444445,
        longitude: -106.44541111111111,
        accuracyMeters: 4.591833262441514,
        altitudeMeters: 4402.12777284827,
        source: 'exif-gps',
        confidence: 'high',
      },
      capture: {
        localDate: '2023-06-18',
        localDateTime: '2023-06-18T11:11:31.020',
        offset: '-06:00',
        instant: '2023-06-18T17:11:31.020Z',
        source: 'date-time-original',
        confidence: 'high',
      },
      issues: [],
    });
    expect(analyzed.sourceHash).toBe(
      createHash('sha256').update(bytes).digest('hex'),
    );
    expect(parseMock).toHaveBeenCalledWith(
      file,
      expect.objectContaining({
        makerNote: false,
        userComment: false,
        xmp: false,
        iptc: false,
        reviveValues: false,
        gps: {
          pick: expect.arrayContaining([
            'GPSLatitude',
            'GPSLatitudeRef',
            'GPSLongitude',
            'GPSLongitudeRef',
            'GPSHPositioningError',
          ]),
        },
      }),
    );
  });

  it('rejects placeholder and invalid GPS instead of silently plotting it', async () => {
    const zero = makeFile('jpeg').file;
    parseMock.mockResolvedValueOnce({
      DateTimeOriginal: '2024:01:02 12:00:00',
      GPSLatitudeRef: 'N',
      GPSLatitude: [0, 0, 0],
      GPSLongitudeRef: 'E',
      GPSLongitude: [0, 0, 0],
    });
    const zeroResult = await analyzeAtlasImportPhoto(zero);

    expect(zeroResult.location).toBeNull();
    expect(zeroResult.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'zero-zero-location' }),
      ]),
    );

    const invalid = makeFile('jpeg').file;
    parseMock.mockResolvedValueOnce({
      DateTimeOriginal: '2024:01:02 12:00:00',
      GPSLatitudeRef: 'N',
      GPSLatitude: [91, 0, 0],
      GPSLongitudeRef: 'W',
      GPSLongitude: [83, 0, 0],
    });
    const invalidResult = await analyzeAtlasImportPhoto(invalid);

    expect(invalidResult.location).toBeNull();
    expect(invalidResult.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid-location' }),
      ]),
    );
  });

  it('keeps an offset-free EXIF date local and marks file timestamps as low confidence', async () => {
    const exifFile = makeFile('jpeg').file;
    parseMock.mockResolvedValueOnce({
      DateTimeOriginal: '2024:12:31 23:59:58',
      GPSLatitudeRef: 'S',
      GPSLatitude: [12, 30, 0],
      GPSLongitudeRef: 'E',
      GPSLongitude: [130, 0, 0],
    });
    const exifResult = await analyzeAtlasImportPhoto(exifFile);

    expect(exifResult.location).toMatchObject({
      latitude: -12.5,
      longitude: 130,
      confidence: 'medium',
    });
    expect(exifResult.capture).toMatchObject({
      localDate: '2024-12-31',
      localDateTime: '2024-12-31T23:59:58.000',
      offset: null,
      instant: null,
      source: 'date-time-original',
      confidence: 'high',
    });

    const lastModified = new Date(2025, 2, 4, 12).getTime();
    const fallbackFile = makeFile('jpeg', { lastModified }).file;
    parseMock.mockResolvedValueOnce({});
    const fallbackResult = await analyzeAtlasImportPhoto(fallbackFile);
    expect(fallbackResult.capture).toEqual({
      localDate: '2025-03-04',
      localDateTime: null,
      offset: null,
      instant: null,
      source: 'file-last-modified',
      confidence: 'low',
    });
  });

  it('never presents a GPS UTC timestamp as the photographer local date', async () => {
    const lastModified = new Date(2025, 0, 2, 12).getTime();
    const file = makeFile('jpeg', { lastModified }).file;
    parseMock.mockResolvedValueOnce({
      GPSDateStamp: '2025:01:01',
      GPSTimeStamp: [23, 59, 59],
    });

    const analyzed = await analyzeAtlasImportPhoto(file);

    expect(analyzed.capture).toEqual({
      localDate: '2025-01-02',
      localDateTime: null,
      offset: null,
      instant: null,
      source: 'file-last-modified',
      confidence: 'low',
    });
  });

  it('rejects oversized camera metadata before starting a pixel decode', async () => {
    const file = makeFile('heic').file;
    parseMock.mockResolvedValueOnce({
      ExifImageWidth: 8_064,
      ExifImageHeight: 6_048,
    });

    const analyzed = await analyzeAtlasImportPhoto(file);

    expect(analyzed.canPrepare).toBe(false);
    expect(analyzed.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'image-too-large',
          severity: 'error',
        }),
      ]),
    );
    expect(MockHeicWorker.instances).toHaveLength(0);
  });

  it.each(['jpeg', 'png', 'webp', 'heic'] as const)(
    'rejects oversized %s container dimensions before browser decode',
    async (format) => {
      const { file } = makeFileWithIntrinsicDimensions(format, 6_000, 5_000);
      parseMock.mockResolvedValueOnce({});

      const analyzed = await analyzeAtlasImportPhoto(file);

      expect(analyzed.canPrepare).toBe(false);
      expect(analyzed.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'image-too-large',
            severity: 'error',
          }),
        ]),
      );
      expect(MockHeicWorker.instances).toHaveLength(0);
    },
  );

  it('skips legal standalone JPEG markers while preflighting dimensions', async () => {
    const { file, bytes } = makeFileWithIntrinsicDimensions(
      'jpeg',
      6_000,
      5_000,
    );
    bytes.copyWithin(8, 6, 15);
    bytes.set([0xff, 0x01], 6);
    parseMock.mockResolvedValueOnce({});

    const analyzed = await analyzeAtlasImportPhoto(file);

    expect(analyzed.canPrepare).toBe(false);
    expect(analyzed.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'image-too-large' }),
      ]),
    );
  });

  it('trusts file signatures over a mismatched declared MIME type', async () => {
    const { file } = makeFile('png', { type: 'image/jpeg' });
    parseMock.mockResolvedValue({});

    const analyzed = await analyzeAtlasImportPhoto(file);

    expect(analyzed.format).toBe('png');
    expect(analyzed.canPrepare).toBe(true);
    expect(analyzed.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'mime-mismatch' }),
      ]),
    );
  });

  it('keeps ordinary images on the fast path and creates bounded metadata-free derivatives', async () => {
    const { file } = makeFile('jpeg', { type: 'image/jpeg' });
    parseMock.mockResolvedValue({});
    const { close, drawImage, fillRect } = installCanvas();
    const progress: string[] = [];

    const prepared = await prepareAtlasImportPhoto(file, {
      onProgress: ({ stage }) => progress.push(stage),
    });

    expect(MockHeicWorker.instances).toHaveLength(0);
    expect(window.createImageBitmap).toHaveBeenCalledWith(file, {
      imageOrientation: 'from-image',
    });
    expect(prepared.master.type).toBe('image/jpeg');
    expect(prepared.thumbnail.type).toBe('image/jpeg');
    expect(prepared.master.size).toBeLessThanOrEqual(
      ATLAS_IMPORT_PHOTO_LIMITS.masterMaxBytes,
    );
    expect(prepared.thumbnail.size).toBeLessThanOrEqual(
      ATLAS_IMPORT_PHOTO_LIMITS.thumbnailMaxBytes,
    );
    expect(prepared.dimensions).toEqual({
      sourceWidth: 4000,
      sourceHeight: 3000,
      masterWidth: 2560,
      masterHeight: 1920,
      thumbnailWidth: 1024,
      thumbnailHeight: 768,
    });
    expect(progress).toEqual(['analyzing', 'decoding', 'rendering', 'ready']);
    expect(fillRect).toHaveBeenCalledTimes(2);
    expect(drawImage).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('removes EXIF, IPTC, and comment segments retained by mobile WebKit JPEG encoding', async () => {
    const { file } = makeFile('jpeg', { type: 'image/jpeg' });
    parseMock.mockResolvedValue({});
    installCanvas();
    jest
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback) => callback(jpegWithPrivateMetadata()));

    const prepared = await prepareAtlasImportPhoto(file);
    const outputs = await Promise.all([
      blobBytes(prepared.master),
      blobBytes(prepared.thumbnail),
    ]);

    for (const bytes of outputs) {
      const markers = Array.from(bytes)
        .map((value, index) => (value === 0xff ? bytes[index + 1] : null))
        .filter((value): value is number => value !== null);
      expect(markers).toContain(0xe0);
      expect(markers).not.toContain(0xe1);
      expect(markers).not.toContain(0xed);
      expect(markers).not.toContain(0xfe);
      expect(markers).toContain(0xda);
    }
  });

  it('creates one bounded metadata-free review preview without retaining a full-size master', async () => {
    const { file } = makeFile('jpeg', { type: 'image/jpeg' });
    parseMock.mockResolvedValue({});
    const { close, drawImage, fillRect } = installCanvas();
    const analysis = await analyzeAtlasImportPhoto(file);

    const preview = await prepareAtlasImportPreview(file, analysis);

    expect(preview.blob.type).toBe('image/jpeg');
    expect(preview).toMatchObject({ width: 1024, height: 768 });
    expect(window.createImageBitmap).toHaveBeenCalledWith(file, {
      imageOrientation: 'from-image',
    });
    expect(fillRect).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      'image/jpeg',
      expect.any(Number),
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('uses native HEIC decoding for mobile Safari before loading the worker', async () => {
    const { file } = makeFile('heic');
    const { close, drawImage } = installCanvas({
      width: 3024,
      height: 4032,
    });

    const preview = await prepareAtlasImportPreview(file, analyzedHeic(file));

    expect(preview).toMatchObject({ width: 768, height: 1024 });
    expect(window.createImageBitmap).toHaveBeenCalledWith(file, {
      imageOrientation: 'from-image',
    });
    expect(MockHeicWorker.instances).toHaveLength(0);
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('uses the mobile Chrome image load event when decode rejects', async () => {
    const { file } = makeFile('heic');
    const { drawImage } = installCanvas({ nativeDecodeFails: true });
    const image = document.createElement('img');
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 3024 },
      naturalHeight: { configurable: true, value: 4032 },
      decode: {
        configurable: true,
        value: jest.fn().mockRejectedValue(new Error('Decode rejected.')),
      },
      src: {
        configurable: true,
        set: () => {
          image.dispatchEvent(new Event('load'));
        },
      },
    });
    jest.spyOn(window, 'Image').mockImplementation(() => image);
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: jest.fn().mockReturnValue('blob:mobile-heic'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: jest.fn(),
    });

    const preview = await prepareAtlasImportPreview(file, analyzedHeic(file));

    expect(preview).toMatchObject({ width: 768, height: 1024 });
    expect(image.decode).toHaveBeenCalledTimes(1);
    expect(MockHeicWorker.instances).toHaveLength(0);
    expect(drawImage).toHaveBeenCalledTimes(1);
  });

  it('rejects decoded images above the 25 megapixel safety limit', async () => {
    const { file } = makeFile('jpeg');
    parseMock.mockResolvedValue({});
    const { close } = installCanvas({ width: 10_000, height: 6000 });

    await expect(prepareAtlasImportPhoto(file)).rejects.toMatchObject({
      code: 'image-too-large',
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('lazily serializes HEIC workers, transfers unique requests, and resets after a crash', async () => {
    const first = makeFile('heic', { name: 'first.heic' }).file;
    const second = makeFile('heic', { name: 'second.heic' }).file;
    installCanvas({
      width: 3024,
      height: 4032,
      nativeDecodeFails: true,
    });
    const firstProgress: string[] = [];
    const secondProgress: string[] = [];

    const firstPreparation = prepareAtlasImportPhoto(first, {
      analysis: analyzedHeic(first),
      onProgress: ({ stage }) => firstProgress.push(stage),
    });
    const secondPreparation = prepareAtlasImportPhoto(second, {
      analysis: analyzedHeic(second),
      onProgress: ({ stage }) => secondProgress.push(stage),
    });
    await new Promise((resolve) => window.setTimeout(resolve, 10));

    expect(MockHeicWorker.instances).toHaveLength(1);
    const worker = MockHeicWorker.instances[0];
    expect(worker.options).toEqual({
      name: 'field-atlas-heic-decoder',
      type: 'module',
    });
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    const firstRequest = worker.postMessage.mock.calls[0][0] as {
      id: string;
      kind: string;
      file: File;
    };
    expect(firstRequest).toMatchObject({
      kind: 'convert',
      file: first,
    });
    const firstBitmap = { width: 3024, height: 4032, close: jest.fn() };
    worker.emitMessage({
      kind: 'converted',
      id: firstRequest.id,
      bitmap: firstBitmap,
    });
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    const secondRequest = worker.postMessage.mock.calls[1][0] as {
      id: string;
      kind: string;
      file: File;
    };
    expect(secondRequest).toMatchObject({
      kind: 'convert',
      file: second,
    });
    expect(secondRequest.id).not.toBe(firstRequest.id);
    const secondBitmap = { width: 3024, height: 4032, close: jest.fn() };
    worker.emitMessage({
      kind: 'converted',
      id: secondRequest.id,
      bitmap: secondBitmap,
    });
    await Promise.all([firstPreparation, secondPreparation]);

    expect(firstProgress).toContain('converting-heic');
    expect(secondProgress).toContain('converting-heic');
    expect(firstBitmap.close).toHaveBeenCalledTimes(1);
    expect(secondBitmap.close).toHaveBeenCalledTimes(1);

    const failed = makeFile('heic', { name: 'failed.heic' }).file;
    const failedPreparation = prepareAtlasImportPhoto(failed, {
      analysis: analyzedHeic(failed),
    });
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    worker.emitError();

    await expect(failedPreparation).rejects.toMatchObject({
      code: 'decode-failed',
    });
    expect(worker.terminate).toHaveBeenCalledTimes(1);

    const recovered = makeFile('heic', { name: 'recovered.heic' }).file;
    const recoveredPreparation = prepareAtlasImportPhoto(recovered, {
      analysis: analyzedHeic(recovered),
    });
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(MockHeicWorker.instances).toHaveLength(2);
    const recoveredWorker = MockHeicWorker.instances[1];
    const recoveredRequest = recoveredWorker.postMessage.mock.calls[0][0] as {
      id: string;
    };
    recoveredWorker.emitMessage({
      kind: 'converted',
      id: recoveredRequest.id,
      bitmap: { width: 3024, height: 4032, close: jest.fn() },
    });
    await expect(recoveredPreparation).resolves.toMatchObject({
      dimensions: { sourceWidth: 3024, sourceHeight: 4032 },
    });

    jest.useFakeTimers();
    try {
      const timedOut = makeFile('heic', { name: 'timed-out.heic' }).file;
      const timedOutPreparation = prepareAtlasImportPhoto(timedOut, {
        analysis: analyzedHeic(timedOut),
      });
      const timeoutExpectation = expect(
        timedOutPreparation,
      ).rejects.toMatchObject({ code: 'decode-failed' });
      await Promise.resolve();
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(90_000);
      await timeoutExpectation;
      expect(recoveredWorker.terminate).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('creates and idempotently revokes preview object URLs', () => {
    const createObjectURL = jest
      .fn()
      .mockReturnValueOnce('blob:master')
      .mockReturnValueOnce('blob:thumbnail');
    const revokeObjectURL = jest.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
    const urls = createPreparedImportPhotoObjectUrls({
      master: new Blob(['master'], { type: 'image/jpeg' }),
      thumbnail: new Blob(['thumbnail'], { type: 'image/webp' }),
    });

    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(urls).toMatchObject({
      masterUrl: 'blob:master',
      thumbnailUrl: 'blob:thumbnail',
    });
    urls.revoke();
    urls.revoke();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenNthCalledWith(1, 'blob:master');
    expect(revokeObjectURL).toHaveBeenNthCalledWith(2, 'blob:thumbnail');
  });

  it('uses a clear typed error when output cannot meet the upload byte limits', async () => {
    const { file } = makeFile('jpeg');
    parseMock.mockResolvedValue({});
    installCanvas();
    jest
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback, type) => {
        const blob = new Blob(['oversized'], { type: type ?? 'image/png' });
        Object.defineProperty(blob, 'size', {
          configurable: true,
          value:
            type === 'image/jpeg'
              ? ATLAS_IMPORT_PHOTO_LIMITS.masterMaxBytes + 1
              : ATLAS_IMPORT_PHOTO_LIMITS.thumbnailMaxBytes + 1,
        });
        callback(blob);
      });

    await expect(prepareAtlasImportPhoto(file)).rejects.toEqual(
      expect.objectContaining<Partial<AtlasImportPhotoError>>({
        code: 'encode-failed',
      }),
    );
  });
});
