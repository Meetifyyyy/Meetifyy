import { Module } from '@nestjs/common';
import { CommunitiesController } from './communities.controller';
import { CommunitiesService } from './communities.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
  imports: [PrismaModule, SupabaseModule],
  controllers: [CommunitiesController],
  providers: [CommunitiesService],
})
export class CommunitiesModule {}
