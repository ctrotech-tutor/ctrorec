import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { LectureCapture } from './lecture-capture'
import {
  courseKeys,
  courseLecturesOptions,
  courseOfferingsOptions,
  cancelActiveAudioUpload,
  createLecture,
  publishLecture,
  updateLecture,
  uploadLectureAudio,
  type AudioUploadProgress,
  type CourseOffering,
  type Lecture,
} from '../lib/lectures'

export function CourseWorkspace({ ownerId }: Readonly<{ ownerId: string }>) {
  const queryClient = useQueryClient()
  const offerings = useQuery(courseOfferingsOptions)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = offerings.data?.find(
    (offering) => offering.id === selectedId,
  )
  const offering = selected ?? offerings.data?.[0]
  const lectures = useQuery({
    ...courseLecturesOptions(offering?.id ?? ''),
    enabled: Boolean(offering),
    refetchInterval: (query) =>
      query.state.data?.some((lecture) => {
        const status = lecture.audio?.dataSaver?.status
        return status === 'pending' || status === 'processing'
      })
        ? 2_000
        : false,
  })

  async function refreshLectures(offeringId: string) {
    await queryClient.invalidateQueries({
      queryKey: courseKeys.lectures(offeringId),
    })
  }

  return (
    <section className="course-workspace" aria-labelledby="courses-title">
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">Academic memory</p>
          <h2 id="courses-title">Course lectures</h2>
        </div>
        {offerings.data && offerings.data.length > 1 && offering ? (
          <label className="offering-picker">
            <span>Current course</span>
            <select
              onChange={(event) => setSelectedId(event.target.value)}
              value={offering.id}
            >
              {offerings.data.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.course.code} · Section {item.section}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {offerings.isPending ? (
        <p className="workspace-state" role="status">
          Loading your courses…
        </p>
      ) : offerings.isError ? (
        <p className="form-error" role="alert">
          {offerings.error.message}
        </p>
      ) : offerings.data.length === 0 ? (
        <p className="workspace-state">
          No current course assignments or enrollments are available.
        </p>
      ) : offering ? (
        <OfferingLectures
          key={offering.id}
          error={lectures.isError ? lectures.error.message : undefined}
          lectures={lectures.data}
          offering={offering}
          ownerId={ownerId}
          pending={lectures.isPending}
          onRefresh={() => refreshLectures(offering.id)}
        />
      ) : null}
    </section>
  )
}

function OfferingLectures({
  offering,
  ownerId,
  lectures,
  pending,
  error,
  onRefresh,
}: Readonly<{
  offering: CourseOffering
  ownerId: string
  lectures: Lecture[] | undefined
  pending: boolean
  error: string | undefined
  onRefresh: () => Promise<void>
}>) {
  return (
    <div className="offering-content">
      <div className="offering-summary">
        <p>
          <strong>
            {offering.course.code} · {offering.course.title}
          </strong>
        </p>
        <p>
          Section {offering.section} · {offering.term.name} ·{' '}
          {offering.access.canManage ? 'Lecturer access' : 'Student access'}
        </p>
      </div>

      {offering.access.canManage && offering.status === 'active' ? (
        <NewLectureForm offeringId={offering.id} onRefresh={onRefresh} />
      ) : null}

      {pending ? (
        <p className="workspace-state" role="status">
          Loading lectures…
        </p>
      ) : error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : lectures && lectures.length > 0 ? (
        <ol className="lecture-list">
          {lectures.map((lecture) => (
            <LectureItem
              key={lecture.id}
              canManage={
                offering.access.canManage && offering.status === 'active'
              }
              lecture={lecture}
              ownerId={ownerId}
              onRefresh={onRefresh}
            />
          ))}
        </ol>
      ) : (
        <p className="workspace-state">
          {offering.access.canManage
            ? 'No lectures have been added to this offering.'
            : 'No lectures have been published for this offering yet.'}
        </p>
      )}
    </div>
  )
}

interface LectureDetailsInput {
  title: string
  description: string
  occurredAt: string
}

function NewLectureForm({
  offeringId,
  onRefresh,
}: Readonly<{
  offeringId: string
  onRefresh: () => Promise<void>
}>) {
  const [resetKey, setResetKey] = useState(0)
  const create = useMutation({
    mutationFn: (details: LectureDetailsInput) =>
      createLecture({ offeringId, ...details }),
    onSuccess: async () => {
      await onRefresh()
      setResetKey((value) => value + 1)
    },
  })

  return (
    <section className="lecture-composer" aria-labelledby="new-lecture-title">
      <div>
        <p className="eyebrow">Preserve the next class</p>
        <h3 id="new-lecture-title">Add a lecture</h3>
      </div>
      <LectureDetailsForm
        key={resetKey}
        error={create.error?.message}
        pending={create.isPending}
        submitLabel="Create lecture"
        onSubmit={(details) => create.mutate(details)}
      />
    </section>
  )
}

function LectureDetailsForm({
  initial,
  pending,
  error,
  submitLabel,
  onSubmit,
  onCancel,
}: Readonly<{
  initial?: Lecture
  pending: boolean
  error: string | undefined
  submitLabel: string
  onSubmit: (details: LectureDetailsInput) => void
  onCancel?: () => void
}>) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) {
      return
    }
    const data = new FormData(event.currentTarget)
    const localDate = String(data.get('occurredAt') ?? '')
    const occurredAt = new Date(localDate)
    if (Number.isNaN(occurredAt.getTime())) {
      return
    }
    onSubmit({
      title: String(data.get('title') ?? ''),
      description: String(data.get('description') ?? ''),
      occurredAt: occurredAt.toISOString(),
    })
  }

  return (
    <form className="lecture-details-form" onSubmit={submit}>
      <label>
        <span>Lecture title</span>
        <input
          defaultValue={initial?.title ?? ''}
          maxLength={200}
          name="title"
          required
        />
      </label>
      <label>
        <span>Lecture date and time</span>
        <input
          defaultValue={toDateTimeLocal(initial?.occurredAt)}
          name="occurredAt"
          required
          type="datetime-local"
        />
      </label>
      <label>
        <span>Description</span>
        <textarea
          defaultValue={initial?.description ?? ''}
          maxLength={4_000}
          name="description"
          rows={3}
        />
      </label>
      <div className="form-actions">
        <button className="primary-button" disabled={pending} type="submit">
          {pending ? 'Saving…' : submitLabel}
        </button>
        {onCancel ? (
          <button className="secondary-button" onClick={onCancel} type="button">
            Cancel
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  )
}

function LectureItem({
  lecture,
  ownerId,
  canManage,
  onRefresh,
}: Readonly<{
  lecture: Lecture
  ownerId: string
  canManage: boolean
  onRefresh: () => Promise<void>
}>) {
  const [uploadProgress, setUploadProgress] =
    useState<AudioUploadProgress | null>(null)
  const [editing, setEditing] = useState(false)
  const [intakeMode, setIntakeMode] = useState<'record' | 'upload'>('record')
  const upload = useMutation({
    mutationFn: uploadLectureAudio,
    onSuccess: onRefresh,
  })
  const publish = useMutation({
    mutationFn: publishLecture,
    onSuccess: onRefresh,
  })
  const update = useMutation({
    mutationFn: updateLecture,
    onSuccess: async () => {
      await onRefresh()
      setEditing(false)
    },
  })
  const clearUpload = useMutation({
    mutationFn: () => cancelActiveAudioUpload(lecture.id),
    onSuccess: () => {
      upload.reset()
      setUploadProgress(null)
    },
  })
  const [quality, setQuality] = useState<'original' | 'data-saver'>('original')
  const dataSaver = lecture.audio?.dataSaver
  const readyDataSaver = dataSaver?.status === 'ready' ? dataSaver : null
  const selectedMedia =
    quality === 'data-saver' && readyDataSaver
      ? {
          label: 'Data-saver copy',
          details: `AAC · M4A · ${formatBytes(readyDataSaver.byteSize)}`,
          url: readyDataSaver.url,
          downloadUrl: readyDataSaver.downloadUrl,
        }
      : lecture.audio
        ? {
            label: 'Original recording',
            details: `${lecture.audio.originalFileName} · ${formatBytes(lecture.audio.byteSize)}`,
            url: lecture.audio.url,
            downloadUrl: lecture.audio.downloadUrl,
          }
        : null

  function submitUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const file = new FormData(form).get('audio')
    if (!(file instanceof File) || file.size === 0 || upload.isPending) {
      return
    }
    setUploadProgress({
      phase: 'hashing',
      receivedBytes: 0,
      totalBytes: file.size,
    })
    upload.mutate(
      { lectureId: lecture.id, file, onProgress: setUploadProgress },
      {
        onSuccess: () => {
          form.reset()
          setUploadProgress(null)
        },
      },
    )
  }

  return (
    <li className="lecture-item" data-lecture-id={lecture.id}>
      <div className="lecture-heading">
        <div>
          <p className="lecture-date">
            {formatLectureDate(lecture.occurredAt)}
          </p>
          <h3>{lecture.title}</h3>
        </div>
        <div className="lecture-actions">
          <span className="lecture-status">{lecture.status}</span>
          {canManage && !editing ? (
            <button
              className="button-link"
              onClick={() => setEditing(true)}
              type="button"
            >
              Edit details
            </button>
          ) : null}
        </div>
      </div>
      {editing ? (
        <LectureDetailsForm
          error={update.error?.message}
          initial={lecture}
          onCancel={() => setEditing(false)}
          pending={update.isPending}
          submitLabel="Save details"
          onSubmit={(details) =>
            update.mutate({ lectureId: lecture.id, ...details })
          }
        />
      ) : lecture.description ? (
        <p>{lecture.description}</p>
      ) : null}

      {lecture.audio && selectedMedia ? (
        <div className="original-audio">
          <div className="audio-details">
            <strong>{selectedMedia.label}</strong>
            <span>{selectedMedia.details}</span>
          </div>
          <div className="audio-toolbar">
            <label className="quality-picker">
              <span>Playback quality</span>
              <select
                data-testid={`lecture-quality-${lecture.id}`}
                onChange={(event) =>
                  setQuality(event.target.value as 'original' | 'data-saver')
                }
                value={quality}
              >
                <option value="original">
                  Original · {formatBytes(lecture.audio.byteSize)}
                </option>
                <option disabled={!readyDataSaver} value="data-saver">
                  {readyDataSaver
                    ? `Data saver · ${formatBytes(readyDataSaver.byteSize)}`
                    : dataSaver?.status === 'failed'
                      ? 'Data saver unavailable'
                      : 'Preparing data saver…'}
                </option>
              </select>
            </label>
            <a
              className="download-link"
              download
              href={selectedMedia.downloadUrl}
            >
              Download{' '}
              {selectedMedia.label === 'Data-saver copy'
                ? 'data saver'
                : 'original'}
            </a>
          </div>
          <audio
            key={selectedMedia.url}
            aria-label={`${selectedMedia.label}: ${lecture.title}`}
            controls
            data-testid={`lecture-audio-${lecture.id}`}
            preload="none"
            src={selectedMedia.url}
          />
          <p className="data-note">
            Audio loads when you choose to play it. Data saver is a derived
            copy; the original remains available.
          </p>
        </div>
      ) : canManage ? (
        <div className="audio-intake">
          <div className="intake-switch" aria-label="Original audio source">
            <button
              aria-pressed={intakeMode === 'record'}
              onClick={() => setIntakeMode('record')}
              type="button"
            >
              Record lecture
            </button>
            <button
              aria-pressed={intakeMode === 'upload'}
              onClick={() => setIntakeMode('upload')}
              type="button"
            >
              Upload audio
            </button>
          </div>
          {intakeMode === 'record' ? (
            <LectureCapture
              lectureId={lecture.id}
              ownerId={ownerId}
              onSaved={onRefresh}
            />
          ) : (
            <form className="upload-form" onSubmit={submitUpload}>
              <label>
                <span>Original audio</span>
                <input
                  accept="audio/mpeg,audio/wav,audio/mp4,audio/webm,audio/ogg,.mp3,.wav,.m4a,.webm,.ogg"
                  disabled={upload.isPending}
                  name="audio"
                  onChange={() => upload.reset()}
                  required
                  type="file"
                />
              </label>
              <button
                className="secondary-button"
                disabled={upload.isPending}
                type="submit"
              >
                {upload.isPending ? 'Uploading…' : 'Upload recording'}
              </button>
              {uploadProgress ? (
                <div className="upload-progress" role="status">
                  <span>{uploadProgressLabel(uploadProgress)}</span>
                  <progress
                    aria-label="Upload progress"
                    max={uploadProgress.totalBytes}
                    value={uploadProgress.receivedBytes}
                  />
                </div>
              ) : null}
              {upload.isError ? (
                <button
                  className="button-link"
                  disabled={clearUpload.isPending}
                  onClick={() => clearUpload.mutate()}
                  type="button"
                >
                  {clearUpload.isPending
                    ? 'Clearing…'
                    : 'Clear interrupted upload'}
                </button>
              ) : null}
              <p className="data-note">
                MP3, WAV, M4A, WebM, or Ogg · up to 256 MiB · interrupted
                uploads resume from the last confirmed chunk
              </p>
            </form>
          )}
        </div>
      ) : null}

      {canManage && lecture.audio && lecture.status === 'draft' ? (
        <button
          className="primary-button publish-button"
          disabled={publish.isPending}
          onClick={() => publish.mutate(lecture.id)}
          type="button"
        >
          {publish.isPending ? 'Publishing…' : 'Publish to enrolled students'}
        </button>
      ) : null}

      {upload.error || publish.error || clearUpload.error ? (
        <p className="form-error" role="alert">
          {upload.error?.message ??
            publish.error?.message ??
            clearUpload.error?.message}
        </p>
      ) : null}
    </li>
  )
}

function toDateTimeLocal(value?: string): string {
  const date = value ? new Date(value) : new Date()
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function uploadProgressLabel(progress: AudioUploadProgress): string {
  if (progress.phase === 'completing') {
    return 'Finalizing the original recording'
  }
  const percentage = Math.min(
    100,
    Math.floor((progress.receivedBytes / progress.totalBytes) * 100),
  )
  return progress.phase === 'hashing'
    ? `Checking recording integrity · ${percentage}%`
    : `Uploading · ${percentage}%`
}

function formatLectureDate(value: string): string {
  return new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value))
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
