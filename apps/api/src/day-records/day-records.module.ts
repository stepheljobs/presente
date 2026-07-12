import { Module } from '@nestjs/common';
import { CorrectionsService } from './corrections.service';
import {
  CorrectionsController,
  DayRecordsController,
} from './day-records.controller';
import { DayRecordsService } from './day-records.service';

@Module({
  controllers: [DayRecordsController, CorrectionsController],
  providers: [DayRecordsService, CorrectionsService],
  exports: [DayRecordsService, CorrectionsService],
})
export class DayRecordsModule {}
