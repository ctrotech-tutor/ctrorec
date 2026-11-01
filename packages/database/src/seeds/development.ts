import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '../client.js'
import {
  academicTerms,
  academicUnits,
  courseOfferings,
  courses,
  enrollments,
  institutions,
  lecturerAssignments,
  lectures,
  membershipRoles,
  memberships,
  users,
} from '../schema/index.js'

const IDS = {
  institution: '019a1000-0000-7000-8000-000000000001',
  lecturerUser: '019a1000-0000-7000-8000-000000000002',
  studentUser: '019a1000-0000-7000-8000-000000000003',
  lecturerMembership: '019a1000-0000-7000-8000-000000000004',
  studentMembership: '019a1000-0000-7000-8000-000000000005',
  unit: '019a1000-0000-7000-8000-000000000006',
  term: '019a1000-0000-7000-8000-000000000007',
  course: '019a1000-0000-7000-8000-000000000008',
  offering: '019a1000-0000-7000-8000-000000000009',
  assignment: '019a1000-0000-7000-8000-00000000000a',
  enrollment: '019a1000-0000-7000-8000-00000000000b',
  lecture: '019a1000-0000-7000-8000-00000000000c',
} as const

const DEVELOPMENT_PASSWORD_HASHES = {
  lecturer:
    '$scrypt$ln=17,r=8,p=1$DrbDQNZHf8M9OHQFNKGDUw$5HTpKdtlaihennivnE8ZeZB3EquNwfPIsFkmPAurPWs',
  student:
    '$scrypt$ln=17,r=8,p=1$tAi0RE2bMBwq10pr0txPpw$32GqoVkJ2Z0jbBzjm8fvzDnK58Mr4ZmNPZlZVehTyiQ',
} as const

export async function seedDevelopment(db: Database) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The development seed cannot run in production.')
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(institutions)
      .where(eq(institutions.slug, 'asteria-university'))
      .limit(1)

    if (existing) {
      if (existing.id !== IDS.institution) {
        throw new Error(
          'The development seed slug already belongs to another institution.',
        )
      }
      await tx
        .update(users)
        .set({ passwordHash: DEVELOPMENT_PASSWORD_HASHES.lecturer })
        .where(and(eq(users.id, IDS.lecturerUser), isNull(users.passwordHash)))
      await tx
        .update(users)
        .set({ passwordHash: DEVELOPMENT_PASSWORD_HASHES.student })
        .where(and(eq(users.id, IDS.studentUser), isNull(users.passwordHash)))
      return { institutionId: existing.id, seeded: false as const }
    }

    await tx.insert(institutions).values({
      id: IDS.institution,
      name: 'Asteria University',
      slug: 'asteria-university',
    })
    await tx.insert(users).values([
      {
        id: IDS.lecturerUser,
        displayName: 'Development Lecturer',
        email: 'lecturer@ctrorec.test',
        passwordHash: DEVELOPMENT_PASSWORD_HASHES.lecturer,
      },
      {
        id: IDS.studentUser,
        displayName: 'Development Student',
        email: 'student@ctrorec.test',
        passwordHash: DEVELOPMENT_PASSWORD_HASHES.student,
      },
    ])
    await tx.insert(memberships).values([
      {
        id: IDS.lecturerMembership,
        institutionId: IDS.institution,
        userId: IDS.lecturerUser,
      },
      {
        id: IDS.studentMembership,
        institutionId: IDS.institution,
        userId: IDS.studentUser,
      },
    ])
    await tx.insert(membershipRoles).values([
      {
        institutionId: IDS.institution,
        membershipId: IDS.lecturerMembership,
        role: 'academic_staff',
      },
      {
        institutionId: IDS.institution,
        membershipId: IDS.studentMembership,
        role: 'student',
      },
    ])
    await tx.insert(academicUnits).values({
      id: IDS.unit,
      institutionId: IDS.institution,
      kind: 'department',
      code: 'COMPUTING',
      name: 'Computing and Software Systems',
    })
    await tx.insert(academicTerms).values({
      id: IDS.term,
      institutionId: IDS.institution,
      code: '2026-HARMATTAN',
      name: '2026/2027 Harmattan',
      startsOn: '2026-10-01',
      endsOn: '2027-02-28',
      status: 'active',
    })
    await tx.insert(courses).values({
      id: IDS.course,
      institutionId: IDS.institution,
      unitId: IDS.unit,
      code: 'CSC101',
      title: 'Introduction to Computing',
    })
    await tx.insert(courseOfferings).values({
      id: IDS.offering,
      institutionId: IDS.institution,
      courseId: IDS.course,
      termId: IDS.term,
      section: 'A',
      status: 'active',
    })
    await tx.insert(lecturerAssignments).values({
      id: IDS.assignment,
      institutionId: IDS.institution,
      courseOfferingId: IDS.offering,
      membershipId: IDS.lecturerMembership,
      startsAt: new Date('2026-10-01T08:00:00.000Z'),
    })
    await tx.insert(enrollments).values({
      id: IDS.enrollment,
      institutionId: IDS.institution,
      courseOfferingId: IDS.offering,
      membershipId: IDS.studentMembership,
      enrolledAt: new Date('2026-10-01T08:00:00.000Z'),
    })
    await tx.insert(lectures).values({
      id: IDS.lecture,
      institutionId: IDS.institution,
      courseOfferingId: IDS.offering,
      createdByMembershipId: IDS.lecturerMembership,
      title: 'Welcome and course orientation',
      occurredAt: new Date('2026-10-29T09:00:00.000Z'),
    })

    return { institutionId: IDS.institution, seeded: true as const }
  })
}
