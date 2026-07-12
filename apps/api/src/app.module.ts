import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AppConfigController } from './config/app-config.controller';
import { DatabaseModule } from './database/database.module';
import { InvitesModule } from './invites/invites.module';
import { MessagingModule } from './messaging/dispatcher';
import { SessionsModule } from './sessions/sessions.module';
import { RecognitionModule } from './recognition/provider';
import { SettingsModule } from './settings/settings.module';
import { SitesModule } from './sites/sites.module';
import { UploadsModule } from './uploads/uploads.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DayRecordsModule } from './day-records/day-records.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PayrollModule } from './payroll/payroll.module';
import { WorkersModule } from './workers/workers.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    AuditModule,
    MessagingModule,
    AuthModule,
    InvitesModule,
    SessionsModule,
    SettingsModule,
    SitesModule,
    RecognitionModule,
    WorkersModule,
    UploadsModule,
    DayRecordsModule,
    PayrollModule,
    DashboardModule,
    NotificationsModule,
  ],
  controllers: [AppController, AppConfigController],
})
export class AppModule {}
