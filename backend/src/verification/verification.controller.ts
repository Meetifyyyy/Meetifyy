import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  VerificationService,
  LIVE_CAPTURE_LIMITS,
} from './verification.service';
import { JwtGuard } from '../common/guards';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import {
  CaptureVerificationDto,
  SubmitLiveVerificationDto,
  SubmitVerificationDto,
} from './dto/verification.dto';

// `api/verification`, not `verification`. Every other user-facing controller in
// the app is mounted under `api/`, the client has always posted to
// `/api/verification/request`, and there is no global prefix — so this handler
// was mounted at a path nothing called. Submitting verification 404'd, which is
// why no account could progress past UNVERIFIED through the UI at all.
@Controller('api/verification')
@UseGuards(JwtGuard)
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  /**
   * One live camera capture (`kind` = selfie | id), stored for a submission.
   * The image is re-encoded server side; see VerificationService.captureDocument.
   */
  @Post('capture')
  @RateLimit('verification.capture.user')
  @UseInterceptors(
    FileInterceptor('file', {
      // Multer stops reading past this, so an oversized body is never buffered.
      limits: { fileSize: LIVE_CAPTURE_LIMITS.maxBytes, files: 1 },
    }),
  )
  async capture(
    @CurrentUser('id') userId: string,
    @Body() body: CaptureVerificationDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.verificationService.captureDocument(userId, body.kind, file);
  }

  /** Submit ONE live capture for review: a selfie or a government ID. */
  @Post('live-request')
  async submitLiveVerification(
    @CurrentUser('id') userId: string,
    @Body() body: SubmitLiveVerificationDto,
  ) {
    return this.verificationService.submitLiveVerification(
      userId,
      body.method,
      body.mediaId,
    );
  }

  /**
   * Legacy two-document submission (selfie + ID card), still sent by installed
   * apps built before the live choice. Kept until those builds are retired
   * through the version gate; the website and new builds use live-request.
   */
  @Post('request')
  async submitVerification(
    @CurrentUser('id') userId: string,
    @Body() body: SubmitVerificationDto,
  ) {
    return this.verificationService.submitVerification(
      userId,
      body.selfieMediaId,
      body.idCardMediaId,
    );
  }

  @Get('status')
  async getStatus(@CurrentUser('id') userId: string) {
    return this.verificationService.getStatus(userId);
  }
}
