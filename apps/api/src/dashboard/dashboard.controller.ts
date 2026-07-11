import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/roles';
import { DashboardService } from './dashboard.service';

class AdminTagDto {
  @IsIn(['tag', 'retag', 'untag'])
  action!: 'tag' | 'retag' | 'untag';

  @IsOptional()
  @IsUUID()
  tagId?: string;

  @IsOptional()
  @IsUUID()
  workerId?: string;

  @IsOptional()
  @IsUUID()
  photoId?: string;

  @IsString()
  @MinLength(3)
  reason!: string;
}

class ResolveTypedDto {
  @IsIn([
    'set_halfday',
    'set_out_time',
    'mark_absent_pm',
    'approve_manual',
    'reject_manual',
    'accept_geofence',
    'reject_session',
    'keep_engineer',
    'use_recognition',
    'mark_absent',
    'resolve',
    'waive',
  ])
  resolution!:
    | 'set_halfday'
    | 'set_out_time'
    | 'mark_absent_pm'
    | 'approve_manual'
    | 'reject_manual'
    | 'accept_geofence'
    | 'reject_session'
    | 'keep_engineer'
    | 'use_recognition'
    | 'mark_absent'
    | 'resolve'
    | 'waive';

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  outTime?: string;

  @IsOptional()
  @IsUUID()
  workerId?: string;
}

class EvidenceDto {
  @IsOptional()
  @IsUUID()
  workerId?: string;

  @IsOptional()
  @IsUUID()
  engineerId?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Roles('owner', 'admin')
  @Get('today')
  today(@CurrentUser() user: AuthUser) {
    return this.dashboard.todayHeadcount(user);
  }

  @Roles('owner', 'admin')
  @Get('photos')
  photos(
    @CurrentUser() user: AuthUser,
    @Query('limit') limit?: string,
  ) {
    return this.dashboard.photoFeed(user, limit ? Number(limit) : 40);
  }

  @Roles('owner', 'admin')
  @Get('devices')
  devices(@CurrentUser() user: AuthUser) {
    return this.dashboard.deviceSyncStatus(user);
  }

  @Roles('owner', 'admin')
  @Get('sessions/:id')
  session(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.dashboard.sessionForTagging(user, id);
  }

  @Roles('owner', 'admin')
  @Post('sessions/:id/admin-tag')
  @HttpCode(200)
  adminTag(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminTagDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.dashboard.adminTag(user, id, dto);
  }

  @Roles('owner', 'admin')
  @Get('reports/attendance')
  attendanceReport(
    @CurrentUser() user: AuthUser,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('siteId') siteId?: string,
  ) {
    return this.dashboard.attendanceSummary(user, { from, to, siteId });
  }

  @Roles('owner', 'admin')
  @Get('reports/ot')
  otReport(
    @CurrentUser() user: AuthUser,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.dashboard.otReport(user, { from, to });
  }

  @Roles('owner', 'admin')
  @Get('reports/exceptions')
  exceptionTrends(
    @CurrentUser() user: AuthUser,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.dashboard.exceptionTrends(user, { from, to });
  }

  @Roles('owner', 'admin')
  @Get('padding')
  padding(@CurrentUser() user: AuthUser) {
    return this.dashboard.paddingIndicators(user);
  }

  @Roles('owner', 'admin')
  @Post('evidence-pack')
  @HttpCode(200)
  async evidence(
    @Body() dto: EvidenceDto,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const pack = await this.dashboard.evidencePack(user, dto);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${pack.filename}"`,
      'X-Export-Hash': pack.hash,
    });
    return new StreamableFile(pack.body);
  }
}

@Controller('exceptions')
export class ExceptionResolveController {
  constructor(private readonly dashboard: DashboardService) {}

  /** Typed resolvers (E8-S06–S09); coexists with generic resolve on Sessions module. */
  @Roles('owner', 'admin')
  @Post(':id/resolve-typed')
  @HttpCode(200)
  resolveTyped(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveTypedDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.dashboard.resolveTyped(user, id, dto);
  }
}
