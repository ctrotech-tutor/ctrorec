export function normalizeEmail(email: string): string {
  return email.trim().normalize('NFC').toLowerCase()
}

export function accountEmail(request: { body?: { email?: unknown } }): string {
  const email = request.body?.email
  return typeof email === 'string' ? normalizeEmail(email) : ''
}
