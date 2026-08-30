import { SetMetadata } from '@nestjs/common';

export const IS_VERIFIED_ONLY_KEY = 'isVerifiedOnly';
export const VerifiedOnly = () => SetMetadata(IS_VERIFIED_ONLY_KEY, true);
