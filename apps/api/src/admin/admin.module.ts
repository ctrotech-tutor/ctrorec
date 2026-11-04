import { Module } from '@nestjs/common'
import { AdminAccessService } from './admin-access.service.js'
import { AdminController } from './admin.controller.js'
import { AdminRepository } from './admin.repository.js'
import { AdminService } from './admin.service.js'
import { CaptureEvidenceRepository } from './capture-evidence.repository.js'
import { CaptureEvidenceService } from './capture-evidence.service.js'

@Module({
  controllers: [AdminController],
  providers: [
    AdminAccessService,
    AdminRepository,
    AdminService,
    CaptureEvidenceRepository,
    CaptureEvidenceService,
  ],
  exports: [AdminAccessService],
})
export class AdminModule {}
