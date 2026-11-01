import { queryOptions } from '@tanstack/react-query'

export interface AuthMembership {
  id: string
  status: string
  institution: {
    id: string
    slug: string
    name: string
    status: string
  }
  roles: string[]
}

export interface AuthMe {
  user: {
    id: string
    email: string
    displayName: string
    emailVerified: boolean
  }
  memberships: AuthMembership[]
}

export interface SignInInput {
  email: string
  password: string
}

export const authKeys = {
  me: ['auth', 'me'] as const,
}

export const authMeOptions = queryOptions({
  queryKey: authKeys.me,
  queryFn: async ({ signal }): Promise<AuthMe | null> => {
    const response = await fetch('/api/auth/me', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal,
    })

    if (response.status === 401) {
      return null
    }
    if (!response.ok) {
      throw new Error(`Session request failed with ${response.status}.`)
    }

    const body: unknown = await response.json()
    if (!isAuthMe(body)) {
      throw new Error('Session response did not match the expected contract.')
    }
    return body
  },
  retry: 1,
})

export async function signIn(input: SignInInput): Promise<void> {
  const response = await fetch('/api/auth/sign-in', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  if (response.ok) {
    return
  }
  if (response.status === 401) {
    throw new Error('Email or password is incorrect.')
  }
  if (response.status === 429) {
    throw new Error('Too many attempts. Wait before trying again.')
  }
  throw new Error(
    'Sign-in is unavailable. Check your connection and try again.',
  )
}

export async function signOut(): Promise<void> {
  const response = await fetch('/api/auth/sign-out', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    throw new Error('Sign-out failed. Try again.')
  }
}

function isAuthMe(value: unknown): value is AuthMe {
  if (!isRecord(value) || !isRecord(value.user)) {
    return false
  }

  return (
    typeof value.user.id === 'string' &&
    typeof value.user.email === 'string' &&
    typeof value.user.displayName === 'string' &&
    typeof value.user.emailVerified === 'boolean' &&
    Array.isArray(value.memberships) &&
    value.memberships.every(isMembership)
  )
}

function isMembership(value: unknown): value is AuthMembership {
  if (!isRecord(value) || !isRecord(value.institution)) {
    return false
  }

  return (
    typeof value.id === 'string' &&
    typeof value.status === 'string' &&
    typeof value.institution.id === 'string' &&
    typeof value.institution.slug === 'string' &&
    typeof value.institution.name === 'string' &&
    typeof value.institution.status === 'string' &&
    Array.isArray(value.roles) &&
    value.roles.every((role) => typeof role === 'string')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
