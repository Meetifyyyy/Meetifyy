import { Global, Module } from '@nestjs/common';
import { StudentYearPolicyService } from './student-year-policy.service';

/**
 * The first-year isolation policy, available everywhere.
 *
 * `@Global` for the same reason VerificationAccessModule is: a dozen feature
 * modules enforce this rule and a module that forgot to import it would fail
 * at boot rather than quietly stop filtering — but only if it injected the
 * service at all. Making it global removes the import step entirely, so the
 * only way to miss the policy is to not call it, which the audit in
 * `docs/first-year-isolation.md` enumerates.
 *
 * To remove the feature: set `FEATURE_FIRST_YEAR_ISOLATION=false`, or delete
 * this directory and the call sites the doc lists.
 */
@Global()
@Module({
  providers: [StudentYearPolicyService],
  exports: [StudentYearPolicyService],
})
export class StudentYearPolicyModule {}
