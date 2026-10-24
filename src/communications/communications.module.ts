import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { FileStorageService } from "../common/file-storage.service";
import { PrismaModule } from "../prisma/prisma.module";
import {
  CommunicationsController,
  DocumentDownloadController,
  ParentCommunicationsController,
  StudentCommunicationsController,
} from "./communications.controller";
import { CommunicationsService } from "./communications.service";
import { NotificationWorker } from "./notification-worker";

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [
    CommunicationsController,
    ParentCommunicationsController,
    StudentCommunicationsController,
    DocumentDownloadController,
  ],
  providers: [CommunicationsService, FileStorageService, NotificationWorker],
})
export class CommunicationsModule {}
