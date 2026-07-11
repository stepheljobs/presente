import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CurrentUser, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/roles';
import { CaptureService } from './capture.service';
import { SessionsService } from './sessions.service';

export class IngestSessionDto {
  @IsIn(['time_in', 'time_out'])
  type!: 'time_in' | 'time_out';

  @IsOptional()
  @IsUUID()
  siteId?: string;

  @IsString()
  @MinLength(1)
  deviceId!: string;

  /** Device clock at the moment of capture (may be days old for offline queues). */
  @IsISO8601()
  deviceCapturedAt!: string;

  /** Device clock at the moment of upload — drift is measured against this. */
  @IsISO8601()
  deviceSentAt!: string;

  @IsOptional()
  @IsObject()
  @Type(() => Object)
  payload?: Record<string, unknown>;

  /** E4-S05: best-effort GPS fix; explicit no-fix is a first-class state. */
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @IsIn(['fix', 'no_fix'])
  gpsStatus?: 'fix' | 'no_fix';

  /** E4-S07: flags, never blocks. */
  @IsOptional()
  @IsBoolean()
  mockLocation?: boolean;
}

class SessionPhotoDto {
  @IsString()
  @MinLength(1)
  storageKey!: string;

  @IsOptional()
  @IsString()
  sha256?: string;
}

class SubmitPhotosDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SessionPhotoDto)
  photos!: SessionPhotoDto[];
}

class TagActionDto {
  @IsIn(['confirm', 'manual', 'visitor'])
  type!: 'confirm' | 'manual' | 'visitor';

  @IsOptional()
  @IsUUID()
  tagId?: string;

  @IsOptional()
  @IsBoolean()
  accept?: boolean;

  @IsOptional()
  @IsUUID()
  workerId?: string;

  @IsOptional()
  @IsUUID()
  photoId?: string;
}

class ReconcileDto {
  @IsUUID()
  workerId!: string;

  @IsIn(['left_early', 'leave_exception'])
  action!: 'left_early' | 'leave_exception';

  @IsOptional()
  @IsString()
  note?: string;
}

@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessionsService: SessionsService,
    private readonly captureService: CaptureService,
  ) {}

  @Roles('engineer')
  @Put(':uuid')
  @HttpCode(200)
  ingest(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() dto: IngestSessionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sessionsService.ingest(uuid, dto, user);
  }

  @Get(':uuid')
  get(@Param('uuid', ParseUUIDPipe) uuid: string, @CurrentUser() user: AuthUser) {
    return this.captureService.getSession(user, uuid);
  }

  @Roles('engineer')
  @Post(':uuid/photos')
  submitPhotos(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() dto: SubmitPhotosDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.captureService.submitPhotos(user, uuid, dto.photos);
  }

  /** E4-S09: photos left `pending recognition` by a provider outage. */
  @Roles('engineer')
  @Post(':uuid/photos/retry-recognition')
  @HttpCode(200)
  async retryRecognition(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.captureService.runRecognition(user.tenantId, uuid);
    return this.captureService.getSession(user, uuid);
  }

  @Roles('engineer')
  @Post(':uuid/tags')
  @HttpCode(200)
  tagAction(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() dto: TagActionDto,
    @CurrentUser() user: AuthUser,
  ) {
    if (dto.type === 'confirm' && (!dto.tagId || dto.accept === undefined)) {
      throw new BadRequestException('confirm requires tagId and accept');
    }
    if (dto.type === 'manual' && !dto.workerId) {
      throw new BadRequestException('manual requires workerId');
    }
    return this.captureService.applyTagAction(
      user,
      uuid,
      dto.type === 'confirm'
        ? {
            type: 'confirm',
            tagId: dto.tagId!,
            accept: dto.accept!,
            workerId: dto.workerId,
          }
        : dto.type === 'manual'
          ? { type: 'manual', workerId: dto.workerId!, photoId: dto.photoId }
          : { type: 'visitor', photoId: dto.photoId, tagId: dto.tagId },
    );
  }

  @Roles('engineer')
  @Get(':uuid/reconciliation')
  reconciliation(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.captureService.reconciliation(user, uuid);
  }

  @Roles('engineer')
  @Post(':uuid/reconciliation')
  @HttpCode(200)
  reconcile(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() dto: ReconcileDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.captureService.reconcileWorker(
      user,
      uuid,
      dto.workerId,
      dto.action,
      dto.note,
    );
  }
}
