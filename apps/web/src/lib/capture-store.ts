import type { CaptureProvenance } from './lectures'

const DATABASE_NAME = 'ctrorec-lecturer-capture'
const DATABASE_VERSION = 1
const CAPTURES = 'captures'
const CHUNKS = 'chunks'
const OWNER_LECTURE = 'owner_lecture'

export type LocalCaptureStatus = 'recording' | 'paused' | 'stopped' | 'failed'

export interface LocalCapture {
  id: string
  lectureId: string
  ownerId: string
  fileName: string
  recorderMimeType: string
  consentAttestedAt: string
  startedAt: string
  stoppedAt: string | null
  durationMs: number
  chunkCount: number
  byteSize: number
  persistentStorageGranted: boolean
  status: LocalCaptureStatus
  stopReason: CaptureProvenance['stopReason'] | null
  error: string | null
  createdAt: string
  updatedAt: string
}

interface CaptureChunk {
  captureId: string
  sequence: number
  timecode: number
  blob: Blob
}

export async function createLocalCapture(capture: LocalCapture): Promise<void> {
  const database = await openCaptureDatabase()
  try {
    const transaction = database.transaction(CAPTURES, 'readwrite')
    transaction.objectStore(CAPTURES).add(capture)
    await transactionDone(transaction)
  } finally {
    database.close()
  }
}

export async function findLocalCapture(
  ownerId: string,
  lectureId: string,
): Promise<LocalCapture | null> {
  const database = await openCaptureDatabase()
  try {
    const transaction = database.transaction(CAPTURES, 'readonly')
    const request = transaction
      .objectStore(CAPTURES)
      .index(OWNER_LECTURE)
      .get([ownerId, lectureId])
    return ((await requestResult(request)) as LocalCapture | undefined) ?? null
  } finally {
    database.close()
  }
}

export async function appendLocalCaptureChunk(input: {
  captureId: string
  sequence: number
  timecode: number
  blob: Blob
  durationMs: number
}): Promise<LocalCapture> {
  const database = await openCaptureDatabase()
  try {
    const transaction = database.transaction([CAPTURES, CHUNKS], 'readwrite')
    const captures = transaction.objectStore(CAPTURES)
    const existing = (await requestResult(captures.get(input.captureId))) as
      LocalCapture | undefined
    if (!existing) {
      throw new Error('The local capture no longer exists.')
    }
    if (!['recording', 'paused'].includes(existing.status)) {
      throw new Error('The local capture is no longer recording.')
    }
    if (existing.chunkCount !== input.sequence) {
      throw new Error('The local capture chunks are out of sequence.')
    }
    const updated: LocalCapture = {
      ...existing,
      durationMs: Math.max(0, Math.round(input.durationMs)),
      chunkCount: existing.chunkCount + 1,
      byteSize: existing.byteSize + input.blob.size,
      updatedAt: new Date().toISOString(),
    }
    transaction.objectStore(CHUNKS).add({
      captureId: input.captureId,
      sequence: input.sequence,
      timecode: input.timecode,
      blob: input.blob,
    } satisfies CaptureChunk)
    captures.put(updated)
    await transactionDone(transaction)
    return updated
  } finally {
    database.close()
  }
}

export async function updateLocalCapture(
  captureId: string,
  changes: Partial<
    Pick<
      LocalCapture,
      | 'status'
      | 'stoppedAt'
      | 'durationMs'
      | 'stopReason'
      | 'error'
      | 'persistentStorageGranted'
    >
  >,
): Promise<LocalCapture> {
  const database = await openCaptureDatabase()
  try {
    const transaction = database.transaction(CAPTURES, 'readwrite')
    const captures = transaction.objectStore(CAPTURES)
    const existing = (await requestResult(captures.get(captureId))) as
      LocalCapture | undefined
    if (!existing) {
      throw new Error('The local capture no longer exists.')
    }
    const updated: LocalCapture = {
      ...existing,
      ...changes,
      updatedAt: new Date().toISOString(),
    }
    captures.put(updated)
    await transactionDone(transaction)
    return updated
  } finally {
    database.close()
  }
}

export async function readLocalCaptureFile(
  capture: LocalCapture,
): Promise<File> {
  if (
    capture.status !== 'stopped' ||
    !capture.stoppedAt ||
    !capture.stopReason ||
    capture.chunkCount === 0 ||
    capture.byteSize === 0
  ) {
    throw new Error('This local capture is incomplete and cannot be uploaded.')
  }
  const database = await openCaptureDatabase()
  try {
    const transaction = database.transaction(CHUNKS, 'readonly')
    const request = transaction
      .objectStore(CHUNKS)
      .index(CAPTURES)
      .getAll(IDBKeyRange.only(capture.id))
    const chunks = (await requestResult(request)) as CaptureChunk[]
    chunks.sort((left, right) => left.sequence - right.sequence)
    if (
      chunks.length !== capture.chunkCount ||
      chunks.some(
        (chunk, sequence) =>
          chunk.sequence !== sequence || chunk.blob.size === 0,
      ) ||
      chunks.reduce((total, chunk) => total + chunk.blob.size, 0) !==
        capture.byteSize
    ) {
      throw new Error(
        'The local capture is missing audio chunks. Discard it and record again.',
      )
    }
    return new File(
      chunks.map((chunk) => chunk.blob),
      capture.fileName,
      {
        type: capture.recorderMimeType,
        lastModified: Date.parse(capture.stoppedAt),
      },
    )
  } finally {
    database.close()
  }
}

export async function deleteLocalCapture(captureId: string): Promise<void> {
  const database = await openCaptureDatabase()
  try {
    const transaction = database.transaction([CAPTURES, CHUNKS], 'readwrite')
    const chunks = transaction.objectStore(CHUNKS)
    const request = chunks
      .index(CAPTURES)
      .openCursor(IDBKeyRange.only(captureId))
    request.onsuccess = () => {
      const cursor = request.result
      if (cursor) {
        cursor.delete()
        cursor.continue()
      }
    }
    transaction.objectStore(CAPTURES).delete(captureId)
    await transactionDone(transaction)
  } finally {
    database.close()
  }
}

export function localCaptureProvenance(
  capture: LocalCapture,
): CaptureProvenance {
  if (!capture.stoppedAt || !capture.stopReason) {
    throw new Error('The local capture has no completion details.')
  }
  return {
    clientCaptureId: capture.id,
    recorderMimeType: capture.recorderMimeType,
    consentAttestedAt: capture.consentAttestedAt,
    startedAt: capture.startedAt,
    stoppedAt: capture.stoppedAt,
    durationMs: capture.durationMs,
    chunkCount: capture.chunkCount,
    persistentStorageGranted: capture.persistentStorageGranted,
    stopReason: capture.stopReason,
  }
}

async function openCaptureDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) {
    throw new Error('This browser cannot store a recoverable local capture.')
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      const captures = database.createObjectStore(CAPTURES, { keyPath: 'id' })
      captures.createIndex(OWNER_LECTURE, ['ownerId', 'lectureId'], {
        unique: true,
      })
      const chunks = database.createObjectStore(CHUNKS, {
        keyPath: ['captureId', 'sequence'],
      })
      chunks.createIndex(CAPTURES, 'captureId')
    }
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => database.close()
      resolve(database)
    }
    request.onerror = () =>
      reject(
        request.error ?? new Error('Could not open local capture storage.'),
      )
    request.onblocked = () =>
      reject(
        new Error('Local capture storage is blocked by another browser tab.'),
      )
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('A local capture request failed.'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () =>
      reject(
        transaction.error ??
          new Error('The local capture transaction was cancelled.'),
      )
    transaction.onerror = () => {
      // The abort handler reports the transaction failure after all requests settle.
    }
  })
}
