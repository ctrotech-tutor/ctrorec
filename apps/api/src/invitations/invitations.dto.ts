import { Transform } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'

const membershipRoleNames = [
  'institution_admin',
  'academic_staff',
  'student',
] as const

export class CreateInvitationDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  @MaxLength(254)
  email!: string

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName!: string

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsIn(membershipRoleNames, { each: true })
  roles!: string[]

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(14)
  expiresInDays?: number
}

export class InspectInvitationDto {
  @IsString()
  @MinLength(32)
  @MaxLength(128)
  token!: string
}

export class AcceptInvitationDto extends InspectInvitationDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  @MaxLength(254)
  email!: string

  // Existing accounts may have credentials created under an older policy.
  @IsString()
  @MaxLength(128)
  password!: string
}
