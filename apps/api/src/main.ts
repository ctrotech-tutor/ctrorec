import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from './app.module.js'
import { configureApi } from './configure-api.js'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)
  const config = app.get(ConfigService)
  const logger = new Logger('API')

  configureApi(app)

  if (config.getOrThrow<boolean>('API_DOCS_ENABLED')) {
    const documentConfig = new DocumentBuilder()
      .setTitle('ctrorec API')
      .setDescription('Application-owned API for lecture access workflows.')
      .setVersion('0.1.0')
      .addCookieAuth('__Host-sid')
      .build()
    const documentFactory = () =>
      SwaggerModule.createDocument(app, documentConfig)

    SwaggerModule.setup('api/docs', app, documentFactory, {
      jsonDocumentUrl: 'api/docs/openapi.json',
    })
  }

  const host = config.getOrThrow<string>('API_HOST')
  const port = config.getOrThrow<number>('API_PORT')
  await app.listen(port, host)
  logger.log(`Listening on http://${host}:${port}/api`)
}

void bootstrap()
