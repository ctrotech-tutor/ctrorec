import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { createConfiguredAudioStorage } from '@ctrorec/media/configured'
import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { MulterModule } from '@nestjs/platform-express'
import { diskStorage } from 'multer'
import { AUDIO_STORAGE } from './audio-storage.js'
import { LectureWriteGuard } from './lecture-write.guard.js'
import { LecturesController } from './lectures.controller.js'
import { LecturesRepository } from './lectures.repository.js'
import { LecturesService } from './lectures.service.js'
import { MediaJobsService } from './media-jobs.service.js'
import { ResumableAudioService } from './resumable-audio.service.js'
import { UploadReconciliationService } from './upload-reconciliation.service.js'

@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const temporaryDirectory = config.getOrThrow<string>(
          'AUDIO_UPLOAD_TEMP_DIR',
        )
        return {
          storage: diskStorage({
            destination: (_request, _file, callback) => {
              void mkdir(temporaryDirectory, { recursive: true }).then(
                () => callback(null, temporaryDirectory),
                (error: unknown) =>
                  callback(
                    error instanceof Error
                      ? error
                      : new Error('Could not prepare upload storage.'),
                    '',
                  ),
              )
            },
            filename: (_request, _file, callback) =>
              callback(null, randomUUID()),
          }),
          limits: {
            fileSize: config.getOrThrow<number>('AUDIO_MAX_UPLOAD_BYTES'),
            files: 1,
            fields: 0,
            parts: 1,
          },
        }
      },
    }),
  ],
  controllers: [LecturesController],
  providers: [
    LecturesRepository,
    LecturesService,
    ResumableAudioService,
    UploadReconciliationService,
    MediaJobsService,
    LectureWriteGuard,
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
export class LecturesModule {}
