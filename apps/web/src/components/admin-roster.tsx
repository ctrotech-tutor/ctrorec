import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { FormEvent, ReactNode } from 'react'
import {
  adminKeys,
  adminRosterOptions,
  assignLecturer,
  endEnrollment,
  endLecturerAssignment,
  enrollStudent,
  type AcademicStructure,
  type AdminMembership,
  type AdminOffering,
  type LecturerRosterEntry,
  type StudentRosterEntry,
} from '../lib/admin'
import { courseKeys } from '../lib/lectures'

export function AdminRoster({
  institutionId,
  offering,
  structure,
  memberships,
  onClose,
}: Readonly<{
  institutionId: string
  offering: AdminOffering
  structure: AcademicStructure
  memberships: AdminMembership[]
  onClose: () => void
}>) {
  const roster = useQuery(adminRosterOptions(institutionId, offering.id))
  const queryClient = useQueryClient()
  const course = structure.courses.find((item) => item.id === offering.courseId)
  const term = structure.terms.find((item) => item.id === offering.termId)
  const staff = memberships.filter(
    (membership) =>
      membership.status === 'active' &&
      membership.user.status === 'active' &&
      membership.roles.includes('academic_staff'),
  )
  const students = memberships.filter(
    (membership) =>
      membership.status === 'active' &&
      membership.user.status === 'active' &&
      membership.roles.includes('student'),
  )

  async function refreshAccess() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: adminKeys.roster(institutionId, offering.id),
      }),
      queryClient.invalidateQueries({ queryKey: courseKeys.offerings() }),
    ])
  }

  return (
    <section className="roster-panel" aria-labelledby="roster-title">
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">Current access and history</p>
          <h3 id="roster-title">
            {course?.code ?? 'Course'} · Section {offering.section}
          </h3>
          <p className="admin-hint">
            {term?.name ?? 'Academic term'} · {offering.status}
          </p>
        </div>
        <button className="secondary-button" onClick={onClose} type="button">
          Close roster
        </button>
      </div>

      {roster.isPending ? (
        <p className="workspace-state" role="status">
          Loading roster…
        </p>
      ) : roster.isError ? (
        <p className="form-error" role="alert">
          {roster.error.message}
        </p>
      ) : roster.data ? (
        <div className="roster-columns">
          <RosterColumn
            title="Lecturers"
            empty="No lecturer assignments yet."
            currentCount={
              roster.data.lecturers.filter(
                (entry) =>
                  !entry.endsAt &&
                  new Date(entry.startsAt).getTime() <= Date.now(),
              ).length
            }
            isEmpty={roster.data.lecturers.length === 0}
          >
            {['planned', 'active'].includes(offering.status) ? (
              <AssignLecturerForm
                institutionId={institutionId}
                memberships={staff}
                offeringId={offering.id}
                onSaved={refreshAccess}
              />
            ) : null}
            <div className="roster-list">
              {roster.data.lecturers.map((entry) => (
                <LecturerItem
                  key={entry.id}
                  entry={entry}
                  institutionId={institutionId}
                  onEnded={refreshAccess}
                />
              ))}
            </div>
          </RosterColumn>

          <RosterColumn
            title="Students"
            empty="No student enrollments yet."
            currentCount={
              roster.data.students.filter(
                (entry) =>
                  !entry.endsAt &&
                  new Date(entry.enrolledAt).getTime() <= Date.now(),
              ).length
            }
            isEmpty={roster.data.students.length === 0}
          >
            {['planned', 'active'].includes(offering.status) ? (
              <EnrollStudentForm
                institutionId={institutionId}
                memberships={students}
                offeringId={offering.id}
                onSaved={refreshAccess}
              />
            ) : null}
            <div className="roster-list">
              {roster.data.students.map((entry) => (
                <StudentItem
                  key={entry.id}
                  entry={entry}
                  institutionId={institutionId}
                  onEnded={refreshAccess}
                />
              ))}
            </div>
          </RosterColumn>
        </div>
      ) : null}
    </section>
  )
}

function AssignLecturerForm({
  institutionId,
  offeringId,
  memberships,
  onSaved,
}: Readonly<{
  institutionId: string
  offeringId: string
  memberships: AdminMembership[]
  onSaved: () => Promise<void>
}>) {
  const mutation = useMutation({
    mutationFn: (input: { membershipId: string; role: string }) =>
      assignLecturer({ institutionId, offeringId, ...input }),
    onSuccess: onSaved,
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    mutation.mutate({
      membershipId: String(data.get('membershipId') ?? ''),
      role: String(data.get('role') ?? 'lead'),
    })
  }

  return (
    <form className="roster-form" onSubmit={submit}>
      <label>
        Assign academic staff
        <select name="membershipId" required>
          <option value="">Choose a person</option>
          {memberships.map((membership) => (
            <option key={membership.id} value={membership.id}>
              {membership.user.displayName} · {membership.user.email}
            </option>
          ))}
        </select>
      </label>
      <label>
        Teaching role
        <select defaultValue="lead" name="role">
          <option value="lead">Lead</option>
          <option value="assistant">Assistant</option>
          <option value="guest">Guest</option>
        </select>
      </label>
      <button
        className="primary-button"
        disabled={mutation.isPending}
        type="submit"
      >
        {mutation.isPending ? 'Assigning…' : 'Assign lecturer'}
      </button>
      <MutationError error={mutation.error?.message} />
    </form>
  )
}

function EnrollStudentForm({
  institutionId,
  offeringId,
  memberships,
  onSaved,
}: Readonly<{
  institutionId: string
  offeringId: string
  memberships: AdminMembership[]
  onSaved: () => Promise<void>
}>) {
  const mutation = useMutation({
    mutationFn: (membershipId: string) =>
      enrollStudent({ institutionId, offeringId, membershipId }),
    onSuccess: onSaved,
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const membershipId = String(
      new FormData(event.currentTarget).get('membershipId') ?? '',
    )
    mutation.mutate(membershipId)
  }

  return (
    <form className="roster-form" onSubmit={submit}>
      <label>
        Enroll a student
        <select name="membershipId" required>
          <option value="">Choose a person</option>
          {memberships.map((membership) => (
            <option key={membership.id} value={membership.id}>
              {membership.user.displayName} · {membership.user.email}
            </option>
          ))}
        </select>
      </label>
      <button
        className="primary-button"
        disabled={mutation.isPending}
        type="submit"
      >
        {mutation.isPending ? 'Enrolling…' : 'Enroll student'}
      </button>
      <MutationError error={mutation.error?.message} />
    </form>
  )
}

function LecturerItem({
  entry,
  institutionId,
  onEnded,
}: Readonly<{
  entry: LecturerRosterEntry
  institutionId: string
  onEnded: () => Promise<void>
}>) {
  const mutation = useMutation({
    mutationFn: () =>
      endLecturerAssignment({
        institutionId,
        assignmentId: entry.id,
        endsAt: new Date().toISOString(),
      }),
    onSuccess: onEnded,
  })
  return (
    <article className="roster-entry">
      <div>
        <strong>{entry.displayName}</strong>
        <span>{entry.email}</span>
        <small>
          {entry.role} · {formatParticipation(entry.startsAt, entry.endsAt)}
        </small>
      </div>
      {!entry.endsAt && new Date(entry.startsAt).getTime() <= Date.now() ? (
        <button
          className="button-link"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
          type="button"
        >
          {mutation.isPending ? 'Ending…' : 'End access'}
        </button>
      ) : null}
      <MutationError error={mutation.error?.message} />
    </article>
  )
}

function StudentItem({
  entry,
  institutionId,
  onEnded,
}: Readonly<{
  entry: StudentRosterEntry
  institutionId: string
  onEnded: () => Promise<void>
}>) {
  const mutation = useMutation({
    mutationFn: () =>
      endEnrollment({
        institutionId,
        enrollmentId: entry.id,
        endsAt: new Date().toISOString(),
      }),
    onSuccess: onEnded,
  })
  return (
    <article className="roster-entry">
      <div>
        <strong>{entry.displayName}</strong>
        <span>{entry.email}</span>
        <small>{formatParticipation(entry.enrolledAt, entry.endsAt)}</small>
      </div>
      {!entry.endsAt && new Date(entry.enrolledAt).getTime() <= Date.now() ? (
        <button
          className="button-link"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
          type="button"
        >
          {mutation.isPending ? 'Ending…' : 'End access'}
        </button>
      ) : null}
      <MutationError error={mutation.error?.message} />
    </article>
  )
}

function RosterColumn({
  title,
  currentCount,
  isEmpty,
  empty,
  children,
}: Readonly<{
  title: string
  currentCount: number
  isEmpty: boolean
  empty: string
  children: ReactNode
}>) {
  return (
    <section className="roster-column">
      <div className="admin-section-heading">
        <h4>{title}</h4>
        <span>{currentCount} current</span>
      </div>
      {isEmpty ? <p className="admin-hint">{empty}</p> : null}
      {children}
    </section>
  )
}

function formatParticipation(startsAt: string, endsAt: string | null): string {
  const start = new Date(startsAt).toLocaleDateString()
  return endsAt
    ? `${start} to ${new Date(endsAt).toLocaleDateString()} · closed`
    : new Date(startsAt).getTime() > Date.now()
      ? `Starts ${start} · scheduled`
      : `Since ${start} · open`
}

function MutationError({ error }: Readonly<{ error: string | undefined }>) {
  return error ? (
    <p className="form-error" role="alert">
      {error}
    </p>
  ) : null
}
