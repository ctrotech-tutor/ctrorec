import type { Request } from 'express'
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import type { AuthUser } from '../auth/auth-user.js'
import { LecturesService } from './lectures.service.js'

@Injectable()
export class LectureWriteGuard implements CanActivate {
  constructor(
    @Inject(LecturesService) private readonly lectures: LecturesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>()
    if (!request.user) {
      throw new UnauthorizedException()
    }
    await this.lectures.assertCanManageLecture(
      request.user.id,
      typeof request.params.lectureId === 'string'
        ? request.params.lectureId
        : '',
    )
    return true
  }
}
