import { z } from 'zod'

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    DATABASE_URL: z.url(),
    AUDIO_STORAGE_PROVIDER: z.enum(['local', 'cloudinary']).default('local'),
    AUDIO_STORAGE_ROOT: z.string().min(1).default('../../.data/audio'),
    CLOUDINARY_URL: z.string().min(1).optional(),
    CLOUDINARY_FOLDER: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/)
      .default('ctrorec'),
    MEDIA_TEMP_DIR: z.string().min(1).default('../../.data/processing'),
    FFMPEG_BIN: z.string().min(1).default('ffmpeg'),
    MEDIA_PROCESSING_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(86_400_000)
      .default(1_800_000),
    MEDIA_RECONCILIATION_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    MEDIA_RECONCILE_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(10_000)
      .max(86_400_000)
      .default(900_000),
    MEDIA_RECONCILE_GRACE_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .max(7 * 24 * 60 * 60 * 1000)
      .default(1_800_000),
    QUEUE_SCHEMA: z
      .string()
      .regex(/^[a-z_][a-z0-9_]*$/)
      .default('pgboss'),
    RECOVERY_EMAIL_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    RECOVERY_SMTP_URL: z
      .url()
      .refine(
        (value) => ['smtp:', 'smtps:'].includes(new URL(value).protocol),
        {
          message: 'Use an smtp:// or smtps:// connection URL.',
        },
      )
      .optional(),
    RECOVERY_EMAIL_FROM: z
      .string()
      .min(3)
      .max(254)
      .regex(/^[^\r\n]+$/)
      .default('no-reply@localhost'),
    RECOVERY_WEB_ORIGIN: z
      .url()
      .default('http://localhost:3000')
      .transform((value) => new URL(value).origin),
    RECOVERY_SMTP_CONNECTION_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(120_000)
      .default(10_000),
    RECOVERY_SMTP_GREETING_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(120_000)
      .default(10_000),
    RECOVERY_SMTP_SOCKET_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(120_000)
      .default(30_000),
    RECOVERY_SMTP_IGNORE_TLS: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  })
  .superRefine((environment, context) => {
    if (
      environment.AUDIO_STORAGE_PROVIDER === 'cloudinary' &&
      !environment.CLOUDINARY_URL
    ) {
      context.addIssue({
        code: 'custom',
        message: 'CLOUDINARY_URL is required for Cloudinary audio storage.',
        path: ['CLOUDINARY_URL'],
      })
    }
    if (environment.RECOVERY_EMAIL_ENABLED && !environment.RECOVERY_SMTP_URL) {
      context.addIssue({
        code: 'custom',
        message:
          'RECOVERY_SMTP_URL is required when recovery email is enabled.',
        path: ['RECOVERY_SMTP_URL'],
      })
    }
  })

export type WorkerEnvironment = z.infer<typeof environmentSchema>

export function validateWorkerEnvironment(
  input: Record<string, unknown>,
): WorkerEnvironment {
  const result = environmentSchema.safeParse(input)

  if (!result.success) {
    throw new Error(
      `Invalid worker environment:\n${z.prettifyError(result.error)}`,
    )
  }

  return result.data
}
