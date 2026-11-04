import { Equals, IsString, MaxLength, MinLength } from 'class-validator'

export class MediaRetentionReasonDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string
}

export class DeleteLectureMediaDto extends MediaRetentionReasonDto {
  @IsString()
  @Equals('DELETE MEDIA')
  confirmation!: string
}
