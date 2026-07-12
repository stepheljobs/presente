import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/roles';
import { CorrectionsService } from './corrections.service';
import { DayRecordsService, type DayStatus } from './day-records.service';

class RecomputeDto {
  @IsString()
  @MinLength(10)
  day!: string;
}

class AdminEditDto {
  @IsOptional()
  @IsISO8601()
  timeIn?: string | null;

  @IsOptional()
  @IsISO8601()
  timeOut?: string | null;

  @IsOptional()
  @IsIn(['present', 'halfday', 'absent', 'ot_candidate'])
  status?: DayStatus;

  @IsString()
  @MinLength(3)
  reason!: string;
}

class ManualPresentDto {
  @IsUUID()
  workerId!: string;

  @IsUUID()
  siteId!: string;

  @IsString()
  @MinLength(10)
  day!: string;

  @IsOptional()
  @IsISO8601()
  timeIn?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

class ProposedDto {
  @IsOptional()
  @IsISO8601()
  timeIn?: string | null;

  @IsOptional()
  @IsISO8601()
  timeOut?: string | null;

  @IsOptional()
  @IsIn(['present', 'halfday', 'absent', 'ot_candidate'])
  status?: DayStatus;
}

class CorrectionCreateDto {
  @IsOptional()
  @IsUUID()
  dayRecordId?: string;

  @IsUUID()
  workerId!: string;

  @IsOptional()
  @IsUUID()
  siteId?: string;

  @IsString()
  @MinLength(10)
  day!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => ProposedDto)
  proposed!: ProposedDto;

  @IsString()
  @MinLength(3)
  reason!: string;

  @IsOptional()
  @IsString()
  photoKey?: string;
}

class CorrectionReviewDto {
  @IsIn(['approved', 'rejected'])
  decision!: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  note?: string;
}

@Controller('day-records')
export class DayRecordsController {
  constructor(private readonly days: DayRecordsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('day') day?: string,
    @Query('workerId') workerId?: string,
    @Query('siteId') siteId?: string,
  ) {
    return this.days.list(user, { day, workerId, siteId });
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.days.get(user, id);
  }

  @Roles('owner', 'admin')
  @Post('recompute')
  @HttpCode(200)
  recompute(@Body() dto: RecomputeDto, @CurrentUser() user: AuthUser) {
    return this.days
      .recomputeDay(user.tenantId, dto.day)
      .then((written) => ({ written, day: dto.day }));
  }

  @Roles('owner', 'admin')
  @Put(':id')
  adminEdit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminEditDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.days.adminEdit(user, id, dto);
  }

  @Roles('owner', 'admin', 'engineer')
  @Post('manual-present')
  @HttpCode(200)
  manualPresent(
    @Body() dto: ManualPresentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.days.markManualPresent(user, dto);
  }
}

@Controller('corrections')
export class CorrectionsController {
  constructor(private readonly corrections: CorrectionsService) {}

  @Roles('engineer')
  @Post()
  create(@Body() dto: CorrectionCreateDto, @CurrentUser() user: AuthUser) {
    return this.corrections.create(user, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
  ) {
    return this.corrections.list(user, { status });
  }

  @Roles('owner', 'admin')
  @Post(':id/review')
  @HttpCode(200)
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CorrectionReviewDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.corrections.review(user, id, dto);
  }
}
