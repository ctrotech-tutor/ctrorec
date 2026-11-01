import { createConfiguredAudioStorage } from '@ctrorec/media/configured'
import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { QueueModule } from '../queue/queue.module.js'
import { DataSaverRepository } from './data-saver.repository.js'
import { DataSaverService } from './data-saver.service.js'
import { AUDIO_STORAGE } from './media.constants.js'

@Module({
  imports: [QueueModule],
  providers: [
    DataSaverRepository,
    DataSaverService,
    {
      provide: AUDIO_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const cloudinaryUrl = config.get<string>('CLOUDINARY_URL')
        return createConfiguredAudioStorage({
          provider: config.getOrThrow<'local' | 'cloudinary'>(
            'AUDIO_STORAGE_PROVIDER',
          ),
          localRoot: config.getOrThrow<string>('AUDIO_STORAGE_ROOT'),
          cloudinaryFolder: config.getOrThrow<string>('CLOUDINARY_FOLDER'),
          ...(cloudinaryUrl ? { cloudinaryUrl } : {}),
        })
      },
    },
  ],
})
export class MediaModule {}
