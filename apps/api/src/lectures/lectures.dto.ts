import { Type } from 'class-transformer'
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'

export class CreateLectureDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string

  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  description?: string

  @IsISO8601({ strict: true })
  occurredAt!: string
}

export class UpdateLectureDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string

  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  description?: string

  @IsOptional()
  @IsISO8601({ strict: true })
  occurredAt?: string
}

export class CaptureProvenanceDto {
  @IsUUID()
  clientCaptureId!: string

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  recorderMimeType!: string

  @IsISO8601({ strict: true })
  consentAttestedAt!: string

  @IsISO8601({ strict: true })
  startedAt!: string

  @IsISO8601({ strict: true })
  stoppedAt!: string

  @IsInt()
  @Min(0)
  @Max(604_800_000)
  durationMs!: number

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  chunkCount!: number

  @IsBoolean()
  persistentStorageGranted!: boolean

  @IsIn([
    'stopped',
    'interrupted',
    'track-ended',
    'recorder-error',
    'size-limit',
  ])
  stopReason!:
    'stopped' | 'interrupted' | 'track-ended' | 'recorder-error' | 'size-limit'

  @IsInt()
  @Min(0)
  @Max(604_800_000)
  hashingDurationMs!: number

  @IsInt()
  @Min(0)
  @Max(604_800_000)
  uploadDurationMs!: number

  @IsInt()
  @Min(0)
  @Max(1_000_000)
  uploadRetryCount!: number
}

export class CompleteAudioUploadDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => CaptureProvenanceDto)
  capture?: CaptureProvenanceDto
}

export class CreateAudioUploadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string

  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  byteSize!: number

  @Matches(/^[0-9a-f]{64}$/)
  sha256!: string
}
