import { describe, expect, it } from 'vitest'
import { parseDataSaverJob } from '../src/jobs.js'

const validJob = {
  derivativeId: '019a1000-0000-7000-8000-000000000001',
  lectureId: '019a1000-0000-7000-8000-00000000000c',
  sourceSha256: 'a'.repeat(64),
}

describe('data-saver job payload', () => {
  it('accepts tenant-linked identifiers and a source checksum', () => {
    expect(parseDataSaverJob(validJob)).toEqual(validJob)
  })

  it('rejects malformed identifiers and checksums', () => {
    expect(() =>
      parseDataSaverJob({ ...validJob, derivativeId: 'not-a-uuid' }),
    ).toThrow('Invalid data-saver job payload.')
    expect(() =>
      parseDataSaverJob({ ...validJob, sourceSha256: 'abc' }),
    ).toThrow('Invalid data-saver job payload.')
    expect(() => parseDataSaverJob(null)).toThrow(
      'Invalid data-saver job payload.',
    )
  })
})
