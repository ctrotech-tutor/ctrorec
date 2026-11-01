import { randomUUID } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { copyFile, link, mkdir, rm, stat } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import type { Readable } from 'node:stream'

export interface AudioStorage {
  readonly provider: string
  save(key: string, sourcePath: string): Promise<void>
  verify(key: string, expectedSize: number): Promise<void>
  open(
    key: string,
    expectedSize: number,
    start?: number,
    end?: number,
  ): Promise<Readable>
  delete(key: string): Promise<void>
}

export class LocalAudioStorage implements AudioStorage {
  readonly provider = 'local'
  private readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
  }

  async save(key: string, sourcePath: string): Promise<void> {
    const destination = this.resolveKey(key)
    await mkdir(dirname(destination), { recursive: true })
    const staging = `${destination}.${randomUUID()}.upload`

    try {
      await copyFile(sourcePath, staging, constants.COPYFILE_EXCL)
      await link(staging, destination)
    } finally {
      await rm(staging, { force: true })
    }
  }

  async verify(key: string, expectedSize: number): Promise<void> {
    const details = await stat(this.resolveKey(key))
    if (!details.isFile() || details.size !== expectedSize) {
      throw new Error('The stored audio object does not match its metadata.')
    }
  }

  async open(
    key: string,
    expectedSize: number,
    start?: number,
    end?: number,
  ): Promise<Readable> {
    const path = this.resolveKey(key)
    await this.verify(key, expectedSize)
    return createReadStream(path, {
      ...(start === undefined ? {} : { start }),
      ...(end === undefined ? {} : { end }),
    })
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true })
  }

  private resolveKey(key: string): string {
    const path = resolve(this.root, key)
    if (path === this.root || !path.startsWith(`${this.root}${sep}`)) {
      throw new Error('Invalid local audio storage key.')
    }
    return path
  }
}
