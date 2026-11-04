import { Transform } from 'class-transformer'
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator'

export class RequestRecoveryDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  @MaxLength(254)
  email!: string
}

export class InspectRecoveryDto {
  @IsString()
  @MinLength(32)
  @MaxLength(128)
  token!: string
}

export class ResetPasswordDto extends InspectRecoveryDto {
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string
}
