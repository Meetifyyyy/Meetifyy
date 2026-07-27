import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { UsersModule } from '../users/users.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [UsersModule, RedisModule],
  controllers: [SearchController],
  providers: [SearchService]
})
export class SearchModule {}
