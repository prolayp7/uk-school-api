import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { AcademicController, ParentAcademicController, StudentAcademicController } from "./academic.controller";
import { AcademicService } from "./academic.service";

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [AcademicController, ParentAcademicController, StudentAcademicController],
  providers: [AcademicService],
})
export class AcademicModule {}
