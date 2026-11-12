import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type HeadObjectCommandOutput,
  type S3Client,
} from '@aws-sdk/client-s3';
import { cacheControlFor } from './object-cache-control';
import { PRIVATE_PREFIXES } from './private-prefixes';

/**
 * Moves objects that belong in the private bucket out of the main one.
 *
 * A key is routed to the private bucket by its prefix at WRITE time, so an
 * object stored before its prefix joined that list is still in the main
 * bucket, whose public host serves any key to anyone. The provider keeps such
 * objects readable through a read fallback; this is what closes the exposure
 * instead of only working around it.
 *
 * Nothing here imports the application's configuration, so the same routine
 * runs at boot (the janitor) and from a shell (the script) against whichever
 * environment the caller's client points at.
 */

/** Objects handled per run, so a large backlog is spread across boots. */
export const DEFAULT_RELOCATION_CAP = 2000;

/** The two buckets of one account, and a client that can reach both. */
export interface PrivateMediaTarget {
  s3: S3Client;
  mainBucket: string;
  privateBucket: string;
}

export interface RelocationOptions {
  /** False lists and compares only (HeadObject); nothing is copied or deleted. */
  apply: boolean;
  /** Most objects looked at in total, across all prefixes. */
  maxObjects?: number;
  /** Defaults to every private prefix. */
  prefixes?: readonly string[];
  /** Called once a key has left the main bucket, so callers can drop caches. */
  onRelocated?: (key: string) => void;
}

export interface RelocationCounts {
  /** Objects found in the main bucket under the prefix. */
  scanned: number;
  /** Copies made to the private bucket and verified. */
  copied: number;
  /** Keys the private bucket already held at the same size. */
  alreadyPresent: number;
  /** Objects removed from the main bucket. */
  deleted: number;
  /** Keys left exactly as they were because something went wrong. */
  failed: number;
  /** Keys that disappeared between listing and handling. */
  vanished: number;
  /** Report-only runs: keys an `apply` run would copy. */
  pending: number;
}

export interface RelocationReport {
  byPrefix: Record<string, RelocationCounts>;
  total: RelocationCounts;
  /** True when the run stopped at its cap and more may remain. */
  capped: boolean;
  /** Distinct error names seen (never keys, never messages). */
  errors: string[];
}

const emptyCounts = (): RelocationCounts => ({
  scanned: 0,
  copied: 0,
  alreadyPresent: 0,
  deleted: 0,
  failed: 0,
  vanished: 0,
  pending: 0,
});

/** What the AWS SDK throws for an absent object: HeadObject says NotFound. */
export function isObjectNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  if ('name' in err && (err.name === 'NoSuchKey' || err.name === 'NotFound')) {
    return true;
  }
  return (
    '$metadata' in err &&
    typeof err.$metadata === 'object' &&
    err.$metadata !== null &&
    'httpStatusCode' in err.$metadata &&
    err.$metadata.httpStatusCode === 404
  );
}

/** An error's class name only: a message from storage can quote a key. */
function errorName(err: unknown): string {
  return err instanceof Error && err.name ? err.name : 'UnknownError';
}

/**
 * `CopySource` is `<bucket>/<key>` and the SDK sends it as given, so the key
 * has to be URL-encoded here. Each segment is encoded on its own so the
 * separators stay readable as separators.
 */
function copySource(bucket: string, key: string): string {
  return `${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/** An unquoted single-part ETag is the MD5 of the body and so comparable. */
function comparableEtag(etag: string | undefined): string | undefined {
  const bare = etag?.replace(/"/g, '');
  return bare && !bare.includes('-') ? bare : undefined;
}

/** Same bytes as far as storage lets us tell: size, and ETag where it is an MD5. */
function sameObject(
  source: HeadObjectCommandOutput,
  copy: HeadObjectCommandOutput,
): boolean {
  if (
    source.ContentLength === undefined ||
    source.ContentLength !== copy.ContentLength
  ) {
    return false;
  }
  const a = comparableEtag(source.ETag);
  const b = comparableEtag(copy.ETag);
  return a && b ? a === b : true;
}

/** HeadObject, with absence as null and every other failure thrown. */
async function headOrNull(
  s3: S3Client,
  bucket: string,
  key: string,
): Promise<HeadObjectCommandOutput | null> {
  try {
    return await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (err) {
    if (isObjectNotFound(err)) return null;
    throw err;
  }
}

interface ListedObject {
  key: string;
  size: number | undefined;
}

/**
 * One key, start to finish.
 *
 * The order is the safety property: the main-bucket object is deleted only
 * after the private copy has been read back and matches the source. Anything
 * short of that leaves both objects where they are, and the next run starts
 * again from the same state.
 */
async function relocateKey(
  { s3, mainBucket, privateBucket }: PrivateMediaTarget,
  { key, size }: ListedObject,
  apply: boolean,
  counts: RelocationCounts,
  reasons: Set<string>,
  onRelocated: ((key: string) => void) | undefined,
): Promise<void> {
  const removeFromMain = async (): Promise<void> => {
    await s3.send(new DeleteObjectCommand({ Bucket: mainBucket, Key: key }));
    counts.deleted += 1;
    onRelocated?.(key);
  };

  // An earlier run (or another replica) may have copied it and been cut off
  // before the delete. A same-size copy is already what we would make.
  const existing = await headOrNull(s3, privateBucket, key);
  if (
    existing &&
    size !== undefined &&
    existing.ContentLength !== undefined &&
    existing.ContentLength === size
  ) {
    counts.alreadyPresent += 1;
    if (apply) await removeFromMain();
    return;
  }

  if (!apply) {
    counts.pending += 1;
    return;
  }

  const source = await headOrNull(s3, mainBucket, key);
  if (!source) {
    counts.vanished += 1;
    return;
  }

  try {
    await s3.send(
      new CopyObjectCommand({
        Bucket: privateBucket,
        Key: key,
        CopySource: copySource(mainBucket, key),
        // REPLACE drops the source's headers, so both are set explicitly: the
        // cache directive the provider would write for this key today, and
        // the content type carried over.
        MetadataDirective: 'REPLACE',
        CacheControl: cacheControlFor(key),
        ...(source.ContentType ? { ContentType: source.ContentType } : {}),
      }),
    );
  } catch (err) {
    if (isObjectNotFound(err)) {
      counts.vanished += 1;
      return;
    }
    throw err;
  }

  const copy = await headOrNull(s3, privateBucket, key);
  if (!copy || !sameObject(source, copy)) {
    counts.failed += 1;
    reasons.add('CopyVerificationFailed');
    return;
  }
  counts.copied += 1;

  await removeFromMain();
}

/**
 * Relocates every object under the private prefixes from the main bucket to
 * the private one. Never throws: a failure is counted and the run goes on.
 */
export async function relocatePrivateMedia(
  target: PrivateMediaTarget,
  options: RelocationOptions,
): Promise<RelocationReport> {
  const prefixes = options.prefixes ?? PRIVATE_PREFIXES;
  let remaining = options.maxObjects ?? DEFAULT_RELOCATION_CAP;
  let capped = false;
  const byPrefix: Record<string, RelocationCounts> = {};
  const reasons = new Set<string>();

  for (const prefix of prefixes) {
    const counts = emptyCounts();
    byPrefix[prefix] = counts;

    if (remaining <= 0) {
      capped = true;
      continue;
    }

    try {
      let token: string | undefined;
      do {
        const page = await target.s3.send(
          new ListObjectsV2Command({
            Bucket: target.mainBucket,
            Prefix: prefix,
            ContinuationToken: token,
            MaxKeys: Math.min(1000, remaining),
          }),
        );
        const objects = page.Contents ?? [];
        remaining -= objects.length;
        counts.scanned += objects.length;

        for (const object of objects) {
          if (!object.Key) continue;
          try {
            await relocateKey(
              target,
              { key: object.Key, size: object.Size },
              options.apply,
              counts,
              reasons,
              options.onRelocated,
            );
          } catch (err) {
            counts.failed += 1;
            reasons.add(errorName(err));
          }
        }

        token = page.IsTruncated ? page.NextContinuationToken : undefined;
        if (token && remaining <= 0) {
          capped = true;
          break;
        }
      } while (token);
    } catch (err) {
      // Listing failed, so nothing under this prefix was judged. Counted as a
      // failure so a run that did nothing cannot look like a clean one.
      counts.failed += 1;
      reasons.add(errorName(err));
    }
  }

  const total = emptyCounts();
  for (const counts of Object.values(byPrefix)) {
    for (const field of Object.keys(total) as Array<keyof RelocationCounts>) {
      total[field] += counts[field];
    }
  }

  return { byPrefix, total, capped, errors: [...reasons].sort() };
}
