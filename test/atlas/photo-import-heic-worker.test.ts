/**
 * @jest-environment node
 */

jest.mock('heic-to/csp', () => ({
  __esModule: true,
  heicTo: jest.fn(),
}));

describe('Atlas HEIC decoder worker', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('uses the CSP decoder and transfers the decoded bitmap', async () => {
    const listeners: Array<(event: MessageEvent<unknown>) => void> = [];
    const postMessage = jest.fn();
    Object.defineProperties(globalThis, {
      addEventListener: {
        configurable: true,
        value: jest.fn(
          (type: string, candidate: (event: MessageEvent<unknown>) => void) => {
            if (type === 'message') listeners.push(candidate);
          },
        ),
      },
      postMessage: { configurable: true, value: postMessage },
    });
    const bitmap = { width: 4032, height: 3024, close: jest.fn() };
    const { heicTo } = await import('heic-to/csp');
    const heicToMock = heicTo as jest.Mock;
    heicToMock.mockResolvedValue(bitmap as unknown as ImageBitmap);
    await import('@/app/lib/atlas/photo-import-heic.worker');
    const file = new Blob(['heic'], { type: 'image/heic' });

    listeners[0]?.({
      data: { kind: 'convert', id: 'request-1', file },
    } as MessageEvent<unknown>);
    await Promise.resolve();
    await Promise.resolve();

    expect(heicToMock).toHaveBeenCalledWith({
      blob: file,
      type: 'bitmap',
    });
    expect(postMessage).toHaveBeenCalledWith(
      {
        kind: 'converted',
        id: 'request-1',
        bitmap,
      },
      [bitmap],
    );
    expect(bitmap.close).not.toHaveBeenCalled();
  });

  it('returns an opaque failure without leaking decoder internals', async () => {
    const listeners: Array<(event: MessageEvent<unknown>) => void> = [];
    const postMessage = jest.fn();
    Object.defineProperties(globalThis, {
      addEventListener: {
        configurable: true,
        value: jest.fn(
          (type: string, candidate: (event: MessageEvent<unknown>) => void) => {
            if (type === 'message') listeners.push(candidate);
          },
        ),
      },
      postMessage: { configurable: true, value: postMessage },
    });
    const { heicTo } = await import('heic-to/csp');
    const heicToMock = heicTo as jest.Mock;
    heicToMock.mockRejectedValue(new Error('sensitive decoder detail'));
    await import('@/app/lib/atlas/photo-import-heic.worker');

    listeners[0]?.({
      data: {
        kind: 'convert',
        id: 'request-2',
        file: new Blob(['heic'], { type: 'image/heic' }),
      },
    } as MessageEvent<unknown>);
    await Promise.resolve();
    await Promise.resolve();

    expect(postMessage).toHaveBeenCalledWith({
      kind: 'failed',
      id: 'request-2',
    });
  });
});
