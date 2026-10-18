import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { CampusEventsService } from './campus-events.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-request';
import {
  CreateCampusEventDto,
  UpdateCampusEventDto,
  CampusEventScope,
  CAMPUS_EVENT_SCOPES,
} from './dto/campus-event.dto';
import { clampPageParam, singleQueryValue } from '../common/pagination.util';
import { CampusAccessService } from '../common/campus/campus-access.service';

@Controller('api/campus-events')
@UseGuards(JwtGuard)
export class CampusEventsController {
  constructor(
    private readonly service: CampusEventsService,
    private readonly campusAccess: CampusAccessService,
  ) {}

  // Campus events are gated on a verified college email (403
  // `campus_affiliation_required` without one), like the rest of the campus
  // surfaces; see the note on GET /api/users/campus. Writes additionally need
  // `isCampusRep`, checked in the service against the affiliation's college.
  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('scope') scope?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const s = (scope || 'upcoming') as CampusEventScope;
    if (!CAMPUS_EVENT_SCOPES.includes(s)) {
      throw new BadRequestException(
        'scope must be one of: upcoming, ongoing, past',
      );
    }
    // `campusId` used to be accepted here and passed straight through, which
    // let any verified account list any college's events by supplying someone
    // else's campus id. No client ever sent it. The campus is now resolved from
    // the caller's affiliation alone, the only campus they may read.
    const { collegeId } = await this.campusAccess.requireAffiliation(user?.id);
    return this.service.listByScope(user?.id, s, {
      campusId: collegeId,
      limit: clampPageParam(limit, { def: 20, max: 50, min: 1 }),
      cursor: singleQueryValue(cursor),
    });
  }

  // Static routes before `:id`.
  @Get('mine')
  async listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.service.listMine(user.id, {
      limit: clampPageParam(limit, { def: 20, max: 50, min: 1 }),
      cursor: singleQueryValue(cursor),
    });
  }

  @Get(':id')
  async getById(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getById(id, user?.id);
  }

  @Post()
  async create(
    @Body() dto: CreateCampusEventDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCampusEventDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(user.id, id, dto);
  }

  @Post(':id/publish')
  async publish(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.publish(user.id, id);
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.remove(user.id, id);
  }
}
