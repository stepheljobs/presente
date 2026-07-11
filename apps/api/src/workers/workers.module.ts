import { Module } from '@nestjs/common';
import { EnrollmentService } from './enrollment.service';
import { RosterController, WorkersController } from './workers.controller';
import { WorkersService } from './workers.service';

@Module({
  controllers: [WorkersController, RosterController],
  providers: [WorkersService, EnrollmentService],
  exports: [WorkersService, EnrollmentService],
})
export class WorkersModule {}
