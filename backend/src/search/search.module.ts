import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { UsersModule } from '../users/users.module';
import { RedisModule } from '../redis/redis.module';
import { ActivityAccessModule } from '../activities/activity-access.module';

@Module({
  imports: [UsersModule, RedisModule, ActivityAccessModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
