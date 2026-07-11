import { Global, Injectable, Logger, Module } from '@nestjs/common';

export interface RecognitionProvider {
  /** Index a worker's enrollment photos; returns the provider face/template id. */
  indexFaces(input: {
    tenantId: string;
    workerId: string;
    photoKeys: string[];
  }): Promise<{ faceId: string }>;

  /** Delete a worker's template provider-side; must confirm deletion (E3-S12). */
  deleteFaces(input: {
    tenantId: string;
    faceId: string;
  }): Promise<{ deleted: boolean }>;

  /**
   * E4-S09: detect + match every face in a session photo against the
   * candidate roster. workerId null = face detected but unmatched.
   */
  searchFaces(input: {
    tenantId: string;
    photoKey: string;
    candidates: { workerId: string; faceId: string }[];
  }): Promise<{ faces: { workerId: string | null; confidence: number }[] }>;
}

export const RECOGNITION_PROVIDER = Symbol('RECOGNITION_PROVIDER');

/**
 * Dev stand-in for the managed cloud service (PRD §7 — AWS Rekognition or
 * equivalent, decided but not yet provisioned). Deterministic ids so tests
 * and downstream stories can build against the real interface.
 */
@Injectable()
export class StubRecognitionProvider implements RecognitionProvider {
  private readonly logger = new Logger('Recognition');

  async indexFaces(input: {
    tenantId: string;
    workerId: string;
    photoKeys: string[];
  }): Promise<{ faceId: string }> {
    this.logger.log(
      `STUB indexFaces worker=${input.workerId} photos=${input.photoKeys.length}`,
    );
    return { faceId: `stub-face-${input.workerId}` };
  }

  async deleteFaces(input: {
    tenantId: string;
    faceId: string;
  }): Promise<{ deleted: boolean }> {
    this.logger.log(`STUB deleteFaces faceId=${input.faceId}`);
    return { deleted: true };
  }

  async searchFaces(input: {
    tenantId: string;
    photoKey: string;
    candidates: { workerId: string; faceId: string }[];
  }): Promise<{ faces: { workerId: string | null; confidence: number }[] }> {
    this.logger.log(
      `STUB searchFaces photo=${input.photoKey} candidates=${input.candidates.length}`,
    );
    // No detection capability in the stub — photos stay taggable manually.
    return { faces: [] };
  }
}

@Global()
@Module({
  providers: [
    { provide: RECOGNITION_PROVIDER, useClass: StubRecognitionProvider },
  ],
  exports: [RECOGNITION_PROVIDER],
})
export class RecognitionModule {}
