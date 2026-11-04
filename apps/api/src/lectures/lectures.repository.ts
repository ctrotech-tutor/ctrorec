import type { Database, DatabaseTransaction } from '@ctrorec/database'
import {
  academicTerms,
  courseOfferings,
  courses,
  enrollments,
  institutions,
  lectureAudio,
  lectureAudioCaptures,
  lectureAudioDerivatives,
  lectureAudioUploads,
  lecturerAssignments,
  lectures,
  membershipRoles,
  memberships,
} from '@ctrorec/database/schema'
import { Inject, Injectable } from '@nestjs/common'
import { and, asc, desc, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm'
import { DATABASE } from '../database/database.constants.js'

export type Lecture = typeof lectures.$inferSelect
export type LectureAudio = typeof lectureAudio.$inferSelect
export type LectureAudioDerivative = typeof lectureAudioDerivatives.$inferSelect
export type LectureAudioUpload = typeof lectureAudioUploads.$inferSelect
export class AudioUploadStateChangedError extends Error {}
type CourseOffering = typeof courseOfferings.$inferSelect
type Course = typeof courses.$inferSelect
type AcademicTerm = typeof academicTerms.$inferSelect
type Institution = typeof institutions.$inferSelect

export interface OfferingContext {
  offering: CourseOffering
  course: Course
  term: AcademicTerm
  institution: Institution
}

export interface LectureContext extends OfferingContext {
  lecture: Lecture
  audio: LectureAudio | null
  dataSaver: LectureAudioDerivative | null
}

export interface OfferingAccess {
  membershipId: string | null
  canManage: boolean
  canStudy: boolean
}

@Injectable()
export class LecturesRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async listTeachingOfferings(
    userId: string,
    now: Date,
  ): Promise<OfferingContext[]> {
    return this.db
      .select({
        offering: courseOfferings,
        course: courses,
        term: academicTerms,
        institution: institutions,
      })
      .from(lecturerAssignments)
      .innerJoin(
        memberships,
        and(
          eq(lecturerAssignments.membershipId, memberships.id),
          eq(lecturerAssignments.institutionId, memberships.institutionId),
        ),
      )
      .innerJoin(
        membershipRoles,
        and(
          eq(membershipRoles.membershipId, memberships.id),
          eq(membershipRoles.institutionId, memberships.institutionId),
          eq(membershipRoles.role, 'academic_staff'),
        ),
      )
      .innerJoin(
        courseOfferings,
        and(
          eq(lecturerAssignments.courseOfferingId, courseOfferings.id),
          eq(lecturerAssignments.institutionId, courseOfferings.institutionId),
        ),
      )
      .innerJoin(
        courses,
        and(
          eq(courseOfferings.courseId, courses.id),
          eq(courseOfferings.institutionId, courses.institutionId),
        ),
      )
      .innerJoin(
        academicTerms,
        and(
          eq(courseOfferings.termId, academicTerms.id),
          eq(courseOfferings.institutionId, academicTerms.institutionId),
        ),
      )
      .innerJoin(
        institutions,
        eq(courseOfferings.institutionId, institutions.id),
      )
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.status, 'active'),
          eq(institutions.status, 'active'),
          inArray(courseOfferings.status, ['active', 'completed']),
          lte(lecturerAssignments.startsAt, now),
          or(
            isNull(lecturerAssignments.endsAt),
            gt(lecturerAssignments.endsAt, now),
          ),
        ),
      )
      .orderBy(asc(courses.code), asc(courseOfferings.section))
  }

  async listStudyingOfferings(
    userId: string,
    now: Date,
  ): Promise<OfferingContext[]> {
    return this.db
      .select({
        offering: courseOfferings,
        course: courses,
        term: academicTerms,
        institution: institutions,
      })
      .from(enrollments)
      .innerJoin(
        memberships,
        and(
          eq(enrollments.membershipId, memberships.id),
          eq(enrollments.institutionId, memberships.institutionId),
        ),
      )
      .innerJoin(
        membershipRoles,
        and(
          eq(membershipRoles.membershipId, memberships.id),
          eq(membershipRoles.institutionId, memberships.institutionId),
          eq(membershipRoles.role, 'student'),
        ),
      )
      .innerJoin(
        courseOfferings,
        and(
          eq(enrollments.courseOfferingId, courseOfferings.id),
          eq(enrollments.institutionId, courseOfferings.institutionId),
        ),
      )
      .innerJoin(
        courses,
        and(
          eq(courseOfferings.courseId, courses.id),
          eq(courseOfferings.institutionId, courses.institutionId),
        ),
      )
      .innerJoin(
        academicTerms,
        and(
          eq(courseOfferings.termId, academicTerms.id),
          eq(courseOfferings.institutionId, academicTerms.institutionId),
        ),
      )
      .innerJoin(
        institutions,
        eq(courseOfferings.institutionId, institutions.id),
      )
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.status, 'active'),
          eq(institutions.status, 'active'),
          inArray(courseOfferings.status, ['active', 'completed']),
          lte(enrollments.enrolledAt, now),
          or(isNull(enrollments.endsAt), gt(enrollments.endsAt, now)),
        ),
      )
      .orderBy(asc(courses.code), asc(courseOfferings.section))
  }

  async findOffering(id: string): Promise<OfferingContext | null> {
    const [row] = await this.db
      .select({
        offering: courseOfferings,
        course: courses,
        term: academicTerms,
        institution: institutions,
      })
      .from(courseOfferings)
      .innerJoin(
        courses,
        and(
          eq(courseOfferings.courseId, courses.id),
          eq(courseOfferings.institutionId, courses.institutionId),
        ),
      )
      .innerJoin(
        academicTerms,
        and(
          eq(courseOfferings.termId, academicTerms.id),
          eq(courseOfferings.institutionId, academicTerms.institutionId),
        ),
      )
      .innerJoin(
        institutions,
        eq(courseOfferings.institutionId, institutions.id),
      )
      .where(eq(courseOfferings.id, id))
      .limit(1)
    return row ?? null
  }

  async findLecture(id: string): Promise<LectureContext | null> {
    const [row] = await this.db
      .select({
        lecture: lectures,
        offering: courseOfferings,
        course: courses,
        term: academicTerms,
        institution: institutions,
      })
      .from(lectures)
      .innerJoin(
        courseOfferings,
        and(
          eq(lectures.courseOfferingId, courseOfferings.id),
          eq(lectures.institutionId, courseOfferings.institutionId),
        ),
      )
      .innerJoin(
        courses,
        and(
          eq(courseOfferings.courseId, courses.id),
          eq(courseOfferings.institutionId, courses.institutionId),
        ),
      )
      .innerJoin(
        academicTerms,
        and(
          eq(courseOfferings.termId, academicTerms.id),
          eq(courseOfferings.institutionId, academicTerms.institutionId),
        ),
      )
      .innerJoin(institutions, eq(lectures.institutionId, institutions.id))
      .where(eq(lectures.id, id))
      .limit(1)
    if (!row) {
      return null
    }

    const [audio] = await this.db
      .select()
      .from(lectureAudio)
      .where(
        and(
          eq(lectureAudio.lectureId, row.lecture.id),
          eq(lectureAudio.institutionId, row.lecture.institutionId),
        ),
      )
      .limit(1)
    if (!audio) {
      return { ...row, audio: null, dataSaver: null }
    }
    const [dataSaver] = await this.db
      .select()
      .from(lectureAudioDerivatives)
      .where(
        and(
          eq(lectureAudioDerivatives.lectureId, audio.lectureId),
          eq(lectureAudioDerivatives.institutionId, audio.institutionId),
          eq(lectureAudioDerivatives.kind, 'data_saver'),
        ),
      )
      .limit(1)
    return { ...row, audio, dataSaver: dataSaver ?? null }
  }

  async listLectures(offeringId: string): Promise<LectureContext[]> {
    const rows = await this.db
      .select({
        lecture: lectures,
        offering: courseOfferings,
        course: courses,
        term: academicTerms,
        institution: institutions,
      })
      .from(lectures)
      .innerJoin(
        courseOfferings,
        and(
          eq(lectures.courseOfferingId, courseOfferings.id),
          eq(lectures.institutionId, courseOfferings.institutionId),
        ),
      )
      .innerJoin(
        courses,
        and(
          eq(courseOfferings.courseId, courses.id),
          eq(courseOfferings.institutionId, courses.institutionId),
        ),
      )
      .innerJoin(
        academicTerms,
        and(
          eq(courseOfferings.termId, academicTerms.id),
          eq(courseOfferings.institutionId, academicTerms.institutionId),
        ),
      )
      .innerJoin(institutions, eq(lectures.institutionId, institutions.id))
      .where(eq(lectures.courseOfferingId, offeringId))
      .orderBy(desc(lectures.occurredAt), desc(lectures.createdAt))

    if (rows.length === 0) {
      return []
    }
    const audioRows = await this.db
      .select()
      .from(lectureAudio)
      .where(
        inArray(
          lectureAudio.lectureId,
          rows.map((row) => row.lecture.id),
        ),
      )
    const audioByLecture = new Map(
      audioRows.map((audio) => [audio.lectureId, audio]),
    )
    const derivativeRows =
      audioRows.length === 0
        ? []
        : await this.db
            .select()
            .from(lectureAudioDerivatives)
            .where(
              and(
                inArray(
                  lectureAudioDerivatives.lectureId,
                  audioRows.map((audio) => audio.lectureId),
                ),
                eq(lectureAudioDerivatives.kind, 'data_saver'),
              ),
            )
    const dataSaverByLecture = new Map(
      derivativeRows.map((derivative) => [derivative.lectureId, derivative]),
    )
    return rows.map((row) => ({
      ...row,
      audio: audioByLecture.get(row.lecture.id) ?? null,
      dataSaver: dataSaverByLecture.get(row.lecture.id) ?? null,
    }))
  }

  async getAccess(
    userId: string,
    institutionId: string,
    offeringId: string,
    now: Date,
  ): Promise<OfferingAccess> {
    const [membership] = await this.db
      .select({ id: memberships.id })
      .from(memberships)
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
    if (!membership) {
      return { membershipId: null, canManage: false, canStudy: false }
    }

    const [assignment, enrollment] = await Promise.all([
      this.db
        .select({ id: lecturerAssignments.id })
        .from(lecturerAssignments)
        .innerJoin(
          membershipRoles,
          and(
            eq(membershipRoles.membershipId, lecturerAssignments.membershipId),
            eq(
              membershipRoles.institutionId,
              lecturerAssignments.institutionId,
            ),
            eq(membershipRoles.role, 'academic_staff'),
          ),
        )
        .where(
          and(
            eq(lecturerAssignments.membershipId, membership.id),
            eq(lecturerAssignments.institutionId, institutionId),
            eq(lecturerAssignments.courseOfferingId, offeringId),
            lte(lecturerAssignments.startsAt, now),
            or(
              isNull(lecturerAssignments.endsAt),
              gt(lecturerAssignments.endsAt, now),
            ),
          ),
        )
        .limit(1),
      this.db
        .select({ id: enrollments.id })
        .from(enrollments)
        .innerJoin(
          membershipRoles,
          and(
            eq(membershipRoles.membershipId, enrollments.membershipId),
            eq(membershipRoles.institutionId, enrollments.institutionId),
            eq(membershipRoles.role, 'student'),
          ),
        )
        .where(
          and(
            eq(enrollments.membershipId, membership.id),
            eq(enrollments.institutionId, institutionId),
            eq(enrollments.courseOfferingId, offeringId),
            lte(enrollments.enrolledAt, now),
            or(isNull(enrollments.endsAt), gt(enrollments.endsAt, now)),
          ),
        )
        .limit(1),
    ])

    return {
      membershipId: membership.id,
      canManage: assignment.length === 1,
      canStudy: enrollment.length === 1,
    }
  }

  async insertLecture(lecture: typeof lectures.$inferInsert): Promise<Lecture> {
    const [created] = await this.db.insert(lectures).values(lecture).returning()
    if (!created) {
      throw new Error('The lecture record was not returned.')
    }
    return created
  }

  async updateLecture(
    lectureId: string,
    institutionId: string,
    changes: {
      title?: string
      description?: string | null
      occurredAt?: Date
    },
  ): Promise<Lecture | null> {
    const [updated] = await this.db
      .update(lectures)
      .set(changes)
      .where(
        and(
          eq(lectures.id, lectureId),
          eq(lectures.institutionId, institutionId),
        ),
      )
      .returning()
    return updated ?? null
  }

  async createAudioUpload(
    upload: typeof lectureAudioUploads.$inferInsert,
  ): Promise<LectureAudioUpload> {
    const [created] = await this.db
      .insert(lectureAudioUploads)
      .values(upload)
      .returning()
    if (!created) {
      throw new Error('The audio upload session was not returned.')
    }
    return created
  }

  async findActiveAudioUpload(
    lectureId: string,
    institutionId: string,
  ): Promise<LectureAudioUpload | null> {
    const [upload] = await this.db
      .select()
      .from(lectureAudioUploads)
      .where(
        and(
          eq(lectureAudioUploads.lectureId, lectureId),
          eq(lectureAudioUploads.institutionId, institutionId),
          eq(lectureAudioUploads.status, 'active'),
        ),
      )
      .limit(1)
    return upload ?? null
  }

  async findAudioUpload(
    uploadId: string,
    lectureId: string,
    institutionId: string,
  ): Promise<LectureAudioUpload | null> {
    const [upload] = await this.db
      .select()
      .from(lectureAudioUploads)
      .where(
        and(
          eq(lectureAudioUploads.id, uploadId),
          eq(lectureAudioUploads.lectureId, lectureId),
          eq(lectureAudioUploads.institutionId, institutionId),
        ),
      )
      .limit(1)
    return upload ?? null
  }

  async expireAudioUploads(
    lectureId: string,
    now: Date,
  ): Promise<LectureAudioUpload[]> {
    return this.db
      .update(lectureAudioUploads)
      .set({ status: 'expired' })
      .where(
        and(
          eq(lectureAudioUploads.lectureId, lectureId),
          eq(lectureAudioUploads.status, 'active'),
          lte(lectureAudioUploads.expiresAt, now),
        ),
      )
      .returning()
  }

  async withAudioUploadLock<T>(
    uploadId: string,
    lectureId: string,
    institutionId: string,
    callback: (
      upload: LectureAudioUpload | null,
      transaction: DatabaseTransaction,
    ) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (transaction) => {
      const [upload] = await transaction
        .select()
        .from(lectureAudioUploads)
        .where(
          and(
            eq(lectureAudioUploads.id, uploadId),
            eq(lectureAudioUploads.lectureId, lectureId),
            eq(lectureAudioUploads.institutionId, institutionId),
          ),
        )
        .limit(1)
        .for('update')
      return callback(upload ?? null, transaction)
    })
  }

  async advanceAudioUpload(
    transaction: DatabaseTransaction,
    uploadId: string,
    expectedOffset: number,
    receivedBytes: number,
  ): Promise<LectureAudioUpload | null> {
    const [updated] = await transaction
      .update(lectureAudioUploads)
      .set({ receivedBytes })
      .where(
        and(
          eq(lectureAudioUploads.id, uploadId),
          eq(lectureAudioUploads.status, 'active'),
          eq(lectureAudioUploads.receivedBytes, expectedOffset),
        ),
      )
      .returning()
    return updated ?? null
  }

  async expireAudioUpload(
    transaction: DatabaseTransaction,
    uploadId: string,
  ): Promise<void> {
    await transaction
      .update(lectureAudioUploads)
      .set({ status: 'expired' })
      .where(
        and(
          eq(lectureAudioUploads.id, uploadId),
          eq(lectureAudioUploads.status, 'active'),
        ),
      )
  }

  async cancelAudioUpload(
    uploadId: string,
  ): Promise<LectureAudioUpload | null> {
    const [updated] = await this.db
      .update(lectureAudioUploads)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(lectureAudioUploads.id, uploadId),
          eq(lectureAudioUploads.status, 'active'),
        ),
      )
      .returning()
    return updated ?? null
  }

  async insertAudio(
    audio: typeof lectureAudio.$inferInsert,
    enqueue: (
      transaction: DatabaseTransaction,
      derivative: LectureAudioDerivative,
    ) => Promise<void>,
    completedUploadId?: string,
    capture?: Omit<
      typeof lectureAudioCaptures.$inferInsert,
      'lectureId' | 'institutionId'
    >,
  ): Promise<{ audio: LectureAudio; dataSaver: LectureAudioDerivative }> {
    return this.db.transaction(async (transaction) => {
      const [stored] = await transaction
        .insert(lectureAudio)
        .values(audio)
        .returning()
      if (!stored) {
        throw new Error('The lecture audio record was not returned.')
      }
      if (capture) {
        await transaction.insert(lectureAudioCaptures).values({
          ...capture,
          lectureId: stored.lectureId,
          institutionId: stored.institutionId,
        })
      }
      const [derivative] = await transaction
        .insert(lectureAudioDerivatives)
        .values({
          lectureId: stored.lectureId,
          institutionId: stored.institutionId,
          sourceSha256: stored.sha256,
        })
        .returning()
      if (!derivative) {
        throw new Error('The lecture derivative record was not returned.')
      }
      await enqueue(transaction, derivative)
      if (completedUploadId) {
        const [completed] = await transaction
          .update(lectureAudioUploads)
          .set({ status: 'completed', completedAt: new Date() })
          .where(
            and(
              eq(lectureAudioUploads.id, completedUploadId),
              eq(lectureAudioUploads.lectureId, stored.lectureId),
              eq(lectureAudioUploads.institutionId, stored.institutionId),
              eq(lectureAudioUploads.status, 'active'),
              eq(lectureAudioUploads.receivedBytes, stored.byteSize),
              eq(lectureAudioUploads.sha256, stored.sha256),
            ),
          )
          .returning({ id: lectureAudioUploads.id })
        if (!completed) {
          throw new AudioUploadStateChangedError(
            'The audio upload session changed during completion.',
          )
        }
      }
      return { audio: stored, dataSaver: derivative }
    })
  }

  async markPublished(
    lectureId: string,
    institutionId: string,
    publishedAt: Date,
  ): Promise<Lecture | null> {
    const [lecture] = await this.db
      .update(lectures)
      .set({ status: 'published', publishedAt })
      .where(
        and(
          eq(lectures.id, lectureId),
          eq(lectures.institutionId, institutionId),
          eq(lectures.status, 'draft'),
        ),
      )
      .returning()
    return lecture ?? null
  }
}
