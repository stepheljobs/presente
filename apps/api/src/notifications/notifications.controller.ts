import { Body, Controller, Delete, HttpCode, Post } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { CurrentUser } from '../auth/decorators';
import type { AuthUser } from '../auth/roles';
import { NotificationService } from './notification.service';
import { NotificationJobs } from './notification.jobs';

class RegisterDeviceDto {
  @IsString()
  @MinLength(8)
  token!: string;

  @IsOptional()
  @IsIn(['android', 'ios', 'web'])
  platform?: 'android' | 'ios' | 'web';
}

class UnregisterDto {
  @IsString()
  @MinLength(8)
  token!: string;
}

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationService,
    private readonly jobs: NotificationJobs,
  ) {}

  /** E9-S01: register FCM / Expo push token for the current user. */
  @Post('devices')
  @HttpCode(200)
  register(@Body() dto: RegisterDeviceDto, @CurrentUser() user: AuthUser) {
    return this.notifications.registerDevice(user, dto);
  }

  @Delete('devices')
  @HttpCode(200)
  unregister(@Body() dto: UnregisterDto, @CurrentUser() user: AuthUser) {
    return this.notifications.unregisterDevice(user, dto.token);
  }

  /**
   * Dev/test hooks — trigger scheduled jobs on demand.
   * In production these are cron-only; kept unauthenticated-role-gated.
   */
  @Post('jobs/no-time-in')
  @HttpCode(200)
  async jobNoTimeIn(@CurrentUser() user: AuthUser) {
    if (user.role === 'engineer') {
      return { sent: 0, error: 'admin/owner only' };
    }
    const sent = await this.jobs.runNoTimeInReminders();
    return { sent };
  }

  @Post('jobs/admin-digest')
  @HttpCode(200)
  async jobAdminDigest(@CurrentUser() user: AuthUser) {
    if (user.role === 'engineer') {
      return { sent: 0, error: 'admin/owner only' };
    }
    const sent = await this.jobs.runAdminDigests();
    return { sent };
  }

  @Post('jobs/owner-weekly')
  @HttpCode(200)
  async jobOwnerWeekly(@CurrentUser() user: AuthUser) {
    if (user.role === 'engineer') {
      return { sent: 0, error: 'admin/owner only' };
    }
    const sent = await this.jobs.runOwnerWeeklySummaries();
    return { sent };
  }
}
