import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AuthController } from "./auth.controller";
import { AuthGuard, SuperAdminGuard } from "./auth.guard";
import { AUTH_MAILER } from "./auth.constants";
import { AuthMailer } from "./auth.mailer";
import { AuthService } from "./auth.service";

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, SuperAdminGuard, { provide: AUTH_MAILER, useClass: AuthMailer }],
  exports: [AuthService, AuthGuard, SuperAdminGuard],
})
export class AuthModule {}
