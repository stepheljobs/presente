import { Module } from '@nestjs/common';
import { NotificationJobs } from './notification.jobs';
import { NotificationService } from './notification.service';
import { NotificationsController } from './notifications.controller';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationService, NotificationJobs],
  exports: [NotificationService, NotificationJobs],
})
export class NotificationsModule {}
