import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../uploads/uploads.service';
import { MediaCleanupService } from '../uploads/media-cleanup.service';
import { normaliseWhitespace, truncateToChars } from './share-text.util';

/**
 * The one authority on whether a post may be shown to the public internet.
 *
 * EVERY externally reachable share surface goes through `getPublicPost` — the
 * crawler HTML document, the OG image, and the signed-out post page. That is
 * the point of the file: the alternative is three call sites each deciding for
 * themselves what "public" means, and the one that gets it wrong is the one
 * that leaks. Adding a fourth surface means calling this, never re-deriving it.
 *
 * WHAT "PUBLIC" MEANS HERE, AND WHY EACH CLAUSE IS PRESENT
 *
 *   - The post is not soft-deleted.
 *   - The author's account is available: `deletedAt` is null AND the status is
 *     ACTIVE. `deletedAt` alone is what the rest of the app checks (see
 *     PostsService.AVAILABLE_AUTHOR), because it is stamped the moment deletion
 *     is requested. This adds the status check on top, which the in-app read
 *     path deliberately does not: inside the app a SUSPENDED or BANNED author's
 *     post is still visible to members, but pushing it onto WhatsApp under a
 *     permanent, unauthenticated URL is a different act, and the conservative
 *     answer is the right default for a surface nobody can retract.
 *   - The post is not in a community, or is in one that is not deleted, not
 *     private, and not a campus community. A campus community is restricted to
 *     verified students of one college even for its own members, so its posts
 *     are by definition not externally shareable.
 *
 * WHAT IS DELIBERATELY NOT CHECKED
 *
 * Blocks. A block is a relationship between two accounts, and an unfurler has
 * no account — there is no viewer for `blockerId` to be. The in-app read path
 * still applies every block filter it always did; this surface simply has no
 * viewer to filter for. Treating "someone, somewhere has blocked this author"
 * as grounds to withhold a public preview would let any account suppress any
 * other account's links.
 *
 * The gate is expressed as WHERE clauses rather than as post-fetch `if`
 * statements on purpose: a post that fails any of them is not fetched at all,
 * so there is no intermediate value holding private data that a later edit
 * could accidentally serialize.
 */
@Injectable()
export class SharePreviewService {
  private readonly logger = new Logger(SharePreviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly mediaCleanup: MediaCleanupService,
  ) {}

  /**
   * How much post text ever leaves this service.
   *
   * The description in a link preview is a teaser, not a copy of the post. A
   * post can be 2,000 characters; publishing all of them in a meta tag would
   * make the unfurled card a complete, permanently cached mirror of content the
   * author can otherwise delete. 180 characters is what the platforms display
   * anyway — X truncates around 200, WhatsApp far shorter.
   */
  static readonly DESCRIPTION_MAX_CHARS = 180;

  /** Text that reaches the card art. Longer than the description; still capped. */
  static readonly CARD_TEXT_MAX_CHARS = 600;

  /**
   * The public projection of a post, or null when it is not publicly shareable.
   *
   * Null is the answer for every failure — deleted, private, restricted,
   * unavailable author, malformed id, no such post. Callers must not
   * distinguish between them in what they return to the client either: "this
   * post is private" and "this post does not exist" have to be the same
   * response, or the endpoint becomes an oracle for the existence of private
   * posts.
   */
  async getPublicPost(postId: string): Promise<PublicSharePost | null> {
    if (!isUuid(postId)) return null;

    // ONE query, and it has to stay one: this runs on an unauthenticated,
    // crawler-facing path where a burst of fetches arrives together. The author,
    // the community gate, the gallery, the counts and the poll all come back in
    // this single round trip — no N+1, and nothing lazily loaded further down.
    const post = await this.prisma.post.findFirst({
      where: {
        id: postId,
        deletedAt: null,
        author: { deletedAt: null, accountStatus: 'ACTIVE' },
        OR: [
          { communityId: null },
          {
            community: {
              deletedAt: null,
              isPrivate: false,
              isCampusCommunity: false,
            },
          },
        ],
      },
      select: {
        id: true,
        text: true,
        createdAt: true,
        updatedAt: true,
        author: {
          select: {
            username: true,
            displayName: true,
            avatar: true,
            // Part of the cache key, not of the card. See `versionToken`: a
            // rename has to retire the cards that carry the old name, and the
            // post's own `updatedAt` cannot see it happen.
            updatedAt: true,
          },
        },
        community: { select: { name: true } },
        media: {
          // The order the post itself renders in, so the card's image is the
          // one a viewer sees first rather than an arbitrary row.
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
          // Bounded, and deliberately larger than one. The primary asset is not
          // always `media[0]`: a gallery whose first item is a video still has
          // photographs further down that make a far better card, and picking
          // them needs the rows to choose from. The composer caps a post at six
          // attachments; twelve leaves room for the older rows that predate it
          // without ever letting this become an unbounded read.
          take: MEDIA_SCAN_LIMIT,
          where: ORIGINALS_ONLY,
          select: {
            objectKey: true,
            mimeType: true,
            type: true,
            width: true,
            height: true,
            visibility: true,
          },
        },
        pollOptions: {
          // Same ordering `PostsService` uses when it shapes a poll for the
          // app, so the card lists the options in the order a voter sees them.
          orderBy: { id: 'asc' },
          take: POLL_OPTION_LIMIT,
          select: { text: true },
          // `voteCount` is deliberately NOT selected. Two reasons, and either
          // alone would be enough. It is somebody's tally of other people's
          // choices, which is not part of what "share a link" should publish;
          // and the card is cached against the post's `updatedAt`, which does
          // not move when a vote is cast, so any count drawn onto it would be
          // frozen at whatever it was the first time the link was unfurled.
        },
        _count: {
          select: { media: { where: ORIGINALS_ONLY }, pollOptions: true },
        },
      },
    });

    if (!post) return null;

    const gallery = this.buildGallery(post.media);
    const pollOptions = post.pollOptions.map((option) => option.text);

    return {
      id: post.id,
      text: normaliseWhitespace(post.text ?? ''),
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      authorUpdatedAt: post.author.updatedAt,
      author: {
        username: post.author.username,
        displayName: post.author.displayName,
        avatarUrl: this.resolveAvatarUrl(post.author.avatar),
      },
      communityName: post.community?.name ?? null,
      image: gallery.images[0] ?? null,
      gallery: gallery.images,
      video: gallery.video,
      mediaKind: gallery.kind,
      imageCount: gallery.imageCount,
      videoCount: gallery.videoCount,
      mediaCount: post._count.media,
      isPoll: post._count.pollOptions > 0,
      pollOptions,
      pollOptionCount: post._count.pollOptions,
    };
  }

  /**
   * Turns the post's media rows into the assets the card and the metadata use.
   *
   * THE SELECTION IS DETERMINISTIC, AND HAS TO BE
   * A preview that changes between two fetches of the same URL is worse than a
   * plain one: unfurlers cache aggressively and inconsistently, so two people
   * sharing the same post would see different cards with no way to explain it.
   * The rows arrive in the post's own render order and are partitioned by kind
   * with that order preserved; nothing here consults a clock or a random.
   *
   * PHOTOGRAPHS WIN OVER VIDEO, WHEREVER THEY SIT IN THE GALLERY
   * A post whose first attachment is a video and whose second is a photograph
   * used to preview as though it had no media at all, because the code looked
   * only at `media[0]`. An unfurler cannot play a video, so the photograph is
   * always the better answer — the video is still represented in the metadata
   * and on the post page, which is where it can actually be watched.
   */
  private buildGallery(rows: MediaRow[]): {
    images: ShareImage[];
    video: ShareVideo | null;
    kind: MediaKind;
    imageCount: number;
    videoCount: number;
  } {
    const usable = rows.filter(
      (row) =>
        row.visibility === 'public' &&
        !this.storage.isAlwaysPrivateKey(row.objectKey),
    );

    const images = usable
      .filter(isServableImage)
      .slice(0, GALLERY_LIMIT)
      .map((row) => this.toShareImage(row));

    const videos = usable.filter(isServableVideo);
    const firstVideo = videos[0] ?? null;

    return {
      images,
      video: firstVideo
        ? {
            url: this.storage.getPublicUrl(firstVideo.objectKey),
            mimeType: firstVideo.mimeType,
            width: firstVideo.width ?? null,
            height: firstVideo.height ?? null,
            // Videos in this pipeline have no poster frame: the uploader stores
            // the file and nothing else, so there is no `_thumb` row for an mp4
            // and no frame to reach for. The key is offered anyway because
            // `variantKeysFor` says it is where one WOULD live — the renderer
            // treats it as a guess that is allowed to 404, which costs one
            // cheap request and means a poster starts appearing automatically
            // if the upload pipeline ever produces one. Extracting a frame here
            // instead would mean decoding video inside a web request, which is
            // the one thing this path must not do.
            posterUrl: this.storage.getPublicUrl(
              this.mediaCleanup.variantKeysFor(firstVideo.objectKey)[1] ??
                firstVideo.objectKey,
            ),
          }
        : null,
      kind: images.length > 0 ? 'image' : firstVideo ? 'video' : 'none',
      imageCount: usable.filter(isServableImage).length,
      videoCount: videos.length,
    };
  }

  /**
   * One media row as a card asset, with both URLs the renderer may try.
   *
   * The ORIGINAL first and the `_thumb.webp` variant as the fallback — the
   * opposite order to the avatar, and deliberately so. The card draws a
   * photograph into a panel up to 540x630, and the thumb is a grid tile around
   * 480px on its long edge; preferring it upscales a smaller source into a
   * larger panel for no saving worth having, because the originals this
   * pipeline stores are already compressed on upload and measured in tens of
   * kilobytes. `fetchImageBytes` caps anything unusual at 6MB.
   *
   * The avatar takes the opposite preference, and correctly so: it is drawn at
   * 88 pixels, where the thumb is already larger than the target.
   */
  private toShareImage(row: MediaRow): ShareImage {
    return {
      url: this.storage.getPublicUrl(row.objectKey),
      fallbackUrl: this.storage.getPublicUrl(
        this.mediaCleanup.variantKeysFor(row.objectKey)[1] ?? row.objectKey,
      ),
      width: row.width ?? null,
      height: row.height ?? null,
    };
  }

  /**
   * The version token in the OG image URL, and the content half of the cache
   * key. One function, so the URL and the cache cannot fall out of step.
   *
   * WHAT IT COVERS
   * `Post.updatedAt` is Prisma's `@updatedAt`, so editing a post moves it and
   * the card gets a new URL — nothing has to be purged, because an edited post
   * is simply a different address. `User.updatedAt` is here for the case that
   * column cannot see: an author renaming themselves changes what every one of
   * their cards SAYS while touching none of their posts. Without it a rename
   * left the old name on every shared link for the cache's whole lifetime.
   *
   * WHAT IT DELIBERATELY DOES NOT COVER
   * Poll votes. They are not drawn on the card (see the `pollOptions` select),
   * precisely because nothing in this token moves when someone votes — a count
   * on the card would be frozen at whatever it was when the link was first
   * unfurled, which is worse than not showing one.
   */
  static versionToken(
    post: Pick<PublicSharePost, 'updatedAt' | 'authorUpdatedAt'>,
  ): string {
    return `${post.updatedAt.getTime()}-${post.authorUpdatedAt.getTime()}`;
  }

  /**
   * The teaser used for `og:description` and `twitter:description`.
   *
   * Falls back to a neutral line rather than an empty tag: a post can legally
   * be an image with no text at all, and platforms render a missing description
   * as a bare URL.
   */
  static description(post: PublicSharePost): string {
    const text = post.text.replace(/\n+/g, ' ').trim();

    // A poll's question IS its text, so the description leads with it and then
    // says how many ways there are to answer — which is the one fact about a
    // poll that makes a link worth opening, and the only one that is not
    // somebody's private choice.
    if (post.isPoll) {
      const options =
        post.pollOptionCount > 0
          ? `Poll · ${post.pollOptionCount} options · Vote on Meetifyy.`
          : 'Vote in this poll on Meetifyy.';
      if (!text) return options;
      return truncateToChars(
        `${text} — ${options}`,
        SharePreviewService.DESCRIPTION_MAX_CHARS,
      );
    }

    if (text) {
      return truncateToChars(text, SharePreviewService.DESCRIPTION_MAX_CHARS);
    }
    if (post.mediaKind === 'video') return 'Watch this video on Meetifyy.';
    if (post.imageCount > 1) {
      return `See these ${post.imageCount} photos on Meetifyy.`;
    }
    if (post.mediaKind === 'image') return 'See this photo on Meetifyy.';
    return 'See this post on Meetifyy.';
  }

  /** The `og:title`, e.g. "Alex shared a post on Meetifyy". */
  static title(post: PublicSharePost, appName: string): string {
    const name = post.author.displayName?.trim() || `@${post.author.username}`;
    return `${name} shared ${SharePreviewService.noun(post)} on ${appName}`;
  }

  /**
   * What the post is, in words, for a title.
   *
   * Ordered by what a reader would call the post if asked. A poll with a
   * photograph on it is still a poll; a gallery is "photos", not "a photo";
   * and a post carrying both a video and photographs leads with the video,
   * because that is the thing you cannot see in the preview and therefore the
   * reason to open the link.
   */
  static noun(post: PublicSharePost): string {
    if (post.isPoll) return 'a poll';
    if (post.videoCount > 0 && post.imageCount > 0) return 'a video and photos';
    if (post.videoCount > 1) return `${post.videoCount} videos`;
    if (post.videoCount === 1) return 'a video';
    if (post.imageCount > 1) return `${post.imageCount} photos`;
    if (post.imageCount === 1) return 'a photo';
    return 'a post';
  }

  /**
   * An avatar URL, or null when the user has none.
   *
   * Prefers the `_thumb.webp` variant the upload pipeline already produces for
   * `avatars/` — the card draws it at 104px, so pulling the full-size original
   * through the renderer would be pure waste. `variantKeysFor` is the same
   * function media cleanup uses to decide which derived files belong to a key,
   * so the two cannot drift apart. The renderer falls back to the original if
   * the variant 404s, which is why guessing here is safe.
   */
  private resolveAvatarUrl(avatar: string | null): string | null {
    if (!avatar) return null;
    if (/^https?:\/\//i.test(avatar)) return avatar;

    const key = avatar.replace(/^\/+(?:api\/media\/)?/, '');
    if (!key || this.storage.isAlwaysPrivateKey(key)) return null;

    const [, thumb] = this.mediaCleanup.variantKeysFor(key);
    return this.storage.getPublicUrl(thumb ?? key);
  }
}

/**
 * What the post's PREVIEW is built from — not what the post contains.
 *
 * A gallery holding a video and four photographs is 'image', because the
 * photographs are what an unfurler can show. `videoCount` and `imageCount`
 * carry the fuller truth for the copy.
 */
export type MediaKind = 'image' | 'video' | 'none';

/**
 * One image the card may draw, offered as two URLs.
 *
 * `url` is the preferred source and `fallbackUrl` the one to try if it fails:
 * the upload pipeline does not produce a `_thumb` variant for every key, so one
 * of the pair is always a guess that has to be allowed to miss.
 */
export interface ShareImage {
  url: string;
  fallbackUrl: string;
  width: number | null;
  height: number | null;
}

/**
 * The post's first video, for metadata and for the card's video treatment.
 *
 * `posterUrl` is where a poster frame WOULD live if the upload pipeline made
 * one. It does not today, so this is a guess the renderer is allowed to miss —
 * never a promise that a frame exists.
 */
export interface ShareVideo {
  url: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  posterUrl: string;
}

export interface PublicSharePost {
  id: string;
  /** Whitespace-normalised post text. May be empty for a media-only post. */
  text: string;
  createdAt: Date;
  updatedAt: Date;
  /**
   * The author row's own `updatedAt`, carried only so the cache key can see a
   * rename. Never rendered. See `versionToken`.
   */
  authorUpdatedAt: Date;
  author: {
    username: string;
    displayName: string;
    avatarUrl: string | null;
  };
  communityName: string | null;

  /**
   * The canonical primary preview image — `gallery[0]`, or null.
   *
   * Every platform that unfurls a link shows exactly one image, so this is the
   * one `og:image` names. The rest of the gallery stays on the post page, where
   * it can actually be browsed.
   */
  image: ShareImage | null;

  /**
   * The images the card may compose, in the post's own order, capped.
   *
   * More than one so a gallery can be shown as a gallery rather than as a
   * single frame that hides what else is there. Bounded because each entry is a
   * download and a decode inside a request an unfurler is waiting on.
   */
  gallery: ShareImage[];

  /** The post's first video, or null. Metadata and the card's fallback art. */
  video: ShareVideo | null;

  /** What the preview is built from. See MediaKind. */
  mediaKind: MediaKind;

  /** Publicly servable images on the post — not capped by GALLERY_LIMIT. */
  imageCount: number;
  /** Publicly servable videos on the post. */
  videoCount: number;
  /** Every attachment, whatever its kind, so the card can say "+3". */
  mediaCount: number;

  isPoll: boolean;
  /** The poll's options, in ballot order, capped. Never their vote counts. */
  pollOptions: string[];
  /** How many options the poll really has, so the card can say "+2 more". */
  pollOptionCount: number;
}

/**
 * How many media rows the query reads before choosing.
 *
 * Larger than the composer's six-attachment cap so older posts with more rows
 * still get a correct choice, and small enough that this can never become an
 * unbounded read on a public endpoint.
 */
const MEDIA_SCAN_LIMIT = 12;

/**
 * How many images the card may compose.
 *
 * Three, because that is what the layout can show without any of them becoming
 * too small to read — and because each one is a download and a decode on a path
 * an unfurler is timing. A fourth would cost a third of the render budget to
 * add a tile the size of a thumbnail.
 */
const GALLERY_LIMIT = 3;

/** How many poll options the card lists before summarising the rest. */
const POLL_OPTION_LIMIT = 4;

/** The media columns this service reads. */
type MediaRow = {
  objectKey: string;
  mimeType: string;
  type: string | null;
  width: number | null;
  height: number | null;
  visibility: string;
};

/**
 * Excludes the derived `_thumb.webp` rows from a post's media.
 *
 * Post attachments are stored as TWO `Media` rows each: the original, and the
 * `<key>_thumb.webp` variant the upload pipeline generates for grids. Both
 * carry the same `postId` and the same `order`, so counting rows reports a
 * six-photo post as twelve attachments, and "first by order then by id" can
 * pick the thumbnail as the primary image by coin toss.
 *
 * Filtered in the query rather than after it, so `_count` is filtered by the
 * same rule and the two cannot disagree. The pattern matches
 * `MediaCleanupService.variantKeysFor`, which is this codebase's existing
 * definition of a derived variant.
 */
const ORIGINALS_ONLY = {
  NOT: { objectKey: { endsWith: '_thumb.webp' } },
} as const;

/**
 * Post ids are uuids. Checking the shape before querying keeps a scan of
 * arbitrary strings off the database and makes an invalid id indistinguishable
 * from a missing one, which is the response every failure has to share.
 */
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(value ?? ''),
  );
}

/**
 * Formats this renderer can decode. Anything else is treated as absent.
 *
 * An allow-list rather than "anything image/*": sharp is what decodes these,
 * and handing it a format it cannot read turns a card into an exception on a
 * public endpoint. SVG is excluded deliberately — it is a document, it can
 * reference remote resources, and rasterising user-supplied SVG inside a
 * request is a class of problem this feature has no reason to take on.
 */
const DECODABLE_IMAGE = /^image\/(png|jpe?g|webp|gif|avif|tiff?)$/i;

/**
 * Whether a media row is a still image the card can draw.
 *
 * `Media.type` is stored UPPERCASE ('IMAGE', 'VIDEO') and is nullable on older
 * rows, so the mime type is the primary signal and `type` only ever vetoes.
 * Comparing `type` against a lowercase literal once rejected every real image
 * post and sent them all down the text-only path — which looked like a working
 * feature, because a card still came out.
 */
function isServableImage(media: MediaRow): boolean {
  if (media.type && media.type.toLowerCase() === 'video') return false;
  return DECODABLE_IMAGE.test(media.mimeType);
}

/**
 * Whether a media row is a video.
 *
 * Videos are never decoded here — see `buildGallery` — but they still have to
 * be recognised, so the copy can say "a video" and the metadata can name the
 * file for the platforms that use it.
 */
function isServableVideo(media: MediaRow): boolean {
  return (
    /^video\//i.test(media.mimeType) || media.type?.toLowerCase() === 'video'
  );
}
