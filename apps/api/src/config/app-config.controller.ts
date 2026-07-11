import { Controller, Get } from '@nestjs/common';
import { CONSENT_NOTICE } from './consent-notice';

/**
 * Server-held configuration the mobile app reads at runtime:
 * - consent copy (E3-S03) so counsel can revise wording without an app release
 * - enrollment quality thresholds (E3-S08), remotely tunable via env
 */
@Controller('config')
export class AppConfigController {
  @Get('consent-notice')
  consentNotice() {
    return CONSENT_NOTICE;
  }

  @Get('enrollment-quality')
  enrollmentQuality() {
    return {
      // Crude blur proxy: JPEG bytes per pixel below this suggests a
      // blurry/featureless shot. Tuned during Alpha field calibration.
      minJpegBytesPerPixel: Number(process.env.QUALITY_MIN_BPP ?? 0.08),
      minWidthPx: Number(process.env.QUALITY_MIN_WIDTH ?? 720),
      // Mean luma bounds (0–255) for under/over-exposure detection.
      minMeanLuma: Number(process.env.QUALITY_MIN_LUMA ?? 40),
      maxMeanLuma: Number(process.env.QUALITY_MAX_LUMA ?? 220),
    };
  }
}
