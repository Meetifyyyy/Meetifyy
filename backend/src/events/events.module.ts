import { Global, Module } from '@nestjs/common';
import { DomainEventService } from './domain-event.service';

@Global()
@Module({
  providers: [DomainEventService],
  exports: [DomainEventService],
})
export class EventsModule {}
