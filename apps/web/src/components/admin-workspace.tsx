import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent, type ReactNode } from 'react'
import type { AuthMembership } from '../lib/auth'
import {
  adminAcademicOptions,
  adminKeys,
  adminMembershipsOptions,
  saveCourse,
  saveOffering,
  saveTerm,
  saveUnit,
  type AcademicStructure,
  type AcademicTerm,
  type AcademicUnit,
  type AdminCourse,
  type AdminOffering,
  type CourseInput,
  type OfferingInput,
  type TermInput,
  type UnitInput,
} from '../lib/admin'
import { courseKeys } from '../lib/lectures'
import { AdminInvitations } from './admin-invitations'
import { AdminMediaRetentionPanel } from './admin-media-retention'
import { AdminRoster } from './admin-roster'
import { CaptureEvidenceExport } from './capture-evidence-export'

export function AdminWorkspace({
  memberships,
}: Readonly<{ memberships: AuthMembership[] }>) {
  const institutions = memberships.filter(
    (membership) =>
      membership.status === 'active' &&
      membership.institution.status === 'active' &&
      membership.roles.includes('institution_admin'),
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = institutions.find(
    (membership) => membership.institution.id === selectedId,
  )
  const membership = selected ?? institutions[0]
  const institutionId = membership?.institution.id
  const structure = useQuery({
    ...adminAcademicOptions(institutionId ?? ''),
    enabled: Boolean(institutionId),
  })
  const people = useQuery({
    ...adminMembershipsOptions(institutionId ?? ''),
    enabled: Boolean(institutionId),
  })
  const [rosterOfferingId, setRosterOfferingId] = useState<string | null>(null)
  const [retentionOfferingId, setRetentionOfferingId] = useState<string | null>(
    null,
  )
  const queryClient = useQueryClient()

  if (!membership || !institutionId) {
    return null
  }

  const currentInstitutionId = institutionId

  async function refreshStructure() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: adminKeys.structure(currentInstitutionId),
      }),
      queryClient.invalidateQueries({ queryKey: courseKeys.offerings() }),
    ])
  }

  const rosterOffering = structure.data?.offerings.find(
    (offering) => offering.id === rosterOfferingId,
  )
  const retentionOffering = structure.data?.offerings.find(
    (offering) => offering.id === retentionOfferingId,
  )

  return (
    <section className="admin-workspace" aria-labelledby="admin-title">
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">Institution operations</p>
          <h2 id="admin-title">Academic administration</h2>
        </div>
        {institutions.length > 1 ? (
          <label className="offering-picker">
            <span>Institution</span>
            <select
              onChange={(event) => {
                setSelectedId(event.target.value)
                setRosterOfferingId(null)
              }}
              value={institutionId}
            >
              {institutions.map((item) => (
                <option key={item.id} value={item.institution.id}>
                  {item.institution.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <p className="admin-intro">
        Manage invitations, academic structure, and current course access.
        Administrator rights do not grant lecturer or student audio access.
      </p>

      <AdminInvitations key={institutionId} institutionId={institutionId} />
      <CaptureEvidenceExport
        key={`evidence-${institutionId}`}
        institutionId={institutionId}
      />

      {structure.isPending ? (
        <p className="workspace-state" role="status">
          Loading academic structure…
        </p>
      ) : structure.isError ? (
        <p className="form-error" role="alert">
          {structure.error.message}
        </p>
      ) : structure.data ? (
        <>
          <AcademicSections
            data={structure.data}
            institutionId={institutionId}
            onRefresh={refreshStructure}
            onRoster={(offeringId) => {
              setRetentionOfferingId(null)
              setRosterOfferingId(offeringId)
            }}
            onRetention={(offeringId) => {
              setRosterOfferingId(null)
              setRetentionOfferingId(offeringId)
            }}
          />
          {rosterOffering ? (
            <AdminRoster
              key={rosterOffering.id}
              institutionId={institutionId}
              memberships={people.data ?? []}
              offering={rosterOffering}
              structure={structure.data}
              onClose={() => setRosterOfferingId(null)}
            />
          ) : null}
          {retentionOffering ? (
            <AdminMediaRetentionPanel
              key={retentionOffering.id}
              institutionId={institutionId}
              label={`${
                structure.data.courses.find(
                  (course) => course.id === retentionOffering.courseId,
                )?.code ?? 'Course'
              } · Section ${retentionOffering.section}`}
              offeringId={retentionOffering.id}
              onClose={() => setRetentionOfferingId(null)}
            />
          ) : null}
          {people.isError ? (
            <p className="form-error" role="alert">
              {people.error.message}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  )
}

function AcademicSections({
  data,
  institutionId,
  onRefresh,
  onRoster,
  onRetention,
}: Readonly<{
  data: AcademicStructure
  institutionId: string
  onRefresh: () => Promise<void>
  onRoster: (offeringId: string) => void
  onRetention: (offeringId: string) => void
}>) {
  return (
    <div className="admin-sections">
      <section className="admin-section" aria-labelledby="units-title">
        <AdminSectionHeading
          title="Academic units"
          id="units-title"
          count={data.units.length}
        />
        <AdminRecordList
          items={data.units}
          empty="No academic units have been created."
          render={(unit) => (
            <div className="admin-record" key={unit.id}>
              <RecordSummary
                code={unit.code}
                title={unit.name}
                meta={`${unit.kind}${unit.parentId ? ` · Parent ${data.units.find((parent) => parent.id === unit.parentId)?.code ?? 'unknown'}` : ''}`}
              />
              <details className="admin-edit">
                <summary>Edit</summary>
                <UnitForm
                  initial={unit}
                  institutionId={institutionId}
                  units={data.units}
                  onSaved={onRefresh}
                />
              </details>
            </div>
          )}
        />
        <details className="admin-create">
          <summary>Add academic unit</summary>
          <UnitForm
            institutionId={institutionId}
            units={data.units}
            onSaved={onRefresh}
          />
        </details>
      </section>

      <section className="admin-section" aria-labelledby="terms-title">
        <AdminSectionHeading
          title="Academic terms"
          id="terms-title"
          count={data.terms.length}
        />
        <AdminRecordList
          items={data.terms}
          empty="No academic terms have been created."
          render={(term) => (
            <div className="admin-record" key={term.id}>
              <RecordSummary
                code={term.code}
                title={term.name}
                meta={`${term.startsOn} to ${term.endsOn} · ${term.status}`}
              />
              <details className="admin-edit">
                <summary>Edit</summary>
                <TermForm
                  initial={term}
                  institutionId={institutionId}
                  onSaved={onRefresh}
                />
              </details>
            </div>
          )}
        />
        <details className="admin-create">
          <summary>Add academic term</summary>
          <TermForm institutionId={institutionId} onSaved={onRefresh} />
        </details>
      </section>

      <section className="admin-section" aria-labelledby="courses-admin-title">
        <AdminSectionHeading
          title="Courses"
          id="courses-admin-title"
          count={data.courses.length}
        />
        <AdminRecordList
          items={data.courses}
          empty="No courses have been created."
          render={(course) => (
            <div className="admin-record" key={course.id}>
              <RecordSummary
                code={course.code}
                title={course.title}
                meta={
                  data.units.find((unit) => unit.id === course.unitId)?.name ??
                  'Unknown unit'
                }
              />
              <details className="admin-edit">
                <summary>Edit</summary>
                <CourseForm
                  initial={course}
                  institutionId={institutionId}
                  units={data.units}
                  onSaved={onRefresh}
                />
              </details>
            </div>
          )}
        />
        {data.units.length > 0 ? (
          <details className="admin-create">
            <summary>Add course</summary>
            <CourseForm
              institutionId={institutionId}
              units={data.units}
              onSaved={onRefresh}
            />
          </details>
        ) : (
          <p className="admin-hint">Create an academic unit first.</p>
        )}
      </section>

      <section className="admin-section" aria-labelledby="offerings-title">
        <AdminSectionHeading
          title="Course offerings"
          id="offerings-title"
          count={data.offerings.length}
        />
        <AdminRecordList
          items={data.offerings}
          empty="No course offerings have been scheduled."
          render={(offering) => (
            <div className="admin-record" key={offering.id}>
              <RecordSummary
                code={
                  data.courses.find((course) => course.id === offering.courseId)
                    ?.code ?? 'Unknown course'
                }
                title={`Section ${offering.section} · ${offering.status}`}
                meta={
                  data.terms.find((term) => term.id === offering.termId)
                    ?.name ?? 'Unknown term'
                }
              />
              <div className="admin-record-actions">
                <button
                  className="button-link"
                  onClick={() => onRetention(offering.id)}
                  type="button"
                >
                  Media retention
                </button>
                <button
                  className="button-link"
                  onClick={() => onRoster(offering.id)}
                  type="button"
                >
                  Manage roster
                </button>
                <details className="admin-edit">
                  <summary>Edit</summary>
                  <OfferingForm
                    initial={offering}
                    courses={data.courses}
                    institutionId={institutionId}
                    terms={data.terms}
                    onSaved={onRefresh}
                  />
                </details>
              </div>
            </div>
          )}
        />
        {data.courses.length > 0 && data.terms.length > 0 ? (
          <details className="admin-create">
            <summary>Schedule course offering</summary>
            <OfferingForm
              courses={data.courses}
              institutionId={institutionId}
              terms={data.terms}
              onSaved={onRefresh}
            />
          </details>
        ) : (
          <p className="admin-hint">Create a course and term first.</p>
        )}
      </section>
    </div>
  )
}

function UnitForm({
  institutionId,
  units,
  initial,
  onSaved,
}: Readonly<{
  institutionId: string
  units: AcademicUnit[]
  initial?: AcademicUnit
  onSaved: () => Promise<void>
}>) {
  const mutation = useMutation({
    mutationFn: (values: UnitInput) =>
      saveUnit({ institutionId, unitId: initial?.id, values }),
    onSuccess: onSaved,
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    mutation.mutate({
      code: String(data.get('code') ?? ''),
      name: String(data.get('name') ?? ''),
      kind: String(data.get('kind') ?? ''),
      parentId: String(data.get('parentId') ?? '') || null,
    })
  }

  return (
    <form className="admin-form" onSubmit={submit}>
      <FormError error={mutation.error?.message} />
      <div className="admin-form-grid">
        <label>
          Code
          <input
            defaultValue={initial?.code}
            maxLength={40}
            name="code"
            required
          />
        </label>
        <label>
          Kind
          <input
            defaultValue={initial?.kind ?? 'department'}
            maxLength={40}
            name="kind"
            pattern="[A-Za-z][A-Za-z0-9_\-]*"
            required
          />
        </label>
      </div>
      <label>
        Name
        <input
          defaultValue={initial?.name}
          maxLength={160}
          name="name"
          required
        />
      </label>
      <label>
        Parent unit
        <select defaultValue={initial?.parentId ?? ''} name="parentId">
          <option value="">No parent</option>
          {units
            .filter((unit) => unit.id !== initial?.id)
            .map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.code} · {unit.name}
              </option>
            ))}
        </select>
      </label>
      <SubmitButton
        label={initial ? 'Save unit' : 'Create unit'}
        pending={mutation.isPending}
      />
    </form>
  )
}

function TermForm({
  institutionId,
  initial,
  onSaved,
}: Readonly<{
  institutionId: string
  initial?: AcademicTerm
  onSaved: () => Promise<void>
}>) {
  const mutation = useMutation({
    mutationFn: (values: TermInput) =>
      saveTerm({ institutionId, termId: initial?.id, values }),
    onSuccess: onSaved,
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    mutation.mutate({
      code: String(data.get('code') ?? ''),
      name: String(data.get('name') ?? ''),
      startsOn: String(data.get('startsOn') ?? ''),
      endsOn: String(data.get('endsOn') ?? ''),
      status: String(data.get('status') ?? 'planned'),
    })
  }

  return (
    <form className="admin-form" onSubmit={submit}>
      <FormError error={mutation.error?.message} />
      <div className="admin-form-grid">
        <label>
          Code
          <input
            defaultValue={initial?.code}
            maxLength={40}
            name="code"
            required
          />
        </label>
        <StatusSelect value={initial?.status ?? 'planned'} />
      </div>
      <label>
        Name
        <input
          defaultValue={initial?.name}
          maxLength={160}
          name="name"
          required
        />
      </label>
      <div className="admin-form-grid">
        <label>
          Starts
          <input
            defaultValue={initial?.startsOn}
            name="startsOn"
            required
            type="date"
          />
        </label>
        <label>
          Ends
          <input
            defaultValue={initial?.endsOn}
            name="endsOn"
            required
            type="date"
          />
        </label>
      </div>
      <SubmitButton
        label={initial ? 'Save term' : 'Create term'}
        pending={mutation.isPending}
      />
    </form>
  )
}

function CourseForm({
  institutionId,
  units,
  initial,
  onSaved,
}: Readonly<{
  institutionId: string
  units: AcademicUnit[]
  initial?: AdminCourse
  onSaved: () => Promise<void>
}>) {
  const mutation = useMutation({
    mutationFn: (values: CourseInput) =>
      saveCourse({ institutionId, courseId: initial?.id, values }),
    onSuccess: onSaved,
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    mutation.mutate({
      unitId: String(data.get('unitId') ?? ''),
      code: String(data.get('code') ?? ''),
      title: String(data.get('title') ?? ''),
    })
  }

  return (
    <form className="admin-form" onSubmit={submit}>
      <FormError error={mutation.error?.message} />
      <label>
        Academic unit
        <select
          defaultValue={initial?.unitId ?? units[0]?.id}
          name="unitId"
          required
        >
          {units.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.code} · {unit.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Course code
        <input
          defaultValue={initial?.code}
          maxLength={40}
          name="code"
          required
        />
      </label>
      <label>
        Course title
        <input
          defaultValue={initial?.title}
          maxLength={200}
          name="title"
          required
        />
      </label>
      <SubmitButton
        label={initial ? 'Save course' : 'Create course'}
        pending={mutation.isPending}
      />
    </form>
  )
}

function OfferingForm({
  institutionId,
  courses,
  terms,
  initial,
  onSaved,
}: Readonly<{
  institutionId: string
  courses: AdminCourse[]
  terms: AcademicTerm[]
  initial?: AdminOffering
  onSaved: () => Promise<void>
}>) {
  const mutation = useMutation({
    mutationFn: (values: OfferingInput) =>
      saveOffering({ institutionId, offeringId: initial?.id, values }),
    onSuccess: onSaved,
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    mutation.mutate({
      courseId: String(data.get('courseId') ?? ''),
      termId: String(data.get('termId') ?? ''),
      section: String(data.get('section') ?? ''),
      status: String(data.get('status') ?? 'planned'),
    })
  }

  return (
    <form className="admin-form" onSubmit={submit}>
      <FormError error={mutation.error?.message} />
      <label>
        Course
        <select
          defaultValue={initial?.courseId ?? courses[0]?.id}
          name="courseId"
          required
        >
          {courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.code} · {course.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        Academic term
        <select
          defaultValue={initial?.termId ?? terms[0]?.id}
          name="termId"
          required
        >
          {terms.map((term) => (
            <option key={term.id} value={term.id}>
              {term.code} · {term.name}
            </option>
          ))}
        </select>
      </label>
      <div className="admin-form-grid">
        <label>
          Section
          <input
            defaultValue={initial?.section ?? 'A'}
            maxLength={40}
            name="section"
            required
          />
        </label>
        <StatusSelect value={initial?.status ?? 'planned'} />
      </div>
      <SubmitButton
        label={initial ? 'Save offering' : 'Schedule offering'}
        pending={mutation.isPending}
      />
    </form>
  )
}

function StatusSelect({ value }: Readonly<{ value: string }>) {
  return (
    <label>
      Status
      <select defaultValue={value} name="status">
        {['planned', 'active', 'completed', 'archived'].map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
    </label>
  )
}

function AdminSectionHeading({
  id,
  title,
  count,
}: Readonly<{ id: string; title: string; count: number }>) {
  return (
    <div className="admin-section-heading">
      <h3 id={id}>{title}</h3>
      <span>{count}</span>
    </div>
  )
}

function AdminRecordList<T>({
  items,
  empty,
  render,
}: Readonly<{
  items: T[]
  empty: string
  render: (item: T) => ReactNode
}>) {
  if (items.length === 0) {
    return <p className="admin-hint">{empty}</p>
  }
  return <div className="admin-record-list">{items.map(render)}</div>
}

function RecordSummary({
  code,
  title,
  meta,
}: Readonly<{ code: string; title: string; meta: string }>) {
  return (
    <div className="admin-record-summary">
      <strong>{code}</strong>
      <span>{title}</span>
      <small>{meta}</small>
    </div>
  )
}

function SubmitButton({
  label,
  pending,
}: Readonly<{ label: string; pending: boolean }>) {
  return (
    <button className="primary-button" disabled={pending} type="submit">
      {pending ? 'Saving…' : label}
    </button>
  )
}

function FormError({ error }: Readonly<{ error: string | undefined }>) {
  return error ? (
    <p className="form-error" role="alert">
      {error}
    </p>
  ) : null
}
