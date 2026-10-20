// sanitize-html is ESM-only for Jest; this spec never touches it.
jest.mock('../common/utils/sanitize-html.util', () => ({
  htmlToPlainText: (html: string) => html,
}));

import { resolveAttachmentItems } from './support-email.builder';

describe('resolveAttachmentItems', () => {
  it('lists names and sizes and never emits a link to the private file', () => {
    const items = resolveAttachmentItems([
      { filename: 'screen.png', key: 'support/abc.png', size: 2048 },
      { filename: 'doc.pdf', storageKey: 'support/def.pdf', fileSize: 4096 },
    ]);

    expect(items).toEqual([
      { filename: 'screen.png', size: 2048 },
      { filename: 'doc.pdf', size: 4096 },
    ]);
    expect(items.every((item) => item.url === undefined)).toBe(true);
  });

  it('falls back to a generic name and skips malformed entries', () => {
    expect(
      resolveAttachmentItems([null, 'x', { key: 'support/a.png' }]),
    ).toEqual([{ filename: 'attachment', size: undefined }]);
    expect(resolveAttachmentItems(undefined)).toEqual([]);
  });
});
