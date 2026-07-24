import { Controller, Post, Get, Delete, Body, Param, Query, UseGuards, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { PostsService } from './posts.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { IsString, IsOptional, MaxLength, IsArray, IsObject } from 'class-validator';

export class CreatePostDto {
  @IsString()
  @MaxLength(2000)
  text: string;

  @IsString()
  @IsOptional()
  mediaKey?: string;

  @IsString()
  @IsOptional()
  communityId?: string;

  @IsArray()
  @IsOptional()
  mentions?: any[];

  @IsObject()
  @IsOptional()
  poll?: any;
}

export class CreateCommentDto {
  @IsString()
  @MaxLength(500)
  text: string;

  @IsString()
  @IsOptional()
  parentId?: string;

  @IsArray()
  @IsOptional()
  mentions?: any[];
}

@Controller('api/posts')
@UseGuards(JwtGuard)
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Post()
  async createPost(
    @CurrentUser() user: { id: string },
    @Body() dto: CreatePostDto,
  ) {
    return this.postsService.createPost(user.id, dto.text, dto.mediaKey, dto.communityId);
  }

  @Delete(':id')
  async deletePost(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return this.postsService.deletePost(id, user.id);
  }

  @Get('bookmarks')
  async getBookmarks(
    @CurrentUser() user: { id: string },
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 10;
    return this.postsService.getBookmarks(user.id, parsedLimit, cursor);
  }

  @Get('feed')
  async getFeed(
    @CurrentUser() user: { id: string },
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('communityId') communityId?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 10;
    return this.postsService.getFeed(user.id, parsedLimit, cursor, communityId);
  }

  @Get('user/:username')
  async getUserPosts(
    @CurrentUser() user: { id: string },
    @Param('username') username: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 10;
    return this.postsService.getUserPosts(user.id, username, parsedLimit, cursor);
  }

  @Get(':id')
  async getPostById(
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    const ifNoneMatch = req.headers['if-none-match'];
    const meta = await this.postsService.getPostMeta(id);
    
    if (meta) {
      const etag = `W/"${meta.updatedAt.getTime()}"`;
      if (ifNoneMatch === etag) {
        res.status(304);
        return;
      }
      res.setHeader('ETag', etag);
    }
    
    return this.postsService.getPostById(id, user.id);
  }

  @Post(':id/like')
  async like(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return this.postsService.likePost(id, user.id);
  }

  @Post(':id/unlike')
  async unlike(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return this.postsService.unlikePost(id, user.id);
  }

  @Post(':id/comments')
  async addComment(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.postsService.addComment(id, user.id, dto.text, dto.parentId);
  }

  @Post('comments/:commentId/like')
  async likeComment(
    @CurrentUser() user: { id: string },
    @Param('commentId') commentId: string,
  ) {
    return this.postsService.likeComment(commentId, user.id);
  }

  @Post('comments/:commentId/unlike')
  async unlikeComment(
    @CurrentUser() user: { id: string },
    @Param('commentId') commentId: string,
  ) {
    return this.postsService.unlikeComment(commentId, user.id);
  }

  @Post(':id/bookmark')
  async bookmark(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return this.postsService.bookmarkPost(id, user.id);
  }

  @Delete(':id/bookmark')
  async unbookmark(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return this.postsService.unbookmarkPost(id, user.id);
  }
}
