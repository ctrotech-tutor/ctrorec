import { readFile } from 'node:fs/promises'
import { expect, test, type Locator, type Page } from '@playwright/test'

test('the web shell connects to the API through the same-origin proxy', async ({
  page,
}) => {
  await page.goto('/')

  await expect(page.getByRole('img', { name: 'ctrorec' })).toBeVisible()
  await expect(
    page.getByRole('heading', {
      name: 'Lecture access, built around the teaching.',
    }),
  ).toBeVisible()
  await expect(page.getByTestId('api-status')).toHaveText('API connected')
})

test('a seeded lecturer can sign in, see membership, and sign out', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByLabel('Email address').fill('lecturer@ctrorec.test')
  await page.getByLabel('Password').fill('Lecturer-Dev-2026!')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()

  await expect(
    page.getByRole('heading', { name: 'Development Lecturer' }),
  ).toBeVisible()
  await expect(page.getByText('Asteria University')).toBeVisible()
  await expect(page.getByText('Academic Staff')).toBeVisible()

  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(
    page.getByRole('heading', { name: 'Sign in to continue' }),
  ).toBeVisible()
})

test('the API exposes its liveness contract', async ({ request }) => {
  const response = await request.get('http://127.0.0.1:3001/api/health')

  expect(response.ok()).toBe(true)
  await expect(response.json()).resolves.toEqual({
    service: 'api',
    status: 'ok',
  })
})

test('a lecturer creates, edits, resumes, and publishes audio for student playback', async ({
  page,
}) => {
  const wav = repeatPcmWav(
    await readFile(
      new URL('../../api/test/fixtures/lecture.wav', import.meta.url),
    ),
    10,
  )
  await page.goto('/')
  await signIn(page, 'lecturer@ctrorec.test', 'Lecturer-Dev-2026!')

  const composer = page.locator('.lecture-composer')
  await composer.getByLabel('Lecture title').fill('Resumable browser lecture')
  await composer.getByLabel('Lecture date and time').fill('2026-10-30T10:00')
  await composer
    .getByLabel('Description')
    .fill('Created through the lecturer workflow.')
  await composer.getByRole('button', { name: 'Create lecture' }).click()

  const createdItem = page.locator('[data-lecture-id]').filter({
    hasText: 'Resumable browser lecture',
  })
  await expect(createdItem).toBeVisible()
  const lectureId = await createdItem.getAttribute('data-lecture-id')
  if (!lectureId) {
    throw new Error('Expected the created lecture identifier.')
  }
  const lecturerItem = page.locator(`[data-lecture-id="${lectureId}"]`)
  await lecturerItem.getByRole('button', { name: 'Edit details' }).click()
  await lecturerItem
    .getByLabel('Lecture title')
    .fill('Resumable browser lecture — edited')
  await lecturerItem.getByRole('button', { name: 'Save details' }).click()
  await expect(
    lecturerItem.getByRole('heading', {
      name: 'Resumable browser lecture — edited',
    }),
  ).toBeVisible()

  let abortedLaterChunk = false
  await page.route('**/api/lectures/*/audio/uploads/*', async (route) => {
    const request = route.request()
    if (
      request.method() === 'PATCH' &&
      request.headers()['upload-offset'] === '16384' &&
      !abortedLaterChunk
    ) {
      abortedLaterChunk = true
      await route.abort('failed')
      return
    }
    await route.continue()
  })
  await lecturerItem.locator('input[type="file"]').setInputFiles({
    name: 'lecture.wav',
    mimeType: 'audio/wav',
    buffer: wav,
  })
  await lecturerItem.getByRole('button', { name: 'Upload recording' }).click()
  await expect(lecturerItem.getByText('Original recording')).toBeVisible()
  expect(abortedLaterChunk).toBe(true)
  await lecturerItem
    .getByRole('button', { name: 'Publish to enrolled students' })
    .click()
  await expect(
    lecturerItem.getByText('published', { exact: true }),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(
    page.getByRole('heading', { name: 'Sign in to continue' }),
  ).toBeVisible()
  await signIn(page, 'student@ctrorec.test', 'Student-Dev-2026!')

  const studentItem = page.locator(`[data-lecture-id="${lectureId}"]`)
  const audio = studentItem.getByTestId(`lecture-audio-${lectureId}`)
  await expect(audio).toBeVisible()
  const source = await audio.getAttribute('src')
  if (!source) {
    throw new Error('Expected the protected audio source.')
  }
  const range = await page.request.get(new URL(source, page.url()).toString(), {
    headers: { Range: 'bytes=0-43' },
  })
  expect(range.status()).toBe(206)
  expect((await range.body()).byteLength).toBe(44)

  await expectAudioToPlayAndSeek(audio)

  const quality = studentItem.getByTestId(`lecture-quality-${lectureId}`)
  const dataSaverOption = quality.locator('option[value="data-saver"]')
  await expect(dataSaverOption).toBeEnabled({ timeout: 20_000 })
  await quality.selectOption('data-saver')
  await expect(audio).toHaveAttribute('src', /\/audio\/data-saver$/)
  const derivativeSource = await audio.getAttribute('src')
  if (!derivativeSource) {
    throw new Error('Expected the protected data-saver source.')
  }
  const derivativeRange = await page.request.get(
    new URL(derivativeSource, page.url()).toString(),
    { headers: { Range: 'bytes=0-43' } },
  )
  expect(derivativeRange.status()).toBe(206)
  expect(derivativeRange.headers()['content-type']).toBe('audio/mp4')
  expect((await derivativeRange.body()).byteLength).toBe(44)
  await expectAudioToPlayAndSeek(audio)
})

function repeatPcmWav(source: Buffer, repetitions: number): Buffer {
  if (
    source.length < 44 ||
    source.toString('ascii', 0, 4) !== 'RIFF' ||
    source.toString('ascii', 8, 12) !== 'WAVE' ||
    source.toString('ascii', 12, 16) !== 'fmt ' ||
    source.toString('ascii', 36, 40) !== 'data'
  ) {
    throw new Error('Expected the canonical PCM test fixture.')
  }
  const samples = source.subarray(44)
  const expanded = Buffer.concat([
    source.subarray(0, 44),
    ...Array.from({ length: repetitions }, () => samples),
  ])
  expanded.writeUInt32LE(expanded.length - 8, 4)
  expanded.writeUInt32LE(expanded.length - 44, 40)
  return expanded
}

async function expectAudioToPlayAndSeek(
  audio: Locator,
  expectedDuration?: number,
): Promise<void> {
  await audio.evaluate(async (element) => {
    const media = element as HTMLAudioElement
    if (media.readyState < 1) {
      await new Promise<void>((resolve, reject) => {
        media.addEventListener('loadedmetadata', () => resolve(), {
          once: true,
        })
        media.addEventListener(
          'error',
          () => reject(new Error('The browser could not decode the audio.')),
          { once: true },
        )
        media.load()
      })
    }
  })
  const duration = await audio.evaluate((element) => {
    const media = element as HTMLAudioElement
    return media.duration
  })
  if (expectedDuration === undefined) {
    expect(duration).toBeGreaterThan(0.2)
  } else {
    expect(duration).toBeCloseTo(expectedDuration, 2)
  }

  await audio.evaluate(async (element) => {
    const media = element as HTMLAudioElement
    const seeked = new Promise<void>((resolve) => {
      media.addEventListener('seeked', () => resolve(), { once: true })
    })
    media.currentTime = 0.1
    await seeked
    await media.play()
    if (!media.ended) {
      await new Promise<void>((resolve, reject) => {
        media.addEventListener('ended', () => resolve(), { once: true })
        media.addEventListener(
          'error',
          () => reject(new Error('Audio playback failed.')),
          { once: true },
        )
      })
    }
  })
  expect(
    await audio.evaluate((element) => {
      const media = element as HTMLAudioElement
      return media.currentTime
    }),
  ).toBeGreaterThan(0.2)
}

async function signIn(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Course lectures' }),
  ).toBeVisible()
}
