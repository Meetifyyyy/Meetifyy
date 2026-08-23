import { BadRequestException } from '@nestjs/common';
import { StorageService } from './uploads.service';

/**
 * The upload folder allowlist.
 *
 * Community avatar and cover uploads failed because the editor has always
 * posted to 'community-icons' and 'community-covers' and neither was on this
 * list — every change was rejected with a 400 before a byte was uploaded, and
 * the client reported it as a generic "Upload failed". These tests pin each
 * folder the app actually sends against the list that accepts them, so the
 * two cannot drift apart again silently.
 */
describe('upload folder allowlist', () => {
  const service = new StorageService({} as any, {} as any, { get: () => undefined } as any);
  // The method is private by design; the allowlist is the unit under test.
  const normalize = (folder: string) => (service as any).normalizeFolder(folder);

  describe('folders the client sends', () => {
    // Every literal passed to processAndUploadImage / uploadFileDirect
    // anywhere in the frontend.
    const inUse = [
      'avatars',          // profile avatar
      'profile-covers',   // profile cover
      'community-icons',  // community avatar — the regression
      'community-covers', // community cover — the regression
      'communities',      // create-community dialog
      'posts',
      'chat',
      'voice',
      'defaults',         // platform default assets
    ];

    it.each(inUse)('accepts %s', (folder) => {
      expect(normalize(folder)).toBe(folder);
    });
  });

  it('keeps community icons and covers as separate prefixes', () => {
    // Folding them into 'communities' would work, but would lose the
    // icon/cover distinction that avatars and profile-covers already keep
    // for users.
    expect(normalize('community-icons')).not.toBe(normalize('community-covers'));
  });

  it('still rejects a folder nothing sends', () => {
    expect(() => normalize('arbitrary')).toThrow(BadRequestException);
  });

  it('rejects an attempt to escape the prefix', () => {
    expect(() => normalize('../secrets')).toThrow(BadRequestException);
    expect(() => normalize('avatars/../..')).toThrow(BadRequestException);
  });

  it('names the allowed folders in the error, so a mismatch is diagnosable', () => {
    // The failure that started this was invisible partly because nobody read
    // the message. It should at least be worth reading.
    expect(() => normalize('nope')).toThrow(/community-icons/);
  });
});
