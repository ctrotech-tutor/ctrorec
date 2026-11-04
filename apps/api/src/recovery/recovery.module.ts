import { Module } from '@nestjs/common'
import { RecoveryJobsService } from './recovery-jobs.service.js'
import { RecoveryController } from './recovery.controller.js'
import { RecoveryRepository } from './recovery.repository.js'
import { RecoveryService } from './recovery.service.js'

@Module({
  controllers: [RecoveryController],
  providers: [RecoveryJobsService, RecoveryRepository, RecoveryService],
})
export class RecoveryModule {}
