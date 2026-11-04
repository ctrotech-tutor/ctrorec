import { Inject, Injectable } from '@nestjs/common'
import { PasswordHasher } from '@nestjs/authentication'
import { UsersRepository } from '../users/users.repository.js'
import type { AuthUser } from './auth-user.js'

@Injectable()
export class CredentialsService {
  constructor(
    @Inject(UsersRepository)
    private readonly usersRepository: UsersRepository,
    @Inject(PasswordHasher) private readonly passwordHasher: PasswordHasher,
  ) {}

  async verify(email: string, password: string): Promise<AuthUser | null> {
    const found = await this.usersRepository.findCredentials(email)
    const valid = await this.passwordHasher.verify(
      password,
      found?.passwordHash,
    )

    if (!valid || !found?.passwordHash) {
      return null
    }

    if (this.passwordHasher.needsRehash(found.passwordHash)) {
      const updated = await this.usersRepository.updatePasswordHash(
        found.user.id,
        await this.passwordHasher.hash(password),
        found.user.credentialsVersion,
      )
      if (!updated) {
        return null
      }
    }

    return found.user
  }
}
