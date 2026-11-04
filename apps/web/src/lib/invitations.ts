import { queryOptions } from '@tanstack/react-query'
import { adminKeys } from './admin'
import { requestJson } from './http'

export interface InvitationView {
  id: string
  email: string
  displayName: string
  roles: string[]
  status: 'pending' | 'accepted' | 'expired' | 'revoked' | 'replaced'
  expiresAt: string
  createdAt: string
  acceptedAt: string | null
  revokedAt: string | null
  revocationReason: string | null
  invitedBy: { displayName: string; email: string }
}

export interface CreatedInvitation {
  invitation: InvitationView
  token: string
}

export interface InvitationPreview {
  institution: { name: string; slug: string }
  email: string
  displayName: string
  roles: string[]
  expiresAt: string
  accountExists: boolean
}

export interface AcceptedInvitation {
  accepted: true
  email: string
  displayName: string
  institution: { name: string; slug: string }
  roles: string[]
}

export interface CreateInvitationInput {
  institutionId: string
  email: string
  displayName: string
  roles: string[]
  expiresInDays: number
}

export function adminInvitationsOptions(institutionId: string) {
  return queryOptions({
    queryKey: adminKeys.invitations(institutionId),
    queryFn: async ({ signal }) => {
      const value = await requestJson(root(institutionId), { signal })
      if (!Array.isArray(value) || !value.every(isInvitation)) {
        throw new Error('The invitation response did not match its contract.')
      }
      return value
    },
    retry: 1,
  })
}

export function createInvitation(
  input: CreateInvitationInput,
): Promise<CreatedInvitation> {
  return write(
    root(input.institutionId),
    'POST',
    {
      email: input.email,
      displayName: input.displayName,
      roles: input.roles,
      expiresInDays: input.expiresInDays,
    },
    isCreatedInvitation,
  )
}

export function revokeInvitation(input: {
  institutionId: string
  invitationId: string
}): Promise<InvitationView> {
  return write(
    `${root(input.institutionId)}/${encodeURIComponent(input.invitationId)}/revoke`,
    'POST',
    undefined,
    isInvitation,
  )
}

export async function inspectInvitation(
  token: string,
  signal?: AbortSignal,
): Promise<InvitationPreview> {
  const value = await requestJson('/api/invitations/inspect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
    ...(signal ? { signal } : {}),
  })
  if (!isPreview(value)) {
    throw new Error('The invitation preview did not match its contract.')
  }
  return value
}

export async function acceptInvitation(input: {
  token: string
  email: string
  password: string
}): Promise<AcceptedInvitation> {
  const value = await requestJson('/api/invitations/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!isAccepted(value)) {
    throw new Error('The invitation acceptance did not match its contract.')
  }
  return value
}

async function write<T>(
  path: string,
  method: string,
  body: unknown,
  guard: (value: unknown) => value is T,
): Promise<T> {
  const value = await requestJson(path, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  })
  if (!guard(value)) {
    throw new Error('The invitation response did not match its contract.')
  }
  return value
}

function root(institutionId: string): string {
  return `/api/institutions/${encodeURIComponent(institutionId)}/admin/invitations`
}

function isCreatedInvitation(value: unknown): value is CreatedInvitation {
  return (
    isRecord(value) &&
    typeof value.token === 'string' &&
    value.token.length >= 32 &&
    isInvitation(value.invitation)
  )
}

function isInvitation(value: unknown): value is InvitationView {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.email === 'string' &&
    typeof value.displayName === 'string' &&
    Array.isArray(value.roles) &&
    value.roles.every((role) => typeof role === 'string') &&
    ['pending', 'accepted', 'expired', 'revoked', 'replaced'].includes(
      String(value.status),
    ) &&
    typeof value.expiresAt === 'string' &&
    typeof value.createdAt === 'string' &&
    (typeof value.acceptedAt === 'string' || value.acceptedAt === null) &&
    (typeof value.revokedAt === 'string' || value.revokedAt === null) &&
    (typeof value.revocationReason === 'string' ||
      value.revocationReason === null) &&
    isRecord(value.invitedBy) &&
    typeof value.invitedBy.displayName === 'string' &&
    typeof value.invitedBy.email === 'string'
  )
}

function isPreview(value: unknown): value is InvitationPreview {
  return (
    isRecord(value) &&
    isRecord(value.institution) &&
    typeof value.institution.name === 'string' &&
    typeof value.institution.slug === 'string' &&
    typeof value.email === 'string' &&
    typeof value.displayName === 'string' &&
    Array.isArray(value.roles) &&
    value.roles.every((role) => typeof role === 'string') &&
    typeof value.expiresAt === 'string' &&
    typeof value.accountExists === 'boolean'
  )
}

function isAccepted(value: unknown): value is AcceptedInvitation {
  return (
    isRecord(value) &&
    value.accepted === true &&
    typeof value.email === 'string' &&
    typeof value.displayName === 'string' &&
    isRecord(value.institution) &&
    typeof value.institution.name === 'string' &&
    typeof value.institution.slug === 'string' &&
    Array.isArray(value.roles) &&
    value.roles.every((role) => typeof role === 'string')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
