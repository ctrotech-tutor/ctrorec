import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { QueueModule } from '../queue/queue.module.js'
import { RecoveryMailer } from './recovery-mailer.js'
import { RecoveryRepository } from './recovery.repository.js'
import { RecoveryService } from './recovery.service.js'

@Module({
  imports: [QueueModule],
  providers: [
    RecoveryRepository,
    RecoveryService,
    {
      provide: RecoveryMailer,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const smtpUrl = config.get<string>('RECOVERY_SMTP_URL')
        return new RecoveryMailer({
          enabled: config.getOrThrow<boolean>('RECOVERY_EMAIL_ENABLED'),
          ...(smtpUrl ? { smtpUrl } : {}),
          from: config.getOrThrow<string>('RECOVERY_EMAIL_FROM'),
          connectionTimeoutMs: config.getOrThrow<number>(
            'RECOVERY_SMTP_CONNECTION_TIMEOUT_MS',
          ),
          greetingTimeoutMs: config.getOrThrow<number>(
            'RECOVERY_SMTP_GREETING_TIMEOUT_MS',
          ),
          socketTimeoutMs: config.getOrThrow<number>(
            'RECOVERY_SMTP_SOCKET_TIMEOUT_MS',
          ),
          ignoreTls: config.getOrThrow<boolean>('RECOVERY_SMTP_IGNORE_TLS'),
        })
      },
    },
  ],
})
export class RecoveryModule {}
