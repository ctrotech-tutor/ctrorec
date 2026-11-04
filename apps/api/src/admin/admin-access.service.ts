import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { AdminRepository } from './admin.repository.js'

@Injectable()
export class AdminAccessService {
  constructor(
    @Inject(AdminRepository) private readonly repository: AdminRepository,
  ) {}

  async require(userId: string, institutionId: string) {
    if (!isUuid(institutionId)) {
      throw new NotFoundException('Invalid institutionId.')
    }
    const access = await this.repository.findAdminMembership(
      userId,
      institutionId,
    )
    if (!access) {
      throw new NotFoundException()
    }
    return access
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  )
}
