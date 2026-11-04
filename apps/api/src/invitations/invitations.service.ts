import { createHash, randomBytes } from 'node:crypto'
import type { Database, DatabaseTransaction } from '@ctrorec/database'
import { PasswordHasher } from '@nestjs/authentication'
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { AdminAccessService } from '../admin/admin-access.service.js'
import { DATABASE } from '../database/database.constants.js'
import { normalizeEmail } from '../auth/email.js'
import type {
  AcceptInvitationDto,
  CreateInvitationDto,
  InspectInvitationDto,
} from './invitations.dto.js'
import {
  InvitationsRepository,
  type InvitationRecord,
} from './invitations.repository.js'

const DAY_MS = 86_400_000
const roleOrder: readonly string[] = [
  'institution_admin',
  'academic_staff',
  'student',
]
const allowedRoles = new Set<string>(roleOrder)
const invalidInvitationMessage =
  'This invitation link is invalid, expired, or no longer available.'

@Injectable()
export class InvitationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(InvitationsRepository)
    private readonly repository: InvitationsRepository,
    @Inject(AdminAccessService)
    private readonly adminAccess: AdminAccessService,
    @Inject(PasswordHasher) private readonly passwordHasher: PasswordHasher,
  ) {}

  async list(userId: string, institutionId: string) {
    await this.adminAccess.require(userId, institutionId)
    const now = new Date()
    return (await this.repository.list(institutionId)).map((record) =>
      toInvitationView(record, now),
    )
  }

  async create(
    userId: string,
    institutionId: string,
    input: CreateInvitationDto,
  ) {
    const access = await this.adminAccess.require(userId, institutionId)
    const email = cleanEmail(input.email)
    const displayName = cleanDisplayName(input.displayName)
    const roles = cleanRoles(input.roles)
    const now = new Date()
    const expiresAt = new Date(
      now.getTime() + (input.expiresInDays ?? 7) * DAY_MS,
    )
    const token = randomBytes(32).toString('base64url')
    const tokenHash = hashToken(token)

    const record = await translateWriteError(
      () =>
        this.db.transaction(async (tx) => {
          await this.repository.replaceOpenInvitations(
            tx,
            institutionId,
            email,
            now,
          )
          if (
            await this.repository.findMembershipByEmail(
              tx,
              institutionId,
              email,
            )
          ) {
            throw new ConflictException(
              'This person already has a membership in the institution.',
            )
          }
          const invitation = await this.repository.insertInvitation(
            tx,
            {
              institutionId,
              invitedByMembershipId: access.membershipId,
              email,
              displayName,
              tokenHash,
              expiresAt,
            },
            roles,
          )
          return required(
            await this.repository.findById(tx, institutionId, invitation.id),
          )
        }),
      'Another open invitation was created concurrently. Review the invitation list.',
    )
    return { invitation: toInvitationView(record, now), token }
  }

  async revoke(userId: string, institutionId: string, invitationId: string) {
    await this.adminAccess.require(userId, institutionId)
    if (!isUuid(invitationId)) {
      throw new NotFoundException('Invalid invitationId.')
    }
    const now = new Date()
    return this.db.transaction(async (tx) => {
      const record = await this.repository.findByIdForUpdate(
        tx,
        institutionId,
        invitationId,
      )
      if (!record) {
        throw new NotFoundException()
      }
      if (record.invitation.acceptedAt) {
        throw new ConflictException('An accepted invitation cannot be revoked.')
      }
      if (!record.invitation.revokedAt) {
        await this.repository.revoke(tx, institutionId, invitationId, now)
      }
      return toInvitationView(
        required(
          await this.repository.findById(tx, institutionId, invitationId),
        ),
        now,
      )
    })
  }

  async inspect(input: InspectInvitationDto) {
    const record = await this.repository.findByToken(
      this.db,
      hashToken(input.token),
    )
    assertUsable(record)
    const existingUser = await this.repository.findUserByEmail(
      this.db,
      record.invitation.email,
    )
    return {
      institution: {
        name: record.institution.name,
        slug: record.institution.slug,
      },
      email: record.invitation.email,
      displayName: record.invitation.displayName,
      roles: sortedRoles(record.roles),
      expiresAt: record.invitation.expiresAt.toISOString(),
      accountExists: existingUser !== null,
    }
  }

  async accept(input: AcceptInvitationDto) {
    const tokenHash = hashToken(input.token)
    const email = cleanEmail(input.email)
    const acceptedAt = new Date()
    return translateWriteError(
      () =>
        this.db.transaction(async (tx) => {
          const record = await this.repository.findByTokenForUpdate(
            tx,
            tokenHash,
          )
          assertUsable(record)
          if (record.invitation.email !== email) {
            throw new BadRequestException(
              'The invitation details do not match.',
            )
          }

          await lockEmail(tx, email)
          let user = await this.repository.findUserByEmailForUpdate(tx, email)
          if (user) {
            if (user.status !== 'active' || !user.passwordHash) {
              throw new UnauthorizedException(
                'This account cannot accept an invitation. Contact the institution.',
              )
            }
            const valid = await this.passwordHasher.verify(
              input.password,
              user.passwordHash,
            )
            if (!valid) {
              throw new UnauthorizedException('Invalid email or password')
            }
            if (this.passwordHasher.needsRehash(user.passwordHash)) {
              await this.repository.updatePasswordHash(
                tx,
                user.id,
                await this.passwordHasher.hash(input.password),
                acceptedAt,
              )
            }
          } else {
            if (input.password.length < 12) {
              throw new BadRequestException(
                'Use at least 12 characters for a new password.',
              )
            }
            user = await this.repository.insertUser(tx, {
              email,
              displayName: record.invitation.displayName,
              passwordHash: await this.passwordHasher.hash(input.password),
              status: 'active',
            })
          }

          if (
            await this.repository.findMembershipByUser(
              tx,
              record.invitation.institutionId,
              user.id,
            )
          ) {
            throw new ConflictException(
              'This account already has a membership in the institution.',
            )
          }
          const membership = await this.repository.insertMembership(
            tx,
            record.invitation.institutionId,
            user.id,
            sortedRoles(record.roles),
          )
          await this.repository.markAccepted(tx, {
            institutionId: record.invitation.institutionId,
            invitationId: record.invitation.id,
            acceptedAt,
            userId: user.id,
            membershipId: membership.id,
          })
          return {
            accepted: true as const,
            email: user.email,
            displayName: user.displayName,
            institution: {
              name: record.institution.name,
              slug: record.institution.slug,
            },
            roles: sortedRoles(record.roles),
          }
        }),
      'The account or membership changed during acceptance. Review the account before retrying.',
    )
  }
}

function toInvitationView(record: InvitationRecord, now: Date) {
  return {
    id: record.invitation.id,
    email: record.invitation.email,
    displayName: record.invitation.displayName,
    roles: sortedRoles(record.roles),
    status: invitationStatus(record, now),
    expiresAt: record.invitation.expiresAt.toISOString(),
    createdAt: record.invitation.createdAt.toISOString(),
    acceptedAt: record.invitation.acceptedAt?.toISOString() ?? null,
    revokedAt: record.invitation.revokedAt?.toISOString() ?? null,
    revocationReason: record.invitation.revocationReason,
    invitedBy: record.invitedBy,
  }
}

function invitationStatus(record: InvitationRecord, now: Date): string {
  if (record.invitation.acceptedAt) {
    return 'accepted'
  }
  if (record.invitation.revocationReason === 'replaced') {
    return 'replaced'
  }
  if (record.invitation.revokedAt) {
    return 'revoked'
  }
  return record.invitation.expiresAt.getTime() <= now.getTime()
    ? 'expired'
    : 'pending'
}

function assertUsable(
  record: InvitationRecord | null,
): asserts record is InvitationRecord {
  if (
    !record ||
    record.institution.status !== 'active' ||
    record.invitation.acceptedAt ||
    record.invitation.revokedAt ||
    record.invitation.expiresAt.getTime() <= Date.now() ||
    record.roles.length === 0
  ) {
    throw new BadRequestException(invalidInvitationMessage)
  }
}

function cleanEmail(value: string): string {
  const email = normalizeEmail(value)
  if (email.length > 254 || !email.includes('@')) {
    throw new BadRequestException('A valid invitation email is required.')
  }
  return email
}

function cleanDisplayName(value: string): string {
  const displayName = value.normalize('NFC').trim()
  if (!displayName || displayName.length > 120) {
    throw new BadRequestException('A valid display name is required.')
  }
  return displayName
}

function cleanRoles(values: string[]): string[] {
  const roles = [...new Set(values)]
  if (
    roles.length === 0 ||
    roles.length > roleOrder.length ||
    roles.some((role) => !allowedRoles.has(role))
  ) {
    throw new BadRequestException('Choose at least one valid membership role.')
  }
  return sortedRoles(roles)
}

function sortedRoles(roles: string[]): string[] {
  return [...roles].sort(
    (left, right) => roleOrder.indexOf(left) - roleOrder.indexOf(right),
  )
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

async function lockEmail(
  tx: DatabaseTransaction,
  email: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`ctrorec:invitation:${email}`}))`,
  )
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  )
}

function required<T>(value: T | null): T {
  if (!value) {
    throw new Error('The stored invitation could not be reloaded.')
  }
  return value
}

async function translateWriteError<T>(
  operation: () => Promise<T>,
  conflictMessage: string,
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    const code = postgresCode(error)
    if (code === '23505') {
      throw new ConflictException(conflictMessage)
    }
    if (code === '23503' || code === '23514') {
      throw new BadRequestException(
        'The invitation violates a stored relationship or constraint.',
      )
    }
    throw error
  }
}

function postgresCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('cause' in error)) {
    return null
  }
  const cause = error.cause
  return typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    typeof cause.code === 'string'
    ? cause.code
    : null
}
