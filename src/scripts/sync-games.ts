import dotenv from "dotenv";
import axios from "axios";
import path from "path";
// import { CasinoService } from "../services/casino/aggregator";
import { CasinoService } from "../services/casino/aggregator";
import * as S3Service from "../services/s3";
import { db } from "../db";
import { casino_games } from "../db/schema";
import { CacheService } from "../services/cache";
import { connectRedis } from "../db/redis";

dotenv.config();

// ---------------------
// Types
// ---------------------

interface Game {
  uuid: string;
  name: string;
  image: string;
  type: string;
  provider: string;
  provider_id: number;
  technology: string;
  has_lobby: number;
  is_mobile: number;
  has_freespins: number;
  has_tables: number;
  freespin_valid_until_full_day: number;
  updated_at: number;
  label: string;
  tags: { code: string; label: string }[];
}

interface ApiResponse {
  items: Game[];
  _links: {
    self: { href: string };
    first: { href: string };
    last: { href: string };
    next?: { href: string };
  };
  _meta: {
    totalCount: number;
    pageCount: number;
    currentPage: number;
    perPage: number;
  };
}

// ---------------------
// Utilities
// ---------------------

function getMimeType(filename: string) {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function sanitize(str: string): string {
  return str.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
}

async function downloadImage(url: string): Promise<Buffer> {
  const response = await axios.get(url, { responseType: "arraybuffer" });
  return Buffer.from(response.data);
}

// async function uploadToS3(buffer: Buffer, provider: string, filename: string) {
//   const mimeType = getMimeType(filename);
//   const safeProvider = sanitize(provider);
//   const arrayBuffer = buffer.buffer.slice(
//     buffer.byteOffset,
//     buffer.byteOffset + buffer.byteLength
//   );
//   const file = new File([arrayBuffer], filename, { type: mimeType });
//   return await S3Service.uploadFile(
//     file,
//     `casino-assets/games/${safeProvider}`,
//     true
//   );
// }

async function uploadToS3(buffer: Buffer, provider: string, filename: string) {
  const mimeType = getMimeType(filename);
  const safeProvider = sanitize(provider);

  // Force a concrete ArrayBuffer via copy
  const uint8 = new Uint8Array(buffer);

  const file = new File([uint8], filename, { type: mimeType });

  return S3Service.uploadFile(
    file,
    `casino-assets/games/${safeProvider}`,
    true
  );
}

// ---------------------
// PROCESS GAME
// ---------------------

async function processGame(game: Game): Promise<string | null> {
  if (!game.image) return null;

  try {
    // 1. Check DB to prevent re-upload
    const existing = await db.query.casino_games.findFirst({
      where: (g, { eq }) => eq(g.uuid, game.uuid),
    });

    if (existing && existing.image) {
      console.log("skipping data already exist");
      return existing.image;
    }

    // 2. Not in DB → upload
    const url = new URL(game.image);
    const filename = path.basename(url.pathname);
    const provider = sanitize(game.provider);

    const buffer = await downloadImage(game.image);
    const s3Url = await uploadToS3(buffer, provider, filename);

    // 3. Insert or update
    await db
      .insert(casino_games)
      .values({
        uuid: game.uuid,
        name: game.name,
        image: s3Url,
        type: game.type,
        provider: game.provider,
        provider_id: game.provider_id,
        technology: game.technology,
        has_lobby: !!game.has_lobby,
        is_mobile: !!game.is_mobile,
        has_freespins: !!game.has_freespins,
        has_tables: !!game.has_tables,
        tags: game.tags ?? [],
        freespin_valid_until_full_day: game.freespin_valid_until_full_day,
        updatedAt: new Date(),
        createdAt: new Date(),
        label: game.label,
      })
      .onConflictDoUpdate({
        target: casino_games.uuid,
        set: {
          image: s3Url,
          updatedAt: new Date(),
        },
      });

    return s3Url;
  } catch (err) {
    console.error(`✗ Failed for ${game.name}:`);
    return null;
  }
}

// ---------------------
// Pagination
// ---------------------

async function fetchGames(page: number, perPage = 50): Promise<ApiResponse> {
  try {
    console.log(`Fetching games for page ${page}...`);
    const result = await CasinoService.getGames("tags", page, perPage);
    console.log(`Page ${page} fetched successfully`);
    return result;
  } catch (error) {
    console.error(`Failed to fetch page ${page}:`, error);
    throw error;
  }
}

// ---------------------
// Parallel Batch Processor
// ---------------------

async function processInBatches<T>(
  items: T[],
  batchSize: number,
  callback: (item: T) => Promise<void>
) {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map(callback)); // run in parallel
  }
}

// ---------------------
// Main Sync Logic
// ---------------------

async function syncAllGames() {
  // Connect to Redis before starting
  await connectRedis();

  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalFailed = 0;

  const BATCH_SIZE = 10; // Parallel workers

  try {
    // 1. Fetch first page
    let page = 301;
    let totalPages = 1;

    do {
      const data = await fetchGames(page);

      // Validate response structure
      if (!data || !data.items || !Array.isArray(data.items)) {
        console.error(`Invalid response for page ${page}:`, data);
        console.error("Stopping sync due to invalid API response");
        break;
      }

      totalPages = data._meta?.pageCount || totalPages;
      const games = data.items;

      console.log(`Processing ${games.length} games from page ${page}`);

      await processInBatches(games, BATCH_SIZE, async (game) => {
        totalProcessed++;
        const s3Url = await processGame(game);
        if (s3Url) totalSuccess++;
        else totalFailed++;
      });

      page++;
      console.log("page no.", page);
    } while (page <= totalPages);

    // Invalidate all casino games caches after sync

    await CacheService.invalidatePattern("casino:games:*");
  } catch (error) {
    console.error("Fatal Error:");
    process.exit(1);
  }
}

syncAllGames();
