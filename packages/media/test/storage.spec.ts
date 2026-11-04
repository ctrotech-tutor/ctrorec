import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalAudioStorage } from '../src/storage.js'

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ctrorec-local-storage-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('local audio lifecycle cleanup', () => {
  it('saves without overwriting and deletes both final and incomplete writes', async () => {
    const root = join(directory, 'audio')
    const source = join(directory, 'source.wav')
    const key = 'institution/lecture/intent.wav'
    const destination = join(root, key)
    await writeFile(source, 'original audio')
    const storage = new LocalAudioStorage(root)

    await storage.save(key, source)
    await expect(readFile(destination, 'utf8')).resolves.toBe('original audio')
    await expect(storage.save(key, source)).rejects.toThrow()
    await expect(readFile(destination, 'utf8')).resolves.toBe('original audio')

    await mkdir(dirname(destination), { recursive: true })
    await writeFile(`${destination}.upload`, 'partial replacement')
    await storage.delete(key)

    await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(`${destination}.upload`)).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(storage.delete(key)).resolves.toBeUndefined()
  })
})
