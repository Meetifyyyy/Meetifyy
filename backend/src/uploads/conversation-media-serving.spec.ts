import { UploadsController } from './uploads.controller';

/**
 * How an authorized conversation attachment actually reaches the browser.
 *
 * Passing the authorization check was never the hard part — the bug was what
 * happened next. Everything past the check resolved the key to its PUBLIC
 * address and redirected there, which is wrong for a conversation attachment
 * in both directions:
 *
 *   • the public host does not serve the private bucket, so the redirect
 *     pointed at nothing and every chat image and video 404'd immediately
 *     after being authorized — which read as a permissions bug and was not one;
 *
 *   • where the object IS still on the public host, redirecting to it hands
 *     out a permanent, unauthenticated, unrevokable URL for a private message
 *     attachment, which is the exposure the check exists to close.
 */
describe('serving an authorized conversation attachment', () => {
  const KEY = 'chat/deadbeefdeadbeefdeadbeefdeadbeef.webp';

  const buildRes = () => {
    const res: any = {
      headers: {} as Record<string, string>,
      statusCode: null as number | null,
      redirectedTo: null as string | null,
      ended: false,
      setHeader(k: string, v: string) {
        this.headers[k.toLowerCase()] = v;
      },
      removeHeader() {},
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      redirect(url: string) {
        this.redirectedTo = url;
        return this;
      },
      end() {
        this.ended = true;
        return this;
      },
      sendFile() {
        throw new Error('should not read from local disk');
      },
      send() {
        throw new Error('should not send a body');
      },
    };
    return res;
  };

  const build = (over: Partial<Record<string, any>> = {}) => {
    const storage: any = {
      isSafeStorageKey: () => true,
      isAlwaysPrivateKey: () => false,
      isConversationScopedKey: () => true,
      canViewConversationMedia: jest.fn().mockResolvedValue(true),
      getSignedUrlForViewer: jest
        .fn()
        .mockResolvedValue('https://r2.example/signed?sig=abc'),
      getResolvedPublicUrl: jest
        .fn()
        .mockResolvedValue('https://pub-test.r2.dev/' + KEY),
      exists: jest.fn().mockResolvedValue(true),
      ...over,
    };
    return { controller: new UploadsController(storage), storage };
  };

  const serve = (controller: any, res: any, viewerId: string | null) =>
    (controller as any).handleGetMedia(KEY, 'chat', res, viewerId);

  it('redirects to a signed url, not the public one', async () => {
    const { controller, storage } = build();
    const res = buildRes();

    await serve(controller, res, 'viewer-1');

    expect(res.redirectedTo).toBe('https://r2.example/signed?sig=abc');
    expect(storage.getSignedUrlForViewer).toHaveBeenCalledWith(KEY);
    // The public-url path must not even be consulted for these.
    expect(storage.getResolvedPublicUrl).not.toHaveBeenCalled();
  });

  it('marks the redirect private and short-lived', async () => {
    // The signed url is scoped to one viewer's authorized request; a shared
    // cache holding it would hand it to the next person through.
    const { controller } = build();
    const res = buildRes();

    await serve(controller, res, 'viewer-1');

    expect(res.headers['cache-control']).toMatch(/^private, max-age=\d+$/);
  });

  it('refuses a viewer the conversation check rejects, without signing anything', async () => {
    const { controller, storage } = build({
      canViewConversationMedia: jest.fn().mockResolvedValue(false),
    });
    const res = buildRes();

    await serve(controller, res, 'stranger');

    expect(res.statusCode).toBe(404);
    expect(res.redirectedTo).toBeNull();
    expect(storage.getSignedUrlForViewer).not.toHaveBeenCalled();
  });

  it('refuses an anonymous request', async () => {
    const { controller, storage } = build({
      canViewConversationMedia: jest.fn(async (_k: string, v: unknown) =>
        Boolean(v),
      ),
    });
    const res = buildRes();

    await serve(controller, res, null);

    expect(res.statusCode).toBe(404);
    expect(storage.getSignedUrlForViewer).not.toHaveBeenCalled();
  });

  it('answers an authorized request for an object that is really gone with a miss', async () => {
    const { controller } = build({
      getSignedUrlForViewer: jest.fn().mockResolvedValue(null),
    });
    const res = buildRes();

    await serve(controller, res, 'viewer-1');

    expect(res.statusCode).toBe(404);
    expect(res.redirectedTo).toBeNull();
  });

  it('does not turn a signing failure into a 500', async () => {
    const { controller } = build({
      getSignedUrlForViewer: jest.fn().mockRejectedValue(new Error('r2 down')),
    });
    const res = buildRes();

    await serve(controller, res, 'viewer-1');

    expect(res.statusCode).toBe(404);
  });
});
