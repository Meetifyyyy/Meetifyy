import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { createClient } from '@supabase/supabase-js';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CloudflareR2Provider } from '../uploads/providers/cloudflare-r2.provider';

const logger = new Logger('StorageMigration');

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const configService = app.get(ConfigService);
  
  // Use the CloudflareR2Provider directly to upload files.
  const r2Provider = new CloudflareR2Provider(configService);

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    logger.error('Missing Supabase credentials in .env');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  logger.log('Fetching media records from Supabase...');
  const mediaToMigrate = await prisma.media.findMany({
    where: { provider: 'supabase' },
  });

  logger.log(`Found ${mediaToMigrate.length} files to migrate.`);

  let successCount = 0;
  let failCount = 0;

  for (const media of mediaToMigrate) {
    try {
      logger.log(`Migrating: ${media.objectKey}...`);

      // 1. Download from Supabase
      const { data, error } = await supabase
        .storage
        .from(media.bucket || 'meetifyy-dev')
        .download(media.objectKey);

      if (error) {
        logger.error(`Failed to download ${media.objectKey} from Supabase: ${error.message}`);
        failCount++;
        continue;
      }

      // Convert Blob to Buffer
      const arrayBuffer = await data.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // 2. Upload to Cloudflare R2
      await r2Provider.upload(media.objectKey, buffer, media.mimeType);

      // 3. Update Database Record
      await prisma.media.update({
        where: { id: media.id },
        data: {
          provider: 'r2',
          bucket: process.env.R2_BUCKET_NAME || 'meetifyy-media',
        },
      });

      logger.log(`✅ Successfully migrated ${media.objectKey}`);
      successCount++;
    } catch (err: any) {
      logger.error(`❌ Error migrating ${media.objectKey}:`, err);
      failCount++;
    }
  }

  logger.log(`Migration Complete! Success: ${successCount}, Failed: ${failCount}`);
  await app.close();
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
