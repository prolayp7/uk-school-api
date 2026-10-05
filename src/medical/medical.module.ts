import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { MedicalController, ParentMedicalController } from "./medical.controller";
import { MedicalService } from "./medical.service";

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [MedicalController, ParentMedicalController],
  providers: [MedicalService],
})
export class MedicalModule {}
