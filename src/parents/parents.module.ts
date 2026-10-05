import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { FileStorageService } from "../common/file-storage.service";
import { PrismaModule } from "../prisma/prisma.module";
import { ParentsController } from "./parents.controller";
import { ParentsService } from "./parents.service";

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [ParentsController],
  providers: [FileStorageService, ParentsService],
})
export class ParentsModule {}