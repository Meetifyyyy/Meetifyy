import 'reflect-metadata';
import type { ConfigService } from '@nestjs/config';
import { PayloadTooLargeException } from '@nestjs/common';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type {
  ObjectMetadata,
  StorageProvider,
} from './providers/storage-provider.interface';
import { StorageService } from './uploads.service';
import { MessagingCoreService } from '../messages/core/messaging-core.service';
import { MessagesService } from '../messages/messages.service';
import { DmService } from '../messages/dm/dm.service';
import { GroupChatsService } from '../messages/group-chats/group-chats.service';

const MB = 1024 * 1024;

/**
 * A message attachment that did not come through a conversation upload is
 * measured at send time: a modified client could otherwise name a post's
 * 25 MB video as a chat attachment.
 */
describe('message attachment size at send time', () => {
  const getMetadata = jest.fn((_key: string): Promise<ObjectMetadata | null> =>
    Promise.resolve(null),
  );
  const findUnique = jest.fn(() => Promise.resolve({ mimeType: 'video/mp4' }));
  const service = new StorageService(
    stub<StorageProvider>({ getMetadata }),
    stub<PrismaService>({ media: { findUnique } }),
    stub<ConfigService>({}),
  );

  beforeEach(() => {
    getMetadata.mockReset().mockResolvedValue(null);
    findUnique.mockClear();
  });

  it('refuses a post video over the Messages limit', async () => {
    getMetadata.mockResolvedValue({
      contentLength: 20 * MB,
      contentType: 'video/mp4',
    });
    await expect(
      service.assertMessageAttachmentWithinLimits('/api/media/posts/big.mp4'),
    ).rejects.toThrow(PayloadTooLargeException);
    await expect(
      service.assertMessageAttachmentWithinLimits(
        'https://api.example/api/media/posts/big.mp4?x=1',
      ),
    ).rejects.toThrow('Video must be 15 MB or less');
  });

  it('lets a post image within the Messages limit through', async () => {
    getMetadata.mockResolvedValue({
      contentLength: 4 * MB,
      contentType: 'image/webp',
    });
    await expect(
      service.assertMessageAttachmentWithinLimits('/api/media/posts/p.webp'),
    ).resolves.toBeUndefined();
  });

  it('never measures conversation attachments, so older forwards keep working', async () => {
    await service.assertMessageAttachmentWithinLimits(
      '/api/media/chat/old-40mb.mp4',
    );
    await service.assertMessageAttachmentWithinLimits(
      '/api/media/voice/note.webm',
    );
    expect(getMetadata).not.toHaveBeenCalled();
  });

  it('ignores URLs that name nothing stored here', async () => {
    await service.assertMessageAttachmentWithinLimits(
      'https://media.giphy.com/media/abc/giphy.gif',
    );
    await service.assertMessageAttachmentWithinLimits(undefined);
    expect(getMetadata).not.toHaveBeenCalled();
  });

  it('is wired into every service that sends a message', () => {
    for (const cls of [
      MessagingCoreService,
      MessagesService,
      DmService,
      GroupChatsService,
    ]) {
      const props = Reflect.getMetadata('self:properties_metadata', cls) as
        Array<{ key: string; type: unknown }> | undefined;
      expect(props).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: 'attachmentStorage',
            type: StorageService,
          }),
        ]),
      );
    }
  });
});
