import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { PayloadTooLargeException } from '@nestjs/common'
import type { Request } from 'express'

export function uploadSessionDirectory(root: string, uploadId: string): string {
  return join(root, 'sessions', uploadId)
}

export function uploadChunkPath(directory: string, offset: number): string {
  return join(directory, `${offset}.part`)
}

export async function receiveUploadChunk(
  request: Request,
  directory: string,
  maximumBytes: number,
): Promise<{ path: string; byteSize: number }> {
  await mkdir(directory, { recursive: true })
  const path = join(directory, `${randomUUID()}.incoming`)
  let byteSize = 0
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      byteSize += chunk.length
      if (byteSize > maximumBytes) {
        callback(
          new PayloadTooLargeException(
            'The chunk exceeds the upload session chunk size.',
          ),
        )
        return
      }
      callback(null, chunk)
    },
  })

  try {
    await pipeline(request, meter, createWriteStream(path, { flags: 'wx' }))
    return { path, byteSize }
  } catch (error) {
    await rm(path, { force: true })
    throw error
  }
}

export async function stageUploadChunk(
  incomingPath: string,
  chunkPath: string,
): Promise<void> {
  try {
    const [incoming, existing] = await Promise.all([
      readFile(incomingPath),
      readFile(chunkPath),
    ])
    if (!incoming.equals(existing)) {
      await rm(chunkPath, { force: true })
      await rename(incomingPath, chunkPath)
      return
    }
    await rm(incomingPath, { force: true })
  } catch (error) {
    if (!isMissingFile(error)) {
      throw error
    }
    await rename(incomingPath, chunkPath)
  }
}

export async function assembleUpload(
  directory: string,
  destinationPath: string,
  chunkSize: number,
  totalBytes: number,
): Promise<void> {
  await writeFile(destinationPath, Buffer.alloc(0), { flag: 'wx' })
  try {
    for (let offset = 0; offset < totalBytes; offset += chunkSize) {
      const expectedBytes = Math.min(chunkSize, totalBytes - offset)
      const chunk = await readFile(uploadChunkPath(directory, offset))
      if (chunk.length !== expectedBytes) {
        throw new Error('An upload chunk is incomplete.')
      }
      await appendFile(destinationPath, chunk)
    }
  } catch (error) {
    await rm(destinationPath, { force: true })
    throw error
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}
