import { Module } from '@nestjs/common'
import { AdminAccessService } from './admin-access.service.js'
import { AdminController } from './admin.controller.js'
import { AdminRepository } from './admin.repository.js'
import { AdminService } from './admin.service.js'
import { CaptureEvidenceRepository } from './capture-evidence.repository.js'
import { CaptureEvidenceService } from './capture-evidence.service.js'
import { MediaRetentionController } from './media-retention.controller.js'
import { MediaRetentionRepository } from './media-retention.repository.js'
import { MediaRetentionService } from './media-retention.service.js'

@Module({
  controllers: [AdminController, MediaRetentionController],
  providers: [
    AdminAccessService,
    AdminRepository,
    AdminService,
    CaptureEvidenceRepository,
    CaptureEvidenceService,
    MediaRetentionRepository,
    MediaRetentionService,
  ],
  exports: [AdminAccessService],
})
export class AdminModule {}
