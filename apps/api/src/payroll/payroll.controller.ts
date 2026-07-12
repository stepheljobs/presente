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
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/roles';
import { PayrollService } from './payroll.service';
import type { RunStatus } from './state-machine';

class StartRunDto {
  @IsOptional()
  @IsString()
  start?: string;

  @IsOptional()
  @IsString()
  end?: string;
}

class TransitionDto {
  @IsIn(['draft', 'reviewed', 'approved', 'exported'])
  status!: RunStatus;
}

class OtAdjustDto {
  @IsUUID()
  workerId!: string;

  @IsString()
  @MinLength(10)
  day!: string;

  @IsNumber()
  deltaHours!: number;

  @IsString()
  @MinLength(3)
  reason!: string;
}

class AdjustmentDto {
  @IsUUID()
  workerId!: string;

  @IsNumber()
  amount!: number;

  @IsString()
  @MinLength(3)
  note!: string;
}

class WaiveDto {
  @IsString()
  @MinLength(3)
  note!: string;
}

class OtEligibleDto {
  @IsOptional()
  @IsUUID()
  siteId?: string;

  @IsOptional()
  @IsUUID()
  workerId?: string;

  @IsBoolean()
  otEligible!: boolean;
}

class ApproveRoleDto {
  @IsIn(['admin', 'owner'])
  approveRole!: 'admin' | 'owner';
}

@Controller('payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Roles('owner', 'admin')
  @Get('runs')
  list(@CurrentUser() user: AuthUser) {
    return this.payroll.listRuns(user);
  }

  @Roles('owner', 'admin')
  @Get('suggest-period')
  suggest(@CurrentUser() user: AuthUser) {
    return this.payroll.suggestPeriod(user);
  }

  @Roles('owner', 'admin')
  @Post('runs')
  start(@Body() dto: StartRunDto, @CurrentUser() user: AuthUser) {
    return this.payroll.startRun(
      user,
      dto.start && dto.end ? { start: dto.start, end: dto.end } : undefined,
    );
  }

  @Roles('owner', 'admin')
  @Get('runs/:id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.payroll.getRun(user, id);
  }

  @Roles('owner', 'admin')
  @Post('runs/:id/recompute')
  @HttpCode(200)
  recompute(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.payroll.recompute(user, id);
  }

  @Roles('owner', 'admin')
  @Post('runs/:id/transition')
  @HttpCode(200)
  transition(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransitionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.payroll.transition(user, id, dto.status);
  }

  @Roles('owner', 'admin')
  @Post('runs/:id/ot-adjustments')
  @HttpCode(200)
  otAdjust(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OtAdjustDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.payroll.addOtAdjustment(user, id, dto);
  }

  @Roles('owner', 'admin')
  @Post('runs/:id/adjustments')
  @HttpCode(200)
  adjustment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.payroll.addAdjustment(user, id, dto);
  }

  @Roles('owner', 'admin')
  @Post('runs/:id/post-approval-correction')
  @HttpCode(200)
  postApproval(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.payroll.postApprovalCorrection(user, id, dto);
  }

  @Roles('owner', 'admin')
  @Post('exceptions/:id/waive')
  @HttpCode(200)
  waive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WaiveDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.payroll.waiveException(user, id, dto.note);
  }

  @Roles('owner', 'admin')
  @Post('ot-eligible')
  @HttpCode(200)
  otEligible(@Body() dto: OtEligibleDto, @CurrentUser() user: AuthUser) {
    return this.payroll.setOtEligible(user, dto);
  }

  @Roles('owner')
  @Post('approve-role')
  @HttpCode(200)
  approveRole(@Body() dto: ApproveRoleDto, @CurrentUser() user: AuthUser) {
    return this.payroll.setApproveRole(user, dto.approveRole);
  }

  @Roles('owner', 'admin')
  @Get('runs/:id/export')
  async export(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('format') format: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const allowed = [
      'csv',
      'xlsx',
      'signature-pdf',
      'payslips-zip',
    ] as const;
    type Fmt = (typeof allowed)[number];
    const fmt: Fmt = (allowed as readonly string[]).includes(format)
      ? (format as Fmt)
      : 'csv';
    const file = await this.payroll.export(user, id, fmt);
    res.set({
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'X-Export-Hash': file.hash,
    });
    return new StreamableFile(file.body);
  }
}
