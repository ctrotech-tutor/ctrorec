import { IsEmail, IsString, MaxLength } from 'class-validator'

export class SignInDto {
  @IsEmail()
  @MaxLength(254)
  email!: string

  // Do not impose the current password policy on older credentials.
  @IsString()
  @MaxLength(128)
  password!: string
}
