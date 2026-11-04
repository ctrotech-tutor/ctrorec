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

  async validate(session: SessionRecord): Promise<AuthUser | null> {
    const user = await this.usersRepository.findById(session.userId)
    if (!user) {
      return null
    }
    const snapshot = session.metadata?.credentialsVersion
    const credentialsVersion =
      snapshot === undefined
        ? 0
        : typeof snapshot === 'number' &&
            Number.isInteger(snapshot) &&
            snapshot >= 0
          ? snapshot
          : -1
    return credentialsVersion === user.credentialsVersion ? user : null
  }
}
