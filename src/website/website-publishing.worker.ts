import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { WebsiteService } from "./website.service";

const POLL_INTERVAL_MS = 30_000;

@Injectable()
export class WebsitePublishingWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebsitePublishingWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(private readonly website: WebsiteService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test") return;
    this.timer = setInterval(() => {
      void this.publishDuePages();
    }, POLL_INTERVAL_MS);
    this.timer.unref();
    void this.publishDuePages();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async publishDuePages(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const published = await this.website.processScheduledPublications();
      if (published > 0) this.logger.log(`Published ${published} scheduled website page(s).`);
    } catch (error) {
      this.logger.error(`Scheduled website publication failed (${error instanceof Error ? error.name : "UnknownError"}).`);
    } finally {
      this.running = false;
    }
  }
}
