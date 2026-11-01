import {
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Matches,
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
