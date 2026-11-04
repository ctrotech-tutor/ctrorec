import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator'

const academicStatuses = ['planned', 'active', 'completed', 'archived'] as const

export class CreateUnitDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  code!: string

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string

  @IsString()
  @Matches(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/)
  kind!: string

  @IsOptional()
  @IsUUID()
  parentId?: string
}

export class UpdateUnitDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  code?: string

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string

  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/)
  kind?: string

  @IsOptional()
  @IsUUID()
  parentId?: string | null
}

export class CreateTermDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  code!: string

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string

  @IsISO8601({ strict: true })
  startsOn!: string

  @IsISO8601({ strict: true })
  endsOn!: string

  @IsOptional()
  @IsIn(academicStatuses)
  status?: string
}

export class UpdateTermDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  code?: string

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string

  @IsOptional()
  @IsISO8601({ strict: true })
  startsOn?: string

  @IsOptional()
  @IsISO8601({ strict: true })
  endsOn?: string

  @IsOptional()
  @IsIn(academicStatuses)
  status?: string
}

export class CreateCourseDto {
  @IsUUID()
  unitId!: string

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  code!: string

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string
}

export class UpdateCourseDto {
  @IsOptional()
  @IsUUID()
  unitId?: string

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  code?: string

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string
}

export class CreateOfferingDto {
  @IsUUID()
  courseId!: string

  @IsUUID()
  termId!: string

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  section!: string

  @IsOptional()
  @IsIn(academicStatuses)
  status?: string
}

export class UpdateOfferingDto {
  @IsOptional()
  @IsUUID()
  courseId?: string

  @IsOptional()
  @IsUUID()
  termId?: string

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  section?: string

  @IsOptional()
  @IsIn(academicStatuses)
  status?: string
}

export class CreateLecturerAssignmentDto {
  @IsUUID()
  membershipId!: string

  @IsIn(['lead', 'assistant', 'guest'])
  role!: string

  @IsOptional()
  @IsISO8601({ strict: true })
  startsAt?: string
}

export class CreateEnrollmentDto {
  @IsUUID()
  membershipId!: string

  @IsOptional()
  @IsISO8601({ strict: true })
  enrolledAt?: string
}

export class EndAcademicParticipationDto {
  @IsISO8601({ strict: true })
  endsAt!: string
}
