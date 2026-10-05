import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { ParentSupportController, SupportController } from "./support.controller";
import { SupportService } from "./support.service";

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [SupportController, ParentSupportController],
  providers: [SupportService],
})
export class SupportModule {}
