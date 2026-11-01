export interface AuthUser {
  id: string
  email: string
  displayName: string
  emailVerified: boolean
  /** Global roles are deliberately empty; roles belong to memberships. */
  roles: string[]
}

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
