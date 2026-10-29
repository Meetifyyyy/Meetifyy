import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { GroupChatsService } from './group-chats.service';

/**
 * Invite links, by code: what meetifyy.app/g/<code> opens.
 *
 * Signed-in only. A link is how a group reaches people outside it, so the
 * preview it gives is the one a valid invite gives (getGroupInvitePreview);
 * a signed-out visitor is sent through sign-in first and comes back here.
 * Joining goes through POST /api/group-chats/:id/join with the code, so there
 * is one join path whatever the invite came through.
 */
@Controller('api/group-invites')
export class GroupInvitesController {
  constructor(private readonly groupChatsService: GroupChatsService) {}

  @Get(':code')
  @UseGuards(JwtGuard)
  async getInviteLinkPreview(
    @Req() req: AuthenticatedRequest,
    @Param('code') code: string,
  ) {
    return this.groupChatsService.getInviteLinkPreview(code, req.user?.id);
  }
}
