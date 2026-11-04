import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import {
  adminKeys,
  adminMediaRetentionOptions,
  placeMediaHold,
  releaseMediaHold,
  requestMediaDeletion,
  type AdminMediaHold,
  type AdminRetentionLecture,
} from '../lib/admin'
import { courseKeys } from '../lib/lectures'

export function AdminMediaRetentionPanel({
  institutionId,
  offeringId,
  label,
  onClose,
}: Readonly<{
  institutionId: string
  offeringId: string
  label: string
  onClose: () => void
}>) {
  const retention = useQuery({
    ...adminMediaRetentionOptions(institutionId, offeringId),
    refetchInterval: (query) =>
      query.state.data?.lectures.some(
        (lecture) => lecture.deletion && !lecture.deletion.completedAt,
      )
        ? 2_000
        : false,
  })
  const queryClient = useQueryClient()

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: adminKeys.retention(institutionId, offeringId),
      }),
      queryClient.invalidateQueries({ queryKey: courseKeys.all }),
    ])
  }

  return (
    <section className="retention-panel" aria-labelledby="retention-title">
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">Retention and intentional deletion</p>
          <h3 id="retention-title">{label}</h3>
          <p className="admin-hint">
            Holds preserve media during review. Deletion immediately removes
            course access; the worker then deletes each original and derivative
            with retryable, recorded completion.
          </p>
        </div>
        <button className="secondary-button" onClick={onClose} type="button">
          Close retention
        </button>
      </div>

      {retention.isPending ? (
        <p className="workspace-state" role="status">
          Loading media retention…
        </p>
      ) : retention.isError ? (
        <p className="form-error" role="alert">
          {retention.error.message}
        </p>
      ) : retention.data ? (
        retention.data.lectures.length === 0 ? (
          <p className="workspace-state">
            No uploaded or intentionally deleted media in this offering.
          </p>
        ) : (
          <div className="retention-list">
            {retention.data.lectures.map((lecture) => (
              <RetentionLecture
                key={lecture.id}
                institutionId={institutionId}
                lecture={lecture}
                onChanged={refresh}
              />
            ))}
          </div>
        )
      ) : null}
    </section>
  )
}

function RetentionLecture({
  institutionId,
  lecture,
  onChanged,
}: Readonly<{
  institutionId: string
  lecture: AdminRetentionLecture
  onChanged: () => Promise<void>
}>) {
  return (
    <article className="retention-item">
      <div className="retention-item-heading">
        <div>
          <h4>{lecture.title}</h4>
          <p>
            {formatDate(lecture.occurredAt)} · Lecture {lecture.status}
          </p>
        </div>
        <span
          className="retention-status"
          data-state={
            lecture.deletion
              ? lecture.deletion.completedAt
                ? 'deleted'
                : 'deleting'
              : lecture.activeHold
                ? 'held'
                : 'available'
          }
        >
          {lecture.deletion
            ? lecture.deletion.completedAt
              ? 'Media deleted'
              : 'Deletion in progress'
            : lecture.activeHold
              ? 'Retention hold active'
              : 'Media available'}
        </span>
      </div>

      {lecture.audio ? (
        <dl className="retention-metadata">
          <div>
            <dt>Original</dt>
            <dd>{lecture.audio.originalFileName}</dd>
          </div>
          <div>
            <dt>Format</dt>
            <dd>{lecture.audio.mediaType}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{formatBytes(lecture.audio.byteSize)}</dd>
          </div>
          <div>
            <dt>SHA-256</dt>
            <dd>
              <code className="retention-checksum">{lecture.audio.sha256}</code>
            </dd>
          </div>
        </dl>
      ) : null}

      {lecture.activeHold ? (
        <div className="retention-notice" data-tone="hold">
          <strong>Deletion is blocked by an active hold.</strong>
          <p>{lecture.activeHold.reason}</p>
          <p>Placed {formatDate(lecture.activeHold.createdAt)}.</p>
          <ReleaseHoldForm
            hold={lecture.activeHold}
            institutionId={institutionId}
            onChanged={onChanged}
          />
        </div>
      ) : null}

      {lecture.deletion ? (
        <div className="retention-notice" data-tone="deletion">
          <strong>
            {lecture.deletion.completedAt
              ? 'All linked media objects are recorded as deleted.'
              : 'Course access is revoked; physical deletion is not yet complete.'}
          </strong>
          <p>{lecture.deletion.reason}</p>
          <dl className="retention-metadata">
            <div>
              <dt>Requested</dt>
              <dd>{formatDate(lecture.deletion.requestedAt)}</dd>
            </div>
            <div>
              <dt>Completed</dt>
              <dd>
                {lecture.deletion.completedAt
                  ? formatDate(lecture.deletion.completedAt)
                  : 'Awaiting successful object reconciliation'}
              </dd>
            </div>
            <div>
              <dt>Original retained as evidence</dt>
              <dd>
                {lecture.deletion.originalFileName} ·{' '}
                {formatBytes(lecture.deletion.originalByteSize)}
              </dd>
            </div>
            <div>
              <dt>Original SHA-256</dt>
              <dd>
                <code className="retention-checksum">
                  {lecture.deletion.originalSha256}
                </code>
              </dd>
            </div>
          </dl>
        </div>
      ) : lecture.audio && !lecture.activeHold ? (
        <div className="retention-actions">
          <details>
            <summary>Place a retention hold</summary>
            <PlaceHoldForm
              institutionId={institutionId}
              lectureId={lecture.id}
              onChanged={onChanged}
            />
          </details>
          <details data-destructive="true">
            <summary>Delete original and derivatives</summary>
            <DeleteMediaForm
              institutionId={institutionId}
              lectureId={lecture.id}
              onChanged={onChanged}
            />
          </details>
        </div>
      ) : null}
    </article>
  )
}

function PlaceHoldForm({
  institutionId,
  lectureId,
  onChanged,
}: Readonly<{
  institutionId: string
  lectureId: string
  onChanged: () => Promise<void>
}>) {
  const [reason, setReason] = useState('')
  const mutation = useMutation({
    mutationFn: () => placeMediaHold({ institutionId, lectureId, reason }),
    onSuccess: async () => {
      setReason('')
      await onChanged()
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (reason.trim()) mutation.mutate()
  }

  return (
    <form className="retention-form" onSubmit={submit}>
      <label>
        Hold reason
        <textarea
          maxLength={500}
          onChange={(event) => setReason(event.target.value)}
          required
          rows={3}
          value={reason}
        />
      </label>
      <p className="admin-hint">
        The hold blocks intentional deletion until an administrator records its
        release.
      </p>
      <MutationError error={mutation.error} />
      <button
        className="secondary-button"
        disabled={mutation.isPending || !reason.trim()}
        type="submit"
      >
        {mutation.isPending ? 'Placing hold…' : 'Place hold'}
      </button>
    </form>
  )
}

function ReleaseHoldForm({
  institutionId,
  hold,
  onChanged,
}: Readonly<{
  institutionId: string
  hold: AdminMediaHold
  onChanged: () => Promise<void>
}>) {
  const [reason, setReason] = useState('')
  const mutation = useMutation({
    mutationFn: () =>
      releaseMediaHold({ institutionId, holdId: hold.id, reason }),
    onSuccess: async () => {
      setReason('')
      await onChanged()
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (reason.trim()) mutation.mutate()
  }

  return (
    <form className="retention-form" onSubmit={submit}>
      <label>
        Release reason
        <textarea
          maxLength={500}
          onChange={(event) => setReason(event.target.value)}
          required
          rows={2}
          value={reason}
        />
      </label>
      <MutationError error={mutation.error} />
      <button
        className="secondary-button"
        disabled={mutation.isPending || !reason.trim()}
        type="submit"
      >
        {mutation.isPending ? 'Releasing hold…' : 'Release hold'}
      </button>
    </form>
  )
}

function DeleteMediaForm({
  institutionId,
  lectureId,
  onChanged,
}: Readonly<{
  institutionId: string
  lectureId: string
  onChanged: () => Promise<void>
}>) {
  const [reason, setReason] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const mutation = useMutation({
    mutationFn: () =>
      requestMediaDeletion({
        institutionId,
        lectureId,
        reason,
        confirmation,
      }),
    onSuccess: async () => {
      setReason('')
      setConfirmation('')
      await onChanged()
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (reason.trim() && confirmation === 'DELETE MEDIA') mutation.mutate()
  }

  return (
    <form className="retention-form retention-delete-form" onSubmit={submit}>
      <p>
        This revokes lecturer and student access to the original and every
        derivative. The lecture and capture evidence remain. Object deletion is
        complete only after reconciliation confirms it.
      </p>
      <label>
        Deletion reason
        <textarea
          maxLength={500}
          onChange={(event) => setReason(event.target.value)}
          required
          rows={3}
          value={reason}
        />
      </label>
      <label>
        Type <strong>DELETE MEDIA</strong> to confirm
        <input
          autoComplete="off"
          onChange={(event) => setConfirmation(event.target.value)}
          required
          value={confirmation}
        />
      </label>
      <MutationError error={mutation.error} />
      <button
        className="danger-button"
        disabled={
          mutation.isPending ||
          !reason.trim() ||
          confirmation !== 'DELETE MEDIA'
        }
        type="submit"
      >
        {mutation.isPending ? 'Requesting deletion…' : 'Delete lecture media'}
      </button>
    </form>
  )
}

function MutationError({ error }: Readonly<{ error: Error | null }>) {
  return error ? (
    <p className="form-error" role="alert">
      {error.message}
    </p>
  ) : null
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatBytes(value: number): string {
  if (value < 1_000_000) {
    return `${new Intl.NumberFormat('en-NG').format(Math.ceil(value / 1_000))} KB`
  }
  return `${(value / 1_000_000).toFixed(1)} MB`
}
