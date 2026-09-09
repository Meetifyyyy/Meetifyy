import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { EmailModule } from '../email/email.module';
import { UserSessionService } from './session/user-session.service';

@Module({
  imports: [EmailModule],
  providers: [AuthService, UserSessionService],
  controllers: [AuthController],
  // The guard resolves session state, and the account-deletion and
  // password-change paths revoke sessions, so the service leaves this module.
  exports: [UserSessionService],
})
export class AuthModule {}
