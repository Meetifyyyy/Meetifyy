import { Global, Module } from '@nestjs/common';
import { LegalConsentService } from './legal-consent.service';

/**
 * The mandatory-acknowledgement gate, available everywhere.
 *
 * `@Global` for the same reason `StudentYearPolicyModule` is: `JwtGuard` is
 * constructed in the module context of whichever controller applies it, so a
 * non-global provider would mean every one of the ~25 feature modules has to
 * import this one, and the first that forgot would fail at boot — or worse,
 * a future guard would quietly resolve nothing and stop enforcing.
 */
@Global()
@Module({
  providers: [LegalConsentService],
  exports: [LegalConsentService],
})
export class LegalConsentModule {}
