import { describe, expect, it } from 'vitest'
import {
  captureEvidenceCsv,
  type CaptureEvidenceRow,
} from '../src/admin/capture-evidence.js'

const row: CaptureEvidenceRow = {
  captureReference: '019a1000-0000-7000-8000-0000000000c1',
  lectureId: '019a1000-0000-7000-8000-0000000000c2',
  courseCode: 'CSC101',
  offeringSection: 'A',
  lectureTitle: 'Consented scripted lecture',
  lectureOccurredAt: new Date('2026-11-04T09:00:00.000Z'),
  recorderMimeType: 'audio/webm;codecs=opus',
  consentAttestedAt: new Date('2026-11-04T08:59:59.000Z'),
  captureStartedAt: new Date('2026-11-04T09:00:00.000Z'),
  captureStoppedAt: new Date('2026-11-04T09:05:00.000Z'),
  captureDurationMs: 300_000,
  savedChunkCount: 150,
  persistentStorageGranted: true,
  stopReason: 'stopped',
  hashingDurationMs: 125,
  uploadDurationMs: 2_500,
  uploadRetryCount: 1,
  originalMediaType: 'audio/webm',
  originalByteSize: 20_000,
  originalSha256: 'a'.repeat(64),
  serverRecordedAt: new Date('2026-11-04T09:05:03.000Z'),
  derivativeStatus: 'ready',
  derivativeAttempts: 1,
  derivativeByteSize: 10_000,
  derivativeProcessingStartedAt: new Date('2026-11-04T09:05:03.000Z'),
  derivativeCompletedAt: new Date('2026-11-04T09:05:05.000Z'),
}

describe('capture evidence CSV', () => {
  it('exports correlated original, handoff, and derivative measurements', () => {
    const csv = captureEvidenceCsv([row])

    expect(csv).toContain('"capture_reference"')
    expect(csv).toContain(row.captureReference)
    expect(csv).toContain('"125","2500","1"')
    expect(csv).toContain('"ready","1","10000","2000","0.500000","10000"')
  })

  it('neutralizes spreadsheet formulas and escapes quoted text', () => {
    const csv = captureEvidenceCsv([
      {
        ...row,
        courseCode: ' +CMD',
        lectureTitle: '=2+2,"quoted"',
      },
    ])

    expect(csv).toContain('"\' +CMD"')
    expect(csv).toContain('"\'=2+2,""quoted"""')
  })

  it('leaves unavailable derivative measurements empty', () => {
    const csv = captureEvidenceCsv([
      {
        ...row,
        derivativeStatus: 'failed',
        derivativeByteSize: null,
        derivativeProcessingStartedAt: null,
        derivativeCompletedAt: null,
      },
    ])

    expect(csv.trimEnd().endsWith(',,,,')).toBe(true)
  })
})
