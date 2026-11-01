import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { v2 as cloudinary } from 'cloudinary'
import {
  CloudinaryAudioStorage,
  cloudinaryOptionsFromUrl,
} from '../src/cloudinary.js'
import { transcodeDataSaver } from '../src/ffmpeg.js'

const acknowledgement = 'DELETE-SYNTHETIC-EVIDENCE-OBJECTS'

async function main(): Promise<void> {
  const connectionUrl = requiredEnvironment('CLOUDINARY_URL')
  const folder = requiredEnvironment('CLOUDINARY_EVIDENCE_FOLDER')
  if (process.env.CLOUDINARY_EVIDENCE_ACK !== acknowledgement) {
    throw new Error(
      `Set CLOUDINARY_EVIDENCE_ACK=${acknowledgement} to allow synthetic evidence uploads and deletion.`,
    )
  }
  if (!folder.startsWith('ctrorec-evidence-')) {
    throw new Error('The evidence folder must start with ctrorec-evidence-.')
  }
  const options = cloudinaryOptionsFromUrl(connectionUrl, folder)
  const storage = new CloudinaryAudioStorage(options)
  cloudinary.config({
    cloud_name: options.cloudName,
    api_key: options.apiKey,
    api_secret: options.apiSecret,
    secure: true,
  })
  const directory = await mkdtemp(join(tmpdir(), 'ctrorec-cloudinary-live-'))
  const originalPath = join(directory, 'original.wav')
  const derivativePath = join(directory, 'derivative.m4a')
  const originalKey = `synthetic/${randomUUID()}.wav`
  const derivativeKey = `synthetic/${randomUUID()}.m4a`
  const saved: string[] = []

  try {
    await writeFile(originalPath, syntheticWav())
    await transcodeDataSaver({
      ffmpegPath: process.env.FFMPEG_BIN ?? 'ffmpeg',
      sourcePath: originalPath,
      destinationPath: derivativePath,
    })
    const original = await readFile(originalPath)
    const derivative = await readFile(derivativePath)

    await storage.save(originalKey, originalPath)
    saved.push(originalKey)
    await storage.save(derivativeKey, derivativePath)
    saved.push(derivativeKey)
    await storage.verify(originalKey, original.length)
    await storage.verify(derivativeKey, derivative.length)

    expectEqual(
      await readObject(storage, originalKey, original.length),
      original,
    )
    expectEqual(
      await readObject(storage, derivativeKey, derivative.length),
      derivative,
    )
    expectEqual(
      await readObject(storage, originalKey, original.length, 10, 109),
      original.subarray(10, 110),
    )
    expectEqual(
      await readObject(storage, derivativeKey, derivative.length, 10, 109),
      derivative.subarray(10, 110),
    )

    const unsigned = [
      await unsignedStatus(originalKey, 'wav'),
      await unsignedStatus(derivativeKey, 'm4a'),
    ]
    await storage.delete(originalKey)
    await storage.delete(derivativeKey)
    await expectRejection(storage.verify(originalKey, original.length))
    await expectRejection(storage.verify(derivativeKey, derivative.length))

    console.log(
      JSON.stringify(
        {
          status: 'passed',
          scope: 'synthetic authenticated original and derivative only',
          originalBytes: original.length,
          derivativeBytes: derivative.length,
          rangeChecks: 2,
          unsignedStatuses: unsigned,
          deletionChecks: 2,
          remainingClaims: [
            'Nest authorization and revocation require an application pilot.',
            'Real-hall quality, Nigerian networks, and unit economics are unmeasured.',
          ],
        },
        null,
        2,
      ),
    )
  } finally {
    for (const key of saved.reverse()) {
      await storage.delete(key).catch(() => undefined)
    }
    await rm(directory, { recursive: true, force: true })
  }
}

async function readObject(
  storage: CloudinaryAudioStorage,
  key: string,
  size: number,
  start?: number,
  end?: number,
): Promise<Buffer> {
  const stream = await storage.open(key, size, start, end)
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

async function unsignedStatus(key: string, format: string): Promise<number> {
  const publicId = `${requiredEnvironment('CLOUDINARY_EVIDENCE_FOLDER')}/${key.replace(/\.[^.]+$/, '')}`
  const url = cloudinary.url(publicId, {
    resource_type: 'video',
    type: 'authenticated',
    format,
    sign_url: false,
    secure: true,
  })
  const response = await fetch(url)
  await response.body?.cancel()
  if (response.ok) {
    throw new Error('Unsigned Cloudinary delivery unexpectedly succeeded.')
  }
  return response.status
}

function syntheticWav(): Buffer {
  const sampleRate = 8_000
  const samples = 8_000
  const dataSize = samples * 2
  const wav = Buffer.alloc(44 + dataSize)
  wav.write('RIFF', 0, 'ascii')
  wav.writeUInt32LE(wav.length - 8, 4)
  wav.write('WAVE', 8, 'ascii')
  wav.write('fmt ', 12, 'ascii')
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36, 'ascii')
  wav.writeUInt32LE(dataSize, 40)
  for (let index = 0; index < samples; index += 1) {
    const sample = Math.round(
      Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 8_000,
    )
    wav.writeInt16LE(sample, 44 + index * 2)
  }
  return wav
}

function expectEqual(actual: Buffer, expected: Buffer): void {
  if (!actual.equals(expected)) {
    throw new Error('Cloudinary delivery bytes did not match the source.')
  }
}

async function expectRejection(operation: Promise<void>): Promise<void> {
  try {
    await operation
  } catch {
    return
  }
  throw new Error('The deleted Cloudinary object is still available.')
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required.`)
  }
  return value
}

void main().catch((error: unknown) => {
  let message = error instanceof Error ? error.message : 'Unknown error'
  const connectionUrl = process.env.CLOUDINARY_URL
  if (connectionUrl) {
    try {
      const { apiSecret } = cloudinaryOptionsFromUrl(
        connectionUrl,
        'ctrorec-evidence-redacted',
      )
      message = message.replaceAll(apiSecret, '[redacted]')
    } catch {
      // Preserve the original safe configuration error.
    }
  }
  console.error(message)
  process.exitCode = 1
})
