import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { LegalDocumentType } from '@prisma/client';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import type { AdminRequest } from '../../common/types/authenticated-request';
import { AdminLegalService } from './admin-legal.service';
import {
  NotifyLegalUpdateDto,
  PreviewLegalContentDto,
  PublishLegalDraftDto,
  SaveLegalDraftDto,
  StartLegalDraftDto,
} from './dto/admin-legal.dto';

const DocumentTypePipe = new ParseEnumPipe(LegalDocumentType);

/**
 * Legal-document management for the admin portal.
 *
 * Authorization is `AdminJwtGuard` and nothing else — the guard every other
 * privileged admin surface uses (active SuperAdmin, live session, CSRF on
 * mutations). Every mutation is written to the audit log by AuditInterceptor
 * (see the LEGAL_* actions there).
 *
 * There is no route that edits a published version, by design: the only
 * writes are to the draft, and the only transitions are publish and notify.
 */
@UseGuards(AdminJwtGuard)
@Controller('admin/legal')
export class AdminLegalController {
  constructor(private readonly legal: AdminLegalService) {}

  @Get('documents')
  listDocuments() {
    return this.legal.listDocuments();
  }

  /** How many users a notifying publish would reach — for the confirm step. */
  @Get('audience')
  async audience() {
    return { totalActiveUsers: await this.legal.countActiveUsers() };
  }

  /** Sanitizes without storing, for the editor's live preview. */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  preview(@Body() dto: PreviewLegalContentDto) {
    return this.legal.preview(dto);
  }

  /** Asks users to review the current text of one or more documents. */
  @Post('notify')
  @HttpCode(HttpStatus.OK)
  notify(@Body() dto: NotifyLegalUpdateDto, @Req() req: AdminRequest) {
    return this.legal.notify(req.admin.id, dto);
  }

  @Get('versions/:id')
  getVersion(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.legal.getVersion(id);
  }

  @Get('documents/:type')
  getDocument(@Param('type', DocumentTypePipe) type: LegalDocumentType) {
    return this.legal.getDocument(type);
  }

  /** Opens (or returns) the draft; `fromVersionId` restores an older version. */
  @Post('documents/:type/draft')
  @HttpCode(HttpStatus.OK)
  startDraft(
    @Param('type', DocumentTypePipe) type: LegalDocumentType,
    @Body() dto: StartLegalDraftDto,
    @Req() req: AdminRequest,
  ) {
    return this.legal.startDraft(type, req.admin.id, dto.fromVersionId);
  }

  @Put('documents/:type/draft')
  saveDraft(
    @Param('type', DocumentTypePipe) type: LegalDocumentType,
    @Body() dto: SaveLegalDraftDto,
    @Req() req: AdminRequest,
  ) {
    return this.legal.saveDraft(type, req.admin.id, dto);
  }

  @Delete('documents/:type/draft')
  deleteDraft(@Param('type', DocumentTypePipe) type: LegalDocumentType) {
    return this.legal.deleteDraft(type);
  }

  @Post('documents/:type/publish')
  @HttpCode(HttpStatus.OK)
  publish(
    @Param('type', DocumentTypePipe) type: LegalDocumentType,
    @Body() dto: PublishLegalDraftDto,
    @Req() req: AdminRequest,
  ) {
    return this.legal.publishDraft(type, req.admin.id, dto);
  }
}
