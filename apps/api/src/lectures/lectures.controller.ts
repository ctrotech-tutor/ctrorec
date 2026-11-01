import { pipeline } from 'node:stream'
import { CurrentUser } from '@nestjs/authentication'
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBody, ApiConsumes } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { LectureWriteGuard } from './lecture-write.guard.js'
import {
  CreateAudioUploadDto,
  CreateLectureDto,
  UpdateLectureDto,
} from './lectures.dto.js'
import { LecturesService } from './lectures.service.js'
import { ResumableAudioService } from './resumable-audio.service.js'

@Controller()
export class LecturesController {
  constructor(
    @Inject(LecturesService) private readonly lectures: LecturesService,
    @Inject(ResumableAudioService)
    private readonly resumableAudio: ResumableAudioService,
  ) {}

  @Get('course-offerings')
  @Header('Cache-Control', 'private, no-store')
  listOfferings(@CurrentUser('id') userId: string) {
    return this.lectures.listOfferings(userId)
  }

  @Get('course-offerings/:offeringId/lectures')
  @Header('Cache-Control', 'private, no-store')
  listLectures(
    @CurrentUser('id') userId: string,
    @Param('offeringId') offeringId: string,
  ) {
    return this.lectures.listLectures(userId, offeringId)
  }

  @Post('course-offerings/:offeringId/lectures')
  @ApiBody({ type: CreateLectureDto })
  @Header('Cache-Control', 'private, no-store')
  createLecture(
    @CurrentUser('id') userId: string,
    @Param('offeringId') offeringId: string,
    @Body() input: CreateLectureDto,
  ) {
    return this.lectures.createLecture(userId, offeringId, input)
  }

  @Get('lectures/:lectureId')
  @UseGuards(LectureWriteGuard)
  @Header('Cache-Control', 'private, no-store')
  getLecture(
    @CurrentUser('id') userId: string,
    @Param('lectureId') lectureId: string,
  ) {
    return this.lectures.getManagedLecture(userId, lectureId)
  }

  @Patch('lectures/:lectureId')
  @ApiBody({ type: UpdateLectureDto })
  @UseGuards(LectureWriteGuard)
  @Header('Cache-Control', 'private, no-store')
  updateLecture(
    @CurrentUser('id') userId: string,
    @Param('lectureId') lectureId: string,
    @Body() input: UpdateLectureDto,
  ) {
    return this.lectures.updateLecture(userId, lectureId, input)
  }

  @Post('lectures/:lectureId/audio/uploads')
  @ApiBody({ type: CreateAudioUploadDto })
  @UseGuards(LectureWriteGuard)
  @Header('Cache-Control', 'private, no-store')
  createAudioUpload(
    @CurrentUser('id') userId: string,
    @Param('lectureId') lectureId: string,
    @Body() input: CreateAudioUploadDto,
  ) {
    return this.resumableAudio.create(userId, lectureId, input)
  }

  @Get('lectures/:lectureId/audio/uploads/active')
  @UseGuards(LectureWriteGuard)
  @Header('Cache-Control', 'private, no-store')
  getActiveAudioUpload(
    @CurrentUser('id') userId: string,
    @Param('lectureId') lectureId: string,
  ) {
    return this.resumableAudio.getActive(userId, lectureId)
  }

  @Delete('lectures/:lectureId/audio/uploads/active')
  @UseGuards(LectureWriteGuard)
  @HttpCode(204)
  @Header('Cache-Control', 'private, no-store')
  cancelActiveAudioUpload(
    @CurrentUser('id') userId: string,
    @Param('lectureId') lectureId: string,
  ) {
    return this.resumableAudio.cancelActive(userId, lectureId)
  }

  @Get('lectures/:lectureId/audio/uploads/:uploadId')
  @UseGuards(LectureWriteGuard)
  @Header('Cache-Control', 'private, no-store')
  getAudioUpload(
    @CurrentUser('id') userId: string,
    @Param('lectureId') lectureId: string,
    @Param('uploadId') uploadId: string,
  ) {
    return this.resumableAudio.get(userId, lectureId, uploadId)
  }

  @Patch('lectures/:lectureId/audio/uploads/:uploadId')
  @UseGuards(LectureWriteGuard)
  @Header('Cache-Control', 'private, no-store')
  appendAudioUpload(
    @CurrentUser('id') userId: string,
    @Param('lectureId') lectureId: string,
    @Param('uploadId') uploadId: string,
    @Req() request: Request,
  ) {
    const header = request.headers['upload-offset']
    return this.resumableAudio.append(
      userId,
      lectureId,
      uploadId,
      Array.isArray(header) ? header[0] : header,
      request,
    )
  }

  @Post('lectures/:lectureId/audio/uploads/:uploadId/complete')
  @UseGuards(LectureWriteGuard)
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  completeAudioUpload(
    @CurrentUser('id') userId: string,
    @Param('lectureId') lectureId: string,
    @Param('uploadId') uploadId: string,
  ) {
    return this.resumableAudio.complete(userId, lectureId, uploadId)
  }

  @Delete('lectures/:lectureId/audio/uploads/:uploadId')
  @UseGuards(LectureWriteGuard)
  @HttpCode(204)
  @Header('Cache-Control', 'private, no-store')
  cancelAudioUpload(
    @CurrentUser('id') userId: string,
    @Param('lectureId') lectureId: string,
    @Param('uploadId') uploadId: string,
  ) {
    return this.resumableAudio.cancel(userId, lectureId, uploadId)
  }

  @Post('lectures/:lectureId/audio')
  @UseGuards(LectureWriteGuard)
  @UseInterceptors(FileInterceptor('audio'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['audio'],
      properties: { audio: { type: 'string', format: 'binary' } },
    },
  })
  @Header('Cache-Control', 'private, no-store')
  upload(
    @CurrentUser('id') userId: string,
    @Param('lectureId') lectureId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) {
      throw new BadRequestException('Choose an audio file to upload.')
    }
    return this.lectures.attachAudio(userId, lectureId, file)
  }

  @Post('lectures/:lectureId/publish')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  publish(
    @CurrentUser('id') userId: string,
    @Param('lectureId') lectureId: string,
  ) {
    return this.lectures.publish(userId, lectureId)
  }

  @Get('lectures/:lectureId/audio')
  streamAudio(
    @CurrentUser('id') userId: string,
    @Param('lectureId') lectureId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    return this.sendAudio(userId, lectureId, request, response, 'original')
  }

  @Get('lectures/:lectureId/audio/download')
  downloadAudio(
    @CurrentUser('id') userId: string,
    @Param('lectureId') lectureId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    return this.sendAudio(
      userId,
      lectureId,
      request,
      response,
      'original',
      true,
    )
  }

  @Get('lectures/:lectureId/audio/data-saver')
  streamDataSaver(
    @CurrentUser('id') userId: string,
    @Param('lectureId') lectureId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    return this.sendAudio(userId, lectureId, request, response, 'data-saver')
  }

  @Get('lectures/:lectureId/audio/data-saver/download')
  downloadDataSaver(
    @CurrentUser('id') userId: string,
    @Param('lectureId') lectureId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    return this.sendAudio(
      userId,
      lectureId,
      request,
      response,
      'data-saver',
      true,
    )
  }

  private async sendAudio(
    userId: string,
    lectureId: string,
    request: Request,
    response: Response,
    variant: 'original' | 'data-saver',
    attachment = false,
  ): Promise<void> {
    const rangeHeader = request.headers.range
    const rawIfRangeHeader = request.headers['if-range']
    const ifRangeHeader = Array.isArray(rawIfRangeHeader)
      ? rawIfRangeHeader.join(',')
      : rawIfRangeHeader
    const audio = await this.lectures.openAudio(userId, lectureId, {
      variant,
      ...(rangeHeader ? { rangeHeader } : {}),
      ...(ifRangeHeader ? { ifRangeHeader } : {}),
    })
    response.set({
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
      'Content-Type': audio.mediaType,
      ETag: audio.etag,
      ...(attachment
        ? { 'Content-Disposition': attachmentDisposition(audio.fileName) }
        : {}),
    })

    if (audio.range.kind === 'unsatisfiable') {
      response
        .status(416)
        .set('Content-Range', `bytes */${audio.byteSize}`)
        .json({ message: 'The requested byte range is not available.' })
      return
    }
    if (!audio.stream) {
      throw new NotFoundException()
    }

    const full = audio.range.kind === 'full'
    const start = audio.range.kind === 'full' ? 0 : audio.range.start
    const end =
      audio.range.kind === 'full' ? audio.byteSize - 1 : audio.range.end
    response.status(full ? 200 : 206)
    response.set('Content-Length', String(end - start + 1))
    if (!full) {
      response.set('Content-Range', `bytes ${start}-${end}/${audio.byteSize}`)
    }

    pipeline(audio.stream, response, (error) => {
      if (error && !response.destroyed) {
        response.destroy(error)
      }
    })
  }
}

function attachmentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^A-Za-z0-9._-]/g, '_') || 'recording'
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}
