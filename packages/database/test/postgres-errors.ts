import { expect } from 'vitest'

interface ExpectedPostgresError {
  code: string
  constraint: string
}

export async function expectPostgresError(
  query: PromiseLike<unknown>,
  expected: ExpectedPostgresError,
): Promise<void> {
  let thrown: unknown = null
  try {
    await query
  } catch (error) {
    thrown = error
  }

  expect(thrown, 'Expected PostgreSQL to reject the query').not.toBeNull()
  if (typeof thrown !== 'object' || thrown === null || !('cause' in thrown)) {
    throw thrown
  }

  expect(thrown.cause).toMatchObject(expected)
}
