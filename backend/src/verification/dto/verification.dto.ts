import { IsEnum, IsIn, IsUUID } from 'class-validator';
import { VerificationMethod } from '@prisma/client';

/** `POST /api/verification/capture` multipart field alongside the image. */
export class CaptureVerificationDto {
  @IsIn(['selfie', 'id'])
  kind!: 'selfie' | 'id';
}

/** `POST /api/verification/live-request`: one live capture, by method. */
export class SubmitLiveVerificationDto {
  @IsEnum(VerificationMethod)
  method!: VerificationMethod;

  @IsUUID()
  mediaId!: string;
}

/**
 * `POST /api/verification/request`: the legacy two-document submission that
 * installed apps from before the live choice still send. Validated now; it was
 * a plain interface, which the global ValidationPipe never checks.
 */
export class SubmitVerificationDto {
  @IsUUID()
  selfieMediaId!: string;

  @IsUUID()
  idCardMediaId!: string;
}
