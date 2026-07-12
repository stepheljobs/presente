import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { NextFunction, Request, Response } from 'express';

/**
 * Laravel-style HTTP access log: method + path + status + duration.
 * Dual sink: Nest Logger (stdout) and storage/logs/access.log.
 * No bodies or query strings.
 */
@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');
  private readonly logFile: string;
  private dirReady: Promise<void> | null = null;

  constructor() {
    const configured = process.env.HTTP_LOG_FILE;
    this.logFile =
      configured && configured !== 'false'
        ? configured
        : join(process.cwd(), 'storage/logs/access.log');
  }

  use(req: Request, res: Response, next: NextFunction): void {
    if (!this.isEnabled()) {
      next();
      return;
    }

    const start = Date.now();
    res.on('finish', () => {
      const path = this.requestPath(req);
      if (path === '/health') return;

      const line = `${req.method} ${path} ${res.statusCode} ${Date.now() - start}ms`;
      this.logger.log(line);
      void this.appendToFile(line);
    });

    next();
  }

  private isEnabled(): boolean {
    if (process.env.HTTP_LOG === 'false') return false;
    if (process.env.NODE_ENV === 'test') return false;
    return true;
  }

  private requestPath(req: Request): string {
    if (typeof req.path === 'string' && req.path.length > 0) {
      return req.path;
    }
    const raw = req.originalUrl ?? req.url ?? '/';
    return raw.split('?')[0] || '/';
  }

  private ensureLogDir(): Promise<void> {
    if (!this.dirReady) {
      this.dirReady = mkdir(dirname(this.logFile), { recursive: true }).then(
        () => undefined,
      );
    }
    return this.dirReady;
  }

  private async appendToFile(line: string): Promise<void> {
    if (process.env.HTTP_LOG_FILE === 'false') return;

    try {
      await this.ensureLogDir();
      await appendFile(
        this.logFile,
        `${new Date().toISOString()} ${line}\n`,
        'utf8',
      );
    } catch (err) {
      this.logger.warn(
        `failed to write access log: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
