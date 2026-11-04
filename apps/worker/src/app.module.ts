import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { validateWorkerEnvironment } from './config.js'
import { DatabaseModule } from './database/database.module.js'
import { MediaModule } from './media/media.module.js'
import { RecoveryModule } from './recovery/recovery.module.js'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['../../.env.local', '../../.env', '.env.local', '.env'],
      validate: validateWorkerEnvironment,
    }),
    DatabaseModule,
    MediaModule,
    RecoveryModule,
  ],
})
export class AppModule {}
