import { Inject, Injectable } from '@nestjs/common'
import {
  AuthenticationRegistry,
  SessionCookieProvider,
  type SessionRecord,
} from '@nestjs/authentication'
import { UsersRepository } from '../users/users.repository.js'
import type { AuthUser } from './auth-user.js'

@Injectable()
export class SessionAuth extends SessionCookieProvider<AuthUser> {
  constructor(
    @Inject(UsersRepository)
    private readonly usersRepository: UsersRepository,
    @Inject(AuthenticationRegistry) registry: AuthenticationRegistry,
  ) {
    super()
    registry.registerProvider(this)
  }

  validate(session: SessionRecord): Promise<AuthUser | null> {
    return this.usersRepository.findById(session.userId)
  }
}
