import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CloudinaryAudioStorage,
  cloudinaryOptionsFromUrl,
  type CloudinaryClient,
} from '../src/cloudinary.js'

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ctrorec-cloudinary-unit-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('Cloudinary audio storage candidate', () => {
  it('uploads audio as an authenticated video resource without overwriting', async () => {
    const client = fakeClient()
    const storage = createStorage(client)
    const source = join(directory, 'source.wav')
    await writeFile(source, 'audio')

    await storage.save('institution/lecture/object.wav', source)

    expect(client.uploader.upload_large).toHaveBeenCalledWith(source, {
      public_id: 'ctrorec-test/institution/lecture/object',
      resource_type: 'video',
      type: 'authenticated',
      overwrite: false,
      unique_filename: false,
      discard_original_filename: true,
    })
  })

  it('streams a validated range through a short-lived server-side URL', async () => {
    const client = fakeClient()
    const fetch = vi.fn(
      async () =>
        new Response(Uint8Array.from([2, 3]), {
          status: 206,
          headers: {
            'Content-Length': '2',
            'Content-Range': 'bytes 1-2/4',
          },
        }),
    )
    const storage = createStorage(client, fetch)

    const stream = await storage.open('institution/lecture/object.wav', 4, 1, 2)
    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk))
    }

    expect(Buffer.concat(chunks)).toEqual(Buffer.from([2, 3]))
    expect(fetch).toHaveBeenCalledWith(
      'https://media.test/signed',
      expect.objectContaining({
        headers: { Range: 'bytes=1-2' },
        redirect: 'follow',
      }),
    )
    expect(client.utils.private_download_url).toHaveBeenCalledWith(
      'ctrorec-test/institution/lecture/object',
      'wav',
      expect.objectContaining({
        type: 'authenticated',
        resource_type: 'video',
      }),
    )
  })

  it('rejects a full response when a range was requested', async () => {
    const storage = createStorage(
      fakeClient(),
      vi.fn(async () => new Response('full', { status: 200 })),
    )

    await expect(
      storage.open('institution/lecture/object.wav', 4, 1, 2),
    ).rejects.toThrow('invalid audio response')
  })

  it('parses credentials without accepting a non-Cloudinary URL', () => {
    expect(
      cloudinaryOptionsFromUrl(
        'cloudinary://key:secret@example-cloud',
        'ctrorec-test',
      ),
    ).toMatchObject({ cloudName: 'example-cloud', apiKey: 'key' })
    expect(() =>
      cloudinaryOptionsFromUrl('https://key:secret@example-cloud', 'test'),
    ).toThrow('Invalid CLOUDINARY_URL.')
  })
})

function fakeClient(): CloudinaryClient {
  return {
    uploader: {
      upload_large: vi.fn(async (_source, options) => ({
        public_id: options.public_id,
        format: 'wav',
        resource_type: 'video',
        type: 'authenticated',
        bytes: 5,
      })),
      destroy: vi.fn(async () => ({ result: 'ok' })),
    },
    api: {
      resource: vi.fn(async (_publicId, options) => ({
        public_id: 'ctrorec-test/institution/lecture/object',
        format: 'wav',
        resource_type: options.resource_type,
        type: options.type,
        bytes: 5,
      })),
    },
    utils: {
      private_download_url: vi.fn(() => 'https://media.test/signed'),
    },
  } as unknown as CloudinaryClient
}

function createStorage(
  client: CloudinaryClient,
  fetch?: typeof globalThis.fetch,
): CloudinaryAudioStorage {
  return new CloudinaryAudioStorage({
    cloudName: 'example-cloud',
    apiKey: 'key',
    apiSecret: 'secret',
    folder: 'ctrorec-test',
    client,
    ...(fetch ? { fetch } : {}),
  })
}
