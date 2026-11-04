import type { Server } from 'node:http'
import {
  createDatabase,
  seedDevelopment,
  type Database,
  type DatabasePool,
} from '@ctrorec/database'
import {
  academicUnits,
  courseOfferings,
  institutions,
  lectures,
  membershipRoles,
} from '@ctrorec/database/schema'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { and, eq } from 'drizzle-orm'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest'
import { AppModule } from '../src/app.module.js'
import { configureApi } from '../src/configure-api.js'
import { requireTestDatabaseUrl, resetDatabase } from './test-database.js'

const adminCredentials = {
  email: 'lecturer@ctrorec.test',
  password: 'Lecturer-Dev-2026!',
}
const studentCredentials = {
  email: 'student@ctrorec.test',
  password: 'Student-Dev-2026!',
}
const INSTITUTION_ID = '019a1000-0000-7000-8000-000000000001'
const LECTURER_MEMBERSHIP_ID = '019a1000-0000-7000-8000-000000000004'
const STUDENT_MEMBERSHIP_ID = '019a1000-0000-7000-8000-000000000005'
const TERM_ID = '019a1000-0000-7000-8000-000000000007'
const COURSE_ID = '019a1000-0000-7000-8000-000000000008'
const OFFERING_ID = '019a1000-0000-7000-8000-000000000009'

interface UnitView {
  id: string
  parentId: string | null
  code: string
  kind: string
  name: string
}
interface TermView {
  id: string
  code: string
  startsOn: string
  endsOn: string
  status: string
}
interface CourseView {
  id: string
  unitId: string
  code: string
  title: string
}
interface OfferingView {
  id: string
  courseId: string
  termId: string
  section: string
  status: string
}
interface AcademicView {
  institution: { id: string; slug: string; name: string }
  units: UnitView[]
  terms: TermView[]
  courses: CourseView[]
  offerings: OfferingView[]
}
interface RosterView {
  lecturers: Array<{
    id: string
    displayName: string
    startsAt: string
    endsAt: string | null
  }>
  students: Array<{
    id: string
    displayName: string
    enrolledAt: string
    endsAt: string | null
  }>
}

let db: Database
let pool: DatabasePool
let app: NestExpressApplication
let baseUrl: string

beforeAll(() => {
  ;({ db, pool } = createDatabase(requireTestDatabaseUrl(), {
    applicationName: 'ctrorec-admin-http-tests',
    maxConnections: 3,
  }))
})

beforeEach(async () => {
  await resetDatabase(db)
  await seedDevelopment(db)
  app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
  })
  configureApi(app, { shutdownHooks: false })
  await app.listen(0, '127.0.0.1')
  const server = app.getHttpServer() as Server
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Expected the test API to listen on a TCP port.')
  }
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterEach(async () => {
  await app.close()
})

afterAll(async () => {
  await pool.end()
})

describe('institution academic administration', () => {
  it('creates and edits academic structure with fresh admin authorization', async () => {
    const admin = cookieFrom(await signIn(adminCredentials))
    const student = cookieFrom(await signIn(studentCredentials))
    const root = `/api/institutions/${INSTITUTION_ID}/admin`

    const initial = await api(`${root}/academic`, { cookie: admin })
    expect(initial.status).toBe(200)
    expect((await json<AcademicView>(initial)).institution).toMatchObject({
      id: INSTITUTION_ID,
      slug: 'asteria-university',
    })
    expect((await api(`${root}/academic`, { cookie: student })).status).toBe(
      404,
    )
    const people = await api(`${root}/memberships`, { cookie: admin })
    expect(people.status).toBe(200)
    expect(await json<unknown[]>(people)).toHaveLength(2)
    expect((await api(`${root}/memberships`, { cookie: student })).status).toBe(
      404,
    )

    const faculty = await api(`${root}/units`, {
      method: 'POST',
      cookie: admin,
      body: { code: 'eng', name: 'Faculty of Engineering', kind: 'FACULTY' },
    })
    expect(faculty.status).toBe(201)
    const facultyBody = await json<UnitView>(faculty)
    expect(facultyBody).toMatchObject({ code: 'ENG', kind: 'faculty' })

    const unit = await api(`${root}/units`, {
      method: 'POST',
      cookie: admin,
      body: {
        code: 'csc',
        name: 'Computer Science',
        kind: 'department',
        parentId: facultyBody.id,
      },
    })
    expect(unit.status).toBe(201)
    const unitBody = await json<UnitView>(unit)
    expect(unitBody.parentId).toBe(facultyBody.id)

    const renamed = await api(`${root}/units/${unitBody.id}`, {
      method: 'PATCH',
      cookie: admin,
      body: { name: 'Computer Science and Software Engineering' },
    })
    expect(renamed.status).toBe(200)
    expect((await json<UnitView>(renamed)).name).toBe(
      'Computer Science and Software Engineering',
    )

    const term = await api(`${root}/terms`, {
      method: 'POST',
      cookie: admin,
      body: {
        code: '2027-rain',
        name: '2026/2027 Rain',
        startsOn: '2027-03-01',
        endsOn: '2027-07-31',
        status: 'active',
      },
    })
    expect(term.status).toBe(201)
    const termBody = await json<TermView>(term)
    expect(termBody.code).toBe('2027-RAIN')

    const invalidTerm = await api(`${root}/terms`, {
      method: 'POST',
      cookie: admin,
      body: {
        code: 'INVALID',
        name: 'Invalid term',
        startsOn: '2027-08-01',
        endsOn: '2027-07-01',
      },
    })
    expect(invalidTerm.status).toBe(400)

    const course = await api(`${root}/courses`, {
      method: 'POST',
      cookie: admin,
      body: { unitId: unitBody.id, code: 'csc201', title: 'Data Structures' },
    })
    expect(course.status).toBe(201)
    const courseBody = await json<CourseView>(course)
    const duplicateCourse = await api(`${root}/courses`, {
      method: 'POST',
      cookie: admin,
      body: { unitId: unitBody.id, code: 'CSC201', title: 'Duplicate' },
    })
    expect(duplicateCourse.status).toBe(409)

    const offering = await api(`${root}/offerings`, {
      method: 'POST',
      cookie: admin,
      body: {
        courseId: courseBody.id,
        termId: termBody.id,
        section: 'A',
        status: 'active',
      },
    })
    expect(offering.status).toBe(201)
    const offeringBody = await json<OfferingView>(offering)
    const updated = await api(`${root}/offerings/${offeringBody.id}`, {
      method: 'PATCH',
      cookie: admin,
      body: { section: 'B', status: 'planned' },
    })
    expect(updated.status).toBe(200)
    expect((await json<OfferingView>(updated)).section).toBe('B')

    await db
      .delete(membershipRoles)
      .where(
        and(
          eq(membershipRoles.membershipId, LECTURER_MEMBERSHIP_ID),
          eq(membershipRoles.role, 'institution_admin'),
        ),
      )
    expect((await api(`${root}/academic`, { cookie: admin })).status).toBe(404)
    expect(
      (
        await api(`${root}/terms/${termBody.id}`, {
          method: 'PATCH',
          cookie: admin,
          body: { status: 'archived' },
        })
      ).status,
    ).toBe(404)
  })

  it('rejects cross-tenant parents and cyclic unit hierarchies', async () => {
    const admin = cookieFrom(await signIn(adminCredentials))
    const root = `/api/institutions/${INSTITUTION_ID}/admin`
    const otherInstitution = required(
      (
        await db
          .insert(institutions)
          .values({ name: 'Other University', slug: 'other-university' })
          .returning()
      )[0],
    )
    const otherUnit = required(
      (
        await db
          .insert(academicUnits)
          .values({
            institutionId: otherInstitution.id,
            kind: 'department',
            code: 'OTHER',
            name: 'Other department',
          })
          .returning()
      )[0],
    )

    expect(
      (
        await api(`/api/institutions/${otherInstitution.id}/admin/academic`, {
          cookie: admin,
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await api(`${root}/courses`, {
          method: 'POST',
          cookie: admin,
          body: { unitId: otherUnit.id, code: 'BAD101', title: 'Invalid' },
        })
      ).status,
    ).toBe(404)

    const first = await json<UnitView>(
      await api(`${root}/units`, {
        method: 'POST',
        cookie: admin,
        body: { code: 'FIRST', name: 'First unit', kind: 'unit' },
      }),
    )
    const second = await json<UnitView>(
      await api(`${root}/units`, {
        method: 'POST',
        cookie: admin,
        body: {
          code: 'SECOND',
          name: 'Second unit',
          kind: 'unit',
          parentId: first.id,
        },
      }),
    )
    expect(
      (
        await api(`${root}/units/${first.id}`, {
          method: 'PATCH',
          cookie: admin,
          body: { parentId: second.id },
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await api(`${root}/units/${first.id}`, {
          method: 'PATCH',
          cookie: admin,
          body: { parentId: first.id },
        })
      ).status,
    ).toBe(400)
  })

  it('manages rosters while preserving history and revoking current access', async () => {
    const admin = cookieFrom(await signIn(adminCredentials))
    const student = cookieFrom(await signIn(studentCredentials))
    const root = `/api/institutions/${INSTITUTION_ID}/admin`
    const offering = required(
      (
        await db
          .insert(courseOfferings)
          .values({
            institutionId: INSTITUTION_ID,
            courseId: COURSE_ID,
            termId: TERM_ID,
            section: 'B',
            status: 'active',
          })
          .returning()
      )[0],
    )
    const rosterPath = `${root}/offerings/${offering.id}/roster`
    expect(
      (await json<RosterView>(await api(rosterPath, { cookie: admin })))
        .lecturers,
    ).toHaveLength(0)

    const yesterday = new Date(Date.now() - 86_400_000).toISOString()
    const assigned = await api(`${root}/offerings/${offering.id}/lecturers`, {
      method: 'POST',
      cookie: admin,
      body: {
        membershipId: LECTURER_MEMBERSHIP_ID,
        role: 'lead',
        startsAt: yesterday,
      },
    })
    expect(assigned.status).toBe(201)
    const assignment = required((await json<RosterView>(assigned)).lecturers[0])
    expect(assignment.displayName).toBe('Development Lecturer')
    expect(
      (
        await api(`${root}/offerings/${offering.id}/lecturers`, {
          method: 'POST',
          cookie: admin,
          body: { membershipId: LECTURER_MEMBERSHIP_ID, role: 'lead' },
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await api(`${root}/offerings/${offering.id}/lecturers`, {
          method: 'POST',
          cookie: admin,
          body: { membershipId: STUDENT_MEMBERSHIP_ID, role: 'lead' },
        })
      ).status,
    ).toBe(400)

    const enrolled = await api(`${root}/offerings/${offering.id}/students`, {
      method: 'POST',
      cookie: admin,
      body: { membershipId: STUDENT_MEMBERSHIP_ID, enrolledAt: yesterday },
    })
    expect(enrolled.status).toBe(201)
    const enrollment = required((await json<RosterView>(enrolled)).students[0])
    expect(
      (
        await api(`${root}/offerings/${offering.id}/students`, {
          method: 'POST',
          cookie: admin,
          body: { membershipId: LECTURER_MEMBERSHIP_ID },
        })
      ).status,
    ).toBe(400)

    expect(
      (
        await json<unknown[]>(
          await api('/api/course-offerings', { cookie: admin }),
        )
      ).length,
    ).toBe(2)
    expect(
      (
        await json<unknown[]>(
          await api('/api/course-offerings', { cookie: student }),
        )
      ).length,
    ).toBe(2)

    const now = new Date()
    const lecture = required(
      (
        await db
          .insert(lectures)
          .values({
            institutionId: INSTITUTION_ID,
            courseOfferingId: offering.id,
            createdByMembershipId: LECTURER_MEMBERSHIP_ID,
            title: 'Roster-controlled lecture',
            occurredAt: now,
            status: 'published',
            publishedAt: now,
          })
          .returning()
      )[0],
    )
    expect(
      (
        await api(`/api/course-offerings/${offering.id}/lectures`, {
          cookie: student,
        })
      ).status,
    ).toBe(200)

    const endedEnrollment = await api(`${root}/enrollments/${enrollment.id}`, {
      method: 'PATCH',
      cookie: admin,
      body: { endsAt: new Date().toISOString() },
    })
    expect(endedEnrollment.status).toBe(200)
    expect(
      required((await json<RosterView>(endedEnrollment)).students[0]).endsAt,
    ).not.toBeNull()
    expect(
      (
        await api(`/api/course-offerings/${offering.id}/lectures`, {
          cookie: student,
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await api(`${root}/enrollments/${enrollment.id}`, {
          method: 'PATCH',
          cookie: admin,
          body: { endsAt: new Date().toISOString() },
        })
      ).status,
    ).toBe(409)

    const endedAssignment = await api(
      `${root}/lecturer-assignments/${assignment.id}`,
      {
        method: 'PATCH',
        cookie: admin,
        body: { endsAt: new Date().toISOString() },
      },
    )
    expect(endedAssignment.status).toBe(200)
    expect(
      (
        await api(`/api/course-offerings/${offering.id}/lectures`, {
          method: 'POST',
          cookie: admin,
          body: {
            title: 'Must not be created',
            occurredAt: new Date().toISOString(),
          },
        })
      ).status,
    ).toBe(404)

    const storedLecture = await db
      .select()
      .from(lectures)
      .where(eq(lectures.id, lecture.id))
    expect(storedLecture).toHaveLength(1)
    const historical = await api(rosterPath, { cookie: admin })
    const historicalBody = await json<RosterView>(historical)
    expect(required(historicalBody.lecturers[0]).endsAt).not.toBeNull()
    expect(required(historicalBody.students[0]).endsAt).not.toBeNull()
  })

  it('archives offerings without deleting lecture history', async () => {
    const admin = cookieFrom(await signIn(adminCredentials))
    const root = `/api/institutions/${INSTITUTION_ID}/admin`
    const before = await db.select().from(lectures)
    expect(before).toHaveLength(1)

    const archived = await api(`${root}/offerings/${OFFERING_ID}`, {
      method: 'PATCH',
      cookie: admin,
      body: { status: 'archived' },
    })
    expect(archived.status).toBe(200)
    expect(
      (
        await api(`${root}/offerings/${OFFERING_ID}/students`, {
          method: 'POST',
          cookie: admin,
          body: { membershipId: STUDENT_MEMBERSHIP_ID },
        })
      ).status,
    ).toBe(409)
    expect(await db.select().from(lectures)).toHaveLength(1)
    expect(
      (
        await json<unknown[]>(
          await api('/api/course-offerings', { cookie: admin }),
        )
      ).length,
    ).toBe(0)
    const academic = await json<AcademicView>(
      await api(`${root}/academic`, { cookie: admin }),
    )
    expect(required(academic.offerings[0]).status).toBe('archived')
  })
})

async function signIn(credentials: {
  email: string
  password: string
}): Promise<Response> {
  return api('/api/auth/sign-in', { method: 'POST', body: credentials })
}

async function api(
  path: string,
  options: { method?: string; cookie?: string; body?: unknown } = {},
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.body === undefined
        ? {}
        : { 'Content-Type': 'application/json' }),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  })
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

function cookieFrom(response: Response): string {
  const setCookie = response.headers.get('set-cookie')
  if (!setCookie) {
    throw new Error(`Expected a session cookie; received ${response.status}.`)
  }
  const [cookie] = setCookie.split(';')
  if (!cookie) {
    throw new Error('Expected a non-empty session cookie.')
  }
  return cookie
}

function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Expected a database row.')
  }
  return value
}
