import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { open, stat } from 'node:fs/promises'

export type SupportedAudioMediaType =
  'audio/mpeg' | 'audio/wav' | 'audio/mp4' | 'audio/webm' | 'audio/ogg'

export interface InspectedAudio {
  byteSize: number
  mediaType: SupportedAudioMediaType
  sha256: string
}

export interface InspectAudioOptions {
  /** Validate containers that can contain video and recognize generic MP4 audio brands. */
  ffprobePath?: string
}

export async function inspectAudio(
  path: string,
  options: InspectAudioOptions = {},
): Promise<InspectedAudio> {
  const details = await stat(path)
  if (!details.isFile() || details.size === 0) {
    throw new Error('The uploaded audio file is empty or invalid.')
  }

  const handle = await open(path, 'r')
  const header = Buffer.alloc(12)
  try {
    await handle.read(header, 0, header.length, 0)
  } finally {
    await handle.close()
  }

  let mediaType = detectAudioMediaType(header)
  const canContainVideo =
    isEbml(header) || isOgg(header) || isMp4Container(header)
  if (options.ffprobePath && canContainVideo) {
    const probe = await probeAudioOnly(options.ffprobePath, path)
    if (!probe.audioOnly) {
      throw new Error('The uploaded file is not an audio-only recording.')
    }
    mediaType = mediaTypeFromContainer(header, probe.formatName)
  }
  if (!mediaType) {
    throw new Error('Unsupported audio signature.')
  }

  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer)
  }

  return {
    byteSize: details.size,
    mediaType,
    sha256: hash.digest('hex'),
  }
}

export function detectAudioMediaType(
  header: Buffer,
): SupportedAudioMediaType | null {
  if (
    header.length >= 12 &&
    header.subarray(0, 4).toString('ascii') === 'RIFF' &&
    header.subarray(8, 12).toString('ascii') === 'WAVE'
  ) {
    return 'audio/wav'
  }
  if (
    header.length >= 12 &&
    header.subarray(4, 8).toString('ascii') === 'ftyp' &&
    header.subarray(8, 12).toString('ascii') === 'M4A '
  ) {
    return 'audio/mp4'
  }
  if (isEbml(header)) {
    return 'audio/webm'
  }
  if (isOgg(header)) {
    return 'audio/ogg'
  }
  if (
    header.length >= 3 &&
    (header.subarray(0, 3).toString('ascii') === 'ID3' ||
      (header[0] === 0xff && ((header[1] ?? 0) & 0xe0) === 0xe0))
  ) {
    return 'audio/mpeg'
  }
  return null
}

function mediaTypeFromContainer(
  header: Buffer,
  formatName: string,
): SupportedAudioMediaType | null {
  const formats = new Set(formatName.split(','))
  if (isEbml(header) && (formats.has('webm') || formats.has('matroska'))) {
    return 'audio/webm'
  }
  if (isOgg(header) && formats.has('ogg')) {
    return 'audio/ogg'
  }
  if (
    isMp4Container(header) &&
    (formats.has('mov') || formats.has('mp4') || formats.has('ismv'))
  ) {
    return 'audio/mp4'
  }
  return null
}

function isEbml(header: Buffer): boolean {
  return (
    header.length >= 4 &&
    header[0] === 0x1a &&
    header[1] === 0x45 &&
    header[2] === 0xdf &&
    header[3] === 0xa3
  )
}

function isOgg(header: Buffer): boolean {
  return (
    header.length >= 4 && header.subarray(0, 4).toString('ascii') === 'OggS'
  )
}

function isMp4Container(header: Buffer): boolean {
  return (
    header.length >= 12 && header.subarray(4, 8).toString('ascii') === 'ftyp'
  )
}

interface ProbeResult {
  audioOnly: boolean
  formatName: string
}

async function probeAudioOnly(
  ffprobePath: string,
  sourcePath: string,
): Promise<ProbeResult> {
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      ffprobePath,
      [
        '-v',
        'error',
        '-show_entries',
        'format=format_name:stream=codec_type',
        '-of',
        'json',
        '--',
        sourcePath,
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 15_000,
      },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout = `${stdout}${chunk}`.slice(0, 65_536)
    })
    child.stderr.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-8_192)
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve(stdout)
        return
      }
      reject(
        new Error(
          `FFprobe exited with ${code === null ? `signal ${signal ?? 'unknown'}` : `code ${code}`}.${stderr.trim() ? ` ${stderr.trim()}` : ''}`,
        ),
      )
    })
  })

  let parsed: unknown
  try {
    parsed = JSON.parse(output)
  } catch {
    throw new Error('FFprobe returned an invalid media inspection result.')
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.streams)) {
    throw new Error('FFprobe returned an incomplete media inspection result.')
  }
  const formatName =
    isRecord(parsed.format) && typeof parsed.format.format_name === 'string'
      ? parsed.format.format_name
      : ''
  const streamTypes = parsed.streams.map((stream: unknown) =>
    isRecord(stream) && typeof stream.codec_type === 'string'
      ? stream.codec_type
      : 'unknown',
  )
  return {
    audioOnly: streamTypes.includes('audio') && !streamTypes.includes('video'),
    formatName,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
