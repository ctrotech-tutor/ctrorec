import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { AuthenticationModule } from '@nestjs/authentication'
import {
  ThrottlerGuard,
  ThrottlerModule,
  minutes,
  normalizeIp,
} from '@nestjs/throttler'
import { AuthModule } from './auth/auth.module.js'
import { accountEmail } from './auth/email.js'
import { validateApiEnvironment } from './config.js'
import { DatabaseModule } from './database/database.module.js'
import { HealthModule } from './health/health.module.js'
import { LecturesModule } from './lectures/lectures.module.js'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['../../.env.local', '../../.env', '.env.local', '.env'],
      validate: validateApiEnvironment,
    }),
    ThrottlerModule.forRoot([
      { name: 'default', ttl: minutes(1), limit: 100 },
      {
        name: 'account',
        ttl: minutes(15),
        limit: 5,
        skipIf: (context) => !accountEmail(context.switchToHttp().getRequest()),
        getTracker: (request) =>
          `${accountEmail(request)}|${normalizeIp(request.ip)}`,
      },
    ]),
    AuthenticationModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        session: {
          absoluteTtl: '14d',
          idleTtl: '3d',
          cookie: {
            secure: config.getOrThrow<boolean>('AUTH_COOKIE_SECURE'),
          },
          trustedOrigins: [config.getOrThrow<string>('WEB_ORIGIN')],
          metadata: (request) => ({
            userAgent: request.headers['user-agent'] ?? null,
          }),
        },
      }),
    }),
    DatabaseModule,
    AuthModule,
    HealthModule,
    LecturesModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
