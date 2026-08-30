#!/usr/bin/env node
/**
 * One-off: move existing verification documents out of the public bucket.
 *
 * New uploads land in the right place already — they are created `private`,
 * carry `private, no-store`, and route to `R2_VERIFICATION_BUCKET_NAME` when it
 * is set. This script is for objects written *before* those fixes, which are
 * still sitting in a bucket whose `pub-*.r2.dev` host serves any key to anyone.
 *
 * Three kinds of object are handled differently, because they deserve
 * different outcomes:
 *
 *   - Referenced by a live request  → COPIED to the private bucket, verified,
 *                                     then removed from the public one. A
 *                                     reviewer still needs these.
 *   - Referenced by nothing         → DELETED. Nobody can act on them and they
 *                                     are pure exposure.
 *   - Row says private already      → still moved; the column was never the
 *                                     thing protecting them.
 *
 * Runs read-only by default. Pass --apply to make changes.
 *
 *   node scripts/migrate-verification-media.js            # report only
 *   node scripts/migrate-verification-media.js --apply
 */
const {
  S3Client,
  ListObjectsV2Command,
  CopyObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { PrismaClient } = require('@prisma/client');

const APPLY = process.argv.includes('--apply');
const PREFIX = 'verification/';

function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

async function main() {
  const accountId = env('R2_ACCOUNT_ID');
  const publicBucket = env('R2_BUCKET_NAME');
  const privateBucket = env('R2_VERIFICATION_BUCKET_NAME');

  if (!accountId || !publicBucket) {
    console.error('R2_ACCOUNT_ID and R2_BUCKET_NAME must be set.');
    process.exit(1);
  }

  const s3 = new S3Client({
    region: env('STORAGE_REGION', 'auto'),
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env('R2_ACCESS_KEY_ID'),
      secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
    },
  });

  // The pooler rejects Prisma's prepared statements without this.
  const dbUrl =
    env('DATABASE_URL') +
    (env('DATABASE_URL', '').includes('?') ? '&' : '?') +
    'pgbouncer=true&connection_limit=1';
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  // ── Inventory ─────────────────────────────────────────────────────────────
  const keys = [];
  let token;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: publicBucket,
        Prefix: PREFIX,
        ContinuationToken: token,
      }),
    );
    (page.Contents || []).forEach((o) => keys.push(o.Key));
    token = page.NextContinuationToken;
  } while (token);

  if (keys.length === 0) {
    console.log(`Nothing under ${PREFIX} in ${publicBucket}. Already clean.`);
    await prisma.$disconnect();
    return;
  }

  // Which of these a request still points at. Anything else is unreferenced.
  const referenced = await prisma.media.findMany({
    where: {
      objectKey: { in: keys },
      OR: [
        { verificationSelfies: { some: {} } },
        { verificationIdCards: { some: {} } },
      ],
    },
    select: { id: true, objectKey: true },
  });
  const referencedKeys = new Set(referenced.map((m) => m.objectKey));

  const toMove = keys.filter((k) => referencedKeys.has(k));
  const toDelete = keys.filter((k) => !referencedKeys.has(k));

  console.log(`Found ${keys.length} object(s) under ${PREFIX} in ${publicBucket}`);
  console.log(`  referenced by a request : ${toMove.length}`);
  console.log(`  unreferenced            : ${toDelete.length}`);

  if (toMove.length > 0 && !privateBucket) {
    console.error(
      '\nR2_VERIFICATION_BUCKET_NAME is not set, so there is nowhere to move the\n' +
        `${toMove.length} referenced document(s) to. Provision a bucket with no public\n` +
        'host, set the variable, and re-run. Unreferenced objects can still be\n' +
        'deleted by running with --apply.',
    );
  }

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to make these changes.');
    await prisma.$disconnect();
    return;
  }

  // ── Move the ones a reviewer still needs ──────────────────────────────────
  let moved = 0;
  if (privateBucket) {
    for (const key of toMove) {
      await s3.send(
        new CopyObjectCommand({
          Bucket: privateBucket,
          CopySource: `${publicBucket}/${key}`,
          Key: key,
          CacheControl: 'private, no-store',
          MetadataDirective: 'REPLACE',
        }),
      );
      // Verify the copy landed before removing the only other copy.
      await s3.send(new HeadObjectCommand({ Bucket: privateBucket, Key: key }));
      await s3.send(new DeleteObjectCommand({ Bucket: publicBucket, Key: key }));
      moved += 1;
      console.log(`  moved ${key}`);
    }
  }

  // ── Delete the ones nothing references ────────────────────────────────────
  for (const key of toDelete) {
    await s3.send(new DeleteObjectCommand({ Bucket: publicBucket, Key: key }));
    console.log(`  deleted ${key}`);
  }
  const removedRows = await prisma.media.deleteMany({
    where: { objectKey: { in: toDelete } },
  });

  // Reflect the move in the rows that were left behind.
  if (moved > 0) {
    await prisma.media.updateMany({
      where: { objectKey: { in: toMove } },
      data: { visibility: 'private', bucket: privateBucket },
    });
  }

  console.log(
    `\nDone. moved=${moved} deleted=${toDelete.length} rows_removed=${removedRows.count}`,
  );

  // ── Confirm the exposure is actually closed ───────────────────────────────
  const publicHost = env('R2_PUBLIC_URL');
  if (publicHost) {
    let stillPublic = 0;
    for (const key of keys) {
      const res = await fetch(`${publicHost}/${key}`, { method: 'GET', headers: { Range: 'bytes=0-0' } });
      if (res.status < 400) {
        stillPublic += 1;
        console.error(`  STILL PUBLIC: ${key} (${res.status})`);
      }
    }
    console.log(
      stillPublic === 0
        ? 'Verified: no verification object is publicly reachable.'
        : `WARNING: ${stillPublic} object(s) still publicly reachable.`,
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('Migration failed:', e.message);
  process.exit(1);
});
