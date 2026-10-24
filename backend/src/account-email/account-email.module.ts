import { Module } from '@nestjs/common';
import { AccountEmailController } from './account-email.controller';
import { AccountEmailService } from './account-email.service';
import { UserOtpModule } from '../otp/user-otp.module';
import { EmailModule } from '../email/email.module';
import { AuthModule } from '../auth/auth.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { AccountSecurityModule } from '../account-security/account-security.module';

@Module({
  imports: [
    UserOtpModule,
    EmailModule,
    AuthModule,
    SupabaseModule,
    AccountSecurityModule,
  ],
  controllers: [AccountEmailController],
  providers: [AccountEmailService],
})
export class AccountEmailModule {}
