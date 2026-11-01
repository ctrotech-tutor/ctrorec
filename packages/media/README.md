# @ctrorec/media

Shared, provider-neutral media primitives for the Nest API and worker.

## Contents

- `AudioStorage`: object save, verify, range open, and compensating delete contract.
- `LocalAudioStorage`: development/test filesystem implementation; objects remain outside public assets.
- `@ctrorec/media/cloudinary`: opt-in authenticated Cloudinary candidate with strict range validation; signed URLs stay server-side.
- `@ctrorec/media/configured`: explicit local/Cloudinary selection shared by API and worker.
- Audio signature, byte-size, and SHA-256 inspection.
- The versioned data-saver job name, payload validation, and queue settings.
- Worker-only FFmpeg transcoding through argument-array `spawn`, with abort support and no shell interpolation.

The core contracts have no Nest, React, database, or AI dependency. Cloudinary is pinned and isolated behind the same `AudioStorage` interface; provider-specific SDK types do not leak into lecture controllers or the browser. Local remains the default.

## Data-saver profile

The current candidate profile is mono AAC at 48 kbit/s in an explicitly branded M4A container. Processing removes metadata, chapters, video, subtitles, and data streams and enables MP4 `faststart`. This is an engineering candidate, not a real-hall quality certification. Follow `docs/media-evidence.md` before changing or approving the profile.

The API accepts only WAV, M4A, and MP3 signatures. Generic MP4 `isom` files are not accepted as M4A uploads. Signature inspection is not transcoding, malware scanning, duration analysis, or proof that a container has valid audio.

## Cloudinary evidence

Unit tests use fake provider responses and do not certify a Cloudinary account. The opt-in live runner creates synthetic WAV/M4A objects in an isolated folder, checks authenticated upload, full/range delivery, unsigned denial, and deletion, then cleans them up:

```sh
CLOUDINARY_URL='cloudinary://…' \
CLOUDINARY_EVIDENCE_FOLDER='ctrorec-evidence-your-environment' \
CLOUDINARY_EVIDENCE_ACK='DELETE-SYNTHETIC-EVIDENCE-OBJECTS' \
pnpm --filter @ctrorec/media evidence:cloudinary
```

This can incur provider usage charges and deletes the synthetic objects it creates. It does not test ctrorec session/course revocation, real phones/networks, backup/restore, or cost. See `docs/media-storage.md` before running it and never commit the credential URL.

## Requirements

- Node 26.13+
- FFmpeg available as `ffmpeg`, or set `FFMPEG_BIN` for the worker

```sh
pnpm --filter @ctrorec/media typecheck
pnpm --filter @ctrorec/media test
pnpm --filter @ctrorec/media build
```

Tests execute the real FFmpeg binary with a synthetic WAV fixture. Do not place real student recordings in tests.
