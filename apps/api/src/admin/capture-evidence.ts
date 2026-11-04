export const CAPTURE_EVIDENCE_EXPORT_LIMIT = 5_000

export interface CaptureEvidenceRow {
  captureReference: string
  lectureId: string
  courseCode: string
  offeringSection: string
  lectureTitle: string
  lectureOccurredAt: Date
  recorderMimeType: string
  consentAttestedAt: Date
  captureStartedAt: Date
  captureStoppedAt: Date
  captureDurationMs: number
  savedChunkCount: number
  persistentStorageGranted: boolean
  stopReason: string
  hashingDurationMs: number | null
  uploadDurationMs: number | null
  uploadRetryCount: number | null
  originalMediaType: string
  originalByteSize: number
  originalSha256: string
  serverRecordedAt: Date
  derivativeStatus: string | null
  derivativeAttempts: number | null
  derivativeByteSize: number | null
  derivativeProcessingStartedAt: Date | null
  derivativeCompletedAt: Date | null
}

const columns = [
  'capture_reference',
  'lecture_id',
  'course_code',
  'offering_section',
  'lecture_title',
  'lecture_occurred_at',
  'recorder_mime_type',
  'consent_attested_at',
  'capture_started_at',
  'capture_stopped_at',
  'capture_duration_ms',
  'saved_chunk_count',
  'persistent_storage_granted',
  'stop_reason',
  'hashing_duration_ms',
  'upload_duration_ms',
  'upload_retry_count',
  'original_media_type',
  'original_byte_size',
  'original_sha256',
  'server_recorded_at',
  'derivative_status',
  'derivative_attempts',
  'derivative_byte_size',
  'derivative_processing_ms',
  'derivative_to_original_ratio',
  'derivative_bytes_saved',
] as const

export function captureEvidenceCsv(rows: CaptureEvidenceRow[]): string {
  const records = rows.map((row) => {
    const processingMs = durationBetween(
      row.derivativeProcessingStartedAt,
      row.derivativeCompletedAt,
    )
    const readySize =
      row.derivativeStatus === 'ready' && row.derivativeByteSize !== null
        ? row.derivativeByteSize
        : null
    return [
      row.captureReference,
      row.lectureId,
      row.courseCode,
      row.offeringSection,
      row.lectureTitle,
      row.lectureOccurredAt,
      row.recorderMimeType,
      row.consentAttestedAt,
      row.captureStartedAt,
      row.captureStoppedAt,
      row.captureDurationMs,
      row.savedChunkCount,
      row.persistentStorageGranted,
      row.stopReason,
      row.hashingDurationMs,
      row.uploadDurationMs,
      row.uploadRetryCount,
      row.originalMediaType,
      row.originalByteSize,
      row.originalSha256,
      row.serverRecordedAt,
      row.derivativeStatus,
      row.derivativeAttempts,
      readySize,
      processingMs,
      readySize === null ? null : (readySize / row.originalByteSize).toFixed(6),
      readySize === null ? null : row.originalByteSize - readySize,
    ]
  })
  return `${[columns, ...records]
    .map((record) => record.map(csvCell).join(','))
    .join('\r\n')}\r\n`
}

function durationBetween(startedAt: Date | null, completedAt: Date | null) {
  if (!startedAt || !completedAt) {
    return null
  }
  return Math.max(0, completedAt.getTime() - startedAt.getTime())
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  const text = value instanceof Date ? value.toISOString() : String(value)
  const safe =
    typeof value === 'string' && /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}
