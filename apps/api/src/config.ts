import { z } from 'zod'

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    API_HOST: z.string().min(1).default('0.0.0.0'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    API_TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
    AUDIO_STORAGE_PROVIDER: z.enum(['local', 'cloudinary']).default('local'),
    AUDIO_STORAGE_ROOT: z.string().min(1).default('../../.data/audio'),
    CLOUDINARY_URL: z.string().min(1).optional(),
    CLOUDINARY_FOLDER: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/)
      .default('ctrorec'),
    AUDIO_UPLOAD_TEMP_DIR: z.string().min(1).default('../../.data/uploads'),
    AUDIO_MAX_UPLOAD_BYTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(2_147_483_647)
      .default(268_435_456),
    AUDIO_UPLOAD_CHUNK_BYTES: z.coerce
      .number()
      .int()
      .min(16_384)
      .max(8_388_608)
      .default(4_194_304),
    AUDIO_UPLOAD_SESSION_TTL_MS: z.coerce
      .number()
      .int()
      .min(300_000)
      .max(604_800_000)
      .default(86_400_000),
    DATABASE_URL: z.string().min(1),
    QUEUE_SCHEMA: z
      .string()
      .regex(/^[a-z_][a-z0-9_]*$/)
      .default('pgboss'),
    WEB_ORIGIN: z
      .url()
      .default('http://localhost:3000')
      .transform((value) => new URL(value).origin),
    AUTH_COOKIE_SECURE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    API_DOCS_ENABLED: z
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
  })

export type ApiEnvironment = z.infer<typeof environmentSchema>

export function validateApiEnvironment(
  input: Record<string, unknown>,
): ApiEnvironment {
  const result = environmentSchema.safeParse(input)

  if (!result.success) {
    throw new Error(
      `Invalid API environment:\n${z.prettifyError(result.error)}`,
    )
  }

  return result.data
}
