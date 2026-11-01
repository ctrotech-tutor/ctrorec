import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common'
import {
  CurrentSession,
  CurrentUser,
  Public,
  SessionService,
  SignInService,
  type SessionRecord,
} from '@nestjs/authentication'

@Controller('auth')
export class SessionsController {
  constructor(
    @Inject(SessionService) private readonly sessionService: SessionService,
    @Inject(SignInService) private readonly signInService: SignInService,
  ) {}

  @Get('sessions')
  async list(
    @CurrentUser('id') userId: string,
    @CurrentSession() current: SessionRecord,
  ) {
    const sessions = await this.sessionService.list(userId)
    return sessions.map(({ id, createdAt, lastActiveAt, metadata }) => ({
      id,
      createdAt,
      lastActiveAt,
      userAgent:
        typeof metadata?.userAgent === 'string' ? metadata.userAgent : null,
      current: id === current.id,
    }))
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async revoke(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ): Promise<void> {
    if (!(await this.sessionService.revoke(id, { userId }))) {
      throw new NotFoundException()
    }
  }

  @Public()
  @Post('sign-out')
  @HttpCode(204)
  async signOut(): Promise<void> {
    if (!(await this.signInService.signOut())) {
      throw new UnauthorizedException()
    }
  }

  @Post('sign-out-everywhere')
  @HttpCode(204)
  async signOutEverywhere(@CurrentUser('id') userId: string): Promise<void> {
    await this.signInService.signOutEverywhere(userId)
  }
}
