import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { z } from 'zod'

export const BACKUP_DATABASE_FILE = 'database.dump'
export const BACKUP_MANIFEST_FILE = 'manifest.json'
export const BACKUP_COMPLETE_FILE = 'COMPLETE'

const sha256 = z.string().regex(/^[0-9a-f]{64}$/)
const mediaObjectSchema = z
  .object({
    id: z.uuid(),
    institutionId: z.uuid(),
    lectureId: z.uuid(),
    kind: z.enum(['original', 'data_saver']),
    storageProvider: z.string().min(1),
    storageKey: z.string().min(1),
    byteSize: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    sha256,
  })
  .strict()

const manifestSchema = z
  .object({
    formatVersion: z.literal(1),
    backupId: z.uuid(),
    createdAt: z.iso.datetime(),
    database: z
      .object({
        dumpFile: z.literal(BACKUP_DATABASE_FILE),
        dumpByteSize: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        dumpSha256: sha256,
        migrationCount: z.number().int().nonnegative(),
        migrationsSha256: sha256,
        excludedSchemas: z
          .array(z.string().regex(/^[a-z_][a-z0-9_]*$/))
          .length(1),
        excludedTableData: z.tuple([z.literal('public.lecture_audio_uploads')]),
      })
      .strict(),
    objects: z.array(mediaObjectSchema),
  })
  .strict()
  .superRefine((manifest, context) => {
    const ids = new Set<string>()
    const keys = new Set<string>()
    for (const [index, object] of manifest.objects.entries()) {
      if (ids.has(object.id)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate media intent ${object.id}.`,
          path: ['objects', index, 'id'],
        })
      }
      if (keys.has(object.storageKey)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate media storage key at object ${index}.`,
          path: ['objects', index, 'storageKey'],
        })
      }
      ids.add(object.id)
      keys.add(object.storageKey)
    }
  })

export type BackupMediaObject = z.infer<typeof mediaObjectSchema>
export type MediaBackupManifest = z.infer<typeof manifestSchema>

export async function writeCompleteManifest(
  directory: string,
  manifest: MediaBackupManifest,
): Promise<void> {
  const validated = manifestSchema.parse(manifest)
  const serialized = `${JSON.stringify(validated, null, 2)}\n`
  await writeFile(join(directory, BACKUP_MANIFEST_FILE), serialized, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  })
  const digest = createHash('sha256').update(serialized).digest('hex')
  await writeFile(join(directory, BACKUP_COMPLETE_FILE), `${digest}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  })
}

export async function readVerifiedManifest(
  directory: string,
): Promise<MediaBackupManifest> {
  let marker: string
  let serialized: string
  try {
    ;[marker, serialized] = await Promise.all([
      readFile(join(directory, BACKUP_COMPLETE_FILE), 'utf8'),
      readFile(join(directory, BACKUP_MANIFEST_FILE), 'utf8'),
    ])
  } catch {
    throw new Error('The backup is incomplete or has no readable manifest.')
  }
  const actualManifestDigest = createHash('sha256')
    .update(serialized)
    .digest('hex')
  if (marker.trim() !== actualManifestDigest) {
    throw new Error('The backup completion marker does not match its manifest.')
  }
  return manifestSchema.parse(JSON.parse(serialized))
}

export async function hashFile(path: string): Promise<string> {
  return hashReadable(createReadStream(path))
}

export async function hashReadable(stream: Readable): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of stream) {
    hash.update(chunk as Buffer)
  }
  return hash.digest('hex')
}

export async function assertFileDigest(
  path: string,
  expectedSize: number,
  expectedSha256: string,
): Promise<void> {
  const details = await stat(path)
  if (!details.isFile() || details.size !== expectedSize) {
    throw new Error(`Backup object has an unexpected size: ${path}`)
  }
  const actualSha256 = await hashFile(path)
  if (actualSha256 !== expectedSha256) {
    throw new Error(`Backup object has an unexpected checksum: ${path}`)
  }
}

export function backupObjectPath(directory: string, intentId: string): string {
  return join(directory, 'objects', intentId)
}
