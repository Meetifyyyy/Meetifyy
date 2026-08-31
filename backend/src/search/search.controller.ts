import {
  Controller,
  Get,
  Query,
  UseGuards,
  Req,
  Post,
  Body,
  Delete,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';
import { SearchService } from './search.service';
import { JwtGuard } from '../common/guards/jwt.guard';

@Controller('api/search')
@UseGuards(JwtGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  async search(
    @Req() req: AuthenticatedRequest,
    @Query('q') query: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const currentUserId = req.user?.id;
    const limitNum = limit ? parseInt(limit, 10) : 15;
    return this.searchService.globalSearch(
      query,
      currentUserId,
      limitNum,
      type,
      cursor,
    );
  }

  @Get('suggestions')
  async getSuggestions(
    @Req() req: AuthenticatedRequest,
    @Query('q') query: string,
  ) {
    const currentUserId = req.user?.id;
    return this.searchService.getSuggestions(query, currentUserId);
  }

  @Get('recent')
  async getRecentSearches(@Req() req: AuthenticatedRequest) {
    return this.searchService.getRecentSearches(req.user?.id);
  }

  @Post('recent')
  async addRecentSearch(
    @Req() req: AuthenticatedRequest,
    @Body('term') term: string,
  ) {
    return this.searchService.addRecentSearch(req.user?.id, term);
  }

  @Delete('recent')
  async removeRecentSearch(
    @Req() req: AuthenticatedRequest,
    @Query('term') term: string,
  ) {
    return this.searchService.removeRecentSearch(req.user?.id, term);
  }

  @Delete('recent/clear')
  async clearRecentSearches(@Req() req: AuthenticatedRequest) {
    return this.searchService.clearRecentSearches(req.user?.id);
  }
}
