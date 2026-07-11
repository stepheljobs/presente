import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';

// Point the app at the test database before AppModule reads config.
// process.env wins over .env in @nestjs/config.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://presente_app:presente_app_dev@localhost:5432/presente_test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';

export const OWNER_URL =
  process.env.TEST_OWNER_DATABASE_URL ??
  'postgres://localhost:5432/presente_test';

/** RLS-exempt pool for seeding and asserting on raw table state. */
export function ownerPool(): Pool {
  return new Pool({ connectionString: OWNER_URL });
}

export async function createTestApp(): Promise<INestApplication> {
  // require() so the env assignments above run before AppModule's
  // ConfigModule initializes (a static import would hoist past them).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AppModule } = require('../src/app.module');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}
