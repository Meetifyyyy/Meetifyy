import { IsString, IsOptional, MaxLength } from 'class-validator';

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
}
