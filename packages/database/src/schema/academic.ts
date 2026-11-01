import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { timestamps, uuidPrimaryKey } from './columns.js'
import { institutions } from './identity.js'

export const academicUnits = pgTable(
  'academic_units',
  {
    id: uuidPrimaryKey(),
    institutionId: uuid('institution_id').notNull(),
    parentId: uuid('parent_id'),
    kind: text('kind').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    ...timestamps(),
  },
  (table) => [
    unique('academic_units_institution_code_unique').on(
      table.institutionId,
      table.code,
    ),
    unique('academic_units_id_institution_unique').on(
      table.id,
      table.institutionId,
    ),
    index('academic_units_parent_idx').on(table.parentId),
    foreignKey({
      columns: [table.institutionId],
      foreignColumns: [institutions.id],
      name: 'academic_units_institution_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.parentId, table.institutionId],
      foreignColumns: [table.id, table.institutionId],
      name: 'academic_units_parent_fk',
    }).onDelete('restrict'),
    check(
      'academic_units_not_own_parent',
      sql`${table.parentId} IS NULL OR ${table.parentId} <> ${table.id}`,
    ),
    check(
      'academic_units_fields_valid',
      sql`btrim(${table.kind}) <> '' AND btrim(${table.name}) <> '' AND btrim(${table.code}) <> '' AND ${table.code} = upper(btrim(${table.code}))`,
    ),
  ],
)

export const academicTerms = pgTable(
  'academic_terms',
  {
    id: uuidPrimaryKey(),
    institutionId: uuid('institution_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    endsOn: date('ends_on', { mode: 'string' }).notNull(),
    status: text('status').notNull().default('planned'),
    ...timestamps(),
  },
  (table) => [
    unique('academic_terms_institution_code_unique').on(
      table.institutionId,
      table.code,
    ),
    unique('academic_terms_id_institution_unique').on(
      table.id,
      table.institutionId,
    ),
    foreignKey({
      columns: [table.institutionId],
      foreignColumns: [institutions.id],
      name: 'academic_terms_institution_fk',
    }).onDelete('restrict'),
    check(
      'academic_terms_dates_valid',
      sql`${table.endsOn} >= ${table.startsOn}`,
    ),
    check(
      'academic_terms_fields_valid',
      sql`btrim(${table.name}) <> '' AND btrim(${table.code}) <> '' AND ${table.code} = upper(btrim(${table.code}))`,
    ),
    check(
      'academic_terms_status_valid',
      sql`${table.status} IN ('planned', 'active', 'completed', 'archived')`,
    ),
  ],
)

export const courses = pgTable(
  'courses',
  {
    id: uuidPrimaryKey(),
    institutionId: uuid('institution_id').notNull(),
    unitId: uuid('unit_id').notNull(),
    code: text('code').notNull(),
    title: text('title').notNull(),
    ...timestamps(),
  },
  (table) => [
    unique('courses_institution_code_unique').on(
      table.institutionId,
      table.code,
    ),
    unique('courses_id_institution_unique').on(table.id, table.institutionId),
    index('courses_unit_idx').on(table.unitId),
    foreignKey({
      columns: [table.institutionId],
      foreignColumns: [institutions.id],
      name: 'courses_institution_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.unitId, table.institutionId],
      foreignColumns: [academicUnits.id, academicUnits.institutionId],
      name: 'courses_unit_fk',
    }).onDelete('restrict'),
    check(
      'courses_fields_valid',
      sql`btrim(${table.title}) <> '' AND btrim(${table.code}) <> '' AND ${table.code} = upper(btrim(${table.code}))`,
    ),
  ],
)

export const courseOfferings = pgTable(
  'course_offerings',
  {
    id: uuidPrimaryKey(),
    institutionId: uuid('institution_id').notNull(),
    courseId: uuid('course_id').notNull(),
    termId: uuid('term_id').notNull(),
    section: text('section').notNull().default('main'),
    status: text('status').notNull().default('planned'),
    ...timestamps(),
  },
  (table) => [
    unique('course_offerings_course_term_section_unique').on(
      table.institutionId,
      table.courseId,
      table.termId,
      table.section,
    ),
    unique('course_offerings_id_institution_unique').on(
      table.id,
      table.institutionId,
    ),
    index('course_offerings_term_idx').on(table.termId),
    foreignKey({
      columns: [table.institutionId],
      foreignColumns: [institutions.id],
      name: 'course_offerings_institution_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.courseId, table.institutionId],
      foreignColumns: [courses.id, courses.institutionId],
      name: 'course_offerings_course_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.termId, table.institutionId],
      foreignColumns: [academicTerms.id, academicTerms.institutionId],
      name: 'course_offerings_term_fk',
    }).onDelete('restrict'),
    check(
      'course_offerings_section_nonempty',
      sql`btrim(${table.section}) <> ''`,
    ),
    check(
      'course_offerings_status_valid',
      sql`${table.status} IN ('planned', 'active', 'completed', 'archived')`,
    ),
  ],
)
