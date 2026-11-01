import { Module } from '@nestjs/common'
import { UsersModule } from '../users/users.module.js'
import { AuthController } from './auth.controller.js'
import { CredentialsService } from './credentials.service.js'
import { SessionAuth } from './session-auth.provider.js'
import { DrizzleSessionStore } from './session.store.js'
import { SessionsController } from './sessions.controller.js'

@Module({
  imports: [UsersModule],
  controllers: [AuthController, SessionsController],
  providers: [SessionAuth, CredentialsService, DrizzleSessionStore],
})
export class AuthModule {}
