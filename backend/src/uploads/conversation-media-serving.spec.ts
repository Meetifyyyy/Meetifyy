import type { Response } from 'express';
import { UploadsController } from './uploads.controller';
import { stub } from '../common/testing/stub';
import type { StorageService } from './uploads.service';

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

  /** An Express response that records what the controller did with it. */
  type RecordedResponse = Response & {
    headers: Record<string, string>;
    redirectedTo: string | null;
    ended: boolean;
  };

  const buildRes = (): RecordedResponse => {
    // `statusCode` starts unset: the controller never reads it, and every
    // assertion on it follows a `status()` call.
    const res: RecordedResponse = stub<RecordedResponse>({
      headers: {},
      redirectedTo: null,
      ended: false,
      setHeader: jest.fn((k: string, v: string) => {
        res.headers[k.toLowerCase()] = v;
      }),
      removeHeader: jest.fn(() => {}),
      status: jest.fn((code: number) => {
        res.statusCode = code;
        return res;
      }),
      redirect: jest.fn((url: string) => {
        res.redirectedTo = url;
        return res;
      }),
      end: jest.fn(() => {
        res.ended = true;
        return res;
      }),
      sendFile: jest.fn(() => {
        throw new Error('should not read from local disk');
      }),
      send: jest.fn(() => {
        throw new Error('should not send a body');
      }),
    });
    return res;
  };

  const storageDefaults = () => ({
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
  });

  const build = (over: Partial<ReturnType<typeof storageDefaults>> = {}) => {
    const storage = { ...storageDefaults(), ...over };
    return {
      controller: new UploadsController(stub<StorageService>(storage)),
      storage,
    };
  };

  const serve = (
    controller: UploadsController,
    res: RecordedResponse,
    viewerId: string | null,
  ) => controller['handleGetMedia'](KEY, 'chat', res, viewerId);

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
      canViewConversationMedia: jest.fn((_k: string, v: unknown) =>
        Promise.resolve(Boolean(v)),
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
