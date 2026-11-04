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

The candidate profile is mono AAC in an explicitly branded M4A container. It uses 48 kbit/s for ordinary originals and 32 kbit/s for compressed WebM/Ogg or captures whose measured original bitrate is at most 64 kbit/s. Processing removes metadata, chapters, video, subtitles, and data streams and enables MP4 `faststart`. These are engineering candidates, not real-hall quality certifications. Follow `docs/media-evidence.md` before changing or approving a profile.

The API accepts WAV, M4A, MP3, WebM, Ogg, and audio-only MP4-family input. The API supplies FFprobe for containers that can hold video; worker-side hashing alone does not perform that request-validation probe. Signature/container inspection is not malware scanning, full decode validation, or proof of useful lecture audio.

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
- FFprobe available as `ffprobe`, or set `FFPROBE_BIN` for the API

```sh
pnpm --filter @ctrorec/media typecheck
pnpm --filter @ctrorec/media test
pnpm --filter @ctrorec/media build
```

Tests execute the real FFmpeg binary with a synthetic WAV fixture. Do not place real student recordings in tests.
