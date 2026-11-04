import { createHash } from 'node:crypto'
import type { DatabaseTransaction } from '@ctrorec/database'
import { PasswordHasher } from '@nestjs/authentication'
import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { normalizeEmail } from '../auth/email.js'
import { DATABASE } from '../database/database.constants.js'
import type { Database } from '@ctrorec/database'
import type {
  InspectRecoveryDto,
  RequestRecoveryDto,
  ResetPasswordDto,
} from './recovery.dto.js'
import { RecoveryJobsService } from './recovery-jobs.service.js'
import {
  RecoveryRepository,
  type RecoveryRequestRow,
  type RecoveryUserRow,
} from './recovery.repository.js'

const RECOVERY_TTL_MS = 15 * 60 * 1000
const REQUEST_COOLDOWN_MS = 60 * 1000
const REQUEST_WINDOW_MS = 60 * 60 * 1000
const MAX_REQUESTS_PER_WINDOW = 5
const invalidRecoveryMessage =
  'This recovery link is invalid, expired, or has already been used.'

@Injectable()
export class RecoveryService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(RecoveryRepository)
    private readonly repository: RecoveryRepository,
    @Inject(RecoveryJobsService)
    private readonly jobs: RecoveryJobsService,
    @Inject(PasswordHasher) private readonly passwordHasher: PasswordHasher,
  ) {}

  async request(input: RequestRecoveryDto) {
    const email = normalizeEmail(input.email)
    const now = new Date()
    await this.db.transaction(async (tx) => {
      await lockEmail(tx, email)
      const latest = await this.repository.latestForEmail(tx, email)
      if (
        latest &&
        now.getTime() - latest.createdAt.getTime() < REQUEST_COOLDOWN_MS
      ) {
        return
      }
      const recentCount = await this.repository.countSince(
        tx,
        email,
        new Date(now.getTime() - REQUEST_WINDOW_MS),
      )
      if (recentCount >= MAX_REQUESTS_PER_WINDOW) {
        return
      }

      await this.repository.revokeOpen(tx, email, now, 'replaced')
      const request = await this.repository.insert(tx, {
        email,
        expiresAt: new Date(now.getTime() + RECOVERY_TTL_MS),
      })
      await this.jobs.publish(request.id, tx)
    })

    return {
      accepted: true as const,
      message:
        'If an active account matches that email, a recovery link will be sent.',
    }
  }

  async inspect(input: InspectRecoveryDto) {
    const request = await this.repository.findByToken(
      this.db,
      hashToken(input.token),
    )
    assertUsable(request)
    const user = await this.repository.findUser(this.db, request.userId)
    assertAccountMatches(request, user)
    return {
      valid: true as const,
      expiresAt: request.expiresAt.toISOString(),
    }
  }

  async reset(input: ResetPasswordDto) {
    const tokenHash = hashToken(input.token)
    const passwordHash = await this.passwordHasher.hash(input.password)

    await this.db.transaction(async (tx) => {
      const candidate = await this.repository.findByToken(tx, tokenHash)
      assertUsable(candidate)
      await lockEmail(tx, candidate.email)
      const request = await this.repository.findByTokenForUpdate(tx, tokenHash)
      assertUsable(request)
      const user = await this.repository.findUserForUpdate(tx, request.userId)
      assertAccountMatches(request, user)
      const now = new Date()

      if (
        !(await this.repository.markConsumed(tx, request.id, tokenHash, now)) ||
        !(await this.repository.updatePassword(
          tx,
          user.id,
          request.email,
          passwordHash,
          now,
        ))
      ) {
        throw new BadRequestException(invalidRecoveryMessage)
      }
      await this.repository.deleteUserSessions(tx, user.id)
      await this.repository.revokeOpen(
        tx,
        request.email,
        now,
        'reset',
        request.id,
      )
    })

    return { reset: true as const }
  }
}

function assertUsable(
  request: RecoveryRequestRow | null,
): asserts request is RecoveryRequestRow & { userId: string } {
  if (
    !request ||
    request.status !== 'delivered' ||
    !request.userId ||
    !request.deliveredAt ||
    request.consumedAt ||
    request.revokedAt ||
    request.expiresAt.getTime() <= Date.now()
  ) {
    throw new BadRequestException(invalidRecoveryMessage)
  }
}

function assertAccountMatches(
  request: RecoveryRequestRow & { userId: string },
  user: RecoveryUserRow | null,
): asserts user is RecoveryUserRow {
  if (
    !user ||
    user.id !== request.userId ||
    user.email !== request.email ||
    user.status !== 'active'
  ) {
    throw new BadRequestException(invalidRecoveryMessage)
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

async function lockEmail(
  tx: DatabaseTransaction,
  email: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`ctrorec:recovery:${email}`}))`,
  )
}
