import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createConfiguredAudioStorage } from '@ctrorec/media/configured'
import { LocalAudioStorage } from '@ctrorec/media'
import {
  createMediaBackup,
  restoreMediaBackup,
} from '../backup/media-backup.js'

loadEnvironment()
process.umask(0o077)

async function main(): Promise<void> {
  const command = process.argv[2]
  if (command === 'create') {
    const cloudinaryUrl = process.env.CLOUDINARY_URL
    const storage = createConfiguredAudioStorage({
      provider: configuredProvider(),
      localRoot: resolve(process.env.AUDIO_STORAGE_ROOT ?? '../../.data/audio'),
      cloudinaryFolder: process.env.CLOUDINARY_FOLDER ?? 'ctrorec',
      ...(cloudinaryUrl ? { cloudinaryUrl } : {}),
    })
    const result = await createMediaBackup({
      sourceDatabaseUrl: required('DATABASE_URL'),
      storage,
      backupRoot: resolve(process.env.BACKUP_ROOT ?? '../../.data/backups'),
      queueSchema: process.env.QUEUE_SCHEMA ?? 'pgboss',
      ...(process.env.PG_DUMP_BIN
        ? { pgDumpPath: process.env.PG_DUMP_BIN }
        : {}),
    })
    console.log(
      JSON.stringify({
        backupId: result.backupId,
        directory: result.directory,
        mediaObjects: result.mediaObjects,
        mediaBytes: result.mediaBytes,
      }),
    )
    return
  }

  if (command === 'restore-drill') {
    const backupDirectory = process.argv
      .slice(3)
      .find((argument) => argument !== '--')
    if (!backupDirectory) {
      throw new Error('Usage: backup.ts restore-drill <backup-directory>')
    }
    if (process.env.BACKUP_RESTORE_ACK !== 'RESTORE-INTO-EMPTY-LOCAL-TARGET') {
      throw new Error(
        'Set BACKUP_RESTORE_ACK=RESTORE-INTO-EMPTY-LOCAL-TARGET for the guarded drill.',
      )
    }
    const targetRoot = resolve(required('BACKUP_RESTORE_STORAGE_ROOT'))
    if (
      targetRoot ===
      resolve(process.env.AUDIO_STORAGE_ROOT ?? '../../.data/audio')
    ) {
      throw new Error('Restore storage must differ from the source audio root.')
    }
    await assertEmptyTargetDirectory(targetRoot)
    const result = await restoreMediaBackup({
      backupDirectory,
      targetDatabaseUrl: required('BACKUP_RESTORE_DATABASE_URL'),
      targetStorage: new LocalAudioStorage(targetRoot),
      ...(process.env.PG_RESTORE_BIN
        ? { pgRestorePath: process.env.PG_RESTORE_BIN }
        : {}),
    })
    console.log(JSON.stringify(result))
    return
  }

  throw new Error('Usage: backup.ts create | restore-drill <backup-directory>')
}

function configuredProvider(): 'local' | 'cloudinary' {
  const provider = process.env.AUDIO_STORAGE_PROVIDER ?? 'local'
  if (provider !== 'local' && provider !== 'cloudinary') {
    throw new Error('AUDIO_STORAGE_PROVIDER must be local or cloudinary.')
  }
  return provider
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required.`)
  }
  return value
}

async function assertEmptyTargetDirectory(path: string): Promise<void> {
  try {
    const details = await stat(path)
    if (!details.isDirectory()) {
      throw new Error('BACKUP_RESTORE_STORAGE_ROOT must be a directory.')
    }
    if ((await readdir(path)).length > 0) {
      throw new Error('BACKUP_RESTORE_STORAGE_ROOT must be empty.')
    }
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return
    }
    throw error
  }
}

function loadEnvironment(): void {
  const path = ['../../.env.local', '../../.env', '.env.local', '.env'].find(
    (candidate) => existsSync(candidate),
  )
  if (path) {
    process.loadEnvFile(path)
  }
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
