import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { InvitesModule } from './invites/invites.module';
import { MessagingModule } from './messaging/dispatcher';
import { SessionsModule } from './sessions/sessions.module';
import { SettingsModule } from './settings/settings.module';
import { SitesModule } from './sites/sites.module';
import { UploadsModule } from './uploads/uploads.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AuditModule,
    MessagingModule,
    AuthModule,
    InvitesModule,
    SessionsModule,
    SettingsModule,
    SitesModule,
    UploadsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
