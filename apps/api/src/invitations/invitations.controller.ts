import { Public } from '@nestjs/authentication'
import {
  Body,
  Controller,
  Header,
  HttpCode,
  Inject,
  Post,
} from '@nestjs/common'
import { ApiBody } from '@nestjs/swagger'
import { Throttle, minutes } from '@nestjs/throttler'
import { AcceptInvitationDto, InspectInvitationDto } from './invitations.dto.js'
import { InvitationsService } from './invitations.service.js'

@Controller('invitations')
export class InvitationsController {
  constructor(
    @Inject(InvitationsService)
    private readonly invitations: InvitationsService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: minutes(15) } })
  @Post('inspect')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiBody({ type: InspectInvitationDto })
  inspect(@Body() input: InspectInvitationDto) {
    return this.invitations.inspect(input)
  }

  @Public()
  @Throttle({
    default: { limit: 30, ttl: minutes(15) },
    account: { limit: 5, ttl: minutes(15) },
  })
  @Post('accept')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiBody({ type: AcceptInvitationDto })
  accept(@Body() input: AcceptInvitationDto) {
    return this.invitations.accept(input)
  }
}
