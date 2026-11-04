import { CurrentUser } from '@nestjs/authentication'
import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common'
import { ApiBody, ApiQuery } from '@nestjs/swagger'
import type { AuthUser } from '../auth/auth-user.js'
import {
  CreateCourseDto,
  CreateEnrollmentDto,
  CreateLecturerAssignmentDto,
  CreateOfferingDto,
  CreateTermDto,
  CreateUnitDto,
  EndAcademicParticipationDto,
  UpdateCourseDto,
  UpdateOfferingDto,
  UpdateTermDto,
  UpdateUnitDto,
} from './admin.dto.js'
import { AdminService } from './admin.service.js'
import { CaptureEvidenceService } from './capture-evidence.service.js'

@Controller('institutions/:institutionId/admin')
export class AdminController {
  constructor(
    @Inject(AdminService) private readonly admin: AdminService,
    @Inject(CaptureEvidenceService)
    private readonly captureEvidence: CaptureEvidenceService,
  ) {}

  @Get('academic')
  @Header('Cache-Control', 'private, no-store')
  academic(
    @CurrentUser() user: AuthUser,
    @Param('institutionId') institutionId: string,
  ) {
    return this.admin.getAcademic(user.id, institutionId)
  }

  @Get('capture-evidence.csv')
  @Header('Cache-Control', 'private, no-store')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header(
    'Content-Disposition',
    'attachment; filename="ctrorec-capture-evidence.csv"',
  )
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'to', required: false, type: String })
  exportCaptureEvidence(
    @CurrentUser() user: AuthUser,
    @Param('institutionId') institutionId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.captureEvidence.exportCsv(user.id, institutionId, {
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
    })
  }

  @Get('memberships')
  @Header('Cache-Control', 'private, no-store')
  memberships(
    @CurrentUser() user: AuthUser,
    @Param('institutionId') institutionId: string,
  ) {
    return this.admin.listMemberships(user.id, institutionId)
  }

  @Post('units')
  @ApiBody({ type: CreateUnitDto })
  createUnit(
    @CurrentUser() user: AuthUser,
    @Param('institutionId') institutionId: string,
    @Body() input: CreateUnitDto,
  ) {
    return this.admin.createUnit(user.id, institutionId, input)
  }

  @Patch('units/:unitId')
  @ApiBody({ type: UpdateUnitDto })
  updateUnit(
    @CurrentUser() user: AuthUser,
    @Param('institutionId') institutionId: string,
    @Param('unitId') unitId: string,
    @Body() input: UpdateUnitDto,
  ) {
    return this.admin.updateUnit(user.id, institutionId, unitId, input)
  }

  @Post('terms')
  @ApiBody({ type: CreateTermDto })
  createTerm(
    @CurrentUser() user: AuthUser,
    @Param('institutionId') institutionId: string,
    @Body() input: CreateTermDto,
  ) {
    return this.admin.createTerm(user.id, institutionId, input)
  }

  @Patch('terms/:termId')
  @ApiBody({ type: UpdateTermDto })
  updateTerm(
    @CurrentUser() user: AuthUser,
    @Param('institutionId') institutionId: string,
    @Param('termId') termId: string,
    @Body() input: UpdateTermDto,
  ) {
    return this.admin.updateTerm(user.id, institutionId, termId, input)
  }

  @Post('courses')
  @ApiBody({ type: CreateCourseDto })
  createCourse(
    @CurrentUser() user: AuthUser,
    @Param('institutionId') institutionId: string,
    @Body() input: CreateCourseDto,
  ) {
    return this.admin.createCourse(user.id, institutionId, input)
  }

  @Patch('courses/:courseId')
  @ApiBody({ type: UpdateCourseDto })
  updateCourse(
    @CurrentUser() user: AuthUser,
    @Param('institutionId') institutionId: string,
    @Param('courseId') courseId: string,
    @Body() input: UpdateCourseDto,
  ) {
    return this.admin.updateCourse(user.id, institutionId, courseId, input)
  }

  @Post('offerings')
  @ApiBody({ type: CreateOfferingDto })
  createOffering(
    @CurrentUser() user: AuthUser,
    @Param('institutionId') institutionId: string,
    @Body() input: CreateOfferingDto,
  ) {
    return this.admin.createOffering(user.id, institutionId, input)
  }

  @Patch('offerings/:offeringId')
  @ApiBody({ type: UpdateOfferingDto })
  updateOffering(
    @CurrentUser() user: AuthUser,
    @Param('institutionId') institutionId: string,
    @Param('offeringId') offeringId: string,
    @Body() input: UpdateOfferingDto,
  ) {
    return this.admin.updateOffering(user.id, institutionId, offeringId, input)
  }

  @Get('offerings/:offeringId/roster')
  @Header('Cache-Control', 'private, no-store')
  roster(
    @CurrentUser() user: AuthUser,
    @Param('institutionId') institutionId: string,
    @Param('offeringId') offeringId: string,
  ) {
    return this.admin.getRoster(user.id, institutionId, offeringId)
  }

  @Post('offerings/:offeringId/lecturers')
  @ApiBody({ type: CreateLecturerAssignmentDto })
  assignLecturer(
    @CurrentUser() user: AuthUser,
    @Param('institutionId') institutionId: string,
    @Param('offeringId') offeringId: string,
    @Body() input: CreateLecturerAssignmentDto,
  ) {
    return this.admin.createLecturerAssignment(
      user.id,
      institutionId,
      offeringId,
      input,
    )
  }

  @Post('offerings/:offeringId/students')
  @ApiBody({ type: CreateEnrollmentDto })
  enrollStudent(
    @CurrentUser() user: AuthUser,
    @Param('institutionId') institutionId: string,
    @Param('offeringId') offeringId: string,
    @Body() input: CreateEnrollmentDto,
  ) {
    return this.admin.createEnrollment(
      user.id,
      institutionId,
      offeringId,
      input,
    )
  }

  @Patch('lecturer-assignments/:assignmentId')
  @ApiBody({ type: EndAcademicParticipationDto })
  endAssignment(
    @CurrentUser() user: AuthUser,
    @Param('institutionId') institutionId: string,
    @Param('assignmentId') assignmentId: string,
    @Body() input: EndAcademicParticipationDto,
  ) {
    return this.admin.endLecturerAssignment(
      user.id,
      institutionId,
      assignmentId,
      input,
    )
  }

  @Patch('enrollments/:enrollmentId')
  @ApiBody({ type: EndAcademicParticipationDto })
  endEnrollment(
    @CurrentUser() user: AuthUser,
    @Param('institutionId') institutionId: string,
    @Param('enrollmentId') enrollmentId: string,
    @Body() input: EndAcademicParticipationDto,
  ) {
    return this.admin.endEnrollment(user.id, institutionId, enrollmentId, input)
  }
}
