import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  UnauthorizedException,
} from '@nestjs/common'
import { CurrentUser, Public, SignInService } from '@nestjs/authentication'
import { ApiBody } from '@nestjs/swagger'
import { Throttle, minutes } from '@nestjs/throttler'
import { UsersRepository } from '../users/users.repository.js'
import type { AuthUser } from './auth-user.js'
import { SignInDto } from './auth.dto.js'
import { CredentialsService } from './credentials.service.js'

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(CredentialsService)
    private readonly credentialsService: CredentialsService,
    @Inject(SignInService) private readonly signInService: SignInService,
    @Inject(UsersRepository)
    private readonly usersRepository: UsersRepository,
  ) {}

  @Public()
  @Throttle({
    default: { limit: 30, ttl: minutes(15) },
    account: { limit: 5, ttl: minutes(15) },
  })
  @Post('sign-in')
  @ApiBody({ type: SignInDto })
  @HttpCode(200)
  async signIn(@Body() body: SignInDto) {
    const user = await this.credentialsService.verify(body.email, body.password)
    if (!user) {
      throw new UnauthorizedException('Invalid email or password')
    }

    const { session } = await this.signInService.signIn(user.id, {
      method: 'password',
      metadata: { credentialsVersion: user.credentialsVersion },
    })
    return { mfaRequired: session.mfa === 'pending' }
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const memberships = await this.usersRepository.listMemberships(user.id)
    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        emailVerified: user.emailVerified,
      },
      memberships,
    }
  }
}
