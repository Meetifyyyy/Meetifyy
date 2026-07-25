import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  console.log('Starting media migration...');

  // 1. Migrate Users Avatar
  console.log('Migrating User Avatars...');
  const usersWithAvatars = await prisma.user.findMany({
    where: { avatar: { not: null }, avatarMediaId: null },
  });

  for (const user of usersWithAvatars) {
    if (!user.avatar) continue;
    
    let objectKey = user.avatar;
    let provider = 'external';
    let bucket = 'external';
    
    if (user.avatar.startsWith('/api/media/')) {
      objectKey = user.avatar.replace('/api/media/', '');
      provider = 'supabase';
      bucket = 'meetifyy-dev'; // default bucket
    }

    let media = await prisma.media.findUnique({ where: { objectKey } });
    if (!media) {
      media = await prisma.media.create({
        data: {
          ownerId: user.id,
          objectKey,
          provider,
          bucket,
          mimeType: 'image/jpeg',
          fileSize: 0,
        },
      });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { avatarMediaId: media.id },
    });
  }
  
  // 2. Migrate Users Cover
  console.log('Migrating User Covers...');
  const usersWithCovers = await prisma.user.findMany({
    where: { cover: { not: null }, coverMediaId: null },
  });

  for (const user of usersWithCovers) {
    if (!user.cover) continue;
    
    let objectKey = user.cover;
    let provider = 'external';
    let bucket = 'external';
    
    if (user.cover.startsWith('/api/media/')) {
      objectKey = user.cover.replace('/api/media/', '');
      provider = 'supabase';
      bucket = 'meetifyy-dev';
    }

    let media = await prisma.media.findUnique({ where: { objectKey } });
    if (!media) {
      media = await prisma.media.create({
        data: {
          ownerId: user.id,
          objectKey,
          provider,
          bucket,
          mimeType: 'image/jpeg',
          fileSize: 0,
        },
      });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { coverMediaId: media.id },
    });
  }

  // 3. Migrate Community Avatar
  console.log('Migrating Community Avatars...');
  const communitiesWithAvatars = await prisma.community.findMany({
    where: { avatarKey: { not: null }, avatarMediaId: null },
  });

  for (const community of communitiesWithAvatars) {
    if (!community.avatarKey) continue;
    
    let objectKey = community.avatarKey;
    let provider = 'external';
    let bucket = 'external';
    
    if (community.avatarKey.startsWith('/api/media/')) {
      objectKey = community.avatarKey.replace('/api/media/', '');
      provider = 'supabase';
      bucket = 'meetifyy-dev';
    }

    let media = await prisma.media.findUnique({ where: { objectKey } });
    if (!media) {
      media = await prisma.media.create({
        data: {
          ownerId: community.ownerId || 'system',
          objectKey,
          provider,
          bucket,
          mimeType: 'image/jpeg',
          fileSize: 0,
        },
      });
    }

    await prisma.community.update({
      where: { id: community.id },
      data: { avatarMediaId: media.id },
    });
  }

  // 4. Migrate Community Cover
  console.log('Migrating Community Covers...');
  const communitiesWithCovers = await prisma.community.findMany({
    where: { coverKey: { not: null }, coverMediaId: null },
  });

  for (const community of communitiesWithCovers) {
    if (!community.coverKey) continue;
    
    let objectKey = community.coverKey;
    let provider = 'external';
    let bucket = 'external';
    
    if (community.coverKey.startsWith('/api/media/')) {
      objectKey = community.coverKey.replace('/api/media/', '');
      provider = 'supabase';
      bucket = 'meetifyy-dev';
    }

    let media = await prisma.media.findUnique({ where: { objectKey } });
    if (!media) {
      media = await prisma.media.create({
        data: {
          ownerId: community.ownerId || 'system',
          objectKey,
          provider,
          bucket,
          mimeType: 'image/jpeg',
          fileSize: 0,
        },
      });
    }

    await prisma.community.update({
      where: { id: community.id },
      data: { coverMediaId: media.id },
    });
  }

  console.log('Migration complete!');
  await app.close();
}

bootstrap();
