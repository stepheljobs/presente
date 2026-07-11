import { Module } from '@nestjs/common';
import { CaptureService } from './capture.service';
import {
  ExceptionsController,
  ExceptionSweepJob,
  LookalikesController,
} from './exceptions.controller';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  controllers: [SessionsController, ExceptionsController, LookalikesController],
  providers: [SessionsService, CaptureService, ExceptionSweepJob],
  exports: [CaptureService],
})
export class SessionsModule {}
