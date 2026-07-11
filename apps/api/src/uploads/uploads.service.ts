import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

export const UPLOAD_CATEGORIES = [
  'session-photo',
  'enrollment-photo',
  'consent',
] as const;
export type UploadCategory = (typeof UPLOAD_CATEGORIES)[number];

export const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

/**
 * The bucket is private: nothing is readable or writable without a signed
 * URL, so an unsigned direct PUT is rejected by the store itself. Keys are
 * prefixed per tenant, mirroring the DB isolation model.
 */
@Injectable()
export class UploadsService {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly ttlSeconds: number;

  constructor(config: ConfigService) {
    this.s3 = new S3Client({
      endpoint: config.getOrThrow<string>('STORAGE_ENDPOINT'),
      region: config.getOrThrow<string>('STORAGE_REGION'),
      credentials: {
        accessKeyId: config.getOrThrow<string>('STORAGE_ACCESS_KEY_ID'),
        secretAccessKey: config.getOrThrow<string>(
          'STORAGE_SECRET_ACCESS_KEY',
        ),
      },
      forcePathStyle: true,
    });
    this.bucket = config.getOrThrow<string>('STORAGE_BUCKET');
    this.ttlSeconds = Number(config.get('UPLOAD_URL_TTL_SECONDS', '900'));
  }

  async signUpload(
    tenantId: string,
    category: UploadCategory,
    contentType: string,
  ) {
    const ext = ALLOWED_CONTENT_TYPES[contentType];
    const key = `tenants/${tenantId}/${category}/${randomUUID()}${ext}`;
    const url = await getSignedUrl(
      this.s3,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn: this.ttlSeconds },
    );
    return { url, key, expiresInSeconds: this.ttlSeconds };
  }
}
