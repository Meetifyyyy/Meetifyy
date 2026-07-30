import { IsString, IsOptional, MaxLength, IsBoolean } from 'class-validator';

export class CreateCommunityDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
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

export class UpdateCommunityDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
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
