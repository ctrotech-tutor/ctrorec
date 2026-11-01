import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { v2 as cloudinary } from 'cloudinary'
import type { AudioStorage } from './storage.js'

interface CloudinaryUploadResult {
  public_id: string
  format: string
  resource_type: string
  type: string
  bytes: number
}

type CloudinaryResourceResult = CloudinaryUploadResult

export interface CloudinaryClient {
  uploader: {
    upload_large(
      sourcePath: string,
      options: Record<string, unknown>,
    ): Promise<CloudinaryUploadResult>
    destroy(
      publicId: string,
      options: Record<string, unknown>,
    ): Promise<{ result: string }>
  }
  api: {
    resource(
      publicId: string,
      options: Record<string, unknown>,
    ): Promise<CloudinaryResourceResult>
  }
  utils: {
    private_download_url(
      publicId: string,
      format: string,
      options: Record<string, unknown>,
    ): string
  }
}

export interface CloudinaryAudioStorageOptions {
  cloudName: string
  apiKey: string
  apiSecret: string
  folder: string
  client?: CloudinaryClient
  fetch?: typeof globalThis.fetch
}

export class CloudinaryAudioStorage implements AudioStorage {
  readonly provider = 'cloudinary'
  private readonly client: CloudinaryClient
  private readonly folder: string
  private readonly fetch: typeof globalThis.fetch

  constructor(options: CloudinaryAudioStorageOptions) {
    if (
      !options.cloudName ||
      !options.apiKey ||
      !options.apiSecret ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(options.folder)
    ) {
      throw new Error('Invalid Cloudinary audio storage configuration.')
    }
    this.folder = options.folder
    this.fetch = options.fetch ?? globalThis.fetch
    if (options.client) {
      this.client = options.client
    } else {
      cloudinary.config({
        cloud_name: options.cloudName,
        api_key: options.apiKey,
        api_secret: options.apiSecret,
        secure: true,
      })
      this.client = cloudinary as unknown as CloudinaryClient
    }
  }

  async save(key: string, sourcePath: string): Promise<void> {
    const asset = this.asset(key)
    const source = await stat(sourcePath)
    if (!source.isFile() || source.size === 0) {
      throw new Error('The Cloudinary source must be a non-empty file.')
    }
    const result = await this.client.uploader.upload_large(sourcePath, {
      public_id: asset.publicId,
      resource_type: 'video',
      type: 'authenticated',
      overwrite: false,
      unique_filename: false,
      discard_original_filename: true,
    })
    if (
      result.public_id !== asset.publicId ||
      result.format !== asset.format ||
      result.resource_type !== 'video' ||
      result.type !== 'authenticated' ||
      result.bytes !== source.size
    ) {
      throw new Error('Cloudinary returned inconsistent audio metadata.')
    }
  }

  async verify(key: string, expectedSize: number): Promise<void> {
    const asset = this.asset(key)
    const result = await this.client.api.resource(asset.publicId, {
      resource_type: 'video',
      type: 'authenticated',
    })
    if (
      result.public_id !== asset.publicId ||
      result.format !== asset.format ||
      result.resource_type !== 'video' ||
      result.type !== 'authenticated' ||
      result.bytes !== expectedSize
    ) {
      throw new Error(
        'The Cloudinary audio object does not match its metadata.',
      )
    }
  }

  async open(
    key: string,
    expectedSize: number,
    start?: number,
    end?: number,
  ): Promise<Readable> {
    const asset = this.asset(key)
    const ranged = start !== undefined || end !== undefined
    const rangeStart = start ?? 0
    const rangeEnd = end ?? expectedSize - 1
    if (
      !Number.isSafeInteger(expectedSize) ||
      expectedSize <= 0 ||
      !Number.isSafeInteger(rangeStart) ||
      !Number.isSafeInteger(rangeEnd) ||
      rangeStart < 0 ||
      rangeEnd < rangeStart ||
      rangeEnd >= expectedSize
    ) {
      throw new Error('Invalid Cloudinary audio byte range.')
    }
    const url = this.client.utils.private_download_url(
      asset.publicId,
      asset.format,
      {
        resource_type: 'video',
        type: 'authenticated',
        expires_at: Math.floor(Date.now() / 1000) + 60,
      },
    )
    const controller = new AbortController()
    const headersTimeout = setTimeout(() => controller.abort(), 30_000)
    headersTimeout.unref()
    let response: Response
    try {
      response = await this.fetch(url, {
        ...(ranged
          ? { headers: { Range: `bytes=${rangeStart}-${rangeEnd}` } }
          : {}),
        redirect: 'follow',
        signal: controller.signal,
      })
    } finally {
      clearTimeout(headersTimeout)
    }
    const expectedLength = rangeEnd - rangeStart + 1
    const contentLength = response.headers.get('content-length')
    const valid =
      response.status === (ranged ? 206 : 200) &&
      (!ranged ||
        response.headers.get('content-range') ===
          `bytes ${rangeStart}-${rangeEnd}/${expectedSize}`) &&
      (contentLength === null || Number(contentLength) === expectedLength) &&
      response.body !== null
    if (!valid) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error(
        `Cloudinary returned an invalid audio response (${response.status}).`,
      )
    }
    return Readable.fromWeb(response.body as unknown as NodeReadableStream)
  }

  async delete(key: string): Promise<void> {
    const asset = this.asset(key)
    const result = await this.client.uploader.destroy(asset.publicId, {
      resource_type: 'video',
      type: 'authenticated',
      invalidate: true,
    })
    if (!['ok', 'not found'].includes(result.result)) {
      throw new Error('Cloudinary did not delete the audio object.')
    }
  }

  private asset(key: string): { publicId: string; format: string } {
    const match = /^([A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)\.(mp3|wav|m4a)$/.exec(
      key,
    )
    if (!match?.[1] || !match[2]) {
      throw new Error('Invalid Cloudinary audio storage key.')
    }
    return {
      publicId: `${this.folder}/${match[1]}`,
      format: match[2],
    }
  }
}

export function cloudinaryOptionsFromUrl(
  connectionUrl: string,
  folder: string,
): CloudinaryAudioStorageOptions {
  const url = new URL(connectionUrl)
  if (
    url.protocol !== 'cloudinary:' ||
    !url.hostname ||
    !url.username ||
    !url.password ||
    (url.pathname && url.pathname !== '/') ||
    url.search
  ) {
    throw new Error('Invalid CLOUDINARY_URL.')
  }
  return {
    cloudName: url.hostname,
    apiKey: decodeURIComponent(url.username),
    apiSecret: decodeURIComponent(url.password),
    folder,
  }
}
