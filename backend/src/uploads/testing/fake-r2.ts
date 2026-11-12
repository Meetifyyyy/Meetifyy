import { createHash } from 'crypto';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type S3Client,
} from '@aws-sdk/client-s3';
import { stub } from '../../common/testing/stub';

export interface FakeObject {
  body: string;
  contentType?: string;
  cacheControl?: string;
}

/** What a spec can ask of the fake: what was sent, to which bucket and key. */
export interface SentCommand {
  name: string;
  bucket: string;
  key?: string;
}

/** What the AWS SDK throws for an object that is not there. */
export const notFoundError = (name = 'NotFound'): Error =>
  Object.assign(new Error('not found'), {
    name,
    $metadata: { httpStatusCode: 404 },
  });

const etagOf = (body: string): string =>
  `"${createHash('md5').update(body).digest('hex')}"`;

/**
 * An in-memory stand-in for the two R2 operations the media code uses
 * (listing, head, copy, delete), keyed by bucket.
 *
 * It answers like storage does where it matters to these specs: a missing key
 * is a NotFound error, listing pages by key (so deleting while paging cannot
 * skip anything), a copy with MetadataDirective REPLACE takes its content type
 * and cache directive from the request and nothing from the source, and a
 * delete of an absent key succeeds.
 */
export class FakeR2 {
  readonly buckets = new Map<string, Map<string, FakeObject>>();
  readonly commands: SentCommand[] = [];
  /** The last CopySource sent, exactly as sent. */
  lastCopySource: string | undefined;
  /** Makes CopyObject store different bytes than the source held. */
  corruptCopy = false;
  /** Makes CopyObject throw. */
  copyError: Error | undefined;
  /** Makes DeleteObject throw for matching keys. */
  failDeleteFor: ((key: string) => boolean) | undefined;

  readonly send = jest.fn<Promise<unknown>, [object]>((command) =>
    this.handle(command),
  );

  client(): S3Client {
    return stub<S3Client>({ send: this.send });
  }

  put(bucket: string, key: string, body: string, contentType?: string): void {
    this.bucket(bucket).set(key, { body, contentType });
  }

  has(bucket: string, key: string): boolean {
    return this.bucket(bucket).has(key);
  }

  get(bucket: string, key: string): FakeObject | undefined {
    return this.bucket(bucket).get(key);
  }

  /** Commands sent with the given SDK command class name. */
  sent(name: string): SentCommand[] {
    return this.commands.filter((c) => c.name === name);
  }

  private bucket(name: string): Map<string, FakeObject> {
    let b = this.buckets.get(name);
    if (!b) {
      b = new Map();
      this.buckets.set(name, b);
    }
    return b;
  }

  private handle(command: object): Promise<unknown> {
    if (command instanceof ListObjectsV2Command) {
      const {
        Bucket = '',
        Prefix = '',
        ContinuationToken,
        MaxKeys,
      } = command.input;
      this.commands.push({ name: 'ListObjectsV2Command', bucket: Bucket });
      const keys = [...this.bucket(Bucket).keys()]
        .filter((k) => k.startsWith(Prefix))
        .filter((k) => !ContinuationToken || k > ContinuationToken)
        .sort();
      const page = keys.slice(0, MaxKeys ?? 1000);
      const truncated = keys.length > page.length;
      return Promise.resolve({
        Contents: page.map((Key) => {
          const o = this.bucket(Bucket).get(Key);
          return {
            Key,
            Size: o?.body.length,
            ETag: etagOf(o?.body ?? ''),
          };
        }),
        IsTruncated: truncated,
        NextContinuationToken: truncated ? page[page.length - 1] : undefined,
      });
    }

    if (command instanceof HeadObjectCommand) {
      const { Bucket = '', Key = '' } = command.input;
      this.commands.push({
        name: 'HeadObjectCommand',
        bucket: Bucket,
        key: Key,
      });
      const o = this.bucket(Bucket).get(Key);
      if (!o) return Promise.reject(notFoundError());
      return Promise.resolve({
        ContentLength: o.body.length,
        ContentType: o.contentType,
        CacheControl: o.cacheControl,
        ETag: etagOf(o.body),
      });
    }

    if (command instanceof CopyObjectCommand) {
      const { Bucket = '', Key = '', CopySource = '' } = command.input;
      this.commands.push({
        name: 'CopyObjectCommand',
        bucket: Bucket,
        key: Key,
      });
      this.lastCopySource = CopySource;
      if (this.copyError) return Promise.reject(this.copyError);
      const slash = CopySource.indexOf('/');
      const source = this.bucket(CopySource.slice(0, slash)).get(
        decodeURIComponent(CopySource.slice(slash + 1)),
      );
      if (!source) return Promise.reject(notFoundError('NoSuchKey'));
      const replace = command.input.MetadataDirective === 'REPLACE';
      this.bucket(Bucket).set(Key, {
        body: this.corruptCopy ? `${source.body}!` : source.body,
        contentType: replace ? command.input.ContentType : source.contentType,
        cacheControl: replace
          ? command.input.CacheControl
          : source.cacheControl,
      });
      return Promise.resolve({});
    }

    if (command instanceof DeleteObjectCommand) {
      const { Bucket = '', Key = '' } = command.input;
      this.commands.push({
        name: 'DeleteObjectCommand',
        bucket: Bucket,
        key: Key,
      });
      if (this.failDeleteFor?.(Key)) {
        return Promise.reject(
          Object.assign(new Error('denied'), { name: 'AccessDenied' }),
        );
      }
      this.bucket(Bucket).delete(Key);
      return Promise.resolve({});
    }

    return Promise.reject(new Error('unexpected command'));
  }
}
