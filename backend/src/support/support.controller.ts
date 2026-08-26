import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { OptionalJwtGuard } from '../common/guards/optional-jwt.guard';
import { SupportRateLimitGuard } from '../common/guards/support-ratelimit.guard';
import { StorageService } from '../uploads/uploads.service';
import { CreateSupportRequestDto } from './dto/create-support-request.dto';
import { HelpService } from './help.service';
import { SupportService } from './support.service';
import {
  PUBLIC_SUPPORT_CATEGORIES,
  SUPPORT_ATTACHMENT_LIMITS,
  SUPPORT_CATEGORY_LABELS,
} from './support.constants';

/**
 * The public help centre and support-request API.
 *
 * Every route here is intentionally unauthenticated: someone locked out of
 * their account is exactly the person who most needs to reach support, so
 * requiring a session would break the case the feature exists for.
 *
 * The corollary is that nothing here ever *reads* a ticket. There is no
 * "look up my request by ID" endpoint - a six-character reference is short
 * enough to enumerate, and the tickets contain personal information. Ticket
 * content is reachable only through the authenticated admin API; the user's
 * copy reaches them by email, which proves control of the address.
 */
// `api/` prefix to match every other public controller - main.ts sets no
// global prefix, so each one declares its own.
@Controller('api/support')
export class SupportController {
  constructor(
    private readonly support: SupportService,
    private readonly help: HelpService,
    private readonly storage: StorageService,
  ) {}

  /**
   * The category list and attachment rules the form renders from, so the
   * client does not carry its own copy that can drift from what the server
   * will accept.
   */
  @Get('meta')
  getFormMetadata() {
    return {
      categories: PUBLIC_SUPPORT_CATEGORIES.map((value) => ({ value, label: SUPPORT_CATEGORY_LABELS[value] })),
      attachments: {
        maxFiles: SUPPORT_ATTACHMENT_LIMITS.maxFiles,
        maxBytesPerFile: SUPPORT_ATTACHMENT_LIMITS.maxBytesPerFile,
        allowedMimeTypes: SUPPORT_ATTACHMENT_LIMITS.allowedMimeTypes,
      },
    };
  }

  @Get('help')
  getHelpCentre() {
    return this.help.getPublicHelpCentre();
  }

  @Get('help/search')
  searchHelp(@Query('q') query?: string) {
    return this.help.searchPublicContent(query ?? '');
  }

  @Get('help/articles/:slug')
  getArticle(@Param('slug') slug: string) {
    return this.help.getPublicArticle(slug);
  }

  /**
   * Stores one attachment and returns its key. Uploading is separate from
   * submitting so a large screenshot does not have to be re-sent when the form
   * fails validation, and so the file passes content inspection before any
   * ticket exists.
   */
  @UseGuards(SupportRateLimitGuard)
  @Post('attachments')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: SUPPORT_ATTACHMENT_LIMITS.maxBytesPerFile, files: 1 },
      fileFilter: (_req, file, callback) => {
        const allowed = (SUPPORT_ATTACHMENT_LIMITS.allowedMimeTypes as readonly string[]).includes(file.mimetype);
        callback(null, allowed);
      },
    }),
  )
  async uploadAttachment(@UploadedFile() file: Express.Multer.File) {
    // Multer's fileFilter rejects by omitting the file rather than by raising,
    // so an unsupported type arrives here as "no file".
    if (!file) {
      throw new BadRequestException('Attach a PNG, JPG, WEBP, GIF, PDF or TXT file of 10 MB or less.');
    }
    return this.storage.uploadSupportAttachment(file);
  }

  @UseGuards(SupportRateLimitGuard, OptionalJwtGuard)
  @Post('requests')
  async createRequest(@Body() dto: CreateSupportRequestDto, @Req() req: any) {
    return this.support.createRequest(dto, {
      ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown',
      userAgent: (req.headers['user-agent'] as string) ?? null,
      // Populated by OptionalAuthMiddleware when a valid session happens to be
      // present. Absent for the guest flow, which is the normal case.
      userId: req.user?.id ?? null,
    });
  }
}
