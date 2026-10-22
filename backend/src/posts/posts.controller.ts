import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { PostsService } from './posts.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { RateLimitPolicyGuard } from '../common/rate-limit/rate-limit-policy.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { VerifiedOnly } from '../common/decorators/verified-only.decorator';
import {
  IsString,
  IsOptional,
  Matches,
  IsArray,
  IsObject,
  ValidateNested,
  ArrayMaxSize,
} from 'class-validator';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';
import { Type } from 'class-transformer';
import { clampPageParam } from '../common/pagination.util';
import { MentionDto } from '../common/dto/mention.dto';
import { MaxChars } from '../common/validation/max-chars.validator';
import {
  COMMENT_MAX_CHARS,
  POST_MAX_CHARS,
} from '../common/validation/text-length.util';
import { Idempotent } from '../common/decorators/idempotent.decorator';

export class CreatePostDto {
  /**
   * At most 2,000 characters, counted as Postgres counts the VARCHAR(2000)
   * column (see `countChars`). The cap was 5,000 here while the column held
   * 2,000, so a longer post failed at the database with a 500 instead of a 400.
   */
  @IsString()
  @MaxChars(POST_MAX_CHARS, {
    message: `Posts can be at most ${POST_MAX_CHARS.toLocaleString('en-US')} characters`,
  })
  text!: string;

  @IsString()
  @IsOptional()
  mediaKey?: string;

  @IsArray()
  @ArrayMaxSize(6, { message: 'Max 6 media items allowed' })
  @IsString({ each: true })
  @IsOptional()
  mediaKeys?: string[];

  @IsString()
  @IsOptional()
  communityId?: string;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MentionDto)
  @IsOptional()
  mentions?: MentionDto[];

  /** Only checked to be an object; PostsService reads `options` from it as untrusted. */
  @IsObject()
  @IsOptional()
  poll?: unknown;
}

/**
 * A comment or a reply (a reply is a comment with a `parentId`). At most 500
 * characters, counted as Postgres counts the VARCHAR(500) column (see
 * `countChars`); the composer applies the same rule.
 */
export class CreateCommentDto {
  @IsString()
  @Matches(/\S/, { message: 'Write something before posting' })
  @MaxChars(COMMENT_MAX_CHARS, {
    message: `Comments can be at most ${COMMENT_MAX_CHARS} characters`,
  })
  text!: string;

  @IsString()
  @IsOptional()
  parentId?: string;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MentionDto)
  @IsOptional()
  mentions?: MentionDto[];
}

export class VotePollDto {
  @IsString()
  @IsOptional()
  optionId?: string;

  @IsArray()
  @IsOptional()
  indices?: number[];

  @IsOptional()
  index?: number;
}

@Controller('api/posts')
@UseGuards(JwtGuard)
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Post()
  @Idempotent()
  @VerifiedOnly()
  @UseGuards(RateLimitPolicyGuard)
  @RateLimit('content.post.create')
  async createPost(
    @CurrentUser() user: { id: string },
    @Body() dto: CreatePostDto,
  ) {
    return this.postsService.createPost(
      user.id,
      dto.text,
      dto.mediaKey,
      dto.communityId,
      dto.poll,
      dto.mentions,
      dto.mediaKeys,
    );
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
    const parsedLimit = clampPageParam(limit, { def: 10, min: 1, max: 50 });
    return this.postsService.getBookmarks(user.id, parsedLimit, cursor);
  }

  @Get('feed')
  async getFeed(
    @CurrentUser() user: { id: string },
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('communityId') communityId?: string,
  ) {
    const parsedLimit = clampPageParam(limit, { def: 10, min: 1, max: 50 });
    return this.postsService.getFeed(user.id, parsedLimit, cursor, communityId);
  }

  @Get('user/:username')
  async getUserPosts(
    @CurrentUser() user: { id: string },
    @Param('username') username: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const parsedLimit = clampPageParam(limit, { def: 10, min: 1, max: 50 });
    return this.postsService.getUserPosts(
      user.id,
      username,
      parsedLimit,
      cursor,
    );
  }

  @Get(':id')
  async getPostById(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    const ifNoneMatch = req.headers['if-none-match'];
    // Access is enforced inside getPostMeta, BEFORE any 304 can be returned.
    const meta = await this.postsService.getPostMeta(id, user.id);

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
  async like(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.postsService.likePost(id, user.id);
  }

  @Post(':id/unlike')
  async unlike(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.postsService.unlikePost(id, user.id);
  }

  @Get(':id/comments')
  async getComments(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const parsedLimit = clampPageParam(limit, { def: 20, min: 1, max: 50 });
    return this.postsService.getComments(id, user.id, parsedLimit, cursor);
  }

  @Post(':id/comments')
  @Idempotent()
  @UseGuards(RateLimitPolicyGuard)
  @RateLimit('content.comment.create')
  async addComment(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.postsService.addComment(
      id,
      user.id,
      dto.text,
      dto.parentId,
      dto.mentions,
    );
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

  @Delete('comments/:commentId')
  async deleteComment(
    @CurrentUser() user: { id: string },
    @Param('commentId') commentId: string,
  ) {
    return this.postsService.deleteComment(commentId, user.id);
  }

  @Post(':id/bookmark')
  async bookmark(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.postsService.bookmarkPost(id, user.id);
  }

  @Delete(':id/bookmark')
  async unbookmark(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return this.postsService.unbookmarkPost(id, user.id);
  }

  @Post(':id/vote')
  async voteInPoll(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: VotePollDto,
  ) {
    return this.postsService.voteInPoll(id, user.id, dto);
  }
}
