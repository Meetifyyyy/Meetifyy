import { IsString, IsOptional, MaxLength, IsBoolean } from 'class-validator';

export class CreateCommunityDto {
  @IsString()
  @MaxLength(30)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
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
  @MaxLength(200)
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
  @IsString()
  @MaxLength(20)
  role: 'MODERATOR' | 'MEMBER';
}
