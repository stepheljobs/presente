import { Module } from '@nestjs/common';
import {
  DashboardController,
  ExceptionResolveController,
} from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  controllers: [DashboardController, ExceptionResolveController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
