import { Module } from '@nestjs/common';
import { AdminAccountDeletionController } from './admin-account-deletion.controller';
import { AdminAccountDeletionService } from './admin-account-deletion.service';
import { AccountDeletionModule } from '../../account-deletion/account-deletion.module';

/**
 * Reuses the user-facing lifecycle services rather than reimplementing them:
 * an admin restore has to inherit exactly the same window check and the same
 * race handling against the purge worker as the owner's own Recover button, or
 * the two paths drift and one of them ends up wrong.
 */
@Module({
  imports: [AccountDeletionModule],
  controllers: [AdminAccountDeletionController],
  providers: [AdminAccountDeletionService],
})
export class AdminAccountDeletionModule {}
