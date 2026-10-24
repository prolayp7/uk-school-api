import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { CommunicationsService } from "./communications.service";

const POLL_INTERVAL_MS = 5_000;

@Injectable()
export class NotificationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(private readonly communications: CommunicationsService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test") return;
    this.timer = setInterval(() => {
      void this.runBatch();
    }, POLL_INTERVAL_MS);
    this.timer.unref();
    void this.runBatch();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async runBatch(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.communications.processNotificationOutboxBatch();
    } catch (error) {
      const reason = error instanceof Error ? error.name : "UnknownError";
      this.logger.error(`Notification outbox batch failed (${reason}).`);
    } finally {
      this.running = false;
    }
  }
}
