import {
  IsString,
  IsOptional,
  MaxLength,
  IsBoolean,
  IsIn,
  IsUUID,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  COMMUNITY_DESCRIPTION_MAX,
  COMMUNITY_DESCRIPTION_MAX_LINE_BREAKS,
} from '../community-limits';
import { normalizeMultilineTransform } from '../../common/utils/multiline-text.util';

/** Text with at most COMMUNITY_DESCRIPTION_MAX_LINE_BREAKS line breaks. */
const MAX_LINE_BREAKS_PATTERN = new RegExp(
  `^[^\\n]*(?:\\n[^\\n]*){0,${COMMUNITY_DESCRIPTION_MAX_LINE_BREAKS}}$`,
);

export class CreateCommunityDto {
  @IsString()
  @MaxLength(30)
  name!: string;

  // Normalised before validation, so the length limit counts what is stored.
  @Transform(normalizeMultilineTransform)
  @IsString()
  @IsOptional()
  @MaxLength(COMMUNITY_DESCRIPTION_MAX, {
    message: `description must be at most ${COMMUNITY_DESCRIPTION_MAX} characters`,
  })
  @Matches(MAX_LINE_BREAKS_PATTERN, {
    message: `description can have at most ${COMMUNITY_DESCRIPTION_MAX_LINE_BREAKS} line breaks`,
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

  // Normalised before validation, so the length limit counts what is stored.
  @Transform(normalizeMultilineTransform)
  @IsString()
  @IsOptional()
  @MaxLength(COMMUNITY_DESCRIPTION_MAX, {
    message: `description must be at most ${COMMUNITY_DESCRIPTION_MAX} characters`,
  })
  @Matches(MAX_LINE_BREAKS_PATTERN, {
    message: `description can have at most ${COMMUNITY_DESCRIPTION_MAX_LINE_BREAKS} line breaks`,
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

export class TransferOwnershipDto {
  /** The member who becomes the owner. */
  @IsUUID()
  userId!: string;
}
