import {
  IsString,
  IsOptional,
  MaxLength,
  IsBoolean,
  IsIn,
} from 'class-validator';
import { COMMUNITY_DESCRIPTION_MAX } from '../community-limits';

export class CreateCommunityDto {
  @IsString()
  @MaxLength(30)
  name!: string;

  @IsString()
  @IsOptional()
  @MaxLength(COMMUNITY_DESCRIPTION_MAX, {
    message: `description must be at most ${COMMUNITY_DESCRIPTION_MAX} characters`,
  })
  description?: string;

  @IsString()
  @IsOptional()
  avatarKey?: string;

  @IsString()
  @IsOptional()
  coverKey?: string;

  @IsBoolean()
  @IsOptional()
  isCampusCommunity?: boolean;

  @IsBoolean()
  @IsOptional()
  isPrivate?: boolean;

  @IsString()
  @IsOptional()
  privacy?: string;

  /**
   * The community's brand colour, a CSS colour or gradient. Chosen at creation
   * and used wherever the community is shown without a picture. Length-capped
   * because it is echoed straight into a style attribute.
   */
  @IsString()
  @IsOptional()
  @MaxLength(200)
  color?: string;
}

export class UpdateCommunityDto {
  @IsString()
  @IsOptional()
  @MaxLength(30)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(COMMUNITY_DESCRIPTION_MAX, {
    message: `description must be at most ${COMMUNITY_DESCRIPTION_MAX} characters`,
  })
  description?: string;

  @IsString()
  @IsOptional()
  avatarKey?: string;

  @IsString()
  @IsOptional()
  coverKey?: string;

  @IsBoolean()
  @IsOptional()
  isCampusCommunity?: boolean;

  @IsBoolean()
  @IsOptional()
  isPrivate?: boolean;

  @IsString()
  @IsOptional()
  privacy?: string;
}

export class UpdateMemberRoleDto {
  /**
   * Only these two. The TypeScript union said as much, but the validator
   * accepted any string up to 20 characters and the service cast it with
   * `as any` — so `role: "OWNER"` was accepted and written straight through,
   * minting a second OWNER row. That row then satisfies every
   * `member?.role === 'OWNER'` check in the service, granting the power to
   * edit the community, delete it, and re-role anyone else.
   *
   * Ownership moves only by transferring it, never through this endpoint.
   */
  @IsIn(['MODERATOR', 'MEMBER'], {
    message: 'Role must be MODERATOR or MEMBER',
  })
  role!: 'MODERATOR' | 'MEMBER';
}
