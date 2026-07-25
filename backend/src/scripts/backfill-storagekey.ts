import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  console.log('Starting media storageKey backfill...');

  const allMedia = await prisma.media.findMany({
    where: { storageKey: null }
  });

  console.log(`Found ${allMedia.length} media records without storageKey.`);

  for (const media of allMedia) {
    let type = 'IMAGE';
    if (media.mimeType && media.mimeType.startsWith('video')) {
      type = 'VIDEO';
    } else if (media.objectKey && media.objectKey.endsWith('.mp4')) {
      type = 'VIDEO';
    }

    await prisma.media.update({
      where: { id: media.id },
      data: {
        storageKey: media.objectKey,
        type: type,
      }
    });
  }

  console.log('Backfill complete!');
  await app.close();
}

bootstrap();
