import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { AttendanceController, ParentAttendanceController, StudentAttendanceController } from "./attendance.controller";
import { AttendanceService } from "./attendance.service";

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [AttendanceController, ParentAttendanceController, StudentAttendanceController],
  providers: [AttendanceService],
})
export class AttendanceModule {}
