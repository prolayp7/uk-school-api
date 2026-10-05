import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { AcademicController } from "./academic.controller";
import { AcademicService } from "./academic.service";

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [AcademicController],
  providers: [AcademicService],
})
export class AcademicModule {}
