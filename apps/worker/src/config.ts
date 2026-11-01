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
    QUEUE_SCHEMA: z
      .string()
      .regex(/^[a-z_][a-z0-9_]*$/)
      .default('pgboss'),
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
