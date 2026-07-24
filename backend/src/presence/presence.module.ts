import { Module, Global } from '@nestjs/common';
import { PresenceService } from './presence.service';

@Global()
@Module({
  providers: [PresenceService],
  exports: [PresenceService],
})
export class PresenceModule {}
