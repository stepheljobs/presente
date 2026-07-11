import { Global, Injectable, Logger, Module } from '@nestjs/common';

export interface MessageDispatcher {
  sendEmail(to: string, subject: string, body: string): Promise<void>;
  sendSms(to: string, body: string): Promise<void>;
}

export const MESSAGE_DISPATCHER = Symbol('MESSAGE_DISPATCHER');

/**
 * Dev/stub dispatcher: logs instead of sending. Swap the provider binding
 * here (Resend/SES for email, Semaphore/Twilio for SMS) without touching
 * callers — E1-S03's "provider abstraction" requirement.
 */
@Injectable()
export class ConsoleDispatcher implements MessageDispatcher {
  private readonly logger = new Logger('Messaging');

  async sendEmail(to: string, subject: string, body: string): Promise<void> {
    this.logger.log(`EMAIL to=${to} subject="${subject}" body="${body}"`);
  }

  async sendSms(to: string, body: string): Promise<void> {
    this.logger.log(`SMS to=${to} body="${body}"`);
  }
}

@Global()
@Module({
  providers: [{ provide: MESSAGE_DISPATCHER, useClass: ConsoleDispatcher }],
  exports: [MESSAGE_DISPATCHER],
})
export class MessagingModule {}
