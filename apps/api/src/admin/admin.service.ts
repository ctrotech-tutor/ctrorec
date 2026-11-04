import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { AdminAccessService } from './admin-access.service.js'
import type {
  CreateCourseDto,
  CreateEnrollmentDto,
  CreateLecturerAssignmentDto,
  CreateOfferingDto,
  CreateTermDto,
  CreateUnitDto,
  EndAcademicParticipationDto,
  UpdateCourseDto,
  UpdateOfferingDto,
  UpdateTermDto,
  UpdateUnitDto,
} from './admin.dto.js'
import {
  AdminRepository,
  type AcademicTerm,
  type AcademicUnit,
  type Course,
  type CourseOffering,
} from './admin.repository.js'

const statuses = new Set(['planned', 'active', 'completed', 'archived'])

@Injectable()
export class AdminService {
  constructor(
    @Inject(AdminRepository) private readonly repository: AdminRepository,
    @Inject(AdminAccessService)
    private readonly adminAccess: AdminAccessService,
  ) {}

  async getAcademic(userId: string, institutionId: string) {
    const { institution } = await this.requireAdmin(userId, institutionId)
    const [units, terms, courses, offerings] = await Promise.all([
      this.repository.listUnits(institutionId),
      this.repository.listTerms(institutionId),
      this.repository.listCourses(institutionId),
      this.repository.listOfferings(institutionId),
    ])
    return {
      institution,
      units: units.map(toUnitView),
      terms: terms.map(toTermView),
      courses: courses.map(toCourseView),
      offerings: offerings.map(toOfferingView),
    }
  }

  async listMemberships(userId: string, institutionId: string) {
    await this.requireAdmin(userId, institutionId)
    return this.repository.listMemberships(institutionId)
  }

  async createUnit(
    userId: string,
    institutionId: string,
    input: CreateUnitDto,
  ) {
    await this.requireAdmin(userId, institutionId)
    if (input.parentId) {
      await this.requireUnit(institutionId, input.parentId)
    }
    const row = await translateWriteError(
      () =>
        this.repository.insertUnit({
          institutionId,
          code: cleanCode(input.code),
          name: cleanText(input.name, 'Unit name'),
          kind: cleanKind(input.kind),
          ...(input.parentId ? { parentId: input.parentId } : {}),
        }),
      'That academic unit code already exists.',
    )
    return toUnitView(row)
  }

  async updateUnit(
    userId: string,
    institutionId: string,
    unitId: string,
    input: UpdateUnitDto,
  ) {
    await this.requireAdmin(userId, institutionId)
    requireChanges(input)
    const existing = await this.requireUnit(institutionId, unitId)
    if (input.parentId !== undefined && input.parentId !== null) {
      await this.assertValidUnitParent(institutionId, unitId, input.parentId)
    }
    const row = await translateWriteError(
      () =>
        this.repository.updateUnit(institutionId, existing.id, {
          ...(input.code === undefined ? {} : { code: cleanCode(input.code) }),
          ...(input.name === undefined
            ? {}
            : { name: cleanText(input.name, 'Unit name') }),
          ...(input.kind === undefined ? {} : { kind: cleanKind(input.kind) }),
          ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
          updatedAt: new Date(),
        }),
      'That academic unit code already exists.',
    )
    if (!row) {
      throw new NotFoundException()
    }
    return toUnitView(row)
  }

  async createTerm(
    userId: string,
    institutionId: string,
    input: CreateTermDto,
  ) {
    await this.requireAdmin(userId, institutionId)
    const startsOn = cleanDateOnly(input.startsOn, 'Start date')
    const endsOn = cleanDateOnly(input.endsOn, 'End date')
    assertTermDates(startsOn, endsOn)
    const row = await translateWriteError(
      () =>
        this.repository.insertTerm({
          institutionId,
          code: cleanCode(input.code),
          name: cleanText(input.name, 'Term name'),
          startsOn,
          endsOn,
          status: cleanStatus(input.status ?? 'planned'),
        }),
      'That academic term code already exists.',
    )
    return toTermView(row)
  }

  async updateTerm(
    userId: string,
    institutionId: string,
    termId: string,
    input: UpdateTermDto,
  ) {
    await this.requireAdmin(userId, institutionId)
    requireChanges(input)
    const existing = await this.requireTerm(institutionId, termId)
    const startsOn =
      input.startsOn === undefined
        ? existing.startsOn
        : cleanDateOnly(input.startsOn, 'Start date')
    const endsOn =
      input.endsOn === undefined
        ? existing.endsOn
        : cleanDateOnly(input.endsOn, 'End date')
    assertTermDates(startsOn, endsOn)
    const row = await translateWriteError(
      () =>
        this.repository.updateTerm(institutionId, existing.id, {
          ...(input.code === undefined ? {} : { code: cleanCode(input.code) }),
          ...(input.name === undefined
            ? {}
            : { name: cleanText(input.name, 'Term name') }),
          startsOn,
          endsOn,
          ...(input.status === undefined
            ? {}
            : { status: cleanStatus(input.status) }),
          updatedAt: new Date(),
        }),
      'That academic term code already exists.',
    )
    if (!row) {
      throw new NotFoundException()
    }
    return toTermView(row)
  }

  async createCourse(
    userId: string,
    institutionId: string,
    input: CreateCourseDto,
  ) {
    await this.requireAdmin(userId, institutionId)
    await this.requireUnit(institutionId, input.unitId)
    const row = await translateWriteError(
      () =>
        this.repository.insertCourse({
          institutionId,
          unitId: input.unitId,
          code: cleanCode(input.code),
          title: cleanText(input.title, 'Course title'),
        }),
      'That course code already exists.',
    )
    return toCourseView(row)
  }

  async updateCourse(
    userId: string,
    institutionId: string,
    courseId: string,
    input: UpdateCourseDto,
  ) {
    await this.requireAdmin(userId, institutionId)
    requireChanges(input)
    const existing = await this.requireCourse(institutionId, courseId)
    if (input.unitId) {
      await this.requireUnit(institutionId, input.unitId)
    }
    const row = await translateWriteError(
      () =>
        this.repository.updateCourse(institutionId, existing.id, {
          ...(input.unitId === undefined ? {} : { unitId: input.unitId }),
          ...(input.code === undefined ? {} : { code: cleanCode(input.code) }),
          ...(input.title === undefined
            ? {}
            : { title: cleanText(input.title, 'Course title') }),
          updatedAt: new Date(),
        }),
      'That course code already exists.',
    )
    if (!row) {
      throw new NotFoundException()
    }
    return toCourseView(row)
  }

  async createOffering(
    userId: string,
    institutionId: string,
    input: CreateOfferingDto,
  ) {
    await this.requireAdmin(userId, institutionId)
    await Promise.all([
      this.requireCourse(institutionId, input.courseId),
      this.requireTerm(institutionId, input.termId),
    ])
    const row = await translateWriteError(
      () =>
        this.repository.insertOffering({
          institutionId,
          courseId: input.courseId,
          termId: input.termId,
          section: cleanText(input.section, 'Section'),
          status: cleanStatus(input.status ?? 'planned'),
        }),
      'That course, term, and section offering already exists.',
    )
    return toOfferingView(row)
  }

  async updateOffering(
    userId: string,
    institutionId: string,
    offeringId: string,
    input: UpdateOfferingDto,
  ) {
    await this.requireAdmin(userId, institutionId)
    requireChanges(input)
    const existing = await this.requireOffering(institutionId, offeringId)
    await Promise.all([
      input.courseId
        ? this.requireCourse(institutionId, input.courseId)
        : Promise.resolve(),
      input.termId
        ? this.requireTerm(institutionId, input.termId)
        : Promise.resolve(),
    ])
    const row = await translateWriteError(
      () =>
        this.repository.updateOffering(institutionId, existing.id, {
          ...(input.courseId === undefined ? {} : { courseId: input.courseId }),
          ...(input.termId === undefined ? {} : { termId: input.termId }),
          ...(input.section === undefined
            ? {}
            : { section: cleanText(input.section, 'Section') }),
          ...(input.status === undefined
            ? {}
            : { status: cleanStatus(input.status) }),
          updatedAt: new Date(),
        }),
      'That course, term, and section offering already exists.',
    )
    if (!row) {
      throw new NotFoundException()
    }
    return toOfferingView(row)
  }

  async getRoster(userId: string, institutionId: string, offeringId: string) {
    await this.requireAdmin(userId, institutionId)
    await this.requireOffering(institutionId, offeringId)
    return this.roster(institutionId, offeringId)
  }

  async createLecturerAssignment(
    userId: string,
    institutionId: string,
    offeringId: string,
    input: CreateLecturerAssignmentDto,
  ) {
    await this.requireAdmin(userId, institutionId)
    await this.requireRosterOffering(institutionId, offeringId)
    await this.requireMembershipRole(
      institutionId,
      input.membershipId,
      'academic_staff',
    )
    await translateWriteError(
      () =>
        this.repository.insertLecturerAssignment({
          institutionId,
          courseOfferingId: offeringId,
          membershipId: input.membershipId,
          role: input.role,
          startsAt:
            input.startsAt === undefined
              ? new Date()
              : cleanTimestamp(input.startsAt, 'Assignment start'),
        }),
      'This lecturer already has an open assignment for the offering.',
    )
    return this.roster(institutionId, offeringId)
  }

  async createEnrollment(
    userId: string,
    institutionId: string,
    offeringId: string,
    input: CreateEnrollmentDto,
  ) {
    await this.requireAdmin(userId, institutionId)
    await this.requireRosterOffering(institutionId, offeringId)
    await this.requireMembershipRole(
      institutionId,
      input.membershipId,
      'student',
    )
    await translateWriteError(
      () =>
        this.repository.insertEnrollment({
          institutionId,
          courseOfferingId: offeringId,
          membershipId: input.membershipId,
          enrolledAt:
            input.enrolledAt === undefined
              ? new Date()
              : cleanTimestamp(input.enrolledAt, 'Enrollment date'),
        }),
      'This student already has an open enrollment for the offering.',
    )
    return this.roster(institutionId, offeringId)
  }

  async endLecturerAssignment(
    userId: string,
    institutionId: string,
    assignmentId: string,
    input: EndAcademicParticipationDto,
  ) {
    await this.requireAdmin(userId, institutionId)
    const assignment = await this.repository.findLecturerAssignment(
      institutionId,
      requireUuid(assignmentId, 'assignmentId'),
    )
    if (!assignment) {
      throw new NotFoundException()
    }
    if (assignment.endsAt) {
      throw new ConflictException('This assignment is already closed.')
    }
    const endsAt = cleanTimestamp(input.endsAt, 'Assignment end')
    if (endsAt <= assignment.startsAt) {
      throw new BadRequestException('Assignment end must be after its start.')
    }
    const updated = await this.repository.endLecturerAssignment(
      institutionId,
      assignment.id,
      endsAt,
    )
    if (!updated) {
      throw new ConflictException('This assignment is already closed.')
    }
    return this.roster(institutionId, assignment.courseOfferingId)
  }

  async endEnrollment(
    userId: string,
    institutionId: string,
    enrollmentId: string,
    input: EndAcademicParticipationDto,
  ) {
    await this.requireAdmin(userId, institutionId)
    const enrollment = await this.repository.findEnrollment(
      institutionId,
      requireUuid(enrollmentId, 'enrollmentId'),
    )
    if (!enrollment) {
      throw new NotFoundException()
    }
    if (enrollment.endsAt) {
      throw new ConflictException('This enrollment is already closed.')
    }
    const endsAt = cleanTimestamp(input.endsAt, 'Enrollment end')
    if (endsAt <= enrollment.enrolledAt) {
      throw new BadRequestException('Enrollment end must be after its start.')
    }
    const updated = await this.repository.endEnrollment(
      institutionId,
      enrollment.id,
      endsAt,
    )
    if (!updated) {
      throw new ConflictException('This enrollment is already closed.')
    }
    return this.roster(institutionId, enrollment.courseOfferingId)
  }

  private async requireAdmin(userId: string, institutionId: string) {
    return this.adminAccess.require(userId, institutionId)
  }

  private async requireUnit(institutionId: string, unitId: string) {
    const row = await this.repository.findUnit(
      institutionId,
      requireUuid(unitId, 'unitId'),
    )
    if (!row) {
      throw new NotFoundException()
    }
    return row
  }

  private async requireTerm(institutionId: string, termId: string) {
    const row = await this.repository.findTerm(
      institutionId,
      requireUuid(termId, 'termId'),
    )
    if (!row) {
      throw new NotFoundException()
    }
    return row
  }

  private async requireCourse(institutionId: string, courseId: string) {
    const row = await this.repository.findCourse(
      institutionId,
      requireUuid(courseId, 'courseId'),
    )
    if (!row) {
      throw new NotFoundException()
    }
    return row
  }

  private async requireOffering(institutionId: string, offeringId: string) {
    const row = await this.repository.findOffering(
      institutionId,
      requireUuid(offeringId, 'offeringId'),
    )
    if (!row) {
      throw new NotFoundException()
    }
    return row
  }

  private async requireRosterOffering(
    institutionId: string,
    offeringId: string,
  ) {
    const offering = await this.requireOffering(institutionId, offeringId)
    if (!['planned', 'active'].includes(offering.status)) {
      throw new ConflictException(
        'Add roster entries only to planned or active offerings.',
      )
    }
    return offering
  }

  private async requireMembershipRole(
    institutionId: string,
    membershipId: string,
    role: string,
  ) {
    const membership = await this.repository.findMembership(
      institutionId,
      requireUuid(membershipId, 'membershipId'),
    )
    if (
      !membership ||
      membership.status !== 'active' ||
      membership.user.status !== 'active' ||
      !membership.roles.includes(role)
    ) {
      throw new BadRequestException(
        `The selected membership is not an active ${role === 'academic_staff' ? 'academic staff member' : 'student'}.`,
      )
    }
    return membership
  }

  private async assertValidUnitParent(
    institutionId: string,
    unitId: string,
    parentId: string,
  ) {
    const visited = new Set([unitId])
    let cursor: string | null = parentId
    while (cursor) {
      if (visited.has(cursor)) {
        throw new BadRequestException(
          'An academic unit cannot be its own ancestor.',
        )
      }
      visited.add(cursor)
      const parent = await this.requireUnit(institutionId, cursor)
      cursor = parent.parentId
      if (visited.size > 100) {
        throw new BadRequestException(
          'The academic unit hierarchy is too deep.',
        )
      }
    }
  }

  private async roster(institutionId: string, offeringId: string) {
    const [lecturers, students] = await Promise.all([
      this.repository.listLecturerRoster(institutionId, offeringId),
      this.repository.listStudentRoster(institutionId, offeringId),
    ])
    return {
      offeringId,
      lecturers: lecturers.map((row) => ({
        ...row,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt?.toISOString() ?? null,
      })),
      students: students.map((row) => ({
        ...row,
        enrolledAt: row.enrolledAt.toISOString(),
        endsAt: row.endsAt?.toISOString() ?? null,
      })),
    }
  }
}

function toUnitView(row: AcademicUnit) {
  return {
    id: row.id,
    parentId: row.parentId,
    kind: row.kind,
    code: row.code,
    name: row.name,
  }
}

function toTermView(row: AcademicTerm) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    status: row.status,
  }
}

function toCourseView(row: Course) {
  return {
    id: row.id,
    unitId: row.unitId,
    code: row.code,
    title: row.title,
  }
}

function toOfferingView(row: CourseOffering) {
  return {
    id: row.id,
    courseId: row.courseId,
    termId: row.termId,
    section: row.section,
    status: row.status,
  }
}

function cleanCode(value: string): string {
  const code = value.trim().toUpperCase()
  if (!/^[A-Z0-9][A-Z0-9._/-]{0,39}$/.test(code)) {
    throw new BadRequestException(
      'Use letters, numbers, dots, slashes, underscores, or hyphens for the code.',
    )
  }
  return code
}

function cleanText(value: string, label: string): string {
  const text = value.trim()
  if (!text) {
    throw new BadRequestException(`${label} is required.`)
  }
  return text
}

function cleanKind(value: string): string {
  return value.trim().toLowerCase()
}

function cleanStatus(value: string): string {
  if (!statuses.has(value)) {
    throw new BadRequestException('Invalid academic status.')
  }
  return value
}

function cleanDateOnly(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${label} must use YYYY-MM-DD.`)
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException(`${label} is not a valid calendar date.`)
  }
  return value
}

function cleanTimestamp(value: string, label: string): Date {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${label} is invalid.`)
  }
  return parsed
}

function assertTermDates(startsOn: string, endsOn: string): void {
  if (endsOn < startsOn) {
    throw new BadRequestException('Term end must not precede its start.')
  }
}

function requireChanges(input: object): void {
  if (Object.keys(input).length === 0) {
    throw new BadRequestException('Provide at least one change.')
  }
}

function requireUuid(value: string, label: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new NotFoundException(`Invalid ${label}.`)
  }
  return value
}

async function translateWriteError<T>(
  operation: () => Promise<T>,
  uniqueMessage: string,
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    const code = postgresCode(error)
    if (code === '23505') {
      throw new ConflictException(uniqueMessage)
    }
    if (code === '23503' || code === '23514') {
      throw new BadRequestException(
        'The academic change violates a stored relationship or constraint.',
      )
    }
    throw error
  }
}

function postgresCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('cause' in error)) {
    return null
  }
  const cause = error.cause
  return typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    typeof cause.code === 'string'
    ? cause.code
    : null
}
