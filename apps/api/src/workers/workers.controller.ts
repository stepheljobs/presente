import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
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
  Matches,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/roles';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../database/database.service';
import { CSV_MAX_ROWS, parseWorkersCsv } from './csv-import';
import { EnrollmentService } from './enrollment.service';
import { WorkersService } from './workers.service';

class WorkerDto {
  @IsString()
  @MinLength(2)
  fullName!: string;

  @IsOptional()
  @IsString()
  nickname?: string;

  @IsOptional()
  @IsString()
  photoKey?: string;

  @IsOptional()
  @IsString()
  position?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  dailyRate?: number;

  @IsOptional()
  @Matches(/^\+?[0-9 -]{7,20}$/, { message: 'phone must be a valid number' })
  phone?: string;

  @IsOptional()
  @IsString()
  govId?: string;

  /** E6-S08: register without biometrics (manual attendance). */
  @IsOptional()
  @IsBoolean()
  noBiometricConsent?: boolean;

  @IsOptional()
  @IsISO8601()
  startDate?: string;
}

class ApproveDto {
  @IsNumber()
  @Min(0)
  dailyRate!: number;
}

class RejectDto {
  @IsString()
  @MinLength(3)
  note!: string;
}

class DeactivateDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'endDate must be YYYY-MM-DD' })
  endDate!: string;
}

class ConsentDto {
  @IsIn(['signature', 'paper'])
  type!: 'signature' | 'paper';

  @IsString()
  @MinLength(1)
  artifactKey!: string;

  @IsOptional()
  @IsObject()
  strokeData?: Record<string, unknown>;

  @IsIn(['en', 'tl'])
  language!: 'en' | 'tl';
}

class EnrollmentPhotoDto {
  @IsIn(['front', 'left', 'right', 'hard_hat'])
  pose!: 'front' | 'left' | 'right' | 'hard_hat';

  @IsString()
  @MinLength(1)
  storageKey!: string;

  @IsOptional()
  @IsString()
  sha256?: string;
}

class SubmitEnrollmentDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => EnrollmentPhotoDto)
  photos!: EnrollmentPhotoDto[];
}

class CsvImportDto {
  @IsString()
  @MinLength(1)
  csv!: string;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

@Controller('workers')
export class WorkersController {
  constructor(
    private readonly workersService: WorkersService,
    private readonly enrollmentService: EnrollmentService,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  create(@Body() dto: WorkerDto, @CurrentUser() user: AuthUser) {
    return this.workersService.create(user, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('siteId') siteId?: string,
    @Query('status') status?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('pageSize', new DefaultValuePipe(50), ParseIntPipe) pageSize = 50,
  ) {
    return this.workersService.list(user, {
      siteId,
      status,
      page: Math.max(1, page),
      pageSize: Math.min(Math.max(1, pageSize), 500),
    });
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.workersService.get(user, id);
  }

  @Roles('owner', 'admin')
  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WorkerDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.workersService.update(user, id, dto);
  }

  @Roles('owner', 'admin')
  @Post(':id/approve')
  @HttpCode(200)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.workersService.approve(user, id, dto.dailyRate);
  }

  @Roles('owner', 'admin')
  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.workersService.reject(user, id, dto.note);
  }

  @Roles('owner', 'admin')
  @Post(':id/deactivate')
  @HttpCode(200)
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeactivateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.workersService.deactivate(user, id, dto.endDate);
  }

  @Post(':id/consents')
  addConsent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConsentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.enrollmentService.addConsent(user, id, dto);
  }

  @Post(':id/enrollment')
  submitEnrollment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitEnrollmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.enrollmentService.submitPhotos(
      user,
      id,
      dto.photos.map((p) => ({
        pose: p.pose,
        storageKey: p.storageKey,
        sha256: p.sha256,
      })),
    );
  }

  @Roles('owner', 'admin')
  @Delete(':id/biometrics')
  deleteBiometrics(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.enrollmentService.deleteBiometrics(user, id);
  }

  /** E3-S13: dry-run returns the row-level error report without writing. */
  @Roles('owner', 'admin')
  @Post('import')
  @HttpCode(200)
  async import(@Body() dto: CsvImportDto, @CurrentUser() user: AuthUser) {
    const { rows, errors } = parseWorkersCsv(dto.csv);
    if (dto.dryRun || errors.length > 0) {
      return { dryRun: true, valid: rows.length, errors, imported: 0 };
    }
    if (rows.length === 0) {
      throw new BadRequestException('No rows to import');
    }
    const imported = await this.db.withTenant(user.tenantId, async (client) => {
      for (const row of rows) {
        await client.query(
          `INSERT INTO workers (tenant_id, full_name, position, daily_rate, created_by)
           VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                   $1, $2, $3, $4)`,
          [row.fullName, row.position ?? null, row.dailyRate ?? null, user.sub],
        );
      }
      await this.audit.log(client, {
        actor: user.sub,
        action: 'worker.import',
        entity: 'workers',
        after: { count: rows.length, maxRows: CSV_MAX_ROWS },
      });
      return rows.length;
    });
    return { dryRun: false, valid: rows.length, errors: [], imported };
  }
}

@Controller('sites/:siteId/workers')
export class RosterController {
  constructor(private readonly workersService: WorkersService) {}

  /** Owner/admin: any site. Engineer: only sites they are assigned to. */
  @Roles('owner', 'admin', 'engineer')
  @Post(':workerId')
  add(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('workerId', ParseUUIDPipe) workerId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.workersService.addToSite(user, siteId, workerId);
  }

  @Roles('owner', 'admin', 'engineer')
  @Delete(':workerId')
  remove(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('workerId', ParseUUIDPipe) workerId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.workersService.removeFromSite(user, siteId, workerId);
  }
}
