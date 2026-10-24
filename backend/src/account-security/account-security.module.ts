import { Module } from '@nestjs/common';
import { ReauthController } from './reauth.controller';
import { ReauthService } from './reauth.service';
import { EmailChangePolicyService } from './email-change-policy.service';
import { AuthEmailGuardCheck } from './auth-email-guard.check';
import { UserOtpModule } from '../otp/user-otp.module';
import { EmailModule } from '../email/email.module';
import { AuthModule } from '../auth/auth.module';
import { SupabaseModule } from '../supabase/supabase.module';

/**
 * Reauthentication grants and the email-change cooldowns, shared by the
 * sign-in email (account-email) and college email (campus-affiliation) flows.
 */
@Module({
  imports: [UserOtpModule, EmailModule, AuthModule, SupabaseModule],
  controllers: [ReauthController],
  providers: [ReauthService, EmailChangePolicyService, AuthEmailGuardCheck],
  exports: [ReauthService, EmailChangePolicyService],
})
export class AccountSecurityModule {}
