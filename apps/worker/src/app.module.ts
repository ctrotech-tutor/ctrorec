import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { validateWorkerEnvironment } from './config.js'
import { DatabaseModule } from './database/database.module.js'
import { MediaModule } from './media/media.module.js'

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
  ],
})
export class AppModule {}
