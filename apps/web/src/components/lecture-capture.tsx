import { useEffect, useRef, useState } from 'react'
import {
  BrowserCapture,
  captureFormat,
  formatCaptureDuration,
} from '../lib/browser-capture'
import {
  deleteLocalCapture,
  findLocalCapture,
  localCaptureProvenance,
  readLocalCaptureFile,
  updateLocalCapture,
  type LocalCapture,
} from '../lib/capture-store'
import { uploadLectureAudio, type AudioUploadProgress } from '../lib/lectures'

type BusyAction =
  'start' | 'pause' | 'resume' | 'stop' | 'recover' | 'upload' | 'delete' | null

export function LectureCapture({
  lectureId,
  ownerId,
  onSaved,
}: Readonly<{
  lectureId: string
  ownerId: string
  onSaved: () => Promise<void>
}>) {
  const engine = useRef<BrowserCapture | null>(null)
  const mounted = useRef(true)
  const [capture, setCapture] = useState<LocalCapture | null>(null)
  const [loading, setLoading] = useState(true)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState<BusyAction>(null)
  const [error, setError] = useState<string | null>(null)
  const [durationMs, setDurationMs] = useState(0)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] =
    useState<AudioUploadProgress | null>(null)

  useEffect(() => {
    mounted.current = true
    let cancelled = false
    setLoading(true)
    findLocalCapture(ownerId, lectureId)
      .then((stored) => {
        if (!cancelled) {
          setCapture(stored)
          setDurationMs(stored?.durationMs ?? 0)
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(errorMessage(reason))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
      mounted.current = false
      const active = engine.current
      engine.current = null
      if (
        active?.current &&
        ['recording', 'paused'].includes(active.current.status)
      ) {
        void active.stop('interrupted').catch(() => {
          // The persisted draft remains available for explicit recovery.
        })
      }
    }
  }, [lectureId, ownerId])

  const activelyRecording =
    capture !== null && ['recording', 'paused'].includes(capture.status)

  useEffect(() => {
    if (!activelyRecording) {
      return
    }
    const timer = window.setInterval(() => {
      setDurationMs(engine.current?.durationMs ?? capture.durationMs)
    }, 250)
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    const flush = () => engine.current?.flush()
    window.addEventListener('beforeunload', warn)
    window.addEventListener('pagehide', flush)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('beforeunload', warn)
      window.removeEventListener('pagehide', flush)
    }
  }, [activelyRecording, capture])

  useEffect(() => {
    if (!capture || capture.status !== 'stopped' || capture.chunkCount === 0) {
      setPreviewUrl(null)
      return
    }
    let cancelled = false
    let url: string | null = null
    readLocalCaptureFile(capture)
      .then((file) => {
        if (cancelled) {
          return
        }
        url = URL.createObjectURL(file)
        setPreviewUrl(url)
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setPreviewUrl(null)
          setError(errorMessage(reason))
        }
      })
    return () => {
      cancelled = true
      if (url) {
        URL.revokeObjectURL(url)
      }
    }
  }, [capture])

  async function start() {
    if (!consent || busy) {
      return
    }
    setBusy('start')
    setError(null)
    const recorder = new BrowserCapture({
      onUpdate: (updated) => {
        if (mounted.current) {
          setCapture(updated)
          setDurationMs(updated.durationMs)
        }
      },
      onError: (message) => {
        if (mounted.current) {
          setError(message)
        }
      },
    })
    engine.current = recorder
    try {
      const started = await recorder.start({
        lectureId,
        ownerId,
        consentAttestedAt: new Date().toISOString(),
      })
      if (!mounted.current) {
        await recorder.stop('interrupted')
        return
      }
      setCapture(started)
      setDurationMs(0)
    } catch (reason) {
      if (engine.current === recorder) {
        engine.current = null
      }
      setError(errorMessage(reason))
    } finally {
      if (mounted.current) {
        setBusy(null)
      }
    }
  }

  async function pauseOrResume() {
    const recorder = engine.current
    if (!recorder || !capture || busy) {
      return
    }
    const action = capture.status === 'paused' ? 'resume' : 'pause'
    setBusy(action)
    setError(null)
    try {
      if (action === 'pause') {
        await recorder.pause()
      } else {
        await recorder.resume()
      }
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(null)
    }
  }

  async function stop() {
    const recorder = engine.current
    if (!recorder || busy) {
      return
    }
    setBusy('stop')
    setError(null)
    try {
      const stopped = await recorder.stop('stopped')
      setCapture(stopped)
      setDurationMs(stopped.durationMs)
      engine.current = null
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(null)
    }
  }

  async function recover() {
    if (
      !capture ||
      engine.current ||
      !['recording', 'paused'].includes(capture.status) ||
      busy
    ) {
      return
    }
    setBusy('recover')
    setError(null)
    try {
      const recovered = await updateLocalCapture(capture.id, {
        status: 'stopped',
        stoppedAt: new Date().toISOString(),
        stopReason: 'interrupted',
        error:
          'Recovered after interruption. The last unflushed recorder segment may be absent; review the audio before uploading.',
      })
      setCapture(recovered)
      setDurationMs(recovered.durationMs)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(null)
    }
  }

  async function discard() {
    if (!capture || busy) {
      return
    }
    if (
      !window.confirm(
        'Delete this local recording from the browser? This cannot be undone.',
      )
    ) {
      return
    }
    setBusy('delete')
    setError(null)
    try {
      await deleteLocalCapture(capture.id)
      setCapture(null)
      setPreviewUrl(null)
      setDurationMs(0)
      setConsent(false)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(null)
    }
  }

  async function upload() {
    if (!capture || capture.status !== 'stopped' || busy) {
      return
    }
    setBusy('upload')
    setError(null)
    setUploadProgress(null)
    try {
      const file = await readLocalCaptureFile(capture)
      await uploadLectureAudio({
        lectureId,
        file,
        capture: localCaptureProvenance(capture),
        onProgress: setUploadProgress,
      })
      await deleteLocalCapture(capture.id)
      setCapture(null)
      setUploadProgress(null)
      await onSaved()
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(null)
    }
  }

  const engineActive = engine.current !== null
  const unfinished = activelyRecording && !engineActive
  const canUpload =
    capture?.status === 'stopped' && capture.chunkCount > 0 && !busy

  return (
    <section className="lecture-capture" aria-label="Record lecture audio">
      <div className="capture-heading">
        <div>
          <p className="capture-kicker">Browser capture</p>
          <h4>Record the lecture</h4>
        </div>
        {capture ? (
          <span className="capture-format">
            {captureFormat(capture.recorderMimeType).mediaType}
          </span>
        ) : null}
      </div>
      {capture ? (
        <p className="capture-reference">
          Evidence reference <code>{capture.id}</code>
        </p>
      ) : null}

      {loading ? (
        <p className="capture-state" role="status">
          Checking for a recoverable local draft…
        </p>
      ) : !capture ? (
        <>
          <label className="capture-consent">
            <input
              checked={consent}
              disabled={busy !== null}
              onChange={(event) => setConsent(event.target.checked)}
              type="checkbox"
            />
            <span>
              I attest that I have permission to record this lecture and will
              follow my institution’s consent and retention rules.
            </span>
          </label>
          <button
            className="primary-button capture-start"
            disabled={!consent || busy !== null}
            onClick={start}
            type="button"
          >
            {busy === 'start'
              ? 'Requesting microphone…'
              : 'Start audio recording'}
          </button>
          <p className="data-note">
            Audio only · 48 kbps requested · recoverable browser draft. Keep
            this tab open while recording; background capture is not guaranteed.
          </p>
        </>
      ) : unfinished ? (
        <div className="capture-recovery">
          <strong>Unfinished local draft</strong>
          <p>
            {formatCaptureDuration(capture.durationMs)} ·{' '}
            {formatBytes(capture.byteSize)} saved before interruption.
          </p>
          <p className="data-note">
            Only recover it if no other tab is still recording this lecture.
            Recovery preserves saved chunks; it cannot restore audio never
            delivered by the browser.
          </p>
          <div className="capture-actions">
            <button
              className="primary-button"
              disabled={busy !== null}
              onClick={recover}
              type="button"
            >
              {busy === 'recover' ? 'Recovering…' : 'Recover saved chunks'}
            </button>
            <button
              className="secondary-button"
              disabled={busy !== null}
              onClick={discard}
              type="button"
            >
              Delete local draft
            </button>
          </div>
        </div>
      ) : activelyRecording ? (
        <div className="capture-live" data-state={capture.status}>
          <div className="capture-live-status" role="status">
            <span className="capture-record-mark" aria-hidden="true" />
            {capture.status === 'paused' ? 'Recording paused' : 'Recording'}
          </div>
          <div className="capture-measurements">
            <strong data-testid={`capture-duration-${lectureId}`}>
              {formatCaptureDuration(durationMs)}
            </strong>
            <span data-testid={`capture-bytes-${lectureId}`}>
              {formatBytes(capture.byteSize)} · {capture.chunkCount} saved{' '}
              {capture.chunkCount === 1 ? 'segment' : 'segments'}
            </span>
          </div>
          <div className="capture-actions">
            <button
              className="secondary-button"
              disabled={busy !== null}
              onClick={pauseOrResume}
              type="button"
            >
              {busy === 'pause'
                ? 'Pausing…'
                : busy === 'resume'
                  ? 'Resuming…'
                  : capture.status === 'paused'
                    ? 'Resume recording'
                    : 'Pause recording'}
            </button>
            <button
              className="primary-button"
              disabled={busy !== null}
              onClick={stop}
              type="button"
            >
              {busy === 'stop' ? 'Saving draft…' : 'Stop and review'}
            </button>
          </div>
          <p className="data-note">
            {capture.persistentStorageGranted
              ? 'Persistent browser storage granted.'
              : 'Best-effort browser storage; upload soon and do not clear site data.'}{' '}
            This is not yet saved to institution storage.
          </p>
        </div>
      ) : capture.status === 'failed' ? (
        <div className="capture-recovery">
          <strong>Incomplete local draft</strong>
          <p>
            This draft cannot be uploaded because local storage did not commit
            every chunk.
          </p>
          <button
            className="secondary-button"
            disabled={busy !== null}
            onClick={discard}
            type="button"
          >
            {busy === 'delete' ? 'Deleting…' : 'Delete incomplete draft'}
          </button>
        </div>
      ) : (
        <div className="capture-draft">
          <div className="capture-draft-heading">
            <strong>
              {capture.stopReason === 'interrupted'
                ? 'Recovered local draft'
                : 'Local draft ready'}
            </strong>
            <span>
              {formatCaptureDuration(capture.durationMs)} ·{' '}
              {formatBytes(capture.byteSize)}
            </span>
          </div>
          {previewUrl ? (
            <audio
              aria-label="Review local lecture recording"
              controls
              preload="metadata"
              src={previewUrl}
            />
          ) : (
            <p className="capture-state">
              No complete local audio preview is available.
            </p>
          )}
          {capture.error ? (
            <p className="capture-warning">{capture.error}</p>
          ) : null}
          <p className="data-note">
            Review the browser draft, then upload it to protected institution
            storage. Successful upload removes this local copy.
          </p>
          <div className="capture-actions">
            <button
              className="primary-button"
              disabled={!canUpload}
              onClick={upload}
              type="button"
            >
              {busy === 'upload'
                ? 'Uploading capture…'
                : 'Upload captured audio'}
            </button>
            <button
              className="secondary-button"
              disabled={busy !== null}
              onClick={discard}
              type="button"
            >
              {busy === 'delete' ? 'Deleting…' : 'Delete local draft'}
            </button>
          </div>
          {uploadProgress ? (
            <div className="upload-progress" role="status">
              <span>{uploadProgressLabel(uploadProgress)}</span>
              <progress
                aria-label="Captured audio upload progress"
                max={uploadProgress.totalBytes}
                value={uploadProgress.receivedBytes}
              />
            </div>
          ) : null}
        </div>
      )}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}

function uploadProgressLabel(progress: AudioUploadProgress): string {
  if (progress.phase === 'completing') {
    return 'Finalizing the original and capture record'
  }
  const percentage = Math.min(
    100,
    Math.floor((progress.receivedBytes / progress.totalBytes) * 100),
  )
  return progress.phase === 'hashing'
    ? `Checking capture integrity · ${percentage}%`
    : `Uploading capture · ${percentage}%`
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KiB`
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : 'The browser capture operation could not be completed.'
}
