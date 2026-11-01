import type { Database } from '../src/client.js'
import {
  academicTerms,
  academicUnits,
  courseOfferings,
  courses,
  institutions,
  membershipRoles,
  memberships,
  users,
} from '../src/schema/index.js'
import { exactlyOne, exactlyTwo } from './rows.js'

export async function createAcademicFixture(db: Database, prefix: string) {
  const institution = exactlyOne(
    await db
      .insert(institutions)
      .values({ name: `Institution ${prefix}`, slug: `institution-${prefix}` })
      .returning(),
  )
  const [lecturerUser, studentUser] = exactlyTwo(
    await db
      .insert(users)
      .values([
        {
          displayName: `Lecturer ${prefix}`,
          email: `lecturer-${prefix}@ctrorec.test`,
        },
        {
          displayName: `Student ${prefix}`,
          email: `student-${prefix}@ctrorec.test`,
        },
      ])
      .returning(),
  )
  const [lecturerMembership, studentMembership] = exactlyTwo(
    await db
      .insert(memberships)
      .values([
        {
          institutionId: institution.id,
          userId: lecturerUser.id,
        },
        {
          institutionId: institution.id,
          userId: studentUser.id,
        },
      ])
      .returning(),
  )
  await db.insert(membershipRoles).values([
    {
      institutionId: institution.id,
      membershipId: lecturerMembership.id,
      role: 'academic_staff',
    },
    {
      institutionId: institution.id,
      membershipId: studentMembership.id,
      role: 'student',
    },
  ])
  const unit = exactlyOne(
    await db
      .insert(academicUnits)
      .values({
        institutionId: institution.id,
        kind: 'department',
        code: `UNIT-${prefix.toUpperCase()}`,
        name: `Unit ${prefix}`,
      })
      .returning(),
  )
  const term = exactlyOne(
    await db
      .insert(academicTerms)
      .values({
        institutionId: institution.id,
        code: `TERM-${prefix.toUpperCase()}`,
        name: `Term ${prefix}`,
        startsOn: '2026-10-01',
        endsOn: '2027-02-28',
        status: 'active',
      })
      .returning(),
  )
  const course = exactlyOne(
    await db
      .insert(courses)
      .values({
        institutionId: institution.id,
        unitId: unit.id,
        code: `COURSE-${prefix.toUpperCase()}`,
        title: `Course ${prefix}`,
      })
      .returning(),
  )
  const offering = exactlyOne(
    await db
      .insert(courseOfferings)
      .values({
        institutionId: institution.id,
        courseId: course.id,
        termId: term.id,
        section: 'A',
        status: 'active',
      })
      .returning(),
  )

  return {
    course,
    institution,
    lecturerMembership,
    lecturerUser,
    offering,
    studentMembership,
    studentUser,
    term,
    unit,
  }
}

export async function createAdditionalStaffMembership(
  db: Database,
  fixture: Awaited<ReturnType<typeof createAcademicFixture>>,
  suffix: string,
) {
  const user = exactlyOne(
    await db
      .insert(users)
      .values({
        displayName: `Additional Staff ${suffix}`,
        email: `additional-${suffix}@ctrorec.test`,
      })
      .returning(),
  )
  const membership = exactlyOne(
    await db
      .insert(memberships)
      .values({
        institutionId: fixture.institution.id,
        userId: user.id,
      })
      .returning(),
  )
  await db.insert(membershipRoles).values({
    institutionId: fixture.institution.id,
    membershipId: membership.id,
    role: 'academic_staff',
  })

  return membership
}
