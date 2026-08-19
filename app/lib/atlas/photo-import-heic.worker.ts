import { heicTo } from 'heic-to/csp';

export type AtlasHeicWorkerRequest = {
  kind: 'convert';
  id: string;
  file: Blob;
};

export type AtlasHeicWorkerResponse =
  | {
      kind: 'converted';
      id: string;
      bitmap: ImageBitmap;
    }
  | {
      kind: 'failed';
      id: string;
    };

type AtlasHeicWorkerScope = {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  postMessage(
    message: AtlasHeicWorkerResponse,
    transfer?: Transferable[],
  ): void;
};

const workerScope = globalThis as unknown as AtlasHeicWorkerScope;

function isRequest(value: unknown): value is AtlasHeicWorkerRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<AtlasHeicWorkerRequest>;
  return (
    request.kind === 'convert' &&
    typeof request.id === 'string' &&
    request.id.length > 0 &&
    request.file instanceof Blob
  );
}

workerScope.addEventListener('message', (event) => {
  if (!isRequest(event.data)) return;
  const { file, id } = event.data;

  void (async () => {
    let bitmap: ImageBitmap | null = null;
    try {
      // The CSP build avoids unsafe-eval. Asking for a bitmap keeps all
      // libheif decoding off the main thread and avoids an intermediate JPEG.
      bitmap = await heicTo({ blob: file, type: 'bitmap' });
      workerScope.postMessage({ kind: 'converted', id, bitmap }, [bitmap]);
      bitmap = null;
    } catch {
      workerScope.postMessage({ kind: 'failed', id });
    } finally {
      bitmap?.close();
    }
  })();
});
