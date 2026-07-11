import { Module, forwardRef } from '@nestjs/common';
import { DayRecordsModule } from '../day-records/day-records.module';
import { CaptureService } from './capture.service';
import {
  ExceptionsController,
  ExceptionSweepJob,
  LookalikesController,
} from './exceptions.controller';
import {
  SessionsController,
  WorkerDaysController,
} from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  imports: [forwardRef(() => DayRecordsModule)],
  controllers: [
    SessionsController,
    ExceptionsController,
    LookalikesController,
    WorkerDaysController,
  ],
  providers: [SessionsService, CaptureService, ExceptionSweepJob],
  exports: [CaptureService],
})
export class SessionsModule {}
