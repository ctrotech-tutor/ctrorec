import {
  BadRequestException,
  Inject,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common'
import { AdminAccessService } from './admin-access.service.js'
import {
  CAPTURE_EVIDENCE_EXPORT_LIMIT,
  captureEvidenceCsv,
} from './capture-evidence.js'
import { CaptureEvidenceRepository } from './capture-evidence.repository.js'

@Injectable()
export class CaptureEvidenceService {
  constructor(
    @Inject(AdminAccessService)
    private readonly adminAccess: AdminAccessService,
    @Inject(CaptureEvidenceRepository)
    private readonly repository: CaptureEvidenceRepository,
  ) {}

  async exportCsv(
    userId: string,
    institutionId: string,
    input: { from?: string; to?: string },
  ): Promise<string> {
    await this.adminAccess.require(userId, institutionId)
    const from = parseUtcDay(input.from, 'from', false)
    const to = parseUtcDay(input.to, 'to', true)
    if (from && to && from >= to) {
      throw new BadRequestException(
        'The from date must not follow the to date.',
      )
    }
    const rows = await this.repository.list(institutionId, {
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    })
    if (rows.length > CAPTURE_EVIDENCE_EXPORT_LIMIT) {
      throw new PayloadTooLargeException(
        `Narrow the export to at most ${CAPTURE_EVIDENCE_EXPORT_LIMIT} captures.`,
      )
    }
    return captureEvidenceCsv(rows)
  }
}

function parseUtcDay(
  value: string | undefined,
  label: string,
  endExclusive: boolean,
): Date | undefined {
  if (value === undefined || value === '') {
    return undefined
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`The ${label} date must use YYYY-MM-DD.`)
  }
  const date = new Date(`${value}T00:00:00.000Z`)
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException(`The ${label} date is invalid.`)
  }
  if (endExclusive) {
    date.setUTCDate(date.getUTCDate() + 1)
  }
  return date
}
