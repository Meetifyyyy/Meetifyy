import { Module } from '@nestjs/common';
import { CampusAffiliationController } from './campus-affiliation.controller';
import { CampusAffiliationService } from './campus-affiliation.service';
import { UserOtpModule } from '../otp/user-otp.module';
import { EmailModule } from '../email/email.module';
import { AuthModule } from '../auth/auth.module';
import { AccountSecurityModule } from '../account-security/account-security.module';

@Module({
  imports: [UserOtpModule, EmailModule, AuthModule, AccountSecurityModule],
  controllers: [CampusAffiliationController],
  providers: [CampusAffiliationService],
  exports: [CampusAffiliationService],
})
export class CampusAffiliationModule {}
