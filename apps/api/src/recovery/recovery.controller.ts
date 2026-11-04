import { Public } from '@nestjs/authentication'
import {
  Body,
  Controller,
  Header,
  HttpCode,
  Inject,
  Post,
} from '@nestjs/common'
import { ApiBody } from '@nestjs/swagger'
import { Throttle, minutes } from '@nestjs/throttler'
import {
  InspectRecoveryDto,
  RequestRecoveryDto,
  ResetPasswordDto,
} from './recovery.dto.js'
import { RecoveryService } from './recovery.service.js'

@Controller('recovery')
export class RecoveryController {
  constructor(
    @Inject(RecoveryService) private readonly recovery: RecoveryService,
  ) {}

  @Public()
  @Throttle({
    default: { limit: 10, ttl: minutes(15) },
    account: { limit: 5, ttl: minutes(15) },
  })
  @Post('request')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @ApiBody({ type: RequestRecoveryDto })
  request(@Body() input: RequestRecoveryDto) {
    return this.recovery.request(input)
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: minutes(15) } })
  @Post('inspect')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiBody({ type: InspectRecoveryDto })
  inspect(@Body() input: InspectRecoveryDto) {
    return this.recovery.inspect(input)
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: minutes(15) } })
  @Post('reset')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiBody({ type: ResetPasswordDto })
  reset(@Body() input: ResetPasswordDto) {
    return this.recovery.reset(input)
  }
}
