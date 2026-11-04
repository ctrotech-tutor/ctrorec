import { spawn } from 'node:child_process'

export interface DataSaverTranscodeOptions {
  ffmpegPath: string
  sourcePath: string
  destinationPath: string
  audioBitrate?: 32000 | 48000
  signal?: AbortSignal
}

export async function transcodeDataSaver(
  options: DataSaverTranscodeOptions,
): Promise<void> {
  const arguments_ = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-n',
    '-i',
    options.sourcePath,
    '-map',
    '0:a:0',
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    '-vn',
    '-sn',
    '-dn',
    '-c:a',
    'aac',
    '-b:a',
    String(options.audioBitrate ?? 48_000),
    '-ac',
    '1',
    '-ar',
    '48000',
    '-brand',
    'M4A ',
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    options.destinationPath,
  ]

  await new Promise<void>((resolve, reject) => {
    const child = spawn(options.ffmpegPath, arguments_, {
      signal: options.signal,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-16_384)
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      const detail = stderr.trim()
      reject(
        new Error(
          `FFmpeg exited with ${code === null ? `signal ${signal ?? 'unknown'}` : `code ${code}`}.${detail ? ` ${detail}` : ''}`,
        ),
      )
    })
  })
}
