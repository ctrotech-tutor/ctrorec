export {
  detectAudioMediaType,
  inspectAudio,
  type InspectedAudio,
  type SupportedAudioMediaType,
} from '@ctrorec/media'

export type ByteRange =
  | { kind: 'full' }
  | { kind: 'single'; start: number; end: number }
  | { kind: 'unsatisfiable' }

export function parseByteRange(
  header: string | undefined,
  size: number,
): ByteRange {
  if (!header) {
    return { kind: 'full' }
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || (match[1] === '' && match[2] === '')) {
    return { kind: 'unsatisfiable' }
  }

  const startText = match[1]
  const endText = match[2]
  const start = startText === '' ? null : Number(startText)
  const end = endText === '' ? null : Number(endText)
  if (
    (start !== null && (!Number.isSafeInteger(start) || start < 0)) ||
    (end !== null && (!Number.isSafeInteger(end) || end < 0))
  ) {
    return { kind: 'unsatisfiable' }
  }

  if (start === null) {
    if (end === null || end === 0) {
      return { kind: 'unsatisfiable' }
    }
    return {
      kind: 'single',
      start: Math.max(size - end, 0),
      end: size - 1,
    }
  }

  if (start >= size || (end !== null && start > end)) {
    return { kind: 'unsatisfiable' }
  }

  return {
    kind: 'single',
    start,
    end: Math.min(end ?? size - 1, size - 1),
  }
}
