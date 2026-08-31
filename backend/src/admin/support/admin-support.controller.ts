import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { AdminSupportService } from './admin-support.service';
import {
  AddInternalNoteDto,
  AssignTicketDto,
  ListSupportTicketsDto,
  PreviewReplyDto,
  SendReplyDto,
  UpdateTicketPriorityDto,
  UpdateTicketStatusDto,
} from './dto/admin-support.dto';
import type { AdminRequest } from '../../common/types/authenticated-request';

/**
 * Ticket management for the Admin Dashboard's Support section.
 *
 * The guard is applied to the controller, not to individual handlers, so a
 * route added later cannot be left unprotected by omission. AdminJwtGuard also
 * enforces the CSRF double-submit on every mutating verb, which matters here
 * more than elsewhere: these endpoints send email to real users, and a
 * cross-site POST that could trigger one would be an open relay wearing an
 * admin's session.
 *
 * Mutations are recorded by AuditInterceptor (see admin/common), which already
 * recognises `/admin/support` and the `/reply` and `/status` suffixes.
 */
@UseGuards(AdminJwtGuard)
@Controller('admin/support')
export class AdminSupportController {
  constructor(private readonly supportService: AdminSupportService) {}

  @Get()
  listTickets(@Query() query: ListSupportTicketsDto) {
    return this.supportService.listTickets(query);
  }

  @Get('stats')
  getStats() {
    return this.supportService.getQueueStats();
  }

  @Get('assignees')
  listAssignees() {
    return this.supportService.listAssignableAdmins();
  }

  /**
   * Renders a reply exactly as the user would receive it, without sending.
   * Declared before `:id` would otherwise be a problem - it is a POST to a
   * distinct path, so no route shadowing arises - and kept next to the reply
   * endpoint it belongs to.
   */
  @Post('reply-preview')
  previewReply(@Body() dto: PreviewReplyDto) {
    return this.supportService.previewReply(dto.body);
  }

  @Get(':id')
  getTicket(@Param('id') id: string) {
    return this.supportService.getTicketById(id);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateTicketStatusDto) {
    return this.supportService.updateTicketStatus(id, dto);
  }

  @Patch(':id/priority')
  updatePriority(
    @Param('id') id: string,
    @Body() dto: UpdateTicketPriorityDto,
  ) {
    return this.supportService.updateTicketPriority(id, dto);
  }

  @Patch(':id/assign')
  assign(@Param('id') id: string, @Body() dto: AssignTicketDto) {
    return this.supportService.assignTicket(id, dto);
  }

  @Post(':id/notes')
  addNote(
    @Param('id') id: string,
    @Body() dto: AddInternalNoteDto,
    @Req() req: AdminRequest,
  ) {
    return this.supportService.addInternalNote(id, dto, req.admin.id);
  }

  @Post(':id/reply')
  reply(
    @Param('id') id: string,
    @Body() dto: SendReplyDto,
    @Req() req: AdminRequest,
  ) {
    return this.supportService.replyToTicket(id, dto, req.admin.id);
  }

  @Post(':id/messages/:messageId/resend')
  resendReply(@Param('id') id: string, @Param('messageId') messageId: string) {
    return this.supportService.retryReplyEmail(id, messageId);
  }

  @Post(':id/resend-confirmation')
  resendConfirmation(@Param('id') id: string) {
    return this.supportService.retryConfirmationEmail(id);
  }
}
