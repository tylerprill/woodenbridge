import 'server-only';

export function getAtlasBlobToken() {
  const token = process.env.ATLAS_BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error('ATLAS_BLOB_READ_WRITE_TOKEN is not configured.');
  }
  return token;
}
