import { readFile } from 'node:fs/promises'
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test'

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

test('a lecturer creates, edits, resumes, records, and publishes audio for student playback', async ({
  page,
}) => {
  test.setTimeout(75_000)
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
  let capturedUploadId: string | null = null
  let abortedCapturedChunk = false
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
    if (
      request.method() === 'PATCH' &&
      capturedUploadId &&
      request.url().includes(`/lectures/${capturedUploadId}/`) &&
      request.headers()['upload-offset'] === '0' &&
      !abortedCapturedChunk
    ) {
      abortedCapturedChunk = true
      await route.abort('failed')
      return
    }
    await route.continue()
  })
  await lecturerItem.getByRole('button', { name: 'Upload audio' }).click()
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

  await composer.getByLabel('Lecture title').fill('Browser captured lecture')
  await composer.getByLabel('Lecture date and time').fill('2026-10-30T12:00')
  await composer.getByRole('button', { name: 'Create lecture' }).click()
  const capturedItem = page.locator('[data-lecture-id]').filter({
    hasText: 'Browser captured lecture',
  })
  await expect(capturedItem).toBeVisible()
  const capturedLectureId = await capturedItem.getAttribute('data-lecture-id')
  if (!capturedLectureId) {
    throw new Error('Expected the captured lecture identifier.')
  }
  capturedUploadId = capturedLectureId
  const captureStart = capturedItem.getByRole('button', {
    name: 'Start audio recording',
  })
  await expect(captureStart).toBeDisabled()
  await capturedItem.getByRole('checkbox').check()
  await expect(captureStart).toBeEnabled()
  await captureStart.click()
  await expect(
    capturedItem.getByText('Recording', { exact: true }),
  ).toBeVisible()
  await expect
    .poll(async () =>
      capturedItem
        .getByTestId(`capture-bytes-${capturedLectureId}`)
        .textContent(),
    )
    .not.toContain('0 B ·')
  await capturedItem.getByRole('button', { name: 'Pause recording' }).click()
  await expect(
    capturedItem.getByText('Recording paused', { exact: true }),
  ).toBeVisible()
  await capturedItem.getByRole('button', { name: 'Resume recording' }).click()
  await page.waitForTimeout(1_200)
  await capturedItem.getByRole('button', { name: 'Stop and review' }).click()
  const localReview = capturedItem.getByLabel('Review local lecture recording')
  await expect(localReview).toBeVisible()
  await localReview.evaluate(async (audio: HTMLAudioElement) => {
    await audio.play()
    await new Promise((resolve) => setTimeout(resolve, 150))
    if (audio.currentTime <= 0) {
      throw new Error('The captured browser draft did not play.')
    }
    audio.pause()
  })

  await page.reload()
  const recoveredItem = page.locator(`[data-lecture-id="${capturedLectureId}"]`)
  await expect(recoveredItem.getByText('Local draft ready')).toBeVisible()
  await expect(
    recoveredItem.getByLabel('Review local lecture recording'),
  ).toBeVisible()
  const captureReference = await recoveredItem
    .locator('.capture-reference code')
    .textContent()
  expect(captureReference).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  )
  await recoveredItem
    .getByRole('button', { name: 'Upload captured audio' })
    .click()
  await expect(recoveredItem.getByText('Original recording')).toBeVisible()
  expect(abortedCapturedChunk).toBe(true)
  await expect(recoveredItem.getByText(/\.webm ·/)).toBeVisible()
  const capturedAudio = recoveredItem.getByTestId(
    `lecture-audio-${capturedLectureId}`,
  )
  const capturedSource = await capturedAudio.getAttribute('src')
  if (!capturedSource) {
    throw new Error('Expected the protected captured-audio source.')
  }
  const capturedRange = await page.request.get(
    new URL(capturedSource, page.url()).toString(),
    { headers: { Range: 'bytes=0-3' } },
  )
  expect(capturedRange.status()).toBe(206)
  expect(capturedRange.headers()['content-type']).toBe('audio/webm')
  expect([...new Uint8Array(await capturedRange.body())]).toEqual([
    0x1a, 0x45, 0xdf, 0xa3,
  ])
  const capturedQuality = recoveredItem.getByTestId(
    `lecture-quality-${capturedLectureId}`,
  )
  await expect(
    capturedQuality.locator('option[value="data-saver"]'),
  ).toHaveText(/^Data saver ·/, { timeout: 20_000 })
  await capturedQuality.selectOption('data-saver')
  await expect(capturedAudio).toHaveAttribute('src', /\/audio\/data-saver$/)
  await expectAudioToPlayAndSeek(capturedAudio)

  await page.getByRole('button', { name: 'Administration' }).click()
  const evidenceSection = page.getByRole('region', {
    name: 'Capture evidence',
  })
  const downloadEvent = page.waitForEvent('download')
  await evidenceSection
    .getByRole('link', { name: 'Download capture evidence CSV' })
    .click()
  const download = await downloadEvent
  const downloadPath = await download.path()
  if (!downloadPath || !captureReference) {
    throw new Error('Expected the capture evidence download and reference.')
  }
  const evidenceRecords = (await readFile(downloadPath, 'utf8'))
    .trimEnd()
    .split('\r\n')
  const evidenceHeader = parseCsvRecord(evidenceRecords[0] ?? '')
  const capturedEvidenceRecord = evidenceRecords.find((record) =>
    record.includes(captureReference),
  )
  if (!capturedEvidenceRecord) {
    throw new Error('Expected the captured lecture in the evidence export.')
  }
  const capturedEvidence = parseCsvRecord(capturedEvidenceRecord)
  expect(capturedEvidence[evidenceHeader.indexOf('upload_retry_count')]).toBe(
    '1',
  )
  expect(capturedEvidence[evidenceHeader.indexOf('lecture_id')]).toBe(
    capturedLectureId,
  )
  await page.getByRole('button', { name: 'Course lectures' }).click()
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
  await expect(dataSaverOption).toHaveText(/^Data saver ·/, {
    timeout: 20_000,
  })
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

test('an institution admin creates structure and controls student roster access', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto('/')
  await signIn(page, 'lecturer@ctrorec.test', 'Lecturer-Dev-2026!')
  await page.getByRole('button', { name: 'Administration' }).click()
  await expect(
    page.getByRole('heading', { name: 'Academic administration' }),
  ).toBeVisible()

  const units = page.getByRole('region', { name: 'Academic units' })
  const addUnit = units.locator('.admin-create')
  await addUnit.locator('summary').click()
  await addUnit.getByLabel('Code', { exact: true }).fill('SCI')
  await addUnit.getByLabel('Kind', { exact: true }).fill('faculty')
  await addUnit.getByLabel('Name', { exact: true }).fill('Science')
  await addUnit.getByRole('button', { name: 'Create unit' }).click()
  await expect(units.getByText('SCI', { exact: true })).toBeVisible()

  const terms = page.getByRole('region', { name: 'Academic terms' })
  const addTerm = terms.locator('.admin-create')
  await addTerm.locator('summary').click()
  await addTerm.getByLabel('Code', { exact: true }).fill('2027-TEST')
  await addTerm.getByLabel('Name', { exact: true }).fill('Evidence Term')
  await addTerm.getByLabel('Starts', { exact: true }).fill('2027-01-01')
  await addTerm.getByLabel('Ends', { exact: true }).fill('2027-06-30')
  await addTerm
    .getByRole('combobox', { name: 'Status', exact: true })
    .selectOption('active')
  await addTerm.getByRole('button', { name: 'Create term' }).click()
  await expect(
    terms.locator('.admin-record').filter({ hasText: '2027-TEST' }),
  ).toBeVisible()

  const courses = page.getByRole('region', { name: 'Courses', exact: true })
  const addCourse = courses.locator('.admin-create')
  await addCourse.locator('summary').click()
  await addCourse
    .getByRole('combobox', { name: 'Academic unit', exact: true })
    .selectOption({ label: 'SCI · Science' })
  await addCourse.getByLabel('Course code', { exact: true }).fill('SCI101')
  await addCourse
    .getByLabel('Course title', { exact: true })
    .fill('Experimental Science')
  await addCourse.getByRole('button', { name: 'Create course' }).click()
  await expect(
    courses.locator('.admin-record').filter({ hasText: 'SCI101' }),
  ).toBeVisible()

  const offerings = page.getByRole('region', { name: 'Course offerings' })
  const addOffering = offerings.locator('.admin-create')
  await addOffering.locator('summary').click()
  await addOffering
    .getByRole('combobox', { name: 'Course', exact: true })
    .selectOption({ label: 'SCI101 · Experimental Science' })
  await addOffering
    .getByRole('combobox', { name: 'Academic term', exact: true })
    .selectOption({ label: '2027-TEST · Evidence Term' })
  await addOffering.getByLabel('Section', { exact: true }).fill('B')
  await addOffering
    .getByRole('combobox', { name: 'Status', exact: true })
    .selectOption('active')
  await addOffering.getByRole('button', { name: 'Schedule offering' }).click()
  const offering = offerings
    .locator('.admin-record-summary strong')
    .getByText('SCI101', { exact: true })
    .locator('../..')
  await expect(offering).toBeVisible()
  await offering.getByRole('button', { name: 'Manage roster' }).click()

  const roster = page.locator('.roster-panel')
  await expect(
    roster.getByRole('heading', { name: 'SCI101 · Section B' }),
  ).toBeVisible()
  await roster
    .getByRole('combobox', { name: 'Assign academic staff', exact: true })
    .selectOption({ label: 'Development Lecturer · lecturer@ctrorec.test' })
  await roster.getByRole('button', { name: 'Assign lecturer' }).click()
  await expect(
    roster.locator('.roster-entry').filter({ hasText: 'Development Lecturer' }),
  ).toBeVisible()
  await roster
    .getByRole('combobox', { name: 'Enroll a student', exact: true })
    .selectOption({ label: 'Development Student · student@ctrorec.test' })
  await roster.getByRole('button', { name: 'Enroll student' }).click()
  await expect(
    roster.locator('.roster-entry').filter({ hasText: 'Development Student' }),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(
    page.getByRole('heading', { name: 'Sign in to continue' }),
  ).toBeVisible()
  await signIn(page, 'student@ctrorec.test', 'Student-Dev-2026!')
  await page
    .getByRole('combobox', { name: 'Current course', exact: true })
    .selectOption({ label: 'SCI101 · Section B' })
  await expect(
    page.getByText('SCI101 · Experimental Science', { exact: true }),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(
    page.getByRole('heading', { name: 'Sign in to continue' }),
  ).toBeVisible()
  await signIn(page, 'lecturer@ctrorec.test', 'Lecturer-Dev-2026!')
  await page.getByRole('button', { name: 'Administration' }).click()
  await offering.getByRole('button', { name: 'Manage roster' }).click()
  const studentEntry = page
    .locator('.roster-entry')
    .filter({ hasText: 'Development Student' })
  await studentEntry.getByRole('button', { name: 'End access' }).click()
  await expect(studentEntry.getByText(/closed/)).toBeVisible()
  await expect(page.getByText('0 current', { exact: true })).toBeVisible()
  await expect(
    page.getByText('No student enrollments yet.', { exact: true }),
  ).toHaveCount(0)

  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(
    page.getByRole('heading', { name: 'Sign in to continue' }),
  ).toBeVisible()
  await signIn(page, 'student@ctrorec.test', 'Student-Dev-2026!')
  await expect(
    page.getByText('SCI101 · Experimental Science', { exact: true }),
  ).toHaveCount(0)
})

test('an institution admin invites a person who accepts and signs in without public registration', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000)
  const email = 'browser.invitee@example.test'
  const password = 'Browser-Invitee-2026!'
  await page.goto('/')
  await signIn(page, 'lecturer@ctrorec.test', 'Lecturer-Dev-2026!')
  await page.getByRole('button', { name: 'Administration' }).click()

  const invitations = page.getByRole('region', {
    name: 'Invitations',
    exact: true,
  })
  await invitations.locator('summary').click()
  await invitations.getByLabel('Email address', { exact: true }).fill(email)
  await invitations
    .getByLabel('Full name', { exact: true })
    .fill('Invited Browser Student')
  await invitations.getByRole('button', { name: 'Create invitation' }).click()
  const linkInput = invitations.getByLabel('Single-use invitation link', {
    exact: true,
  })
  await expect(linkInput).toBeVisible()
  const invitationUrl = await linkInput.inputValue()
  const parsedUrl = new URL(invitationUrl)
  expect(parsedUrl.pathname).toBe('/accept-invite')
  expect(parsedUrl.search).toBe('')
  expect(parsedUrl.hash).toMatch(/^#token=.+/)
  const token = parsedUrl.hash.slice('#token='.length)

  const inviteeContext = await browser.newContext()
  try {
    const invitee = await inviteeContext.newPage()
    await invitee.goto(invitationUrl)
    await expect(invitee).toHaveURL(/\/accept-invite$/)
    await expect(
      invitee.getByRole('heading', {
        name: 'Welcome, Invited Browser Student.',
      }),
    ).toBeVisible()
    await invitee
      .getByLabel('Choose a password', { exact: true })
      .fill(password)
    await invitee.getByLabel('Confirm password', { exact: true }).fill(password)
    await invitee
      .getByRole('button', { name: 'Accept invitation', exact: true })
      .click()
    await expect(
      invitee.getByRole('heading', { name: 'You can now sign in.' }),
    ).toBeVisible()
    await invitee.getByRole('link', { name: 'Continue to sign in' }).click()
    await signIn(invitee, email, password)
    await expect(invitee.getByText('Asteria University')).toBeVisible()
    await expect(invitee.getByText('Student', { exact: true })).toBeVisible()
    await expect(
      invitee.getByText(
        'No current course assignments or enrollments are available.',
      ),
    ).toBeVisible()
    await expect(
      invitee.getByRole('button', { name: 'Administration' }),
    ).toHaveCount(0)
  } finally {
    await inviteeContext.close()
  }

  await page.reload()
  await page.getByRole('button', { name: 'Administration' }).click()
  const acceptedRecord = invitations
    .locator('.invitation-record')
    .filter({ hasText: email })
  await expect(acceptedRecord.locator('.invitation-status')).toHaveText(
    'accepted',
  )
  await expect(
    invitations.getByLabel('Single-use invitation link', { exact: true }),
  ).toHaveCount(0)
  expect(await page.content()).not.toContain(token)
})

test('an account owner resets through a real SMTP-captured one-time link', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000)
  const newPassword = 'SMTP-Recovered-2026!'
  await page.goto('/')
  await signIn(page, 'student@ctrorec.test', 'Student-Dev-2026!')

  const cleanContext = await browser.newContext({
    baseURL: 'http://127.0.0.1:3000',
  })
  const recovery = await cleanContext.newPage()
  try {
    await recovery.goto('/')
    await recovery.getByRole('link', { name: 'Forgot your password?' }).click()
    await expect(
      recovery.getByRole('heading', {
        name: 'Recover access to your account.',
      }),
    ).toBeVisible()
    await recovery.getByLabel('Email address').fill('student@ctrorec.test')
    await recovery
      .getByRole('button', { name: 'Request a recovery link' })
      .click()
    await expect(
      recovery.getByRole('heading', { name: 'Check your email.' }),
    ).toBeVisible()
    await expect(
      recovery.getByText(
        'If an active account matches that email, a recovery link will be sent.',
      ),
    ).toBeVisible()

    const message = await waitForRecoveryEmail(
      recovery.request,
      'student@ctrorec.test',
    )
    expect(message.subject).toBe('Reset your ctrorec password')
    const resetUrl = new URL(message.url)
    const token = new URLSearchParams(resetUrl.hash.slice(1)).get('token')
    if (!token) {
      throw new Error('Expected the emailed fragment token.')
    }

    await recovery.goto(message.url)
    await expect(
      recovery.getByRole('heading', { name: 'Choose a new password.' }),
    ).toBeVisible()
    expect(recovery.url()).not.toContain('token=')
    expect(await recovery.content()).not.toContain(token)
    await recovery.getByLabel('New password', { exact: true }).fill(newPassword)
    await recovery
      .getByLabel('Confirm new password')
      .fill('Different-Password-2026!')
    await recovery.getByRole('button', { name: 'Reset password' }).click()
    await expect(
      recovery.getByText('The password confirmation does not match.'),
    ).toBeVisible()
    await recovery.getByLabel('Confirm new password').fill(newPassword)
    await recovery.getByRole('button', { name: 'Reset password' }).click()
    await expect(
      recovery.getByRole('heading', {
        name: 'Your password has been reset.',
      }),
    ).toBeVisible()

    expect((await recovery.request.get('/api/auth/me')).status()).toBe(401)
    expect((await page.request.get('/api/auth/me')).status()).toBe(401)
    const reused = await cleanContext.newPage()
    await reused.goto(message.url)
    await expect(
      reused.getByRole('heading', { name: 'This link cannot be used.' }),
    ).toBeVisible()
    await reused.close()
    await recovery.goto('/')
    await signIn(recovery, 'student@ctrorec.test', newPassword)
    await expect(recovery.getByText('Asteria University')).toBeVisible()
  } finally {
    await cleanContext.close()
  }
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

async function waitForRecoveryEmail(
  request: APIRequestContext,
  email: string,
): Promise<{ subject: string; url: string }> {
  let captured: { subject: string; url: string } | null = null
  await expect
    .poll(
      async () => {
        const response = await request.get('http://127.0.0.1:2526/messages')
        if (!response.ok()) {
          return null
        }
        const messages = (await response.json()) as Array<{
          to: string[]
          subject: string
          text: string
        }>
        const message = messages.find((candidate) =>
          candidate.to.includes(email),
        )
        const url = message?.text.match(
          /http:\/\/127\.0\.0\.1:3000\/reset-password#token=[A-Za-z0-9_-]+/,
        )?.[0]
        captured = message && url ? { subject: message.subject, url } : null
        return captured?.url ?? null
      },
      { timeout: 20_000 },
    )
    .not.toBeNull()
  if (!captured) {
    throw new Error('Expected an SMTP-captured recovery email.')
  }
  return captured
}

function parseCsvRecord(record: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < record.length; index += 1) {
    const character = record[index]
    if (character === '"') {
      if (quoted && record[index + 1] === '"') {
        cell += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      cells.push(cell)
      cell = ''
    } else {
      cell += character
    }
  }
  cells.push(cell)
  return cells
}

async function signIn(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
}
