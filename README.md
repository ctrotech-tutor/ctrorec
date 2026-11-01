# ctrorec

Workspace for an audio-first, institution-controlled lecture access platform. The original recording remains authoritative; transcripts and generated resources are derivatives and must not block audio access.

## Stack

- TanStack Start, React, and TanStack Query for the web application
- NestJS for the private HTTP API and standalone worker
- PostgreSQL 18, Drizzle ORM, and pg-boss
- Strict TypeScript, ESLint, Prettier, Vitest, and Playwright

Dependencies are locked. Node and pnpm versions are pinned in `.nvmrc` and `package.json`.

## Current scope

- **Phase 1 — academic persistence:** implemented. Institution, identity, membership, course, offering, assignment, enrollment, and lecture-history invariants are enforced in PostgreSQL. See `packages/database/README.md`.
- **Phase 2 — application-owned authentication:** implemented. Nest issues server-side sessions with 14-day absolute and 3-day idle limits. Session identifiers are hashed before persistence, every session request reloads an active user, and users can revoke their sessions. Password verification, throttling, CSRF/origin checks, Secure cookies, and institutional membership responses are covered by real-database HTTP tests.
- **Phase 3 — audio walking skeleton:** implemented for the seeded workflow. A currently assigned lecturer can upload one original MP3/WAV/M4A recording and publish it; currently enrolled students can play published audio with byte-range seeking. Upload, publication, full/partial delivery, ended-enrollment, cross-course, and cross-institution tests run against PostgreSQL and real HTTP.
- **Phase 4 — media efficiency and resilience:** implemented locally. A pg-boss job committed with the original drives worker-only FFmpeg processing into a mono AAC/M4A data-saver copy. Students can choose either ready copy; derivative failure never blocks the original. Delivery includes strong entity tags, safe `If-Range` resume behavior, and explicit downloads. Production Chromium starts the real worker and decodes, plays, and seeks both copies. The 48 kbit/s candidate profile is not a real-hall quality certification.
- **Phase 5 — lecture workflow and upload recovery:** implemented locally. Assigned lecturers can create and edit lectures without seed-only records. Upload sessions use incremental browser SHA-256, fixed chunks, offset recovery, cancellation, expiry, and atomic/idempotent completion. Production Chromium creates and edits a lecture, aborts a later chunk, recovers, publishes, and plays both audio copies. An opt-in Cloudinary adapter and synthetic live-evidence runner exist, but no live provider test or production adoption has occurred.
- **Next — live media evidence and institutional operations:** run `docs/media-evidence.md` and the isolated Cloudinary evidence flow, then expand beyond seeded institution/course administration. Local resumable staging is single-instance; durable production storage and multi-instance upload staging remain evidence gates.

There is no public registration. Original-audio replacement/versioning, approved durable production media storage, multi-instance upload staging, offline playback, password recovery, invitations, transcription, and AI processing are not implemented yet. The session model reserves MFA state but does not provide an MFA flow. The local filesystem audio adapter is for development/testing only.

## Brand

The product name is lowercase `ctrorec`. Production vector/PNG masters and usage rules are in `brand/`; public web assets are in `apps/web/public/brand/`.

## Start locally

Requirements: Node 26.13+, pnpm 12.16+, FFmpeg (including local/browser integration tests), and Docker with Compose.

```sh
npm install --global pnpm@12.16.1
pnpm install --frozen-lockfile
cp .env.example .env
docker compose up -d --wait postgres
pnpm db:migrate
pnpm db:seed
pnpm dev
```

- Web: http://localhost:3000
- API health: http://localhost:3001/api/health
- OpenAPI in local development: http://localhost:3001/api/docs

Use the `localhost` URL rather than a different loopback hostname unless you also change `WEB_ORIGIN`; credentialed writes require an exact trusted origin.

### Development accounts

The idempotent seed creates fictional people and academic records only:

| Role     | Email                   | Password             |
| -------- | ----------------------- | -------------------- |
| Lecturer | `lecturer@ctrorec.test` | `Lecturer-Dev-2026!` |
| Student  | `student@ctrorec.test`  | `Student-Dev-2026!`  |

These credentials are deliberately public development fixtures. Never reuse them for a real account. The seed refuses `NODE_ENV=production` and only backfills a missing development credential hash; it does not overwrite an existing password hash.

## Configuration

| Variable                      | Purpose                                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                | Standard PostgreSQL connection string used by migrations, API, seed, and worker                |
| `TEST_DATABASE_URL`           | Separate integration database; its name must end in `_test`                                    |
| `WEB_ORIGIN`                  | Exact browser origin trusted for CORS and credentialed CSRF-sensitive writes                   |
| `AUTH_COOKIE_SECURE`          | Defaults to `true`; keep it enabled in production and HTTPS deployments                        |
| `API_PROXY_TARGET`            | Server-only API origin used by the production Start proxy; defaults to `http://127.0.0.1:3001` |
| `API_TRUST_PROXY_HOPS`        | Exact trusted proxy hops in front of Nest; defaults to `0`                                     |
| `API_DOCS_ENABLED`            | Enables local OpenAPI UI when `true`; defaults to `false`                                      |
| `AUDIO_STORAGE_PROVIDER`      | `local` by default; `cloudinary` is an evidence-gated candidate                                |
| `AUDIO_STORAGE_ROOT`          | Local-development audio object root; defaults to `../../.data/audio`                           |
| `AUDIO_UPLOAD_TEMP_DIR`       | Multipart/resumable staging directory; defaults to `../../.data/uploads`                       |
| `AUDIO_MAX_UPLOAD_BYTES`      | Per-file upload limit; defaults to 268435456 bytes (256 MiB)                                   |
| `AUDIO_UPLOAD_CHUNK_BYTES`    | Resumable chunk size; defaults to 4194304 bytes (4 MiB)                                        |
| `AUDIO_UPLOAD_SESSION_TTL_MS` | Upload-session lifetime; defaults to 86400000 (24 hours)                                       |
| `CLOUDINARY_FOLDER`           | Provider namespace; defaults to `ctrorec`; use isolated environment-specific names             |
| `CLOUDINARY_URL`              | Server-only provider credentials; required only when Cloudinary is selected                    |
| `FFMPEG_BIN`                  | Worker FFmpeg executable; defaults to `ffmpeg`                                                 |
| `MEDIA_TEMP_DIR`              | Worker-only source/staging directory; defaults to `../../.data/processing`                     |
| `MEDIA_PROCESSING_TIMEOUT_MS` | Per-attempt derivative processing bound; defaults to 1800000 (30 minutes)                      |

If a local plain-HTTP browser does not accept Secure cookies on `localhost`, set `AUTH_COOKIE_SECURE=false` only in the local environment. Do not carry that override into a deployed environment.

Development uses Vite's `/api` proxy. Production uses the TanStack Start server route in `apps/web/src/routes/api/$.ts`, so browsers continue to use same-origin requests and cookies. `API_PROXY_TARGET` is read on the server, not exposed as a browser `VITE_*` variable. The proxy removes connection-specific headers, preserves multiple `Set-Cookie` headers, and replaces untrusted client forwarding values with runtime-derived values where available.

Only set `API_TRUST_PROXY_HOPS` after configuring the proxy chain and network access deliberately. An API that trusts proxy headers must not be directly reachable by untrusted clients; otherwise they can spoof client IPs and weaken throttling.

Local audio is written beneath `.data/`, which is Git-ignored. MP3/WAV/M4A checks are basic container-signature checks, not transcoding, malware scanning, duration analysis, or lecture-hall quality validation. Do not use the local adapter as durable or multi-instance production storage; see `docs/media-storage.md` for the provider gates and Cloudinary assessment.

Resumable upload chunks are staged beneath `AUDIO_UPLOAD_TEMP_DIR` and require fresh lecturer authorization on every status/chunk/completion request. Completion rechecks the assembled file and joins original metadata, derivative state, queue job, and session completion in one transaction. The local staging directory is not shared storage: multiple API instances need a shared staging design or sticky routing before production use. See `docs/lecture-uploads.md`.

Cloudinary can be selected consistently for API and worker with `AUDIO_STORAGE_PROVIDER=cloudinary`. Nest keeps provider credentials and short-lived signed download URLs server-side. The adapter is only a candidate; run the synthetic evidence command in `docs/media-storage.md` and the application authorization/field gates before adoption. Never commit `CLOUDINARY_URL`.

Data-saver processing runs only in the worker. The original row, derivative row, and queue job use one PostgreSQL transaction through pg-boss's Drizzle adapter. The worker verifies source integrity, stages output outside public storage, and marks a derivative ready only after object verification. A derivative that fails or is not smaller remains unavailable while the original stays playable. See `docs/media-evidence.md` before treating the encoding profile as accepted.

## Commands

| Command                                            | Purpose                                                               |
| -------------------------------------------------- | --------------------------------------------------------------------- |
| `pnpm dev`                                         | Run web, API, and worker                                              |
| `pnpm dev:web`                                     | Run only TanStack Start                                               |
| `pnpm dev:api`                                     | Build the database package, then run only NestJS API                  |
| `pnpm dev:worker`                                  | Run only the queue worker                                             |
| `pnpm build:shared`                                | Build database and media packages required by applications            |
| `pnpm check`                                       | Format check, lint, typecheck, unit tests, and builds                 |
| `pnpm test:integration`                            | Run real-PostgreSQL academic, auth, and lecture-audio tests           |
| `pnpm test:e2e`                                    | Build/start production API, worker, and web; run browser tests        |
| `pnpm --filter @ctrorec/media evidence:cloudinary` | Opt-in synthetic live provider evidence; uploads/deletes test objects |
| `pnpm db:generate`                                 | Generate a migration after schema changes                             |
| `pnpm db:check`                                    | Check migration consistency                                           |
| `pnpm db:migrate`                                  | Apply reviewed migrations                                             |
| `pnpm db:seed`                                     | Idempotently seed local development data                              |
| `pnpm db:reset:test`                               | Reset only the guarded `_test` database                               |

`pnpm test:e2e` migrates, resets, and seeds `TEST_DATABASE_URL`; it never resets `DATABASE_URL` and does not use the Vite development servers. Its uploaded objects live under Playwright's ignored `test-results` directory. Integration and browser resets also remove the test pg-boss schema so jobs cannot leak between fixtures. CI installs FFmpeg and runs formatting, lint, typechecks, unit tests, migration checks, both integration suites, builds, and Chromium tests on PostgreSQL 18.6.

## Production process smoke check

Build once, then run the API, worker, and web as separate processes with their production environment:

```sh
pnpm build
pnpm --dir apps/api start
pnpm --dir apps/worker start
pnpm --dir apps/web start
```

The web start script uses `srvx` to serve `dist/client` and invoke TanStack Start's exported fetch handler in `dist/server/server.js`; running that JavaScript entry directly does not open a listener. This is a process check, not a deployment or a substitute for TLS, network policy, backups, and production secrets.

## Layout

```text
apps/web             TanStack Start application and same-origin API proxy
apps/api             NestJS authentication, HTTP API, and integration tests
apps/worker          NestJS standalone pg-boss worker
packages/database    Academic/auth/audio schema, migrations, seed, and tests
packages/media       Shared storage, inspection, job, and FFmpeg primitives
ops/postgres         Local PostgreSQL initialization
docs                 Media-provider assessment and production evidence gates
```
