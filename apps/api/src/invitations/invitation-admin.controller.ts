import { CurrentUser } from '@nestjs/authentication'
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
} from '@nestjs/common'
import { ApiBody } from '@nestjs/swagger'
import type { AuthUser } from '../auth/auth-user.js'
import { CreateInvitationDto } from './invitations.dto.js'
import { InvitationsService } from './invitations.service.js'

@Controller('institutions/:institutionId/admin/invitations')
export class InvitationAdminController {
  constructor(
    @Inject(InvitationsService)
    private readonly invitations: InvitationsService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(
    @CurrentUser() user: AuthUser,
    @Param('institutionId') institutionId: string,
  ) {
    return this.invitations.list(user.id, institutionId)
  }

  @Post()
  @Header('Cache-Control', 'private, no-store')
  @ApiBody({ type: CreateInvitationDto })
  create(
    @CurrentUser() user: AuthUser,
    @Param('institutionId') institutionId: string,
    @Body() input: CreateInvitationDto,
  ) {
    return this.invitations.create(user.id, institutionId, input)
  }

  @Post(':invitationId/revoke')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  revoke(
    @CurrentUser() user: AuthUser,
    @Param('institutionId') institutionId: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.invitations.revoke(user.id, institutionId, invitationId)
  }
}
