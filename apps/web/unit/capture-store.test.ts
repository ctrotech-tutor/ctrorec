import 'fake-indexeddb/auto'
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  appendLocalCaptureChunk,
  createLocalCapture,
  deleteLocalCapture,
  findLocalCapture,
  localCaptureProvenance,
  readLocalCaptureFile,
  updateLocalCapture,
  type LocalCapture,
} from '../src/lib/capture-store'

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('ctrorec-lecturer-capture')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () =>
      reject(new Error('Test database deletion blocked.'))
  })
})

describe('local lecture capture store', () => {
  it('persists ordered blobs, creates one File, and reports provenance', async () => {
    const capture = draft()
    await createLocalCapture(capture)
    await appendLocalCaptureChunk({
      captureId: capture.id,
      sequence: 0,
      timecode: 0,
      blob: new Blob(['first-'], { type: capture.recorderMimeType }),
      durationMs: 2_000,
    })
    const appended = await appendLocalCaptureChunk({
      captureId: capture.id,
      sequence: 1,
      timecode: 2_000,
      blob: new Blob(['second'], { type: capture.recorderMimeType }),
      durationMs: 4_000,
    })
    expect(appended).toMatchObject({ chunkCount: 2, byteSize: 12 })

    const stopped = await updateLocalCapture(capture.id, {
      status: 'stopped',
      stoppedAt: '2026-11-04T10:00:05.000Z',
      stopReason: 'stopped',
      durationMs: 4_000,
    })
    const file = await readLocalCaptureFile(stopped)
    expect(file.name).toBe(capture.fileName)
    expect(file.type).toBe(capture.recorderMimeType)
    expect(await file.text()).toBe('first-second')
    expect(localCaptureProvenance(stopped)).toEqual({
      clientCaptureId: capture.id,
      recorderMimeType: capture.recorderMimeType,
      consentAttestedAt: capture.consentAttestedAt,
      startedAt: capture.startedAt,
      stoppedAt: '2026-11-04T10:00:05.000Z',
      durationMs: 4_000,
      chunkCount: 2,
      persistentStorageGranted: false,
      stopReason: 'stopped',
    })

    await deleteLocalCapture(capture.id)
    expect(
      await findLocalCapture(capture.ownerId, capture.lectureId),
    ).toBeNull()
  })

  it('rejects a sequence gap without advancing the capture', async () => {
    const capture = draft()
    await createLocalCapture(capture)
    await expect(
      appendLocalCaptureChunk({
        captureId: capture.id,
        sequence: 1,
        timecode: 0,
        blob: new Blob(['wrong']),
        durationMs: 1_000,
      }),
    ).rejects.toThrow('out of sequence')
    expect(
      await findLocalCapture(capture.ownerId, capture.lectureId),
    ).toMatchObject({
      chunkCount: 0,
      byteSize: 0,
    })
  })

  it('allows only one local draft per owner and lecture', async () => {
    const capture = draft()
    await createLocalCapture(capture)
    await createLocalCapture({ ...draft(), ownerId: 'another-owner' })
    await expect(createLocalCapture(capture)).rejects.toThrow()
    await expect(
      createLocalCapture({ ...draft(), lectureId: capture.lectureId }),
    ).rejects.toThrow()
  })

  it('does not assemble an unfinished or empty capture', async () => {
    const capture = draft()
    await createLocalCapture(capture)
    await expect(readLocalCaptureFile(capture)).rejects.toThrow('incomplete')
    const stopped = await updateLocalCapture(capture.id, {
      status: 'stopped',
      stoppedAt: new Date().toISOString(),
      stopReason: 'interrupted',
    })
    await expect(readLocalCaptureFile(stopped)).rejects.toThrow('incomplete')
  })
})

function draft(): LocalCapture {
  const id = randomUUID()
  return {
    id,
    lectureId: randomUUID(),
    ownerId: 'lecturer-user',
    fileName: `lecture-${id}.webm`,
    recorderMimeType: 'audio/webm;codecs=opus',
    consentAttestedAt: '2026-11-04T09:59:59.000Z',
    startedAt: '2026-11-04T10:00:00.000Z',
    stoppedAt: null,
    durationMs: 0,
    chunkCount: 0,
    byteSize: 0,
    persistentStorageGranted: false,
    status: 'recording',
    stopReason: null,
    error: null,
    createdAt: '2026-11-04T10:00:00.000Z',
    updatedAt: '2026-11-04T10:00:00.000Z',
  }
}
