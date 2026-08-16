require('dotenv').config({ path: '.env.local', override: false, quiet: true });

const { get, head, put } = require('@vercel/blob');
const { db } = require('@vercel/postgres');
const sharp = require('sharp');

const THUMBNAIL_MAX_DIMENSION = 1024;
const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;
const THUMBNAIL_QUALITY = 82;
const apply = process.argv.includes('--apply');
const report = process.argv.includes('--report');
const limitArgument = process.argv.find((argument) =>
  argument.startsWith('--limit='),
);
const requestedLimit = limitArgument
  ? Number.parseInt(limitArgument.split('=')[1], 10)
  : null;

function thumbnailPath(row) {
  const originalId = row.storage_path
    .split('/')
    .at(-1)
    ?.match(
      /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(?:jpg|png|webp)$/,
    )?.[1];
  return `atlas/memories/${row.entry_id}/${originalId || row.id}.thumbnail.webp`;
}

function megabytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function reportSavings(client, token) {
  const result = await client.query(`
    SELECT byte_size, thumbnail_path
    FROM atlas_media
    WHERE thumbnail_path IS NOT NULL
    ORDER BY created_at
  `);
  let thumbnailBytes = 0;

  for (const row of result.rows) {
    const thumbnail = await head(row.thumbnail_path, { token });
    thumbnailBytes += thumbnail.size;
  }

  const originalBytes = result.rows.reduce(
    (total, row) => total + Number(row.byte_size),
    0,
  );
  const reduction = originalBytes
    ? Math.round((1 - thumbnailBytes / originalBytes) * 100)
    : 0;
  console.log(
    `Thumbnail report: ${result.rows.length} photos, ${megabytes(originalBytes)} original, ${megabytes(thumbnailBytes)} preview, ${reduction}% smaller.`,
  );
}

async function main() {
  const token =
    process.env.ATLAS_BLOB_READ_WRITE_TOKEN ||
    process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error('ATLAS_BLOB_READ_WRITE_TOKEN is not configured.');
  if (requestedLimit !== null && (!requestedLimit || requestedLimit < 1)) {
    throw new Error('--limit must be a positive integer.');
  }

  const client = await db.connect();
  let failures = 0;
  let completed = 0;

  try {
    if (report) {
      await reportSavings(client, token);
      return;
    }

    const result = await client.query(
      `
        SELECT id, entry_id, storage_path
        FROM atlas_media
        WHERE thumbnail_path IS NULL
        ORDER BY created_at
        ${requestedLimit ? 'LIMIT $1' : ''}
      `,
      requestedLimit ? [requestedLimit] : [],
    );

    console.log(
      `${apply ? 'Backfilling' : 'Dry run found'} ${result.rows.length} photo${result.rows.length === 1 ? '' : 's'} without thumbnails.`,
    );
    if (!apply || !result.rows.length) return;

    for (const [index, row] of result.rows.entries()) {
      const pathname = thumbnailPath(row);
      try {
        const original = await get(row.storage_path, {
          access: 'private',
          token,
          useCache: false,
        });
        if (!original || original.statusCode !== 200) {
          throw new Error('Original blob was not found.');
        }

        const source = Buffer.from(
          await new Response(original.stream).arrayBuffer(),
        );
        const thumbnail = await sharp(source)
          .rotate()
          .resize({
            width: THUMBNAIL_MAX_DIMENSION,
            height: THUMBNAIL_MAX_DIMENSION,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .webp({
            quality: THUMBNAIL_QUALITY,
            effort: 4,
            smartSubsample: true,
          })
          .toBuffer();

        if (!thumbnail.length || thumbnail.length > THUMBNAIL_MAX_BYTES) {
          throw new Error('Generated thumbnail is outside the size policy.');
        }

        await put(pathname, thumbnail, {
          access: 'private',
          token,
          contentType: 'image/webp',
          addRandomSuffix: false,
          allowOverwrite: true,
          maximumSizeInBytes: THUMBNAIL_MAX_BYTES,
          cacheControlMaxAge: 30 * 24 * 60 * 60,
        });

        const updated = await client.query(
          `
            UPDATE atlas_media
            SET thumbnail_path = $1
            WHERE id = $2
              AND thumbnail_path IS NULL
            RETURNING id
          `,
          [pathname, row.id],
        );
        if (!updated.rows[0]) {
          throw new Error('The media row changed during backfill.');
        }

        completed += 1;
        console.log(
          `[${index + 1}/${result.rows.length}] Backfilled ${row.id}.`,
        );
      } catch (error) {
        failures += 1;
        console.error(
          `[${index + 1}/${result.rows.length}] Failed ${row.id}: ${error.message}`,
        );
      }
    }

    console.log(
      `Thumbnail backfill finished: ${completed} completed, ${failures} failed.`,
    );
    if (failures) process.exitCode = 1;
  } finally {
    client.release();
    await db.end();
  }
}

main().catch((error) => {
  console.error(`Thumbnail backfill failed: ${error.message}`);
  process.exitCode = 1;
});
