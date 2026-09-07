import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Post,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { LegalDocumentType } from '@prisma/client';
import { LegalService } from './legal.service';
import { AcknowledgeLegalDto } from './dto/legal.dto';
import { JwtGuard } from '../common/guards/jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AllowSuspended } from '../common/decorators/allow-suspended.decorator';
import { AllowPendingDeletion } from '../common/decorators/allow-pending-deletion.decorator';
import { AllowPendingLegalAck } from '../common/decorators/allow-pending-legal-ack.decorator';
import { CacheControl } from '../common/decorators/cache-control.decorator';
import { clientIp } from '../common/rate-limit/client-ip.util';
import type { AuthenticatedUser } from '../common/types/authenticated-request';

/**
 * The public legal pages and the user's own consent record.
 *
 * The two GET routes for document content are deliberately unauthenticated: a
 * Terms page that requires a session is not a Terms page. They expose only what
 * has been published — never a draft, never an admin field.
 *
 * The consent routes carry all three lifecycle decorators. That is the point of
 * them: an account behind the acknowledgement gate must be able to read the
 * documents and accept them, and a suspended or deleting account must still be
 * able to see its own consent state rather than being bounced between two gates
 * that each refuse the other's route.
 */
@Controller('api/legal')
export class LegalController {
  constructor(private readonly legal: LegalService) {}

  /**
   * Published documents without their bodies.
   *
   * Cacheable: this is the same answer for every visitor and changes only when
   * an admin publishes. Sixty seconds bounds how long a footer can advertise a
   * superseded version number, which is not a correctness property — the page
   * itself always reads the live row.
   */
  @Get('documents')
  @CacheControl('public, max-age=60')
  listDocuments() {
    return this.legal.listPublished();
  }

  /** One published document, in full. The public Terms/Privacy pages render this. */
  @Get('documents/:type')
  @CacheControl('public, max-age=60')
  getDocument(
    @Param('type', new ParseEnumPipe(LegalDocumentType))
    type: LegalDocumentType,
  ) {
    return this.legal.getPublished(type);
  }

  /**
   * Whether this user may continue, and what they must accept if not.
   *
   * The client calls this on boot and after a 403 carrying
   * `LEGAL_ACKNOWLEDGEMENT_REQUIRED`. It is the authority for the modal: the
   * cached profile is only ever a hint.
   */
  @Get('consent')
  @UseGuards(JwtGuard)
  @AllowPendingLegalAck()
  @AllowSuspended()
  @AllowPendingDeletion()
  getConsentState(@CurrentUser() user: AuthenticatedUser) {
    return this.legal.getConsentState(user.id);
  }

  /** Records acceptance. Idempotent; see `LegalService.acknowledge`. */
  @Post('consent')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard)
  @AllowPendingLegalAck()
  @AllowSuspended()
  @AllowPendingDeletion()
  acknowledge(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AcknowledgeLegalDto,
    @Req() req: any,
  ) {
    return this.legal.acknowledge(user.id, dto.versionIds, {
      // `req.ip` via `clientIp`, never the raw header: this value goes into a
      // consent record that may have to be produced as evidence, and a
      // caller-controlled address would make every row worthless.
      ip: clientIp(req) || null,
      userAgent: (req.headers?.['user-agent'] as string) || null,
    });
  }

  /** The user's own history of what they accepted and when. */
  @Get('consent/history')
  @UseGuards(JwtGuard)
  @AllowPendingLegalAck()
  @AllowSuspended()
  @AllowPendingDeletion()
  getHistory(@CurrentUser() user: AuthenticatedUser) {
    return this.legal.getHistory(user.id);
  }
}
