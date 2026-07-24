import { IsString, IsNotEmpty, IsEmail, IsOptional } from 'class-validator';

export class CheckUsernameDto {
  @IsString()
  @IsNotEmpty()
  username: string;
}

export class CheckEmailDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;
}

export class LookupEmailDto {
  @IsString()
  @IsNotEmpty()
  username: string;
}

export class TriggerWelcomeEmailDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  name: string;
}

export class TriggerLoginEmailDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  device?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  time?: string;
}

export class TriggerPasswordChangedEmailDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsOptional()
  @IsString()
  name?: string;
}
