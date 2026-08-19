import 'server-only';

import { createHash } from 'node:crypto';

const IMPORT_PAYLOAD_FINGERPRINT_DOMAIN = 'field-atlas:atlas-import:v1\0';

function canonicalize(value: unknown): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Import fingerprints require finite numbers.');
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError('Import fingerprints require plain objects.');
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([first], [second]) =>
          first < second ? -1 : first > second ? 1 : 0,
        )
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  throw new TypeError('Import fingerprints contain an unsupported value.');
}

/**
 * Binds an idempotency key to the complete normalized request that first used
 * it. Object keys are sorted recursively while array order remains meaningful.
 */
export function createAtlasImportPayloadFingerprint(payload: unknown) {
  const canonicalPayload = JSON.stringify(canonicalize(payload));
  return createHash('sha256')
    .update(IMPORT_PAYLOAD_FINGERPRINT_DOMAIN)
    .update(canonicalPayload)
    .digest('hex');
}
