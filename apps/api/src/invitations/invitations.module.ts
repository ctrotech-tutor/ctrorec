import { Module } from '@nestjs/common'
import { AdminModule } from '../admin/admin.module.js'
import { InvitationAdminController } from './invitation-admin.controller.js'
import { InvitationsController } from './invitations.controller.js'
import { InvitationsRepository } from './invitations.repository.js'
import { InvitationsService } from './invitations.service.js'

@Module({
  imports: [AdminModule],
  controllers: [InvitationAdminController, InvitationsController],
  providers: [InvitationsRepository, InvitationsService],
})
export class InvitationsModule {}
