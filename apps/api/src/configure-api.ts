import { ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { NestExpressApplication } from '@nestjs/platform-express'

export function configureApi(
  app: NestExpressApplication,
  options: { shutdownHooks?: boolean } = {},
): void {
  const config = app.get(ConfigService)
  const webOrigin = config.getOrThrow<string>('WEB_ORIGIN')

  app.set('trust proxy', config.getOrThrow<number>('API_TRUST_PROXY_HOPS'))
  app.useSecurityHeaders()
  app.enableCsrfProtection({ trustedOrigins: [webOrigin] })
  app.setGlobalPrefix('api')
  app.useBodyParser('json', { limit: '100kb' })
  app.useBodyParser('urlencoded', { extended: false, limit: '100kb' })
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  )
  app.enableCors({
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Upload-Offset',
      'X-CSRF-Token',
      'X-Request-ID',
    ],
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    origin: webOrigin,
  })
  if (options.shutdownHooks !== false) {
    app.enableShutdownHooks()
  }
}
