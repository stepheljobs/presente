import { Body, Controller, Get, Put } from '@nestjs/common';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { CurrentUser, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/roles';
import { SettingsService } from './settings.service';

class SettingsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  workdays!: number[];

  @IsNumber()
  @Min(1)
  @Max(24)
  standardWorkdayHours!: number;

  /** 1.25 = 125%. Anything below 100% would pay OT less than base. */
  @IsNumber()
  @Min(1)
  @Max(5)
  otMultiplier!: number;

  @IsInt()
  @Min(0)
  @Max(240)
  lateGraceMinutes!: number;

  @IsIn(['hours_threshold', 'cutoff_time'])
  halfdayRule!: 'hours_threshold' | 'cutoff_time';

  @IsNumber()
  @Min(0.5)
  @Max(12)
  halfdayThresholdHours!: number;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'halfdayCutoffTime must be HH:MM',
  })
  halfdayCutoffTime!: string;

  @IsInt()
  @Min(1)
  @Max(7)
  payrollWeekStartDay!: number;
}

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.settingsService.get(user.tenantId);
  }

  @Roles('owner')
  @Put()
  update(@Body() dto: SettingsDto, @CurrentUser() user: AuthUser) {
    return this.settingsService.update(user.tenantId, user.sub, dto);
  }
}
