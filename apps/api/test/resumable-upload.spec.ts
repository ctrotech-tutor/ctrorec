import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assembleUpload,
  quarantineUploadPath,
  stageUploadChunk,
  uploadChunkPath,
} from '../src/lectures/resumable-upload.js'

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ctrorec-upload-unit-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('resumable upload files', () => {
  it('reuses an identical orphan and replaces a different uncommitted chunk', async () => {
    const part = uploadChunkPath(directory, 0)
    const first = join(directory, 'first.incoming')
    await writeFile(first, 'first')
    await stageUploadChunk(first, part)
    expect(await readFile(part, 'utf8')).toBe('first')

    const identical = join(directory, 'identical.incoming')
    await writeFile(identical, 'first')
    await stageUploadChunk(identical, part)
    await expect(readFile(identical)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(part, 'utf8')).toBe('first')

    const changed = join(directory, 'changed.incoming')
    await writeFile(changed, 'changed')
    await stageUploadChunk(changed, part)
    expect(await readFile(part, 'utf8')).toBe('changed')
  })

  it('quarantines a path before removal and tolerates a concurrent winner', async () => {
    const source = join(directory, 'sessions', 'upload-id')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, '0.part'), 'audio')

    const outcomes = await Promise.all([
      quarantineUploadPath(directory, source),
      quarantineUploadPath(directory, source),
    ])
    expect(outcomes.sort()).toEqual([false, true])
    await expect(readFile(join(source, '0.part'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect(await quarantineUploadPath(directory, source)).toBe(false)
    expect(await readdir(join(directory, 'trash'))).toEqual([])
  })

  it('assembles ordered chunks and removes an incomplete result', async () => {
    await writeFile(uploadChunkPath(directory, 0), 'abcd')
    await writeFile(uploadChunkPath(directory, 4), 'efg')
    const destination = join(directory, 'complete.audio')
    await assembleUpload(directory, destination, 4, 7)
    expect(await readFile(destination, 'utf8')).toBe('abcdefg')

    const incomplete = join(directory, 'incomplete.audio')
    await expect(assembleUpload(directory, incomplete, 4, 11)).rejects.toThrow()
    await expect(readFile(incomplete)).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })
})
