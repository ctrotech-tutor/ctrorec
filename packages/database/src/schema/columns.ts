import { sql } from 'drizzle-orm'
import { timestamp, uuid } from 'drizzle-orm/pg-core'

export const uuidPrimaryKey = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`)

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

export const timestamps = () => ({
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})
