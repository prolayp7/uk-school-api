import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { PublicWebsiteController, WebsiteCmsController } from "./website.controller";
import { WebsitePublishingWorker } from "./website-publishing.worker";
import { WebsiteService } from "./website.service";

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [WebsiteCmsController, PublicWebsiteController],
  providers: [WebsiteService, WebsitePublishingWorker],
})
export class WebsiteModule {}
