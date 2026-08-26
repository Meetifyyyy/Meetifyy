import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';

import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { AdminHelpService } from './admin-help.service';
import { ReorderDto } from '../support/dto/admin-support.dto';
import {
  CreateHelpArticleDto,
  CreateHelpCategoryDto,
  ListHelpContentDto,
  PreviewArticleDto,
  SetHelpStatusDto,
  UpdateHelpArticleDto,
  UpdateHelpCategoryDto,
} from './dto/admin-help.dto';

/**
 * Help-content management, mounted under the Support section of the Admin
 * Dashboard (`/admin/support/help/*`) rather than at a path of its own.
 *
 * The nesting is deliberate: the audit interceptor already classifies anything
 * under `/admin/support` as support activity, the dashboard's Support nav item
 * owns both tabs, and there is exactly one place in the portal where support
 * content is managed. A sibling `/admin/help` route would have created a second
 * support surface, which is the thing this feature is supposed not to do.
 */
@UseGuards(AdminJwtGuard)
@Controller('admin/support/help')
export class AdminHelpController {
  constructor(private readonly help: AdminHelpService) {}

  // ── Categories ───────────────────────────────────────────────────────────

  @Get('categories')
  listCategories() {
    return this.help.listCategories();
  }

  @Post('categories')
  createCategory(@Body() dto: CreateHelpCategoryDto) {
    return this.help.createCategory(dto);
  }

  /** Whole-list reorder. Declared before `:id` so "reorder" is not read as an id. */
  @Put('categories/reorder')
  reorderCategories(@Body() dto: ReorderDto) {
    return this.help.reorderCategories(dto);
  }

  @Patch('categories/:id')
  updateCategory(@Param('id') id: string, @Body() dto: UpdateHelpCategoryDto) {
    return this.help.updateCategory(id, dto);
  }

  @Patch('categories/:id/status')
  setCategoryStatus(@Param('id') id: string, @Body() dto: SetHelpStatusDto) {
    return this.help.setCategoryStatus(id, dto);
  }

  @Post('categories/:id/archive')
  archiveCategory(@Param('id') id: string) {
    return this.help.archiveCategory(id);
  }

  @Delete('categories/:id')
  deleteCategory(@Param('id') id: string) {
    return this.help.deleteCategory(id);
  }

  // ── Articles ─────────────────────────────────────────────────────────────

  @Get('articles')
  listArticles(@Query() query: ListHelpContentDto) {
    return this.help.listArticles(query);
  }

  @Post('articles')
  createArticle(@Body() dto: CreateHelpArticleDto) {
    return this.help.createArticle(dto);
  }

  @Put('articles/reorder')
  reorderArticles(@Body() dto: ReorderDto) {
    return this.help.reorderArticles(dto);
  }

  /** Renders a draft through the same sanitizer the save path uses. */
  @Post('articles/preview')
  previewArticle(@Body() dto: PreviewArticleDto) {
    return this.help.previewArticle(dto.body);
  }

  @Get('articles/:id')
  getArticle(@Param('id') id: string) {
    return this.help.getArticle(id);
  }

  @Patch('articles/:id')
  updateArticle(@Param('id') id: string, @Body() dto: UpdateHelpArticleDto) {
    return this.help.updateArticle(id, dto);
  }

  @Patch('articles/:id/status')
  setArticleStatus(@Param('id') id: string, @Body() dto: SetHelpStatusDto) {
    return this.help.setArticleStatus(id, dto);
  }

  @Delete('articles/:id')
  deleteArticle(@Param('id') id: string) {
    return this.help.deleteArticle(id);
  }
}
