import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { LegalDocumentType } from '@prisma/client';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { AdminLegalService } from './admin-legal.service';
import {
  PreviewLegalContentDto,
  PublishLegalVersionDto,
  RollbackLegalVersionDto,
  SaveLegalDraftDto,
} from './dto/admin-legal.dto';
import type { AdminRequest } from '../../common/types/authenticated-request';

/**
 * Legal-document management for the admin portal.
 *
 * Authorization is `AdminJwtGuard` and nothing else — the same guard every
 * other privileged surface in the portal uses. It already proves an active
 * SuperAdmin, a live unrevoked session, and a matching CSRF token on every
 * mutation. Inventing a second mechanism here would mean two definitions of
 * "authorized administrator", and the weaker one would be the one that decides.
 *
 * Note there is no route that edits a published version, by design: the only
 * writes are to a draft, and the only transitions are publish and rollback.
 */
@UseGuards(AdminJwtGuard)
@Controller('admin/legal')
export class AdminLegalController {
  constructor(private readonly legal: AdminLegalService) {}

  /** Every document type with its published version, draft and history count. */
  @Get('documents')
  listDocuments() {
    return this.legal.listDocuments();
  }

  /** Renders content through the save path's sanitizer without storing it. */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  preview(@Body() dto: PreviewLegalContentDto) {
    return this.legal.preview(dto);
  }

  /** One version in full, including its body. Declared before `:type`. */
  @Get('versions/:id')
  getVersion(@Param('id') id: string) {
    return this.legal.getVersion(id);
  }

  /** Acceptance progress for a version whose acknowledgement is mandatory. */
  @Get('versions/:id/acknowledgements')
  getAcknowledgementStats(@Param('id') id: string) {
    return this.legal.getAcknowledgementStats(id);
  }

  @Get('documents/:type')
  getDocument(
    @Param('type', new ParseEnumPipe(LegalDocumentType))
    type: LegalDocumentType,
  ) {
    return this.legal.getDocument(type);
  }

  /** The draft and the live version, both bodies, for the compare view. */
  @Get('documents/:type/compare')
  compare(
    @Param('type', new ParseEnumPipe(LegalDocumentType))
    type: LegalDocumentType,
  ) {
    return this.legal.compare(type);
  }

  /** Opens a draft seeded from the published text, or returns the existing one. */
  @Post('documents/:type/draft')
  @HttpCode(HttpStatus.OK)
  startDraft(
    @Param('type', new ParseEnumPipe(LegalDocumentType))
    type: LegalDocumentType,
    @Req() req: AdminRequest,
  ) {
    return this.legal.startDraft(type, req.admin.id);
  }

  @Put('documents/:type/draft')
  saveDraft(
    @Param('type', new ParseEnumPipe(LegalDocumentType))
    type: LegalDocumentType,
    @Body() dto: SaveLegalDraftDto,
    @Req() req: AdminRequest,
  ) {
    return this.legal.saveDraft(type, req.admin.id, dto);
  }

  @Delete('documents/:type/draft')
  deleteDraft(
    @Param('type', new ParseEnumPipe(LegalDocumentType))
    type: LegalDocumentType,
  ) {
    return this.legal.deleteDraft(type);
  }

  /** Makes the draft the published version. Requires a change summary. */
  @Post('documents/:type/publish')
  @HttpCode(HttpStatus.OK)
  publish(
    @Param('type', new ParseEnumPipe(LegalDocumentType))
    type: LegalDocumentType,
    @Body() dto: PublishLegalVersionDto,
    @Req() req: AdminRequest,
  ) {
    return this.legal.publishDraft(type, req.admin.id, dto);
  }

  /** Publishes a NEW version carrying an earlier version's text. */
  @Post('documents/:type/rollback')
  @HttpCode(HttpStatus.OK)
  rollback(
    @Param('type', new ParseEnumPipe(LegalDocumentType))
    type: LegalDocumentType,
    @Body() dto: RollbackLegalVersionDto,
    @Req() req: AdminRequest,
  ) {
    return this.legal.rollback(type, req.admin.id, dto);
  }
}
