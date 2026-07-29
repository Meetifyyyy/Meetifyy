import { Module } from '@nestjs/common';
import { InstantMatchService } from './instant-match.service';
import { PrismaModule } from '../prisma/prisma.module';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [
    PrismaModule,
    MessagesModule,
  ],
  providers: [InstantMatchService],
  exports: [InstantMatchService],
})
export class InstantMatchModule {}
