require('dotenv').config({ path: '.env', override: false, quiet: true });
require('dotenv').config({ path: '.env.local', override: false, quiet: true });

const { del, put } = require('@vercel/blob');
const { db } = require('@vercel/postgres');
const sharp = require('sharp');
const { randomUUID } = require('node:crypto');

const TARGET_EMAIL = 'prill2ts+woodenbridge-e2e-codex@gmail.com';
const REQUIRED_CONFIRMATION = '--confirm-replace-e2e-atlas';
const APP_URL = 'https://woodenbridge.vercel.app';
const MAX_ORIGINAL_BYTES = 10 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const isApply = process.argv.includes('--apply');
const isConfirmed = process.argv.includes(REQUIRED_CONFIRMATION);

const stops = [
  {
    key: 'rome',
    title: 'Where the Old World Woke',
    description:
      'Rome was barely awake when the first light reached the Colosseum. Delivery vans whispered over the cobbles, swallows cut through the arches, and for a few minutes the amphitheater felt less like a monument than a living piece of the city. I stayed until the stone turned honey-colored and the morning crowds began to gather.',
    placeLabel: 'Rome, Italy',
    placeName: 'Colosseum',
    locality: 'Rome',
    region: 'Lazio',
    country: 'Italy',
    countryCode: 'IT',
    latitude: 41.8902,
    longitude: 12.4922,
    visitedOn: '2025-02-08',
    transition:
      'East across the Mediterranean, marble gave way to sand. Cairo arrived in a wash of horns and desert light.',
    photos: [
      {
        sourceUrl:
          'https://unsplash.com/photos/the-colossion-in-rome-italy-is-one-of-the-worlds-Wo6BHPfVKi8',
        imageUrl:
          'https://images.unsplash.com/photo-1725750978859-707a129ac1c6',
        photographer: 'Spenser Sembrat',
        alt: 'The Colosseum in Rome framed by green foliage and warm morning light',
      },
    ],
  },
  {
    key: 'giza',
    title: 'Stone Against the Desert',
    description:
      'Nothing in Cairo prepares you for the scale of Giza. The pyramids begin as geometry on the horizon, then become weathered mountains with individual stones taller than a person. Near the Sphinx, the wind carried sand across our footprints almost as soon as we made them. Five thousand years suddenly felt less like history and more like a presence.',
    placeLabel: 'Giza, Egypt',
    placeName: 'Giza Pyramid Complex',
    locality: 'Giza',
    region: 'Giza Governorate',
    country: 'Egypt',
    countryCode: 'EG',
    latitude: 29.9792,
    longitude: 31.1342,
    visitedOn: '2025-02-18',
    transition:
      'We followed the old caravan line toward Jordan, trading Cairo traffic for Wadi Musa and a narrow path through red stone.',
    photos: [
      {
        sourceUrl:
          'https://unsplash.com/photos/the-great-pyramid-of-giza-tomb-in-egypt-MoonoldXeqs',
        imageUrl:
          'https://images.unsplash.com/photo-1568322445389-f64ac2515020',
        photographer: 'Alex Azabache',
        alt: 'The Sphinx and pyramids of Giza glowing in warm desert light',
      },
      {
        sourceUrl:
          'https://unsplash.com/photos/the-great-pyramid-of-giza-under-a-clear-blue-sky-QxfnnvoBQcg',
        imageUrl:
          'https://images.unsplash.com/photo-1771142902243-537889394164',
        photographer: 'waa towaw',
        alt: 'The Great Pyramid of Giza rising beneath a clear blue sky',
      },
    ],
  },
  {
    key: 'petra',
    title: 'The Rose-Red Reveal',
    description:
      'The Siq made us earn the first glimpse of Petra. We walked between walls of rippled sandstone until the passage narrowed to a ribbon of light—and then the Treasury appeared, impossibly precise, framed by the canyon. We returned after dark when hundreds of candles softened the façade and every voice dropped to a whisper.',
    placeLabel: 'Wadi Musa, Jordan',
    placeName: 'Petra',
    locality: 'Wadi Musa',
    region: "Ma'an Governorate",
    country: 'Jordan',
    countryCode: 'JO',
    latitude: 30.3285,
    longitude: 35.4444,
    visitedOn: '2025-03-01',
    transition:
      'An overnight flight carried the desert dust east. By dawn in Agra, the horizon had softened into river mist.',
    photos: [
      {
        sourceUrl: 'https://unsplash.com/photos/petra-jordan-yddF8bE4JTc',
        imageUrl:
          'https://images.unsplash.com/photo-1500120194857-62b493650979',
        photographer: 'Joshua Rodriguez',
        alt: 'The Treasury at Petra revealed through the narrow sandstone walls of the Siq',
      },
      {
        sourceUrl:
          'https://unsplash.com/photos/a-group-of-candles-lit-up-in-front-of-a-building-T6X1NkFgkkk',
        imageUrl:
          'https://images.unsplash.com/photo-1635623014846-d8d150a723f4',
        photographer: 'Gabor Koszegi',
        alt: 'Hundreds of candles illuminating the Treasury at Petra after dark',
      },
    ],
  },
  {
    key: 'taj-mahal',
    title: 'Marble at First Light',
    description:
      'At opening time, the Taj Mahal seemed to float above the Yamuna haze. Its marble shifted from blue to blush to bright white as the sun climbed, while the reflecting pool held a second, quieter version below. The perfection is famous; the surprise was how delicate it felt up close—stone lace, flower inlays, and footsteps muted by shoe covers.',
    placeLabel: 'Agra, India',
    placeName: 'Taj Mahal',
    locality: 'Agra',
    region: 'Uttar Pradesh',
    country: 'India',
    countryCode: 'IN',
    latitude: 27.1751,
    longitude: 78.0421,
    visitedOn: '2025-03-15',
    transition:
      'From Agra we kept moving with the sun, across the Bay of Bengal to a temple city being slowly reclaimed by water and roots.',
    photos: [
      {
        sourceUrl:
          'https://unsplash.com/photos/taj-mahal-in-morning-mist-UPbTYGJyBL0',
        imageUrl:
          'https://images.unsplash.com/photo-1742109539243-29d80bba1779',
        photographer: 'Rohit Dey',
        alt: 'The Taj Mahal emerging through pale morning mist in Agra',
      },
      {
        sourceUrl: 'https://unsplash.com/photos/taj-mahal-india-irCAvHP4TrE',
        imageUrl:
          'https://images.unsplash.com/photo-1523980487775-101d70aae2a9',
        photographer: 'Annie Spratt',
        alt: 'The Taj Mahal mirrored in its long reflecting pool',
      },
    ],
  },
  {
    key: 'angkor',
    title: 'Dawn Across the Lotus Pond',
    description:
      'We reached Angkor Wat by tuk-tuk in the dark and waited beside the lotus pond with coffee in paper cups. The five towers appeared first as a black cutout, then doubled in the water as the sky turned violet. Later, inside the galleries, centuries of carved stories ran beneath our fingertips and tree roots buckled the stones nearby.',
    placeLabel: 'Siem Reap, Cambodia',
    placeName: 'Angkor Wat',
    locality: 'Siem Reap',
    region: 'Siem Reap Province',
    country: 'Cambodia',
    countryCode: 'KH',
    latitude: 13.4125,
    longitude: 103.867,
    visitedOn: '2025-04-06',
    transition:
      'The humid temple air followed us north. Beyond Beijing, spring wind moved through the watchtowers like a tide.',
    photos: [
      {
        sourceUrl:
          'https://unsplash.com/photos/angkor-wat-temple-complex-reflected-in-water-_HrqUiLEKtM',
        imageUrl:
          'https://images.unsplash.com/photo-1762270754416-680eb0e60860',
        photographer: 'waa towaw',
        alt: 'Angkor Wat and its towers reflected in still water in Cambodia',
      },
      {
        sourceUrl:
          'https://unsplash.com/photos/angkor-wat-temple-reflected-in-water-at-sunrise-3uCHoO9v7cg',
        imageUrl:
          'https://images.unsplash.com/photo-1779332843563-beec90bdc048',
        photographer: 'Ahmet Yüksek',
        alt: 'Angkor Wat silhouetted against a violet sunrise above the lotus pond',
      },
    ],
  },
  {
    key: 'great-wall',
    title: 'A Wall Without an Edge',
    description:
      'At Mutianyu the Great Wall refused to stay still: it rose, vanished behind a ridge, and surfaced again miles away. We climbed until conversation gave way to breath and the towers looked small behind us. From the highest step we could reach, the wall felt less like a border than a line drawn by human stubbornness across the mountains.',
    placeLabel: 'Beijing, China',
    placeName: 'Mutianyu Great Wall',
    locality: 'Beijing',
    region: 'Beijing Municipality',
    country: 'China',
    countryCode: 'CN',
    latitude: 40.4319,
    longitude: 116.5704,
    visitedOn: '2025-04-22',
    transition:
      'After weeks among ancient stone, Sydney felt almost weightless: salt air, bright ferries, and white sails on blue water.',
    photos: [
      {
        sourceUrl:
          'https://unsplash.com/photos/great-wall-of-china-china-_8EFj6ISA08',
        imageUrl:
          'https://images.unsplash.com/photo-1508804185872-d7badad00f7d',
        photographer: 'Hanson Lu',
        alt: 'The Great Wall of China winding across forested mountain ridges',
      },
      {
        sourceUrl:
          'https://unsplash.com/photos/architectural-photography-of-great-wall-of-china-siy5LCp84AY',
        imageUrl:
          'https://images.unsplash.com/photo-1509624780899-f812439647e4',
        photographer: 'Vincent Guth',
        alt: 'An autumn watchtower and stone steps along the Great Wall of China',
      },
    ],
  },
  {
    key: 'sydney',
    title: 'Sails on the Harbour',
    description:
      'The Opera House changed with every ferry wake and every step around Circular Quay—ship, shell, folded paper, bright white sail. We crossed the harbor at sunset and watched the roof tiles catch the last pink light while the city switched on behind it. It was the youngest wonder on our route and somehow the most playful.',
    placeLabel: 'Sydney, Australia',
    placeName: 'Sydney Opera House',
    locality: 'Sydney',
    region: 'New South Wales',
    country: 'Australia',
    countryCode: 'AU',
    latitude: -33.8568,
    longitude: 151.2153,
    visitedOn: '2025-06-14',
    transition:
      'Then came the longest blue distance of the journey: out across the Pacific to a volcanic island guarded by stone faces.',
    photos: [
      {
        sourceUrl: 'https://unsplash.com/photos/sydney-opera-house-sz8iZG7ZDUM',
        imageUrl: 'https://images.unsplash.com/photo-1558196068-5c45b2104379',
        photographer: 'Quentin Grignet',
        alt: 'The white sails of the Sydney Opera House above the harbor',
      },
    ],
  },
  {
    key: 'rapa-nui',
    title: 'The Long Silence of Rapa Nui',
    description:
      'Ahu Tongariki holds the horizon with fifteen enormous silhouettes, each face turned inland toward the people who raised it. Wind combed the grass, horses wandered the road, and the Pacific seemed to begin in every direction. At sunset the moai became pure shadow, and the island felt farther from everything than any map could explain.',
    placeLabel: 'Rapa Nui, Chile',
    placeName: 'Ahu Tongariki',
    locality: 'Rapa Nui',
    region: 'Valparaíso Region',
    country: 'Chile',
    countryCode: 'CL',
    latitude: -27.1259,
    longitude: -109.2766,
    visitedOn: '2025-08-02',
    transition:
      'We crossed back to the continent and climbed into thinner air, following the Urubamba toward a city hidden above the clouds.',
    photos: [
      {
        sourceUrl: 'https://unsplash.com/photos/moai-easter-island-2Qjk2PfaH3o',
        imageUrl:
          'https://images.unsplash.com/photo-1524536120883-854d2c00bf1f',
        photographer: 'Thomas Griggs',
        alt: 'Moai statues standing in green grass beneath a clouded sky on Rapa Nui',
      },
      {
        sourceUrl:
          'https://unsplash.com/photos/moai-statues-silhouetted-against-a-vibrant-sunset-on-easter-island--duyF-tCnPk',
        imageUrl:
          'https://images.unsplash.com/photo-1773991869210-00689b414c4d',
        photographer: 'Sheila C',
        alt: 'Moai statues silhouetted against a brilliant orange sunset on Rapa Nui',
      },
    ],
  },
  {
    key: 'machu-picchu',
    title: 'City Above the Clouds',
    description:
      'Machu Picchu emerged in pieces: a terrace through the mist, a stone wall wet with rain, then the whole city balanced beneath Huayna Picchu. Llamas grazed where roofs once stood and clouds poured through the saddle like a slow river. The last climb left us soaked and grinning—the kind of tired that makes every color look brighter.',
    placeLabel: 'Machu Picchu, Peru',
    placeName: 'Machu Picchu',
    locality: 'Machu Picchu',
    region: 'Cusco Region',
    country: 'Peru',
    countryCode: 'PE',
    latitude: -13.1631,
    longitude: -72.545,
    visitedOn: '2025-08-24',
    transition:
      'One final flight north brought heat back into the air. In Yucatán, our last road ended at a perfect stone calendar.',
    photos: [
      {
        sourceUrl:
          'https://unsplash.com/photos/machu-picchu-peru-during-daytime-l28V2fyisao',
        imageUrl:
          'https://images.unsplash.com/photo-1578746401323-f997c71f4096',
        photographer: 'Azzedine Rouichi',
        alt: 'The green terraces and stone ruins of Machu Picchu beneath steep Andean peaks',
      },
    ],
  },
  {
    key: 'chichen-itza',
    title: 'A Last Shadow at El Castillo',
    description:
      'We reached Chichén Itzá before the midday heat settled over Yucatán. El Castillo stood in impossible balance—nine terraces, four stairways, and shadows designed to mark the movement of the year. Cicadas filled the spaces between tour groups. We sat beneath a ceiba tree afterward and let ten wonders collapse into one feeling: astonishment that people keep imagining at this scale. The souvenirs that lasted were smaller: sand in a cuff, a rain-softened ticket, and a map crowded with lines that finally felt like ours.',
    placeLabel: 'Yucatán, Mexico',
    placeName: 'Chichén Itzá',
    locality: 'Tinum',
    region: 'Yucatán',
    country: 'Mexico',
    countryCode: 'MX',
    latitude: 20.6843,
    longitude: -88.5678,
    visitedOn: '2025-09-07',
    transition: '',
    photos: [
      {
        sourceUrl: 'https://unsplash.com/photos/chichen-itza-NjdpeYDHNrQ',
        imageUrl:
          'https://images.unsplash.com/photo-1503187680590-525b6e7a793f',
        photographer: 'Jimmy Baum',
        alt: 'El Castillo at Chichén Itzá standing beneath a bright blue Yucatán sky',
      },
    ],
  },
];

function blobToken() {
  const token =
    process.env.ATLAS_BLOB_READ_WRITE_TOKEN ||
    process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error('ATLAS_BLOB_READ_WRITE_TOKEN is not configured.');
  }
  return token;
}

function imageRequestUrl(baseUrl) {
  return `${baseUrl}?auto=format&fit=max&w=2400&q=88`;
}

async function preparePhoto(photo) {
  const response = await fetch(imageRequestUrl(photo.imageUrl), {
    headers: {
      Accept: 'image/jpeg,image/*;q=0.8',
      'User-Agent': 'field-atlas-flagship-chapter/1.0',
    },
  });
  if (!response.ok) {
    throw new Error(
      `Photo download failed (${response.status}) for ${photo.sourceUrl}`,
    );
  }

  const source = Buffer.from(await response.arrayBuffer());
  const original = await sharp(source)
    .rotate()
    .resize({
      width: 2400,
      height: 2400,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  const thumbnail = await sharp(original.data)
    .resize({
      width: 1024,
      height: 1024,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 82, effort: 4, smartSubsample: true })
    .toBuffer();

  if (
    !original.data.length ||
    original.data.length > MAX_ORIGINAL_BYTES ||
    !thumbnail.length ||
    thumbnail.length > MAX_THUMBNAIL_BYTES
  ) {
    throw new Error(
      `Prepared photo is outside the media policy: ${photo.sourceUrl}`,
    );
  }
  if (!original.info.width || !original.info.height) {
    throw new Error(
      `Prepared photo has invalid dimensions: ${photo.sourceUrl}`,
    );
  }

  return {
    original: original.data,
    thumbnail,
    width: original.info.width,
    height: original.info.height,
  };
}

async function uploadPhotos(token, seededStops, uploadedPaths) {
  const total = seededStops.reduce(
    (count, stop) => count + stop.photos.length,
    0,
  );
  let completed = 0;

  for (const stop of seededStops) {
    for (const photo of stop.photos) {
      const prepared = await preparePhoto(photo);
      const originalPath = `atlas/memories/${stop.id}/${photo.id}.jpg`;
      const thumbnailPath = `atlas/memories/${stop.id}/${photo.id}.thumbnail.webp`;

      await put(originalPath, prepared.original, {
        access: 'private',
        token,
        contentType: 'image/jpeg',
        addRandomSuffix: false,
        allowOverwrite: true,
        maximumSizeInBytes: MAX_ORIGINAL_BYTES,
        cacheControlMaxAge: 30 * 24 * 60 * 60,
      });
      uploadedPaths.push(originalPath);
      await put(thumbnailPath, prepared.thumbnail, {
        access: 'private',
        token,
        contentType: 'image/webp',
        addRandomSuffix: false,
        allowOverwrite: true,
        maximumSizeInBytes: MAX_THUMBNAIL_BYTES,
        cacheControlMaxAge: 30 * 24 * 60 * 60,
      });
      uploadedPaths.push(thumbnailPath);

      Object.assign(photo, {
        originalPath,
        thumbnailPath,
        width: prepared.width,
        height: prepared.height,
        byteSize: prepared.original.length,
      });
      completed += 1;
      console.log(
        `[${completed}/${total}] Prepared ${stop.placeName} photograph by ${photo.photographer}.`,
      );
    }
  }
}

async function insertFlagship(client, userId, seededStops, chapter) {
  for (const stop of seededStops) {
    await client.query(
      `
        INSERT INTO atlas_entries (
          id, user_id, client_request_id, title, description, place_label,
          place_name, place_locality, place_region, place_country,
          place_country_code, place_geocoder, place_geocoded_at, visited_on,
          record_state, journey_state, location, version
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'curated', NOW(),
          $12::date, 'saved', 'visited',
          ST_SetSRID(ST_MakePoint($13, $14), 4326)::geography, 1
        )
      `,
      [
        stop.id,
        userId,
        stop.clientRequestId,
        stop.title,
        stop.description,
        stop.placeLabel,
        stop.placeName,
        stop.locality,
        stop.region,
        stop.country,
        stop.countryCode,
        stop.visitedOn,
        stop.longitude,
        stop.latitude,
      ],
    );

    for (const [sortOrder, photo] of stop.photos.entries()) {
      await client.query(
        `
          INSERT INTO atlas_media (
            id, entry_id, user_id, storage_path, thumbnail_path, mime_type,
            width, height, byte_size, alt_text, sort_order
          )
          VALUES ($1, $2, $3, $4, $5, 'image/jpeg', $6, $7, $8, $9, $10)
        `,
        [
          photo.id,
          stop.id,
          userId,
          photo.originalPath,
          photo.thumbnailPath,
          photo.width,
          photo.height,
          photo.byteSize,
          photo.alt,
          sortOrder,
        ],
      );
    }
  }

  await client.query(
    `
      INSERT INTO atlas_chapters (
        id, user_id, title, introduction, cover_media_id, visibility, share_id,
        share_map, share_location_precision, version
      )
      VALUES ($1, $2, $3, $4, $5, 'shared', $6, TRUE, 'exact', 1)
    `,
    [
      chapter.id,
      userId,
      chapter.title,
      chapter.introduction,
      chapter.coverMediaId,
      chapter.shareId,
    ],
  );

  for (const [position, stop] of seededStops.entries()) {
    const transitionFromPrevious =
      position === 0 ? '' : seededStops[position - 1].transition;
    await client.query(
      `
        INSERT INTO atlas_chapter_entries (
          chapter_id, entry_id, user_id, position, transition_note
        )
        VALUES ($1, $2, $3, $4, $5)
      `,
      [chapter.id, stop.id, userId, position, transitionFromPrevious],
    );
  }
}

async function main() {
  const client = await db.connect();
  let token;
  let uploadedPaths = [];

  try {
    const userResult = await client.query(
      `
        SELECT id, first_name, last_name, email, role, email_verified_at
        FROM users
        WHERE email = $1
        LIMIT 1
      `,
      [TARGET_EMAIL],
    );
    const user = userResult.rows[0];
    if (!user || !user.email_verified_at) {
      throw new Error('The verified Codex E2E account was not found.');
    }

    const [entryCount, chapterCount, mediaResult] = await Promise.all([
      client.query(
        'SELECT COUNT(*)::int AS count FROM atlas_entries WHERE user_id = $1',
        [user.id],
      ),
      client.query(
        'SELECT COUNT(*)::int AS count FROM atlas_chapters WHERE user_id = $1',
        [user.id],
      ),
      client.query(
        `
          SELECT storage_path, thumbnail_path
          FROM atlas_media
          WHERE user_id = $1
        `,
        [user.id],
      ),
    ]);
    const oldBlobPaths = mediaResult.rows.flatMap((row) =>
      [row.storage_path, row.thumbnail_path].filter(Boolean),
    );

    console.log(
      `Target: ${user.first_name} ${user.last_name} <${user.email}> (${user.role}).`,
    );
    console.log(
      `Current atlas: ${entryCount.rows[0].count} memories, ${chapterCount.rows[0].count} chapters, ${mediaResult.rowCount} media records, ${oldBlobPaths.length} blob objects.`,
    );
    console.log(
      `Flagship atlas: ${stops.length} memories and ${stops.reduce((count, stop) => count + stop.photos.length, 0)} photographs.`,
    );

    if (!isApply) {
      console.log(
        `Dry run only. Use --apply ${REQUIRED_CONFIRMATION} to replace this account's atlas.`,
      );
      return;
    }
    if (!isConfirmed) {
      throw new Error(
        `Refusing to replace data without ${REQUIRED_CONFIRMATION}.`,
      );
    }

    token = blobToken();
    const seededStops = stops.map((stop) => ({
      ...stop,
      id: randomUUID(),
      clientRequestId: randomUUID(),
      photos: stop.photos.map((photo) => ({ ...photo, id: randomUUID() })),
    }));
    const coverPhoto = seededStops
      .find((stop) => stop.key === 'rapa-nui')
      .photos.at(-1);
    const chapter = {
      id: randomUUID(),
      shareId: randomUUID(),
      coverMediaId: coverPhoto.id,
      title: 'A World in Ten Wonders',
      introduction:
        'Ten monuments, ten different answers to the same human impulse: leave something behind that can outlast us. This chapter follows a slow eastward line from Rome to the Pacific, then crosses into the high spine of the Americas. We chased first light whenever we could, stayed after the crowds thinned, and learned that wonder is rarely just the thing in front of you—it is the road, the weather, the strangers, and the silence around it. Photography sourced from the Unsplash community under the Unsplash License.',
    };

    await uploadPhotos(token, seededStops, uploadedPaths);

    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM atlas_chapters WHERE user_id = $1', [
        user.id,
      ]);
      await client.query('DELETE FROM atlas_entries WHERE user_id = $1', [
        user.id,
      ]);
      await insertFlagship(client, user.id, seededStops, chapter);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }

    if (oldBlobPaths.length) {
      await del(oldBlobPaths, { token }).catch((error) => {
        console.warn(`Old blob cleanup warning: ${error.message}`);
      });
    }

    uploadedPaths = [];
    console.log(
      JSON.stringify(
        {
          chapterId: chapter.id,
          shareId: chapter.shareId,
          shareUrl: `${APP_URL}/shared/chapters/${chapter.shareId}`,
          memories: seededStops.length,
          photographs: seededStops.reduce(
            (count, stop) => count + stop.photos.length,
            0,
          ),
          removed: {
            memories: Number(entryCount.rows[0].count),
            chapters: Number(chapterCount.rows[0].count),
            mediaRecords: mediaResult.rowCount,
            blobObjects: oldBlobPaths.length,
          },
        },
        null,
        2,
      ),
    );
  } catch (error) {
    if (token && uploadedPaths.length) {
      await del(uploadedPaths, { token }).catch(() => undefined);
    }
    throw error;
  } finally {
    client.release();
    await db.end();
  }
}

module.exports = { stops };

if (require.main === module) {
  main().catch((error) => {
    console.error(`Flagship chapter seed failed: ${error.message}`);
    process.exitCode = 1;
  });
}
