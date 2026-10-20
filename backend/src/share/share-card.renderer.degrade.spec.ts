import sharp from 'sharp';
import { ShareCardRenderer } from './share-card.renderer';
import { sharePost, shareVideo } from './testing/share-post.fixture';

/**
 * A video post whose poster downloads but will not decode used to render
 * forever: the fallback dropped the gallery but kept the video, so the retry
 * fetched the same poster again.
 */
describe('ShareCardRenderer — undecodable media', () => {
  it('falls back to a plain card instead of recursing on an undecodable video poster', async () => {
    const renderer = new ShareCardRenderer();
    const loadTiles = jest
      .spyOn(
        renderer as unknown as {
          loadPreviewTiles: (p: { video: unknown }) => Promise<Buffer[]>;
        },
        'loadPreviewTiles',
      )
      // Mirrors the real rule: a poster is only fetched when there is a video
      // and no gallery, and here it downloads as bytes no codec can read.
      .mockImplementation((p) =>
        Promise.resolve(p.video ? [Buffer.from('not an image')] : []),
      );

    const jpeg = await renderer.render(
      sharePost({ video: shareVideo(), videoCount: 1, mediaKind: 'video' }),
    );

    expect((await sharp(jpeg).metadata()).format).toBe('jpeg');
    // One attempt with the poster, then a single media-free render.
    expect(loadTiles.mock.calls.length).toBeLessThanOrEqual(1);
  }, 15000);
});
