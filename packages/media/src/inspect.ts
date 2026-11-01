import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open, stat } from 'node:fs/promises'

export type SupportedAudioMediaType = 'audio/mpeg' | 'audio/wav' | 'audio/mp4'

export interface InspectedAudio {
  byteSize: number
  mediaType: SupportedAudioMediaType
  sha256: string
}

export async function inspectAudio(path: string): Promise<InspectedAudio> {
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

  const mediaType = detectAudioMediaType(header)
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
  if (
    header.length >= 3 &&
    (header.subarray(0, 3).toString('ascii') === 'ID3' ||
      (header[0] === 0xff && ((header[1] ?? 0) & 0xe0) === 0xe0))
  ) {
    return 'audio/mpeg'
  }
  return null
}
