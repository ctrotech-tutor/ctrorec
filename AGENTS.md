# ctrorec

Audio-first, institution-controlled lecture access. Keep the original recording authoritative; AI outputs are derived and must not block audio access.

## Commands

- Install: `pnpm install`
- Local infrastructure: `docker compose up -d`
- Develop: `cp .env.example .env`, then `pnpm dev`
- Verify: `pnpm check`
- Browser smoke tests: `pnpm test:e2e`
- Migrations: `pnpm db:generate`, review the SQL, `pnpm db:check`, then `pnpm db:migrate`
- Development seed: `pnpm db:seed`
- PostgreSQL integration tests: `pnpm test:integration` with a guarded `TEST_DATABASE_URL` ending in `_test`
- Guarded browser-database reset: `pnpm db:reset:test`; never point this at development or production data

Use the Node version in `.nvmrc` and the pnpm version in `package.json`. FFmpeg is required for media unit tests, the worker, CI, and browser integration tests.

## Boundaries

- `apps/web`: TanStack Start UI, routing, SSR, and Query. No domain logic or direct database access.
- `apps/api`: NestJS API. Authentication, authorization, validation, and business rules live here.
- `apps/worker`: PostgreSQL-backed background work. Never run AI work in an HTTP request.
- `packages/database`: Drizzle schema, connection factory, and reviewed migrations.
- Nest owns every private data boundary. Start route guards are only UX.
- Scope every protected resource by institution and course; add cross-tenant denial tests with each feature. Composite tenant foreign keys are integrity checks, not a substitute for Nest authorization.
- Preserve academic history. Do not add cascading deletes to lectures, offerings, assignments, or enrollments; end active history rows instead of overwriting them.
- Keep original lecture audio immutable. The walking skeleton permits one original per lecture and no silent replacement; any future versioning must preserve prior teaching and its provenance.
- Authorize uploads before multipart processing and again in the domain service. Students can read only published lectures through a current enrollment; a current assignment is required for lecturer management. Test same-institution course denial as well as cross-institution denial.
- Keep media bytes behind `AudioStorage`; never expose storage keys or make provider public IDs an authorization decision. The local filesystem adapter is development/test-only. Follow `docs/media-storage.md` before adopting Cloudinary or another production provider.
- Keep original publication and playback independent of derivative processing. Commit original metadata, derivative state, and the pg-boss job in one transaction; never transcode in an HTTP request. Workers must honor cancellation, verify source/destination integrity, and expose only complete derivatives.
- Data-saver is a derived copy, not the source of truth. Do not tighten its encoding profile without the capture/listening evidence in `docs/media-evidence.md`. Range support and resumable upload sessions are separate from offline playback; do not claim offline support without separate evidence.
- Resumable uploads must preserve fresh course authorization, offset/checksum validation, expiry/cancellation, orphan-chunk reconciliation, and atomic/idempotent completion. Local chunk staging is single-instance; do not assume it works across a multi-instance deployment. See `docs/lecture-uploads.md`.
- The Cloudinary adapter is an opt-in candidate. Contract tests and the synthetic live runner do not establish provider adoption, institutional revocation, real-network behavior, deletion completeness, or unit economics. Never expose `CLOUDINARY_URL` or server-side signed download URLs to the browser.
- Use synthetic or explicitly consented audio in tests. Do not introduce real student recordings, unapproved media analysis, or external-model training into test and development workflows.
- PostgreSQL 18 native `uuidv7()` is intentional. `updated_at` is ORM-managed, so administrative SQL must maintain it explicitly.
- Use standard PostgreSQL and application-owned authentication. Do not add vendor-coupled identity.
- Authentication is owned by Nest and `@nestjs/authentication`; keep routes protected by default and mark only intentional public routes with `@Public()`.
- Never store or log raw session cookies or passwords. Persist only the authentication library's hashed session identifiers and credential hashes. Reload an active user on every session-backed request.
- Keep Secure cookies enabled outside explicit local HTTP testing. `WEB_ORIGIN` must match the real browser origin; same-origin web proxying does not replace CSRF or authorization checks.
- Nest constructor dependencies that are otherwise only TypeScript types may need explicit `@Inject(Token)`. Do not let a type-import autofix silently remove decorator metadata and break runtime injection.
- The Start `/api/$` server route is a transport proxy, not a trust boundary. Strip spoofable forwarding headers, preserve authentication cookies, and configure exact trusted proxy hops only when direct API access is network-restricted.
- Production web uses `srvx` to serve static assets and invoke Start's fetch handler. Do not replace it with a hand-rolled Express server.
- Keep dependencies minimal and exact. Review install scripts and package-supplied agent skills; never bulk-approve them.
- Do not edit `apps/web/src/routeTree.gen.ts` directly.
- Keep setup, architecture, and operational documentation current. Avoid redundant prose, not necessary documentation.

## Documentation baseline

Before changing framework behavior, consult the current official documentation and the installed package's migration guidance. Do not copy versionless tutorial code without checking it against the installed APIs.

- TanStack Start: https://tanstack.com/start/latest/docs/framework/react/overview
- NestJS: https://docs.nestjs.com
- Drizzle ORM: https://orm.drizzle.team/docs/overview
- PostgreSQL 18: https://www.postgresql.org/docs/18/
- pg-boss: https://pgboss.io
- Vite: https://vite.dev/guide
- Playwright: https://playwright.dev/docs/intro

Use current stable, compatible versions. Pin exactly what has been installed and verified; do not blindly jump to a new major when required tooling does not support it.
