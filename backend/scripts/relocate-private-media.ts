/**
 * Moves private-prefix objects (verification/, chat/, messages/, voice/,
 * support/) out of the main bucket, where the public host serves any key to
 * anyone, into the private bucket.
 *
 * The API does this by itself on boot (PrivateMediaJanitor). This runs the
 * same routine by hand against whichever environment the variables below
 * point at, for when you want the counts before anything moves, or a backlog
 * larger than one boot's cap cleared at once.
 *
 * Report-only by default: it lists the main bucket and issues HeadObject
 * against the private one, and changes nothing. Pass --apply to move.
 * Only counts are printed — never object keys.
 *
 *   R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… \
 *   R2_BUCKET_NAME=… R2_VERIFICATION_BUCKET_NAME=… \
 *   npx ts-node scripts/relocate-private-media.ts            # report only
 *   npx ts-node scripts/relocate-private-media.ts --apply
 *   npx ts-node scripts/relocate-private-media.ts --apply --max=20000
 */
import { S3Client } from '@aws-sdk/client-s3';
import {
  DEFAULT_RELOCATION_CAP,
  relocatePrivateMedia,
} from '../src/uploads/private-media-relocation';

const APPLY = process.argv.includes('--apply');

/** An environment variable, treating an empty value as unset. */
function env(name: string): string | undefined;
function env(name: string, fallback: string): string;
function env(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

/** `--max=N`, or the per-boot default. */
function maxObjects(): number {
  const arg = process.argv.find((a) => a.startsWith('--max='));
  const parsed = arg ? Number(arg.slice('--max='.length)) : NaN;
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_RELOCATION_CAP;
}

async function main(): Promise<void> {
  const accountId = env('R2_ACCOUNT_ID');
  const accessKeyId = env('R2_ACCESS_KEY_ID');
  const secretAccessKey = env('R2_SECRET_ACCESS_KEY');
  const mainBucket = env('R2_BUCKET_NAME');
  const privateBucket = env('R2_VERIFICATION_BUCKET_NAME');

  if (!accountId || !accessKeyId || !secretAccessKey || !mainBucket) {
    console.error(
      'R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET_NAME must be set.',
    );
    process.exit(1);
  }
  if (!privateBucket || privateBucket === mainBucket) {
    console.error(
      'R2_VERIFICATION_BUCKET_NAME must be set and differ from R2_BUCKET_NAME:\n' +
        'with no separate private bucket there is nowhere to move objects to.',
    );
    process.exit(1);
  }

  const s3 = new S3Client({
    region: env('STORAGE_REGION', 'auto'),
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    // Same settings as the API's client (see CloudflareR2Provider).
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  const report = await relocatePrivateMedia(
    { s3, mainBucket, privateBucket },
    { apply: APPLY, maxObjects: maxObjects() },
  );

  console.log(`${APPLY ? 'Applied' : 'Report only'} — counts per prefix:`);
  for (const [prefix, counts] of Object.entries(report.byPrefix)) {
    console.log(`  ${prefix} ${JSON.stringify(counts)}`);
  }
  console.log(`  total ${JSON.stringify(report.total)}`);
  if (report.errors.length > 0) {
    console.error(`Errors seen: ${report.errors.join(', ')}`);
  }
  if (report.capped) {
    console.log('Stopped at the object cap; run again to continue.');
  }
  if (!APPLY) {
    console.log(
      '\nReport only: "pending" would be copied, "alreadyPresent" would just be\n' +
        'deleted from the main bucket. Re-run with --apply to make these changes.',
    );
  }
  if (report.total.failed > 0) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error('Relocation failed:', e instanceof Error ? e.name : 'error');
  process.exit(1);
});
