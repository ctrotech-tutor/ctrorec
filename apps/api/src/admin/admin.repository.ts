import type { Database } from '@ctrorec/database'
import {
  academicTerms,
  academicUnits,
  courseOfferings,
  courses,
  enrollments,
  institutions,
  lecturerAssignments,
  membershipRoles,
  memberships,
  users,
} from '@ctrorec/database/schema'
import { Inject, Injectable } from '@nestjs/common'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { DATABASE } from '../database/database.constants.js'

export type AcademicUnit = typeof academicUnits.$inferSelect
export type AcademicTerm = typeof academicTerms.$inferSelect
export type Course = typeof courses.$inferSelect
export type CourseOffering = typeof courseOfferings.$inferSelect
export type LecturerAssignment = typeof lecturerAssignments.$inferSelect
export type Enrollment = typeof enrollments.$inferSelect

export interface AdminMembershipRecord {
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

export interface LecturerRosterRecord {
  id: string
  membershipId: string
  displayName: string
  email: string
  role: string
  startsAt: Date
  endsAt: Date | null
}

export interface StudentRosterRecord {
  id: string
  membershipId: string
  displayName: string
  email: string
  enrolledAt: Date
  endsAt: Date | null
}

@Injectable()
export class AdminRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findAdminMembership(
    userId: string,
    institutionId: string,
  ): Promise<{
    membershipId: string
    institution: { id: string; slug: string; name: string }
  } | null> {
    const [row] = await this.db
      .select({
        membershipId: memberships.id,
        institutionId: institutions.id,
        institutionSlug: institutions.slug,
        institutionName: institutions.name,
      })
      .from(memberships)
      .innerJoin(
        membershipRoles,
        and(
          eq(membershipRoles.membershipId, memberships.id),
          eq(membershipRoles.institutionId, memberships.institutionId),
          eq(membershipRoles.role, 'institution_admin'),
        ),
      )
      .innerJoin(institutions, eq(memberships.institutionId, institutions.id))
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.institutionId, institutionId),
          eq(memberships.status, 'active'),
          eq(institutions.status, 'active'),
        ),
      )
      .limit(1)
    return row
      ? {
          membershipId: row.membershipId,
          institution: {
            id: row.institutionId,
            slug: row.institutionSlug,
            name: row.institutionName,
          },
        }
      : null
  }

  async listUnits(institutionId: string): Promise<AcademicUnit[]> {
    return this.db
      .select()
      .from(academicUnits)
      .where(eq(academicUnits.institutionId, institutionId))
      .orderBy(asc(academicUnits.code))
  }

  async listTerms(institutionId: string): Promise<AcademicTerm[]> {
    return this.db
      .select()
      .from(academicTerms)
      .where(eq(academicTerms.institutionId, institutionId))
      .orderBy(desc(academicTerms.startsOn), asc(academicTerms.code))
  }

  async listCourses(institutionId: string): Promise<Course[]> {
    return this.db
      .select()
      .from(courses)
      .where(eq(courses.institutionId, institutionId))
      .orderBy(asc(courses.code))
  }

  async listOfferings(institutionId: string): Promise<CourseOffering[]> {
    return this.db
      .select()
      .from(courseOfferings)
      .where(eq(courseOfferings.institutionId, institutionId))
      .orderBy(desc(courseOfferings.createdAt), asc(courseOfferings.section))
  }

  async listMemberships(
    institutionId: string,
  ): Promise<AdminMembershipRecord[]> {
    const rows = await this.db
      .select({
        membershipId: memberships.id,
        membershipStatus: memberships.status,
        role: membershipRoles.role,
        userId: users.id,
        displayName: users.displayName,
        email: users.email,
        userStatus: users.status,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .leftJoin(
        membershipRoles,
        and(
          eq(membershipRoles.membershipId, memberships.id),
          eq(membershipRoles.institutionId, memberships.institutionId),
        ),
      )
      .where(eq(memberships.institutionId, institutionId))
      .orderBy(asc(users.displayName), asc(users.email), asc(memberships.id))

    const byId = new Map<string, AdminMembershipRecord>()
    for (const row of rows) {
      let membership = byId.get(row.membershipId)
      if (!membership) {
        membership = {
          id: row.membershipId,
          status: row.membershipStatus,
          roles: [],
          user: {
            id: row.userId,
            displayName: row.displayName,
            email: row.email,
            status: row.userStatus,
          },
        }
        byId.set(row.membershipId, membership)
      }
      if (row.role) {
        membership.roles.push(row.role)
      }
    }
    return [...byId.values()]
  }

  async findMembership(
    institutionId: string,
    membershipId: string,
  ): Promise<AdminMembershipRecord | null> {
    const rows = await this.db
      .select({
        membershipId: memberships.id,
        membershipStatus: memberships.status,
        role: membershipRoles.role,
        userId: users.id,
        displayName: users.displayName,
        email: users.email,
        userStatus: users.status,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .leftJoin(
        membershipRoles,
        and(
          eq(membershipRoles.membershipId, memberships.id),
          eq(membershipRoles.institutionId, memberships.institutionId),
        ),
      )
      .where(
        and(
          eq(memberships.id, membershipId),
          eq(memberships.institutionId, institutionId),
        ),
      )
      .limit(10)
    const first = rows[0]
    if (!first) {
      return null
    }
    return {
      id: first.membershipId,
      status: first.membershipStatus,
      roles: rows.flatMap((row) => (row.role ? [row.role] : [])),
      user: {
        id: first.userId,
        displayName: first.displayName,
        email: first.email,
        status: first.userStatus,
      },
    }
  }

  async findUnit(
    institutionId: string,
    id: string,
  ): Promise<AcademicUnit | null> {
    const [row] = await this.db
      .select()
      .from(academicUnits)
      .where(
        and(
          eq(academicUnits.id, id),
          eq(academicUnits.institutionId, institutionId),
        ),
      )
      .limit(1)
    return row ?? null
  }

  async findTerm(
    institutionId: string,
    id: string,
  ): Promise<AcademicTerm | null> {
    const [row] = await this.db
      .select()
      .from(academicTerms)
      .where(
        and(
          eq(academicTerms.id, id),
          eq(academicTerms.institutionId, institutionId),
        ),
      )
      .limit(1)
    return row ?? null
  }

  async findCourse(institutionId: string, id: string): Promise<Course | null> {
    const [row] = await this.db
      .select()
      .from(courses)
      .where(and(eq(courses.id, id), eq(courses.institutionId, institutionId)))
      .limit(1)
    return row ?? null
  }

  async findOffering(
    institutionId: string,
    id: string,
  ): Promise<CourseOffering | null> {
    const [row] = await this.db
      .select()
      .from(courseOfferings)
      .where(
        and(
          eq(courseOfferings.id, id),
          eq(courseOfferings.institutionId, institutionId),
        ),
      )
      .limit(1)
    return row ?? null
  }

  async insertUnit(
    values: typeof academicUnits.$inferInsert,
  ): Promise<AcademicUnit> {
    const [row] = await this.db.insert(academicUnits).values(values).returning()
    return required(row)
  }

  async updateUnit(
    institutionId: string,
    id: string,
    values: Partial<typeof academicUnits.$inferInsert>,
  ): Promise<AcademicUnit | null> {
    const [row] = await this.db
      .update(academicUnits)
      .set(values)
      .where(
        and(
          eq(academicUnits.id, id),
          eq(academicUnits.institutionId, institutionId),
        ),
      )
      .returning()
    return row ?? null
  }

  async insertTerm(
    values: typeof academicTerms.$inferInsert,
  ): Promise<AcademicTerm> {
    const [row] = await this.db.insert(academicTerms).values(values).returning()
    return required(row)
  }

  async updateTerm(
    institutionId: string,
    id: string,
    values: Partial<typeof academicTerms.$inferInsert>,
  ): Promise<AcademicTerm | null> {
    const [row] = await this.db
      .update(academicTerms)
      .set(values)
      .where(
        and(
          eq(academicTerms.id, id),
          eq(academicTerms.institutionId, institutionId),
        ),
      )
      .returning()
    return row ?? null
  }

  async insertCourse(values: typeof courses.$inferInsert): Promise<Course> {
    const [row] = await this.db.insert(courses).values(values).returning()
    return required(row)
  }

  async updateCourse(
    institutionId: string,
    id: string,
    values: Partial<typeof courses.$inferInsert>,
  ): Promise<Course | null> {
    const [row] = await this.db
      .update(courses)
      .set(values)
      .where(and(eq(courses.id, id), eq(courses.institutionId, institutionId)))
      .returning()
    return row ?? null
  }

  async insertOffering(
    values: typeof courseOfferings.$inferInsert,
  ): Promise<CourseOffering> {
    const [row] = await this.db
      .insert(courseOfferings)
      .values(values)
      .returning()
    return required(row)
  }

  async updateOffering(
    institutionId: string,
    id: string,
    values: Partial<typeof courseOfferings.$inferInsert>,
  ): Promise<CourseOffering | null> {
    const [row] = await this.db
      .update(courseOfferings)
      .set(values)
      .where(
        and(
          eq(courseOfferings.id, id),
          eq(courseOfferings.institutionId, institutionId),
        ),
      )
      .returning()
    return row ?? null
  }

  async listLecturerRoster(
    institutionId: string,
    offeringId: string,
  ): Promise<LecturerRosterRecord[]> {
    return this.db
      .select({
        id: lecturerAssignments.id,
        membershipId: lecturerAssignments.membershipId,
        displayName: users.displayName,
        email: users.email,
        role: lecturerAssignments.role,
        startsAt: lecturerAssignments.startsAt,
        endsAt: lecturerAssignments.endsAt,
      })
      .from(lecturerAssignments)
      .innerJoin(
        memberships,
        and(
          eq(lecturerAssignments.membershipId, memberships.id),
          eq(lecturerAssignments.institutionId, memberships.institutionId),
        ),
      )
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(
        and(
          eq(lecturerAssignments.courseOfferingId, offeringId),
          eq(lecturerAssignments.institutionId, institutionId),
        ),
      )
      .orderBy(desc(lecturerAssignments.startsAt), asc(users.displayName))
  }

  async listStudentRoster(
    institutionId: string,
    offeringId: string,
  ): Promise<StudentRosterRecord[]> {
    return this.db
      .select({
        id: enrollments.id,
        membershipId: enrollments.membershipId,
        displayName: users.displayName,
        email: users.email,
        enrolledAt: enrollments.enrolledAt,
        endsAt: enrollments.endsAt,
      })
      .from(enrollments)
      .innerJoin(
        memberships,
        and(
          eq(enrollments.membershipId, memberships.id),
          eq(enrollments.institutionId, memberships.institutionId),
        ),
      )
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(
        and(
          eq(enrollments.courseOfferingId, offeringId),
          eq(enrollments.institutionId, institutionId),
        ),
      )
      .orderBy(desc(enrollments.enrolledAt), asc(users.displayName))
  }

  async insertLecturerAssignment(
    values: typeof lecturerAssignments.$inferInsert,
  ): Promise<LecturerAssignment> {
    const [row] = await this.db
      .insert(lecturerAssignments)
      .values(values)
      .returning()
    return required(row)
  }

  async insertEnrollment(
    values: typeof enrollments.$inferInsert,
  ): Promise<Enrollment> {
    const [row] = await this.db.insert(enrollments).values(values).returning()
    return required(row)
  }

  async findLecturerAssignment(
    institutionId: string,
    id: string,
  ): Promise<LecturerAssignment | null> {
    const [row] = await this.db
      .select()
      .from(lecturerAssignments)
      .where(
        and(
          eq(lecturerAssignments.id, id),
          eq(lecturerAssignments.institutionId, institutionId),
        ),
      )
      .limit(1)
    return row ?? null
  }

  async findEnrollment(
    institutionId: string,
    id: string,
  ): Promise<Enrollment | null> {
    const [row] = await this.db
      .select()
      .from(enrollments)
      .where(
        and(
          eq(enrollments.id, id),
          eq(enrollments.institutionId, institutionId),
        ),
      )
      .limit(1)
    return row ?? null
  }

  async endLecturerAssignment(
    institutionId: string,
    id: string,
    endsAt: Date,
  ): Promise<LecturerAssignment | null> {
    const [row] = await this.db
      .update(lecturerAssignments)
      .set({ endsAt, updatedAt: new Date() })
      .where(
        and(
          eq(lecturerAssignments.id, id),
          eq(lecturerAssignments.institutionId, institutionId),
          isNull(lecturerAssignments.endsAt),
        ),
      )
      .returning()
    return row ?? null
  }

  async endEnrollment(
    institutionId: string,
    id: string,
    endsAt: Date,
  ): Promise<Enrollment | null> {
    const [row] = await this.db
      .update(enrollments)
      .set({ endsAt, updatedAt: new Date() })
      .where(
        and(
          eq(enrollments.id, id),
          eq(enrollments.institutionId, institutionId),
          isNull(enrollments.endsAt),
        ),
      )
      .returning()
    return row ?? null
  }
}

function required<T>(row: T | undefined): T {
  if (!row) {
    throw new Error('The academic write did not return its stored row.')
  }
  return row
}
