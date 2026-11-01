import { Controller, Get } from '@nestjs/common'
import { Public } from '@nestjs/authentication'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

export interface HealthResponse {
  service: 'api'
  status: 'ok'
}

@ApiTags('System')
@Public()
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Check API liveness' })
  @ApiOkResponse({
    description: 'The API process is ready to accept requests.',
    schema: {
      type: 'object',
      required: ['service', 'status'],
      properties: {
        service: { type: 'string', enum: ['api'] },
        status: { type: 'string', enum: ['ok'] },
      },
    },
  })
  getHealth(): HealthResponse {
    return { service: 'api', status: 'ok' }
  }
}
