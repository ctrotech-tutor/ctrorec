import { queryOptions } from '@tanstack/react-query'
import { requestJson } from './http'

export interface AcademicUnit {
  id: string
  parentId: string | null
  kind: string
  code: string
  name: string
}
export interface AcademicTerm {
  id: string
  code: string
  name: string
  startsOn: string
  endsOn: string
  status: string
}
export interface AdminCourse {
  id: string
  unitId: string
  code: string
  title: string
}
export interface AdminOffering {
  id: string
  courseId: string
  termId: string
  section: string
  status: string
}
export interface AcademicStructure {
  institution: { id: string; slug: string; name: string }
  units: AcademicUnit[]
  terms: AcademicTerm[]
  courses: AdminCourse[]
  offerings: AdminOffering[]
}
export interface AdminMembership {
  id: string
  status: string
  roles: string[]
  user: {
    id: string
    displayName: string
    email: string
    status: string
  }
}
export interface LecturerRosterEntry {
  id: string
  membershipId: string
  displayName: string
  email: string
  role: string
  startsAt: string
  endsAt: string | null
}
export interface StudentRosterEntry {
  id: string
  membershipId: string
  displayName: string
  email: string
  enrolledAt: string
  endsAt: string | null
}
export interface OfferingRoster {
  offeringId: string
  lecturers: LecturerRosterEntry[]
  students: StudentRosterEntry[]
}
export interface AdminMediaHold {
  id: string
  lectureId: string
  reason: string
  createdAt: string
  releasedAt: string | null
  releaseReason: string | null
}
export interface AdminMediaDeletion {
  id: string
  lectureId: string
  reason: string
  originalFileName: string
  originalMediaType: string
  originalByteSize: number
  originalSha256: string
  requestedAt: string
  completedAt: string | null
}
export interface AdminRetentionLecture {
  id: string
  title: string
  status: string
  occurredAt: string
  audio: {
    originalFileName: string
    mediaType: string
    byteSize: number
    sha256: string
  } | null
  activeHold: AdminMediaHold | null
  deletion: AdminMediaDeletion | null
}
export interface AdminMediaRetention {
  offeringId: string
  lectures: AdminRetentionLecture[]
}

export interface UnitInput {
  code: string
  name: string
  kind: string
  parentId?: string | null
}
export interface TermInput {
  code: string
  name: string
  startsOn: string
  endsOn: string
  status: string
}
export interface CourseInput {
  unitId: string
  code: string
  title: string
}
export interface OfferingInput {
  courseId: string
  termId: string
  section: string
  status: string
}

export const adminKeys = {
  all: ['institution-admin'] as const,
  structure: (institutionId: string) =>
    [...adminKeys.all, 'structure', institutionId] as const,
  memberships: (institutionId: string) =>
    [...adminKeys.all, 'memberships', institutionId] as const,
  invitations: (institutionId: string) =>
    [...adminKeys.all, 'invitations', institutionId] as const,
  roster: (institutionId: string, offeringId: string) =>
    [...adminKeys.all, 'roster', institutionId, offeringId] as const,
  retention: (institutionId: string, offeringId: string) =>
    [...adminKeys.all, 'retention', institutionId, offeringId] as const,
}

export function adminAcademicOptions(institutionId: string) {
  return queryOptions({
    queryKey: adminKeys.structure(institutionId),
    queryFn: async ({ signal }) => {
      const value = await requestJson(`${root(institutionId)}/academic`, {
        signal,
      })
      if (!isAcademicStructure(value)) {
        throw new Error('The academic response did not match its contract.')
      }
      return value
    },
    retry: 1,
  })
}

export function adminMembershipsOptions(institutionId: string) {
  return queryOptions({
    queryKey: adminKeys.memberships(institutionId),
    queryFn: async ({ signal }) => {
      const value = await requestJson(`${root(institutionId)}/memberships`, {
        signal,
      })
      if (!Array.isArray(value) || !value.every(isMembership)) {
        throw new Error('The membership response did not match its contract.')
      }
      return value
    },
    retry: 1,
  })
}

export function adminRosterOptions(institutionId: string, offeringId: string) {
  return queryOptions({
    queryKey: adminKeys.roster(institutionId, offeringId),
    queryFn: async ({ signal }) => {
      const value = await requestJson(
        `${root(institutionId)}/offerings/${id(offeringId)}/roster`,
        { signal },
      )
      if (!isRoster(value)) {
        throw new Error('The roster response did not match its contract.')
      }
      return value
    },
    retry: 1,
  })
}

export function adminMediaRetentionOptions(
  institutionId: string,
  offeringId: string,
) {
  return queryOptions({
    queryKey: adminKeys.retention(institutionId, offeringId),
    queryFn: async ({ signal }) => {
      const value = await requestJson(
        `${root(institutionId)}/offerings/${id(offeringId)}/media-retention`,
        { signal },
      )
      if (!isMediaRetention(value)) {
        throw new Error(
          'The media-retention response did not match its contract.',
        )
      }
      return value
    },
    retry: 1,
  })
}

export function placeMediaHold(input: {
  institutionId: string
  lectureId: string
  reason: string
}): Promise<AdminMediaHold> {
  return write(
    `${root(input.institutionId)}/lectures/${id(input.lectureId)}/media-hold`,
    'POST',
    { reason: input.reason },
    isMediaHold,
  )
}

export function releaseMediaHold(input: {
  institutionId: string
  holdId: string
  reason: string
}): Promise<AdminMediaHold> {
  return write(
    `${root(input.institutionId)}/media-holds/${id(input.holdId)}/release`,
    'POST',
    { reason: input.reason },
    isMediaHold,
  )
}

export function requestMediaDeletion(input: {
  institutionId: string
  lectureId: string
  reason: string
  confirmation: string
}): Promise<{ created: boolean; deletion: AdminMediaDeletion }> {
  return write(
    `${root(input.institutionId)}/lectures/${id(input.lectureId)}/media-deletion`,
    'POST',
    { reason: input.reason, confirmation: input.confirmation },
    isMediaDeletionResponse,
  )
}

export function saveUnit(input: {
  institutionId: string
  unitId?: string | undefined
  values: UnitInput
}): Promise<AcademicUnit> {
  return write(
    `${root(input.institutionId)}/units${input.unitId ? `/${id(input.unitId)}` : ''}`,
    input.unitId ? 'PATCH' : 'POST',
    input.values,
    isUnit,
  )
}

export function saveTerm(input: {
  institutionId: string
  termId?: string | undefined
  values: TermInput
}): Promise<AcademicTerm> {
  return write(
    `${root(input.institutionId)}/terms${input.termId ? `/${id(input.termId)}` : ''}`,
    input.termId ? 'PATCH' : 'POST',
    input.values,
    isTerm,
  )
}

export function saveCourse(input: {
  institutionId: string
  courseId?: string | undefined
  values: CourseInput
}): Promise<AdminCourse> {
  return write(
    `${root(input.institutionId)}/courses${input.courseId ? `/${id(input.courseId)}` : ''}`,
    input.courseId ? 'PATCH' : 'POST',
    input.values,
    isCourse,
  )
}

export function saveOffering(input: {
  institutionId: string
  offeringId?: string | undefined
  values: OfferingInput
}): Promise<AdminOffering> {
  return write(
    `${root(input.institutionId)}/offerings${input.offeringId ? `/${id(input.offeringId)}` : ''}`,
    input.offeringId ? 'PATCH' : 'POST',
    input.values,
    isOffering,
  )
}

export function assignLecturer(input: {
  institutionId: string
  offeringId: string
  membershipId: string
  role: string
  startsAt?: string
}): Promise<OfferingRoster> {
  return write(
    `${root(input.institutionId)}/offerings/${id(input.offeringId)}/lecturers`,
    'POST',
    {
      membershipId: input.membershipId,
      role: input.role,
      ...(input.startsAt ? { startsAt: input.startsAt } : {}),
    },
    isRoster,
  )
}

export function enrollStudent(input: {
  institutionId: string
  offeringId: string
  membershipId: string
  enrolledAt?: string
}): Promise<OfferingRoster> {
  return write(
    `${root(input.institutionId)}/offerings/${id(input.offeringId)}/students`,
    'POST',
    {
      membershipId: input.membershipId,
      ...(input.enrolledAt ? { enrolledAt: input.enrolledAt } : {}),
    },
    isRoster,
  )
}

export function endLecturerAssignment(input: {
  institutionId: string
  assignmentId: string
  endsAt: string
}): Promise<OfferingRoster> {
  return write(
    `${root(input.institutionId)}/lecturer-assignments/${id(input.assignmentId)}`,
    'PATCH',
    { endsAt: input.endsAt },
    isRoster,
  )
}

export function endEnrollment(input: {
  institutionId: string
  enrollmentId: string
  endsAt: string
}): Promise<OfferingRoster> {
  return write(
    `${root(input.institutionId)}/enrollments/${id(input.enrollmentId)}`,
    'PATCH',
    { endsAt: input.endsAt },
    isRoster,
  )
}

async function write<T>(
  path: string,
  method: string,
  body: unknown,
  guard: (value: unknown) => value is T,
): Promise<T> {
  const value = await requestJson(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!guard(value)) {
    throw new Error('The administration response did not match its contract.')
  }
  return value
}

function root(institutionId: string): string {
  return `/api/institutions/${id(institutionId)}/admin`
}

function id(value: string): string {
  return encodeURIComponent(value)
}

function isAcademicStructure(value: unknown): value is AcademicStructure {
  return (
    isRecord(value) &&
    isRecord(value.institution) &&
    typeof value.institution.id === 'string' &&
    typeof value.institution.slug === 'string' &&
    typeof value.institution.name === 'string' &&
    Array.isArray(value.units) &&
    value.units.every(isUnit) &&
    Array.isArray(value.terms) &&
    value.terms.every(isTerm) &&
    Array.isArray(value.courses) &&
    value.courses.every(isCourse) &&
    Array.isArray(value.offerings) &&
    value.offerings.every(isOffering)
  )
}

function isUnit(value: unknown): value is AcademicUnit {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    (typeof value.parentId === 'string' || value.parentId === null) &&
    typeof value.kind === 'string' &&
    typeof value.code === 'string' &&
    typeof value.name === 'string'
  )
}

function isTerm(value: unknown): value is AcademicTerm {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.code === 'string' &&
    typeof value.name === 'string' &&
    typeof value.startsOn === 'string' &&
    typeof value.endsOn === 'string' &&
    typeof value.status === 'string'
  )
}

function isCourse(value: unknown): value is AdminCourse {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.unitId === 'string' &&
    typeof value.code === 'string' &&
    typeof value.title === 'string'
  )
}

function isOffering(value: unknown): value is AdminOffering {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.courseId === 'string' &&
    typeof value.termId === 'string' &&
    typeof value.section === 'string' &&
    typeof value.status === 'string'
  )
}

function isMembership(value: unknown): value is AdminMembership {
  return (
    isRecord(value) &&
    isRecord(value.user) &&
    typeof value.id === 'string' &&
    typeof value.status === 'string' &&
    Array.isArray(value.roles) &&
    value.roles.every((role) => typeof role === 'string') &&
    typeof value.user.id === 'string' &&
    typeof value.user.displayName === 'string' &&
    typeof value.user.email === 'string' &&
    typeof value.user.status === 'string'
  )
}

function isRoster(value: unknown): value is OfferingRoster {
  return (
    isRecord(value) &&
    typeof value.offeringId === 'string' &&
    Array.isArray(value.lecturers) &&
    value.lecturers.every(isLecturerEntry) &&
    Array.isArray(value.students) &&
    value.students.every(isStudentEntry)
  )
}

function isLecturerEntry(value: unknown): value is LecturerRosterEntry {
  return (
    isRosterEntry(value) &&
    typeof value.role === 'string' &&
    typeof value.startsAt === 'string'
  )
}

function isStudentEntry(value: unknown): value is StudentRosterEntry {
  return isRosterEntry(value) && typeof value.enrolledAt === 'string'
}

function isRosterEntry(value: unknown): value is Record<string, unknown> & {
  id: string
  membershipId: string
  displayName: string
  email: string
  endsAt: string | null
} {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.membershipId === 'string' &&
    typeof value.displayName === 'string' &&
    typeof value.email === 'string' &&
    (typeof value.endsAt === 'string' || value.endsAt === null)
  )
}

function isMediaRetention(value: unknown): value is AdminMediaRetention {
  return (
    isRecord(value) &&
    typeof value.offeringId === 'string' &&
    Array.isArray(value.lectures) &&
    value.lectures.every(isRetentionLecture)
  )
}

function isRetentionLecture(value: unknown): value is AdminRetentionLecture {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.status === 'string' &&
    typeof value.occurredAt === 'string' &&
    (value.audio === null || isRetentionAudio(value.audio)) &&
    (value.activeHold === null || isMediaHold(value.activeHold)) &&
    (value.deletion === null || isMediaDeletion(value.deletion))
  )
}

function isRetentionAudio(
  value: unknown,
): value is NonNullable<AdminRetentionLecture['audio']> {
  return (
    isRecord(value) &&
    typeof value.originalFileName === 'string' &&
    typeof value.mediaType === 'string' &&
    typeof value.byteSize === 'number' &&
    Number.isSafeInteger(value.byteSize) &&
    value.byteSize > 0 &&
    typeof value.sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(value.sha256)
  )
}

function isMediaHold(value: unknown): value is AdminMediaHold {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.lectureId === 'string' &&
    typeof value.reason === 'string' &&
    typeof value.createdAt === 'string' &&
    (typeof value.releasedAt === 'string' || value.releasedAt === null) &&
    (typeof value.releaseReason === 'string' || value.releaseReason === null)
  )
}

function isMediaDeletion(value: unknown): value is AdminMediaDeletion {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.lectureId === 'string' &&
    typeof value.reason === 'string' &&
    typeof value.originalFileName === 'string' &&
    typeof value.originalMediaType === 'string' &&
    typeof value.originalByteSize === 'number' &&
    Number.isSafeInteger(value.originalByteSize) &&
    value.originalByteSize > 0 &&
    typeof value.originalSha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(value.originalSha256) &&
    typeof value.requestedAt === 'string' &&
    (typeof value.completedAt === 'string' || value.completedAt === null)
  )
}

function isMediaDeletionResponse(
  value: unknown,
): value is { created: boolean; deletion: AdminMediaDeletion } {
  return (
    isRecord(value) &&
    typeof value.created === 'boolean' &&
    isMediaDeletion(value.deletion)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
