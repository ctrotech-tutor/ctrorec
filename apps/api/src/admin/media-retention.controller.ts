import { CurrentUser } from '@nestjs/authentication'
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
} from '@nestjs/common'
import { ApiBody } from '@nestjs/swagger'
import type { AuthUser } from '../auth/auth-user.js'
import {
  DeleteLectureMediaDto,
  MediaRetentionReasonDto,
} from './media-retention.dto.js'
import { MediaRetentionService } from './media-retention.service.js'

@Controller('institutions/:institutionId/admin')
export class MediaRetentionController {
  constructor(
    @Inject(MediaRetentionService)
    private readonly retention: MediaRetentionService,
  ) {}

  @Get('offerings/:offeringId/media-retention')
  @Header('Cache-Control', 'private, no-store')
  listOfferingLectures(
    @CurrentUser() user: AuthUser,
    @Param('institutionId') institutionId: string,
    @Param('offeringId') offeringId: string,
  ) {
    return this.retention.listOfferingLectures(
      user.id,
      institutionId,
      offeringId,
    )
  }

  @Post('lectures/:lectureId/media-hold')
  @ApiBody({ type: MediaRetentionReasonDto })
  @Header('Cache-Control', 'private, no-store')
  placeHold(
    @CurrentUser() user: AuthUser,
    @Param('institutionId') institutionId: string,
    @Param('lectureId') lectureId: string,
    @Body() input: MediaRetentionReasonDto,
  ) {
    return this.retention.placeHold(user.id, institutionId, lectureId, input)
  }

  @Post('media-holds/:holdId/release')
  @HttpCode(200)
  @ApiBody({ type: MediaRetentionReasonDto })
  @Header('Cache-Control', 'private, no-store')
  releaseHold(
    @CurrentUser() user: AuthUser,
    @Param('institutionId') institutionId: string,
    @Param('holdId') holdId: string,
    @Body() input: MediaRetentionReasonDto,
  ) {
    return this.retention.releaseHold(user.id, institutionId, holdId, input)
  }

  @Post('lectures/:lectureId/media-deletion')
  @HttpCode(200)
  @ApiBody({ type: DeleteLectureMediaDto })
  @Header('Cache-Control', 'private, no-store')
  requestDeletion(
    @CurrentUser() user: AuthUser,
    @Param('institutionId') institutionId: string,
    @Param('lectureId') lectureId: string,
    @Body() input: DeleteLectureMediaDto,
  ) {
    return this.retention.requestDeletion(
      user.id,
      institutionId,
      lectureId,
      input,
    )
  }
}
