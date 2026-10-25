import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { StorageProvider } from './providers/storage-provider.interface';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { config } from '../config';
import {
  baseMimeType,
  extensionForMime,
  isAllowedUploadType,
} from './mime-extension';
import { parseImagePlaceholder } from './image-placeholder.util';
import { SUPPORT_ATTACHMENT_LIMITS } from '../support/support.constants';
import {
  contentMatchesDeclaredKind,
  sanitizeFilename,
  sniffMimeType,
} from './attachment-inspection.util';
import {
  MAX_COVERED_IMAGE_SIZE_BYTES,
  COVERED_IMAGE_SIZE_ERROR_MESSAGE,
  isCoveredImageFolder,
  uploadLimitFor,
  type UploadLimit,
} from './uploads.constants';

/** Upper bound for a college logo upload. */
export const COLLEGE_LOGO_MAX_BYTES = 2 * 1024 * 1024;
/** Logos are stored as a square of this many pixels per side (at most). */
export const COLLEGE_LOGO_SIZE_PX = 512;
/** Smallest accepted logo edge; anything below is too blurry to show. */
export const COLLEGE_LOGO_MIN_PX = 64;
/** Decode ceiling (pixels) so a tiny file cannot expand into a huge bitmap. */
const COLLEGE_LOGO_MAX_INPUT_PIXELS = 40_000_000;

/** Extensions an original can have when a `_thumb` variant derives from it. */
const VARIANT_BASE_EXTENSIONS = [
  'webp',
  'jpg',
  'jpeg',
  'png',
  'gif',
  'mp4',
  'webm',
  'ogv',
  'mov',
];

/** What `checkStoredObject` found for one key. */
export type StoredObjectCheck =
  | { state: 'ok' }
  | { state: 'missing' }
  | { state: 'too_large'; message: string };

/** Which live capture a verification object holds; part of its storage key. */
export type VerificationCaptureKind = 'selfie' | 'id';

/** `verification/live-selfie-…` or `verification/live-id-…`, as only storeVerificationCapture writes. */
export const LIVE_CAPTURE_KEY =
  /^verification\/live-(selfie|id)-[0-9a-f]{32}\.jpg$/;

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly providerName: string;
  private readonly bucketName: string;

  constructor(
    @Inject('STORAGE_PROVIDER') private storageProvider: StorageProvider,
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    this.providerName = config.storage.provider;
    this.bucketName = config.storage.r2.bucketName;
  }

  isSafeStorageKey(key: string): boolean {
    return (
      typeof key === 'string' && /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/.test(key)
    );
  }

  /**
   * The upload limit for a key a presign already registered, from the type
   * that presign recorded. Used by the local-disk upload endpoint, which
   * receives only the key.
   */
  async uploadLimitForKey(key: string): Promise<UploadLimit> {
    const media = await this.prisma.media.findUnique({
      where: { objectKey: key },
      select: { mimeType: true },
    });
    return uploadLimitFor(key.split('/')[0] || 'general', media?.mimeType);
  }

  async userOwnsMediaKey(key: string, userId: string): Promise<boolean> {
    if (!this.isSafeStorageKey(key)) return false;
    const media = await this.prisma.media.findUnique({
      where: { objectKey: key },
      select: { ownerId: true },
    });
    return media?.ownerId === userId;
  }

  /**
   * Upload file securely (pass-through) and register Media.
   */
  async uploadFile(
    userId: string,
    file: Express.Multer.File,
    folder = 'general',
    variantKey?: string,
    placeholder?: unknown,
  ) {
    const safeFolder = this.normalizeFolder(folder);
    // A thumbnail arriving through this fallback keeps its derived key. It
    // used to get a random one, so whenever the direct upload failed the
    // thumbnail landed where nothing would ever look for it, and the
    // `<name>_thumb.webp` the UI asks for 404'd.
    const explicitKey = variantKey
      ? await this.resolveVariantKey(userId, variantKey, safeFolder)
      : undefined;
    if (
      isCoveredImageFolder(safeFolder) &&
      file.size > MAX_COVERED_IMAGE_SIZE_BYTES
    ) {
      throw new BadRequestException(COVERED_IMAGE_SIZE_ERROR_MESSAGE);
    }
    // The per-file limit for this folder and kind (15 MB for a message video,
    // 25 MB for a post video, 5 MB for an image in either), checked before a
    // byte is stored. Multer's own ceiling is only the outer bound.
    if (!file.size) throw new BadRequestException('This file is empty');
    const limit = uploadLimitFor(safeFolder, file.mimetype);
    if (file.size > limit.maxBytes) {
      throw new PayloadTooLargeException(limit.message);
    }
    // Message and post media are checked against their own bytes too: the
    // multipart type is whatever the caller wrote, and it decides how every
    // client will try to render the object.
    if (
      (safeFolder === 'posts' ||
        this.isConversationScopedKey(`${safeFolder}/x`)) &&
      !contentMatchesDeclaredKind(file.buffer, file.mimetype)
    ) {
      throw new BadRequestException(
        "That file's contents do not match its type.",
      );
    }
    // Identity documents get their bytes checked, not just their label.
    //
    // The declared mimetype arrives in the same untrusted multipart body as the
    // content, so on its own it proves nothing — and the verification flow is
    // exactly where "this is a JPEG" needs to be true, because a reviewer makes
    // an identity decision from it and the submission check downstream trusts
    // the recorded type. The same signature check already guards support
    // attachments; it is applied here rather than to every folder because the
    // video and audio types the post/chat paths accept have no signature in it.
    if (this.isAlwaysPrivateKey(`${safeFolder}/x`)) {
      if (!file.mimetype?.startsWith('image/')) {
        throw new BadRequestException('Verification documents must be images');
      }
      const sniffed = sniffMimeType(file.buffer);
      if (sniffed !== file.mimetype) {
        throw new BadRequestException(
          "That file's contents do not match its type.",
        );
      }
    }

    const ext = this.extensionForMime(file.mimetype);
    const randomHex = randomBytes(16).toString('hex');
    const key = explicitKey ?? `${safeFolder}/${randomHex}.${ext}`;

    await this.storageProvider.upload(key, file.buffer, file.mimetype);

    // Register media in database. A variant may already have a row from a
    // presign whose direct upload failed, so that one is upserted.
    const data = {
      ownerId: userId,
      objectKey: key,
      provider: this.providerName,
      bucket: this.bucketName,
      storageKey: key, // Legacy fallback
      type: file.mimetype.startsWith('video')
        ? 'VIDEO'
        : file.mimetype.startsWith('audio')
          ? 'AUDIO'
          : 'IMAGE', // Legacy fallback
      mimeType: file.mimetype,
      fileSize: file.size,
      // Same rule as the presign path: originals of images only, and an
      // invalid value is dropped rather than failing the upload.
      placeholder:
        !explicitKey && file.mimetype.startsWith('image/')
          ? ((await parseImagePlaceholder(placeholder)) ?? undefined)
          : undefined,
      visibility: this.visibilityForFolder(safeFolder),
    };
    const media = explicitKey
      ? await this.prisma.media.upsert({
          where: { objectKey: key },
          create: data,
          update: data,
        })
      : await this.prisma.media.create({ data });

    // Provide a generic, provider-agnostic URL to the frontend
    const publicUrl = `/api/media/${key}`;

    return { publicUrl, key, mediaId: media.id, media };
  }

  /**
   * Stores one live verification capture that the verification service has
   * already decoded, re-encoded and size-checked.
   *
   * The key is `verification/live-<kind>-<32 hex>.jpg`, and this is the only
   * code that writes that shape: the generic upload names objects
   * `<hex>.<ext>`, a thumbnail variant must end in `_thumb`, and the presign
   * path refuses the folder. So a submission can prove a document came through
   * the live flow by its key alone. Private bucket, private visibility.
   */
  async storeVerificationCapture(
    userId: string,
    kind: VerificationCaptureKind,
    jpeg: Buffer,
    width: number,
    height: number,
  ): Promise<{ mediaId: string; key: string }> {
    const key = `verification/live-${kind}-${randomBytes(16).toString('hex')}.jpg`;
    await this.storageProvider.upload(key, jpeg, 'image/jpeg');
    const media = await this.prisma.media.create({
      data: {
        ownerId: userId,
        objectKey: key,
        provider: this.providerName,
        bucket: this.bucketName,
        storageKey: key,
        type: 'IMAGE',
        mimeType: 'image/jpeg',
        fileSize: jpeg.length,
        width,
        height,
        visibility: 'private',
      },
      select: { id: true },
    });
    return { mediaId: media.id, key };
  }

  /**
   * Validates a client-chosen thumbnail key, for the presign and the
   * pass-through alike.
   *
   * The shape check alone (safe characters, same folder, `_thumb.<ext>`)
   * accepted ANY thumbnail key, so any signed-in user could write the
   * thumbnail of someone else's post or cover — and, through the row upsert,
   * take ownership of its Media row. It was harmless only while every direct
   * upload happened to fail. A variant may now only be written by the owner of
   * the original it derives from, and only over a variant row they own.
   */
  private async resolveVariantKey(
    userId: string,
    variantKey: string,
    safeFolder: string,
  ): Promise<string> {
    const [vFolder] = String(variantKey).split('/');
    const match = /^(.*)_thumb\.(webp|jpe?g|png)$/i.exec(String(variantKey));
    if (
      !this.isSafeStorageKey(variantKey) ||
      vFolder !== safeFolder ||
      !match
    ) {
      throw new BadRequestException('Invalid variant key');
    }
    const base = match[1];
    const [original, existing] = await Promise.all([
      // Exact keys, not a prefix match, so this is a unique-index lookup.
      this.prisma.media.findFirst({
        where: {
          objectKey: { in: VARIANT_BASE_EXTENSIONS.map((e) => `${base}.${e}`) },
          ownerId: userId,
        },
        select: { id: true },
      }),
      this.prisma.media.findUnique({
        where: { objectKey: variantKey },
        select: { ownerId: true },
      }),
    ]);
    if (!original || (existing && existing.ownerId !== userId)) {
      throw new BadRequestException('Invalid variant key');
    }
    return variantKey;
  }

  /**
   * Generate a presigned URL for direct client upload and register Media.
   */
  async getPresignedUrl(
    userId: string,
    filename: string,
    contentType: string,
    folder = 'general',
    fileSize = 0,
    variantKey?: string,
    width?: number,
    height?: number,
    duration?: number,
    placeholder?: unknown,
  ) {
    const safeFolder = this.normalizeFolder(folder);
    // Identity documents never upload straight to storage. A presigned PUT
    // bypasses the server entirely: the bytes are never checked against the
    // declared type, and the recorded mimeType is whatever the client claimed.
    // No client has ever used this path for verification; it is closed so a
    // hand-written request cannot use it either.
    if (this.isAlwaysPrivateKey(`${safeFolder}/x`)) {
      throw new BadRequestException(
        'Verification photos must be taken through the verification flow',
      );
    }
    if (typeof contentType !== 'string' || !this.isAllowedMimeType(contentType))
      throw new BadRequestException('Unsupported content type');
    /*
     * Checked and recorded as its essence (`audio/webm`), but signed exactly as
     * declared (`audio/webm;codecs=opus`): the client sends that same header on
     * its PUT, and a signature over anything else is refused by storage. Every
     * Chrome voice note used to fail here and go round through the pass-through.
     */
    const baseType = baseMimeType(contentType);
    const requestedFileSize = Number(fileSize || 0);
    if (!Number.isFinite(requestedFileSize) || requestedFileSize < 0) {
      throw new BadRequestException('Invalid file size');
    }
    // Every client sends the real size; a missing or zero one is either an
    // empty file or a request trying to upload without a bound.
    if (requestedFileSize === 0) {
      throw new BadRequestException('This file is empty');
    }
    const limit = uploadLimitFor(safeFolder, baseType);
    if (requestedFileSize > limit.maxBytes) {
      // Covered images keep the 400 their editors already handle.
      if (isCoveredImageFolder(safeFolder)) {
        throw new BadRequestException(limit.message);
      }
      // 413, not 400: the client stops here instead of falling back to the
      // pass-through upload, which would send every byte to be refused again.
      throw new PayloadTooLargeException(limit.message);
    }

    // A variant key lets the client upload a derived thumbnail sharing the
    // original's key base. Restrict it hard: safe pattern, an allowed folder,
    // and a `_thumb.<ext>` suffix so it can only ever be a thumbnail variant
    // (never an arbitrary object overwrite).
    const explicitKey = variantKey
      ? await this.resolveVariantKey(userId, variantKey, safeFolder)
      : undefined;

    // The size just checked becomes part of the signature, so it is also the
    // only size storage will accept for this URL.
    const { uploadUrl, key, headers } =
      await this.storageProvider.createSignedUploadUrl(
        filename,
        contentType,
        safeFolder,
        undefined,
        explicitKey,
        requestedFileSize,
      );

    const mediaData = {
      ownerId: userId,
      objectKey: key,
      provider: this.providerName,
      bucket: this.bucketName,
      storageKey: key, // Legacy fallback
      type: baseType.startsWith('video')
        ? 'VIDEO'
        : baseType.startsWith('audio')
          ? 'AUDIO'
          : 'IMAGE', // Legacy fallback
      mimeType: baseType,
      fileSize: requestedFileSize,
      width: width ? Math.round(Number(width)) : undefined,
      height: height ? Math.round(Number(height)) : undefined,
      duration: duration ? Math.round(Number(duration)) : undefined,
      // Blur-up placeholder, kept only for the original of an image. Invalid
      // input is dropped rather than rejected: it is cosmetic, and an old
      // client sends none at all.
      placeholder:
        !explicitKey && baseType.startsWith('image/')
          ? ((await parseImagePlaceholder(placeholder)) ?? undefined)
          : undefined,
      visibility: this.visibilityForFolder(safeFolder),
    };

    // Register media in database (pending state). Variant (thumbnail) keys can be
    // re-requested on a retry, so upsert to stay idempotent on the unique objectKey.
    const media = explicitKey
      ? await this.prisma.media.upsert({
          where: { objectKey: key },
          create: mediaData,
          update: mediaData,
        })
      : await this.prisma.media.create({ data: mediaData });

    // Provide a generic, provider-agnostic URL to the frontend
    const publicUrl = `/api/media/${key}`;

    return { uploadUrl, publicUrl, key, headers, mediaId: media.id, media };
  }

  /**
   * Whether an uploaded object is in storage and within its upload limit,
   * measured from storage itself. The row's `fileSize` is the client's own
   * declaration until a confirm corrects it, so it cannot be the check.
   *
   * `declaredType` (the row's mimeType) is the fallback for a store that does
   * not report a content type, so the right per-kind limit still applies.
   */
  async checkStoredObject(
    key: string,
    declaredType?: string | null,
  ): Promise<StoredObjectCheck> {
    if (!this.isSafeStorageKey(key)) return { state: 'missing' };
    const metadata = await this.storageProvider
      .getMetadata(key)
      .catch(() => null);
    if (!metadata) return { state: 'missing' };
    const limit = uploadLimitFor(
      key.split('/')[0] || 'general',
      metadata.contentType || declaredType || undefined,
    );
    if (metadata.contentLength && metadata.contentLength > limit.maxBytes) {
      return { state: 'too_large', message: limit.message };
    }
    return { state: 'ok' };
  }

  /**
   * The storage key a message's `mediaUrl` names, in any of the forms a client
   * sends (`/api/media/<key>`, an absolute API URL, a bare key, or the public
   * storage host), or null when it names nothing this server stores.
   */
  storedKeyFromUrl(value: unknown): string | null {
    if (typeof value !== 'string' || !value) return null;
    const path = value.split(/[?#]/)[0];
    const viaApi = /\/api\/media\/([a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+)$/.exec(
      path,
    );
    if (viaApi) return viaApi[1];
    if (this.isSafeStorageKey(path)) return path;
    const base = config.storage.publicUrl?.replace(/\/+$/, '');
    if (base && path.startsWith(`${base}/`)) {
      const key = path.slice(base.length + 1);
      return this.isSafeStorageKey(key) ? key : null;
    }
    return null;
  }

  /**
   * Refuses a message attachment over the Messages limits (15 MB a video, 5 MB
   * an image, 15 MB a voice note).
   *
   * Everything uploaded into a conversation folder was measured on the way in,
   * so those keys pass untouched - which is what keeps forwarding working,
   * including attachments sent before these limits existed. Only a stored key
   * from ANOTHER folder needs a look: a modified client naming a post's 25 MB
   * video (or a `general` upload) as a chat attachment. That one is measured
   * from storage. A URL naming nothing stored here is not ours to measure.
   */
  async assertMessageAttachmentWithinLimits(mediaUrl: unknown): Promise<void> {
    const key = this.storedKeyFromUrl(mediaUrl);
    if (!key || this.isConversationScopedKey(key)) return;
    const [metadata, media] = await Promise.all([
      this.storageProvider.getMetadata(key).catch(() => null),
      this.prisma.media.findUnique({
        where: { objectKey: key },
        select: { mimeType: true },
      }),
    ]);
    if (!metadata?.contentLength) return;
    const limit = uploadLimitFor(
      'chat',
      metadata.contentType || media?.mimeType || undefined,
    );
    if (metadata.contentLength > limit.maxBytes) {
      throw new PayloadTooLargeException(limit.message);
    }
  }

  async exists(key: string): Promise<boolean> {
    if (!this.isSafeStorageKey(key)) return false;
    try {
      return await this.storageProvider.exists(key);
    } catch {
      return false;
    }
  }

  getPublicUrl(key: string): string {
    return this.storageProvider.getPublicUrl(key);
  }

  /**
   * Prefixes whose contents are never served through the unauthenticated
   * `GET /api/media/*` path, whatever the `media` row says.
   *
   * `visibility` is the general mechanism, but it is a column that has to be
   * set correctly on every write to be worth anything — and it was not: a
   * verification upload went in as the default 'public' and was only flipped
   * afterwards, leaving a window, and a row that never got created at all
   * (unregistered key) had no visibility to read. Identity documents are too
   * sensitive to protect only by a column, so the folder itself is a hard
   * floor: no `verification/` key resolves publicly, row or no row.
   */
  private static readonly PRIVATE_FOLDERS = new Set([
    'verification',
    // Support attachments come from anonymous submitters and are reviewed only
    // by admins (signed URL). Without this the local-disk /api/media route
    // served them unauthenticated.
    'support',
  ]);

  /**
   * Folders whose contents belong to a conversation rather than to the public.
   *
   * Distinct from PRIVATE_FOLDERS, which is never served through the media
   * route at all. These are served — a chat image has to render — but only to
   * someone who is in the conversation it was sent to.
   *
   * They were public. The key is 32 random hex characters, so nobody was going
   * to guess one; the exposure is that the URL is a bearer credential in its own
   * right. Anyone who came by one — a forwarded link, a referrer header, a proxy
   * log, a screenshot of an address bar — had the image permanently, with no way
   * to revoke it, and it kept working after the message was deleted.
   */
  private static readonly CONVERSATION_FOLDERS = new Set([
    'chat',
    'messages',
    'voice',
  ]);

  /** True when this key needs the viewer to be in the conversation. */
  isConversationScopedKey(key: string): boolean {
    const folder = (key || '').split('/')[0];
    return StorageService.CONVERSATION_FOLDERS.has(folder);
  }

  /**
   * May this viewer see this conversation attachment?
   *
   * Two ways in, and both are ownership of a sort: the person who uploaded it,
   * and anyone still participating in a conversation it was sent to. The
   * uploader case matters on its own because an attachment exists between being
   * uploaded and being sent, and the sender has to be able to see their own
   * preview in that window.
   *
   * A key with no media row and no message is refused. That is the safe default
   * for anything unregistered rather than a judgement that it is secret.
   */
  async canViewConversationMedia(
    key: string,
    viewerId: string | null | undefined,
  ): Promise<boolean> {
    if (!viewerId || !this.isSafeStorageKey(key)) return false;

    const media = await this.prisma.media.findUnique({
      where: { objectKey: key },
      select: { id: true, ownerId: true },
    });

    // The uploader, always — including in the window between uploading an
    // attachment and sending it, when no message references it yet.
    if (media?.ownerId === viewerId) return true;

    /**
     * Otherwise: is this attachment in a conversation the viewer is in?
     *
     * Matched through the message payload's `mediaUrl`, because that is where
     * chat attachments actually live. `Message.attachmentMediaId` exists in the
     * schema and is never written by anything — authorizing against it looked
     * right and would have refused every recipient, breaking chat images for
     * everyone except the person who sent them.
     *
     * A thumbnail is derived from its original and has no message of its own,
     * so `chat/<id>_thumb.webp` has to be matched against whatever the original
     * is. Without that, thumbnails would 404 while the full images loaded.
     *
     * Matched on the id, NOT on the id plus the thumbnail's own extension. A
     * thumbnail is always a `.webp` whatever it was derived from, so for a
     * video — original `chat/<id>.mp4`, thumbnail `chat/<id>_thumb.webp` —
     * carrying the extension across produced `chat/<id>.webp`, a key that has
     * never existed. Every video in every conversation lost its poster frame
     * while the video itself played, and the check looked right because it was
     * correct for images, which are the case anyone tests first.
     *
     * The trailing dot is kept so the match cannot run past the id into a
     * different key.
     */
    const baseKey = key.replace(/_thumb\.[A-Za-z0-9]+$/i, '.');

    /*
     * Or named as the message's own thumbnail. A chat PHOTO's thumbnail is a
     * separate upload with a key of its own, recorded only in
     * `payload.thumbnailUrl` - so matching `mediaUrl` alone refused every
     * recipient the small thumbnail, and every chat photo in every list fell
     * back to downloading the full image.
     */
    const participating = await this.prisma.message.findFirst({
      where: {
        OR: [
          { payload: { path: ['mediaUrl'], string_contains: baseKey } },
          { payload: { path: ['thumbnailUrl'], string_contains: key } },
        ],
        // A deleted or unsent message no longer grants access to its media.
        deletedAt: null,
        state: { not: 'UNSENT' },
        conversation: {
          participants: {
            some: { userId: viewerId, deletedAt: null, leftAt: null },
          },
        },
      },
      select: { id: true },
    });

    return Boolean(participating);
  }

  /**
   * The `visibility` value a new upload into this folder must be born with.
   *
   * Set at creation rather than patched afterwards: the previous flow uploaded
   * an identity document as 'public' and only flipped it once the verification
   * request was submitted, which left every selfie and ID card publicly
   * resolvable for the whole gap between the two calls — and permanently so if
   * the user abandoned the form after uploading.
   */
  visibilityForFolder(folder: string): string {
    const key = `${folder}/x`;
    // Conversation attachments join identity documents in being born private.
    // `visibility` is what stops `getSignedUrlsForUser` handing out the CDN URL
    // — which is public and unauthenticated — instead of a signed, expiring one.
    return this.isAlwaysPrivateKey(key) || this.isConversationScopedKey(key)
      ? 'private'
      : 'public';
  }

  /** True when a storage key sits under a folder that is never public. */
  isAlwaysPrivateKey(key: string): boolean {
    const folder = (key || '').split('/')[0];
    return StorageService.PRIVATE_FOLDERS.has(folder);
  }

  /**
   * Resolves a key to its public URL, or null when the object must not be
   * served publicly.
   *
   * Returning null for private media (rather than throwing or returning a
   * signed URL) is deliberate: the caller renders it exactly like a missing
   * object, so the response cannot be used to confirm that a given
   * verification document exists.
   */
  async getResolvedPublicUrl(key: string): Promise<string | null> {
    if (this.isAlwaysPrivateKey(key)) return null;

    const media = await this.prisma.media.findUnique({
      where: { objectKey: key },
      select: {
        provider: true,
        bucket: true,
        objectKey: true,
        visibility: true,
      },
    });

    // Private media is reachable only through getSignedUrlsForUser, which
    // checks ownership, or through an authorized reviewer path.
    if (media && media.visibility !== 'public') return null;

    // R2 is the only storage backend; legacy Supabase-provider rows were
    // migrated, so every key resolves against the active bucket.
    return this.getPublicUrl(key);
  }

  /**
   * A time-limited signed URL for a conversation attachment whose viewer has
   * already been authorized.
   *
   * Deliberately performs no check of its own, and is named so that is obvious.
   * The only caller is the media route, immediately after
   * `canViewConversationMedia` has said yes — putting the check in here too
   * would mean running the same conversation query twice on every image in a
   * thread.
   *
   * Refuses the always-private folders outright regardless, because those are
   * never served through the media route at any authorization level.
   */
  async getSignedUrlForViewer(
    key: string,
    expiresIn = 900,
  ): Promise<string | null> {
    if (!key || !this.isSafeStorageKey(key)) return null;
    if (this.isAlwaysPrivateKey(key)) return null;
    if (!(await this.exists(key))) return null;
    const signed = await this.getSignedUrls([key], expiresIn);
    return signed[key] || null;
  }

  /**
   * A time-limited signed URL for one private object, for an authorized
   * reviewer. Ownership is NOT the test here — a verification reviewer is by
   * definition not the owner — so this must only ever be called from behind
   * AdminJwtGuard.
   */
  async getReviewerSignedUrl(
    key: string,
    expiresIn = 300,
  ): Promise<string | null> {
    if (!key || !this.isSafeStorageKey(key)) return null;
    const signed = await this.getSignedUrls([key], expiresIn);
    return signed[key] || null;
  }

  private signedUrlCache = new Map<
    string,
    { url: string; expiresAt: number }
  >();

  async getSignedUrls(
    keys: string[],
    expiresIn = 3600,
  ): Promise<{ [key: string]: string }> {
    if (!keys || keys.length === 0) return {};
    const now = Date.now();
    const result: { [key: string]: string } = {};
    const uncachedKeys: string[] = [];

    for (const key of keys) {
      const cached = this.signedUrlCache.get(key);
      if (cached && cached.expiresAt > now + 60000) {
        result[key] = cached.url;
      } else {
        uncachedKeys.push(key);
      }
    }

    if (uncachedKeys.length > 0) {
      const freshUrls = await this.storageProvider.createSignedUrls(
        uncachedKeys,
        expiresIn,
      );
      const cacheExpiresAt = now + Math.max(expiresIn - 60, 300) * 1000;
      for (const [key, url] of Object.entries(freshUrls)) {
        result[key] = url;
        this.signedUrlCache.set(key, { url, expiresAt: cacheExpiresAt });
      }
    }

    return result;
  }

  async getSignedUrlsForUser(
    keys: string[],
    expiresIn: number,
    userId: string,
  ) {
    if (!keys || keys.length === 0) return {};

    const media = await this.prisma.media.findMany({
      where: { objectKey: { in: keys } },
      select: {
        objectKey: true,
        ownerId: true,
        visibility: true,
        provider: true,
        bucket: true,
      },
    });

    const mediaMap = new Map(media.map((m) => [m.objectKey, m]));
    const result: { [key: string]: string } = {};
    const keysToSign: string[] = [];
    const conversationKeysToCheck: string[] = [];

    for (const key of keys) {
      const item = mediaMap.get(key);
      const isThumbnailKey = /_thumb\.[a-z0-9]+$/i.test(key);

      // If this is a derived thumbnail key and no media record exists, it was never created;
      // do not return a speculative 404 URL.
      if (!item && isThumbnailKey) {
        continue;
      }

      /**
       * Conversation media is tested FIRST, before any public-URL shortcut.
       *
       * This branch used to sit last, after `!item || visibility === 'public'`.
       * Chat attachments whose Media row is missing, or is still flagged
       * `public`, therefore never reached it: they fell into the shortcut and
       * came back as `getPublicUrl(key)`, which for an object with no public
       * host is the RELATIVE path `/api/media/<key>`.
       *
       * That is not a URL a media tag can use. The website survived it because
       * the path resolves same-origin and the browser attaches the session
       * cookie, so `/api/media` authorized the request itself. The installed
       * app has neither — its WebView origin is `https://localhost`, so the
       * relative path 404s there, and the absolute form 404s too because an
       * <img> or <video> cannot present the bearer token the app authenticates
       * with. Every chat image and video was blank in the app and fine on the
       * web, from this ordering alone.
       *
       * Participation, not ownership, and not the visibility flag: a recipient
       * is not the owner, and the flag describes the object rather than who may
       * see it. This is the same test `GET /api/media/*` applies, so the two
       * paths now agree instead of one of them quietly handing out a public
       * address for a private message attachment.
       */
      if (this.isConversationScopedKey(key)) {
        conversationKeysToCheck.push(key);
      } else if (!item || item.visibility === 'public') {
        // Public media or unregistered non-thumbnail keys return public URL instantly (0ms network overhead)
        result[key] = this.getPublicUrl(key);
      } else if (item.ownerId === userId) {
        keysToSign.push(key);
      }
    }

    if (conversationKeysToCheck.length > 0) {
      const allowed = await Promise.all(
        conversationKeysToCheck.map((key) =>
          this.canViewConversationMedia(key, userId),
        ),
      );
      conversationKeysToCheck.forEach((key, i) => {
        if (allowed[i]) keysToSign.push(key);
      });
    }

    if (keysToSign.length > 0) {
      const signed = await this.getSignedUrls(keysToSign, expiresIn);
      Object.assign(result, signed);
    }

    return result;
  }

  async confirmUpload(key: string, userId: string) {
    if (!this.isSafeStorageKey(key)) return null;
    const media = await this.prisma.media.findUnique({
      where: { objectKey: key },
    });
    if (media && media.ownerId !== userId) return null;
    if (!media) {
      // If no media record exists, it might have been an unmonitored upload, let's create it
      const exists = await this.storageProvider.exists(key);
      if (!exists) return null;
      return this.prisma.media.create({
        data: {
          ownerId: userId,
          objectKey: key,
          provider: this.providerName,
          bucket: this.bucketName,
          storageKey: key,
          mimeType: 'application/octet-stream',
          fileSize: 0,
          // This branch adopts a key that has no row yet, so it must apply the
          // same folder rule as the registered paths — otherwise an
          // unregistered verification key would be adopted as 'public'.
          visibility: this.visibilityForFolder(key.split('/')[0] || 'general'),
        },
      });
    }

    /*
     * What storage actually holds, read once (it also answers "is it there").
     *
     * Awaited rather than fire-and-forget, because it is the one point where
     * the server sees the real size of a direct upload, and an object over its
     * limit is refused here: deleted, row and all, with a 413 the client
     * reports. The signed Content-Length already makes such an object
     * impossible through the presigned URL; this is the check that does not
     * depend on storage honouring that.
     *
     * A miss is still only logged. R2 can lag a fresh PUT, and deleting the row
     * on a transient miss would regress the working upload path.
     */
    const metadata = await this.storageProvider
      .getMetadata(key)
      .catch(() => null);
    if (!metadata) {
      this.logger.warn(
        `confirmUpload: object not yet visible in storage (key=${key}, owner=${userId})`,
      );
      return media;
    }

    const limit = uploadLimitFor(
      key.split('/')[0] || 'general',
      metadata.contentType || media.mimeType,
    );
    if (metadata.contentLength && metadata.contentLength > limit.maxBytes) {
      this.logger.warn(
        `confirmUpload: refused over-limit object key=${key} owner=${userId} size=${metadata.contentLength} limit=${limit.maxBytes}`,
      );
      await this.storageProvider.delete(key).catch(() => false);
      await this.prisma.media.deleteMany({
        where: { objectKey: key, ownerId: userId, postId: null },
      });
      throw new PayloadTooLargeException(limit.message);
    }

    if (metadata.contentLength || metadata.contentType) {
      // The row keeps the declared values until this lands; nothing waits on it.
      this.prisma.media
        .update({
          where: { id: media.id },
          data: {
            fileSize: metadata.contentLength || media.fileSize,
            mimeType: metadata.contentType || media.mimeType,
          },
        })
        .catch(() => {});
    }

    return media;
  }

  private normalizeFolder(folder = 'general'): string {
    // 'activities' backs CrewActivity cover images. Folders are only key
    // prefixes within the single configured bucket, so adding one needs no
    // storage provisioning.
    //
    // 'community-icons' and 'community-covers' are what the community editor
    // has always sent. They were missing from this list, so every avatar or
    // cover change on an existing community was rejected with a 400 before a
    // byte was uploaded — the client reported it as a generic "Upload failed"
    // and the real reason never surfaced. (Creating a community happened to
    // work because that dialog posts to 'communities'.) They are kept as
    // separate prefixes rather than folded into 'communities' so icons and
    // covers stay distinguishable in storage, exactly as avatars and
    // profile-covers already are for users.
    const allowedFolders = [
      'avatars',
      'profile-covers',
      'communities',
      'community-icons',
      'community-covers',
      'posts',
      'chat',
      'groups',
      'voice',
      'temp',
      'general',
      'events',
      'activities',
      // 'defaults' (platform assets) and 'support' (anonymous support
      // attachments, stored by uploadSupportAttachment) are written only by
      // server code, never through the user-writable upload routes.
      'verification',
    ];
    if (!allowedFolders.includes(folder)) {
      throw new BadRequestException(
        `Invalid upload folder. Allowed: ${allowedFolders.join(', ')}`,
      );
    }
    return folder;
  }

  /**
   * Stores an attachment for an unauthenticated support request.
   *
   * Separate from `uploadFile` because that one requires an owning account and
   * the support form must work for someone who cannot log in. The resulting
   * Media row has a null owner, which — per the note on `Media.ownerId` — also
   * makes the ownership check that guards deletion refuse everyone.
   *
   * The declared mimetype is not trusted: it comes from the same untrusted
   * multipart body as the bytes. The magic number is checked against the
   * declared type and both must agree and both must be on the allow-list.
   */
  async uploadSupportAttachment(file: Express.Multer.File) {
    const allowed =
      SUPPORT_ATTACHMENT_LIMITS.allowedMimeTypes as readonly string[];

    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException(
        'That file type is not supported. Attach a PNG, JPG, WEBP, GIF, PDF or TXT file.',
      );
    }
    if (file.size > SUPPORT_ATTACHMENT_LIMITS.maxBytesPerFile) {
      throw new BadRequestException(
        'That file is too large. Attachments must be 10 MB or smaller.',
      );
    }

    const sniffed = sniffMimeType(file.buffer);
    // text/plain has no signature to sniff, so it is accepted on the declared
    // type alone — it is also the one type on the list that cannot carry an
    // active payload.
    if (file.mimetype !== 'text/plain' && sniffed !== file.mimetype) {
      throw new BadRequestException(
        "That file's contents do not match its type.",
      );
    }

    const ext = this.extensionForMime(file.mimetype);
    const key = `support/${randomBytes(16).toString('hex')}.${ext}`;

    await this.storageProvider.upload(key, file.buffer, file.mimetype);

    const media = await this.prisma.media.create({
      data: {
        ownerId: null,
        objectKey: key,
        provider: this.providerName,
        bucket: this.bucketName,
        storageKey: key,
        type: file.mimetype.startsWith('image') ? 'IMAGE' : 'FILE',
        mimeType: file.mimetype,
        fileSize: file.size,
        visibility: 'private',
      },
    });

    return {
      key,
      mediaId: media.id,
      filename: sanitizeFilename(file.originalname),
      mimeType: file.mimetype,
      size: file.size,
    };
  }

  /**
   * Stores a college logo uploaded from the Super Admin console.
   *
   * Owner-less (admins are not user accounts), public (logos are shown before
   * sign-in), PNG / JPEG / WEBP only, at most 2 MB, and the bytes must match
   * the declared type. The image must be square (1:1); anything else is a 400.
   * It is then re-encoded server-side to WebP, at most 512x512, with all
   * metadata (EXIF, GPS, ICC) dropped and transparency kept, so what is stored
   * never depends on what the client claimed to have produced.
   *
   * SVG is refused on purpose: media is served from this API's own origin by
   * `/api/media/*`, and an SVG is a document that can carry script. Without a
   * sanitizer in the storage path, accepting one would be stored XSS against
   * anyone who opens the logo URL directly.
   */
  async uploadCollegeLogo(file: Express.Multer.File) {
    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException(
        'Logos must be PNG, JPEG or WEBP images (SVG is not accepted).',
      );
    }
    if (file.size > COLLEGE_LOGO_MAX_BYTES) {
      throw new BadRequestException('Logos must be 2 MB or smaller.');
    }
    if (sniffMimeType(file.buffer) !== file.mimetype) {
      throw new BadRequestException(
        "That file's contents do not match its type.",
      );
    }

    const output = await this.normaliseCollegeLogo(file.buffer);
    const key = `colleges/${randomBytes(16).toString('hex')}.webp`;
    await this.storageProvider.upload(key, output, 'image/webp');

    const media = await this.prisma.media.create({
      data: {
        ownerId: null,
        objectKey: key,
        provider: this.providerName,
        bucket: this.bucketName,
        storageKey: key,
        type: 'IMAGE',
        mimeType: 'image/webp',
        fileSize: output.length,
        visibility: 'public',
      },
    });
    return { key, mediaId: media.id };
  }

  /**
   * Checks a logo is a decodable square image and returns it as a 512px (or
   * smaller, never enlarged) WebP with metadata stripped.
   */
  private async normaliseCollegeLogo(input: Buffer): Promise<Buffer> {
    const invalid = new BadRequestException('That image could not be read.');
    try {
      const image = sharp(input, {
        limitInputPixels: COLLEGE_LOGO_MAX_INPUT_PIXELS,
      }).rotate(); // apply EXIF orientation before measuring
      const meta = await image.metadata();
      // Orientations 5-8 swap the stored width and height.
      const swapped = (meta.orientation ?? 1) >= 5;
      const width = (swapped ? meta.height : meta.width) ?? 0;
      const height = (swapped ? meta.width : meta.height) ?? 0;
      if (!width || !height) throw invalid;
      if (width !== height) {
        throw new BadRequestException(
          `Logos must be square (1:1); this image is ${width}x${height}px.`,
        );
      }
      if (width < COLLEGE_LOGO_MIN_PX) {
        throw new BadRequestException(
          `Logos must be at least ${COLLEGE_LOGO_MIN_PX}x${COLLEGE_LOGO_MIN_PX}px.`,
        );
      }
      // withoutEnlargement: a 256px logo stays 256px. No withMetadata(), so
      // EXIF/GPS/ICC are not carried into the output.
      return await image
        .resize(COLLEGE_LOGO_SIZE_PX, COLLEGE_LOGO_SIZE_PX, {
          fit: 'cover',
          withoutEnlargement: true,
        })
        .webp({ quality: 85 })
        .toBuffer();
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw invalid;
    }
  }

  private isAllowedMimeType(contentType: string): boolean {
    return isAllowedUploadType(contentType);
  }

  private extensionForMime(contentType: string): string {
    return extensionForMime(contentType);
  }

  async delete(key: string): Promise<boolean> {
    const deleted = await this.storageProvider.delete(key);
    if (deleted) {
      await this.prisma.media.deleteMany({ where: { objectKey: key } });
    }
    return deleted;
  }

  /**
   * Discard an orphaned upload: deletes the storage object + Media row ONLY when
   * it is owned by the caller AND not yet attached to a post. Used to clean up
   * after a post-creation failure so a successful upload never leaves an orphan.
   * Safe/idempotent — returns false without touching anything it doesn't own.
   */
  async discardOwnedUnattached(
    key: string,
    userId: string,
  ): Promise<{ discarded: boolean }> {
    if (!this.isSafeStorageKey(key)) return { discarded: false };
    const media = await this.prisma.media.findUnique({
      where: { objectKey: key },
      select: { id: true, ownerId: true, postId: true },
    });
    if (!media || media.ownerId !== userId || media.postId) {
      return { discarded: false };
    }
    /*
     * A chat attachment has no `postId` to say it is in use: it is attached by
     * a message payload naming it. The client discards what a cancelled upload
     * left behind, and a cancel can race the send, so a key any message names
     * (or whose original it names, for a `_thumb`) is kept.
     */
    if (this.isConversationScopedKey(key)) {
      const named = await this.prisma.message.findFirst({
        where: {
          OR: [
            {
              payload: {
                path: ['mediaUrl'],
                string_contains: key.replace(/_thumb\.[A-Za-z0-9]+$/i, '.'),
              },
            },
            // A photo's separate thumbnail is named only here.
            { payload: { path: ['thumbnailUrl'], string_contains: key } },
          ],
        },
        select: { id: true },
      });
      if (named) return { discarded: false };
    }
    await this.storageProvider.delete(key).catch(() => {});
    await this.prisma.media.deleteMany({
      where: { objectKey: key, ownerId: userId, postId: null },
    });
    this.logger.log(
      `discardOwnedUnattached: removed orphan media key=${key} owner=${userId}`,
    );
    return { discarded: true };
  }
}
