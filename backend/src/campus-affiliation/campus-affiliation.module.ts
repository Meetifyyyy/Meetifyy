import { Module } from '@nestjs/common';
import { CampusAffiliationController } from './campus-affiliation.controller';
import { CampusAffiliationService } from './campus-affiliation.service';
import { UserOtpModule } from '../otp/user-otp.module';
import { EmailModule } from '../email/email.module';
import { AuthModule } from '../auth/auth.module';
import { AccountSecurityModule } from '../account-security/account-security.module';
import { CommunitiesModule } from '../communities/communities.module';

@Module({
  // CommunitiesModule: the cache and realtime follow-up of leaving campus
  // communities when an affiliation ends. It imports nothing from here.
  imports: [
    UserOtpModule,
    EmailModule,
    AuthModule,
    AccountSecurityModule,
    CommunitiesModule,
  ],
  controllers: [CampusAffiliationController],
  providers: [CampusAffiliationService],
  exports: [CampusAffiliationService],
})
export class CampusAffiliationModule {}
