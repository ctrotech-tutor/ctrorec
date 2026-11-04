import {
  appendLocalCaptureChunk,
  createLocalCapture,
  deleteLocalCapture,
  findLocalCapture,
  updateLocalCapture,
  type LocalCapture,
} from './capture-store'

export const CAPTURE_TIMESLICE_MS = 2_000
export const MAX_CAPTURE_BYTES = 256 * 1024 * 1024

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/webm',
  'audio/ogg',
] as const

export interface CaptureFormat {
  mediaType: 'audio/webm' | 'audio/mp4' | 'audio/ogg'
  extension: 'webm' | 'm4a' | 'ogg'
}

export function selectCaptureMimeType(
  isSupported: (mimeType: string) => boolean,
): string | null {
  return MIME_CANDIDATES.find((mimeType) => isSupported(mimeType)) ?? null
}

export function captureFormat(mimeType: string): CaptureFormat {
  const mediaType = mimeType.split(';', 1)[0]?.trim().toLowerCase()
  switch (mediaType) {
    case 'audio/webm':
      return { mediaType, extension: 'webm' }
    case 'audio/mp4':
      return { mediaType, extension: 'm4a' }
    case 'audio/ogg':
      return { mediaType, extension: 'ogg' }
    default:
      throw new Error(
        'This browser selected an unsupported recording format. Upload an audio file instead.',
      )
  }
}

export function formatCaptureDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000))
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

interface BrowserCaptureCallbacks {
  onUpdate: (capture: LocalCapture) => void
  onError: (message: string) => void
}

export class BrowserCapture {
  private recorder: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private capture: LocalCapture | null = null
  private writeQueue: Promise<void> = Promise.resolve()
  private finished: Promise<LocalCapture> | null = null
  private finish!: (capture: LocalCapture) => void
  private fail!: (error: Error) => void
  private finalized = false
  private sequence = 0
  private activeStartedAt: number | null = null
  private accumulatedDurationMs = 0
  private stopReason: LocalCapture['stopReason'] = 'stopped'
  private stoppedAt: string | null = null
  private storageError: string | null = null
  private recorderError: string | null = null
  private limitExceeded = false

  constructor(private readonly callbacks: BrowserCaptureCallbacks) {}

  get current(): LocalCapture | null {
    return this.capture
  }

  get durationMs(): number {
    return Math.round(
      this.accumulatedDurationMs +
        (this.activeStartedAt === null
          ? 0
          : performance.now() - this.activeStartedAt),
    )
  }

  async start(input: {
    lectureId: string
    ownerId: string
    consentAttestedAt: string
  }): Promise<LocalCapture> {
    if (
      !globalThis.navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      throw new Error(
        'Browser recording needs a current browser and a secure HTTPS connection.',
      )
    }
    const existing = await findLocalCapture(input.ownerId, input.lectureId)
    if (existing) {
      throw new Error(
        'A local capture already exists for this lecture. Recover or discard it first.',
      )
    }
    const persistentStorageGranted = await requestPersistentStorage()
    const requestedMimeType = selectCaptureMimeType((mimeType) => {
      try {
        return MediaRecorder.isTypeSupported(mimeType)
      } catch {
        return false
      }
    })
    let stream: MediaStream | null = null
    let createdCaptureId: string | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: { ideal: 1 },
          echoCancellation: { ideal: false },
          noiseSuppression: { ideal: false },
        },
        video: false,
      })
      const recorder = new MediaRecorder(stream, {
        ...(requestedMimeType ? { mimeType: requestedMimeType } : {}),
        audioBitsPerSecond: 48_000,
      })
      const recorderMimeType = recorder.mimeType || requestedMimeType
      if (!recorderMimeType) {
        throw new Error('The browser did not identify its recording format.')
      }
      const format = captureFormat(recorderMimeType)
      const now = new Date().toISOString()
      const capture: LocalCapture = {
        id: crypto.randomUUID(),
        lectureId: input.lectureId,
        ownerId: input.ownerId,
        fileName: `lecture-${input.lectureId}.${format.extension}`,
        recorderMimeType,
        consentAttestedAt: input.consentAttestedAt,
        startedAt: now,
        stoppedAt: null,
        durationMs: 0,
        chunkCount: 0,
        byteSize: 0,
        persistentStorageGranted,
        status: 'recording',
        stopReason: null,
        error: null,
        createdAt: now,
        updatedAt: now,
      }
      await createLocalCapture(capture)
      createdCaptureId = capture.id
      this.stream = stream
      this.recorder = recorder
      this.capture = capture
      this.finished = new Promise<LocalCapture>((resolve, reject) => {
        this.finish = resolve
        this.fail = reject
      })
      void this.finished.catch(() => {
        // Automatic recorder failures are also surfaced through onError/onUpdate.
      })
      recorder.ondataavailable = (event) => this.receiveChunk(event)
      recorder.onerror = () => {
        this.recorderError =
          'The browser reported a recorder error. Review the saved audio before uploading it.'
        this.callbacks.onError(this.recorderError)
        void this.stop('recorder-error')
      }
      recorder.onstop = () => {
        void this.finalize()
      }
      for (const track of stream.getAudioTracks()) {
        track.addEventListener('ended', () => {
          if (this.recorder?.state !== 'inactive') {
            this.stopReason = 'track-ended'
            this.stoppedAt = new Date().toISOString()
          }
        })
      }
      this.activeStartedAt = performance.now()
      recorder.start(CAPTURE_TIMESLICE_MS)
      this.callbacks.onUpdate(capture)
      return capture
    } catch (error) {
      for (const track of stream?.getTracks() ?? []) {
        track.stop()
      }
      if (createdCaptureId) {
        await deleteLocalCapture(createdCaptureId).catch(() => {
          // Preserve the original start error; an orphan appears as recoverable.
        })
      }
      throw captureStartError(error)
    }
  }

  async pause(): Promise<LocalCapture> {
    const recorder = this.requireActiveRecorder()
    if (recorder.state !== 'recording') {
      throw new Error('The recorder is not active.')
    }
    this.accumulatedDurationMs = this.durationMs
    this.activeStartedAt = null
    recorder.pause()
    await this.writeQueue
    const capture = await updateLocalCapture(this.requireCapture().id, {
      status: 'paused',
      durationMs: this.accumulatedDurationMs,
    })
    this.capture = capture
    this.callbacks.onUpdate(capture)
    return capture
  }

  async resume(): Promise<LocalCapture> {
    const recorder = this.requireActiveRecorder()
    if (recorder.state !== 'paused') {
      throw new Error('The recorder is not paused.')
    }
    recorder.resume()
    this.activeStartedAt = performance.now()
    const capture = await updateLocalCapture(this.requireCapture().id, {
      status: 'recording',
    })
    this.capture = capture
    this.callbacks.onUpdate(capture)
    return capture
  }

  stop(
    reason: NonNullable<LocalCapture['stopReason']> = 'stopped',
  ): Promise<LocalCapture> {
    const recorder = this.requireActiveRecorder()
    const finished = this.finished
    if (!finished) {
      return Promise.reject(new Error('The capture was not started correctly.'))
    }
    if (recorder.state === 'inactive') {
      return finished
    }
    if (this.activeStartedAt !== null) {
      this.accumulatedDurationMs = this.durationMs
      this.activeStartedAt = null
    }
    this.stopReason = reason
    this.stoppedAt ??= new Date().toISOString()
    try {
      recorder.stop()
    } catch (error) {
      return Promise.reject(error)
    }
    this.stopTracks()
    return finished
  }

  flush(): void {
    if (this.recorder?.state === 'recording') {
      try {
        this.recorder.requestData()
      } catch {
        // Page teardown may not deliver another event; persisted chunks remain intact.
      }
    }
  }

  private receiveChunk(event: BlobEvent): void {
    const capture = this.requireCapture()
    if (event.data.size === 0 || this.storageError || this.limitExceeded) {
      return
    }
    const sequence = this.sequence
    this.sequence += 1
    const write = this.writeQueue.then(async () => {
      if (this.storageError || this.limitExceeded) {
        return
      }
      const updated = await appendLocalCaptureChunk({
        captureId: capture.id,
        sequence,
        timecode: Number.isFinite(event.timecode) ? event.timecode : 0,
        blob: event.data,
        durationMs: this.durationMs,
      })
      this.capture = updated
      this.callbacks.onUpdate(updated)
      if (updated.byteSize > MAX_CAPTURE_BYTES) {
        this.limitExceeded = true
        this.callbacks.onError(
          'The capture exceeded the 256 MiB original-audio limit. Discard it and record a shorter lecture.',
        )
        void this.stop('size-limit')
      }
    })
    this.writeQueue = write.catch((error: unknown) => {
      this.storageError =
        error instanceof Error
          ? error.message
          : 'A local capture chunk could not be stored.'
      this.callbacks.onError(
        `Local capture storage failed: ${this.storageError}`,
      )
      void this.stop('interrupted')
    })
  }

  private async finalize(): Promise<void> {
    if (this.finalized) {
      return
    }
    this.finalized = true
    if (this.activeStartedAt !== null) {
      this.accumulatedDurationMs = this.durationMs
      this.activeStartedAt = null
    }
    this.stoppedAt ??= new Date().toISOString()
    this.stopTracks()
    try {
      await this.writeQueue
      const capture = this.requireCapture()
      const failed =
        this.storageError ??
        (this.limitExceeded
          ? 'The capture exceeded the original-audio size limit.'
          : null)
      const updated = await updateLocalCapture(capture.id, {
        status: failed ? 'failed' : 'stopped',
        stoppedAt: this.stoppedAt,
        durationMs: this.accumulatedDurationMs,
        stopReason: this.stopReason,
        error: failed ?? this.recorderError,
      })
      this.capture = updated
      this.callbacks.onUpdate(updated)
      this.finish(updated)
    } catch (error) {
      const normalized =
        error instanceof Error
          ? error
          : new Error('The local capture could not be finalized.')
      this.callbacks.onError(normalized.message)
      this.fail(normalized)
    }
  }

  private requireCapture(): LocalCapture {
    if (!this.capture) {
      throw new Error('The capture has not been initialized.')
    }
    return this.capture
  }

  private requireActiveRecorder(): MediaRecorder {
    if (!this.recorder || !this.capture) {
      throw new Error('No browser capture is active.')
    }
    return this.recorder
  }

  private stopTracks(): void {
    for (const track of this.stream?.getTracks() ?? []) {
      track.stop()
    }
  }
}

async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist()) ?? false
  } catch {
    return false
  }
}

function captureStartError(error: unknown): Error {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return new Error(
          'Microphone access was not allowed. Enable it in browser settings and try again.',
        )
      case 'NotFoundError':
        return new Error('No microphone is available on this device.')
      case 'NotReadableError':
      case 'AbortError':
        return new Error(
          'The microphone could not be read. Close other recording apps and try again.',
        )
    }
  }
  return error instanceof Error
    ? error
    : new Error('Browser recording could not be started.')
}
