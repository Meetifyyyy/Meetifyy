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
import { VerifiedOnly } from '../common/decorators/verified-only.decorator';
import {
  CreateCampusEventDto,
  UpdateCampusEventDto,
  CampusEventScope,
  CAMPUS_EVENT_SCOPES,
} from './dto/campus-event.dto';
import { clampPageParam, singleQueryValue } from '../common/pagination.util';

@Controller('api/campus-events')
@UseGuards(JwtGuard)
export class CampusEventsController {
  constructor(private readonly service: CampusEventsService) {}

  // Campus events sit behind the same verification gate as the rest of the
  // campus surfaces; see the note on GET /api/users/campus.
  @Get()
  @VerifiedOnly()
  async list(
    @CurrentUser() user: any,
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
    // the caller alone, which is the only campus they are entitled to read.
    return this.service.listByScope(user?.id, s, {
      limit: clampPageParam(limit, { def: 20, max: 50, min: 1 }),
      cursor: singleQueryValue(cursor),
    });
  }

  // Static routes before `:id`.
  @Get('mine')
  @VerifiedOnly()
  async listMine(
    @CurrentUser() user: any,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.service.listMine(user.id, {
      limit: clampPageParam(limit, { def: 20, max: 50, min: 1 }),
      cursor: singleQueryValue(cursor),
    });
  }

  @Get(':id')
  @VerifiedOnly()
  async getById(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.getById(id, user?.id);
  }

  @Post()
  @VerifiedOnly()
  async create(@Body() dto: CreateCampusEventDto, @CurrentUser() user: any) {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  @VerifiedOnly()
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCampusEventDto,
    @CurrentUser() user: any,
  ) {
    return this.service.update(user.id, id, dto);
  }

  @Post(':id/publish')
  @VerifiedOnly()
  async publish(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.publish(user.id, id);
  }

  @Delete(':id')
  @VerifiedOnly()
  async remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.remove(user.id, id);
  }
}
