import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import { CurrentUser, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/roles';
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
}

@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

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
}
