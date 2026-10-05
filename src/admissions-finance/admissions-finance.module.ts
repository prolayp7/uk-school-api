import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import {
  AdmissionsController,
  FinanceController,
  ParentAdmissionsController,
  ParentFinanceController,
  PaymentWebhookController,
  WebsiteAdmissionsController,
} from "./admissions-finance.controller";
import { AdmissionsService } from "./admissions.service";
import { FinanceService } from "./finance.service";
import { PaymentProviderService } from "./payment-provider.service";

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [
    WebsiteAdmissionsController,
    AdmissionsController,
    ParentAdmissionsController,
    FinanceController,
    ParentFinanceController,
    PaymentWebhookController,
  ],
  providers: [AdmissionsService, FinanceService, PaymentProviderService],
})
export class AdmissionsFinanceModule {}
