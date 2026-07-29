import { Global, Module } from '@nestjs/common';
import { DomainValidatorService } from './domain-validator.service';

@Global()
@Module({
  providers: [DomainValidatorService],
  exports: [DomainValidatorService],
})
export class DomainValidatorModule {}
