import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  NotFoundException,
} from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard, SchoolAccessGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import {
  CreateApplicationDto,
  CreateChargeDto,
  CreateEnrolmentHandoffDto,
  CreateInvoiceDto,
  CreateOfferDto,
  CreateRefundDto,
  OfferResponseDto,
  RequestApplicationDocumentDto,
  UpdateApplicationStatusDto,
} from "./admissions-finance.dto";
import { AdmissionsService } from "./admissions.service";
import { FinanceService } from "./finance.service";

type AuthenticatedUser = { id: string; schoolIds: string[] };

function resolveSchoolId(user: AuthenticatedUser, requestedSchoolId?: string): string {
  if (requestedSchoolId) return requestedSchoolId;
  if (user.schoolIds.length === 1) return user.schoolIds[0];
  if (user.schoolIds.length > 1) throw new BadRequestException("Select a school with the x-school-id header.");
  throw new BadRequestException("An active school membership is required.");
}

@Controller("website/admissions")
export class WebsiteAdmissionsController {
  constructor(private readonly admissionsService: AdmissionsService) {}

  @Post("applications")
  submitApplication(
    @Headers("x-school-id") schoolId: string | undefined,
    @Body() body: CreateApplicationDto,
  ) {
    if (!schoolId) throw new BadRequestException("Select a school with the x-school-id header.");
    return this.admissionsService.createPublicApplication(schoolId, body);
  }
}

@Controller("erp/admissions")
@UseGuards(AuthGuard, SchoolAccessGuard)
export class AdmissionsController {
  constructor(private readonly admissionsService: AdmissionsService) {}

  @Get("applications")
  listApplications(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Query("status") status?: string,
  ) {
    return this.admissionsService.listApplications(resolveSchoolId(user, schoolId), user.id, status);
  }

  @Patch("applications/:applicationId/status")
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("applicationId", ParseUUIDPipe) applicationId: string,
    @Body() body: UpdateApplicationStatusDto,
  ) {
    return this.admissionsService.updateStatus(resolveSchoolId(user, schoolId), user.id, applicationId, body);
  }

  @Patch("applications/:applicationId/parent")
  linkParent(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("applicationId", ParseUUIDPipe) applicationId: string,
    @Body("parentUserId", ParseUUIDPipe) parentUserId: string,
  ) {
    return this.admissionsService.linkParent(resolveSchoolId(user, schoolId), user.id, applicationId, parentUserId);
  }

  @Post("applications/:applicationId/documents")
  requestDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("applicationId", ParseUUIDPipe) applicationId: string,
    @Body() body: RequestApplicationDocumentDto,
  ) {
    return this.admissionsService.requestDocument(resolveSchoolId(user, schoolId), user.id, applicationId, body);
  }

  @Post("applications/:applicationId/offers")
  createOffer(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("applicationId", ParseUUIDPipe) applicationId: string,
    @Body() body: CreateOfferDto,
  ) {
    return this.admissionsService.createOffer(resolveSchoolId(user, schoolId), user.id, applicationId, body);
  }

  @Post("applications/:applicationId/enrolment-handoff")
  verifyHandoff(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("applicationId", ParseUUIDPipe) applicationId: string,
    @Body() body: CreateEnrolmentHandoffDto,
  ) {
    return this.admissionsService.createEnrolmentHandoff(resolveSchoolId(user, schoolId), user.id, applicationId, body);
  }
}

@Controller("parent")
@UseGuards(AuthGuard)
export class ParentAdmissionsController {
  constructor(private readonly admissionsService: AdmissionsService) {}

  @Get("applications")
  listApplications(@CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.listParentApplications(user.id);
  }

  @Post("applications/:applicationId/offers/:offerId/respond")
  respondToOffer(
    @CurrentUser() user: AuthenticatedUser,
    @Param("applicationId", ParseUUIDPipe) applicationId: string,
    @Param("offerId", ParseUUIDPipe) offerId: string,
    @Body() body: OfferResponseDto,
  ) {
    return this.admissionsService.respondToOffer(user.id, applicationId, offerId, body);
  }
}

@Controller("erp/finance")
@UseGuards(AuthGuard, SchoolAccessGuard)
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Post("charges")
  createCharge(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Body() body: CreateChargeDto,
  ) {
    return this.financeService.createCharge(resolveSchoolId(user, schoolId), user.id, body);
  }

  @Post("invoices")
  createInvoice(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Body() body: CreateInvoiceDto,
  ) {
    return this.financeService.createInvoice(resolveSchoolId(user, schoolId), user.id, body);
  }

  @Patch("invoices/:invoiceId/status")
  updateInvoiceStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("invoiceId", ParseUUIDPipe) invoiceId: string,
    @Body("status") status: "issued" | "void",
  ) {
    if (!["issued", "void"].includes(status)) throw new BadRequestException("Unsupported invoice status transition.");
    return this.financeService.updateInvoiceStatus(resolveSchoolId(user, schoolId), user.id, invoiceId, status);
  }

  @Post("payments/:paymentId/refunds")
  createRefund(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("paymentId", ParseUUIDPipe) paymentId: string,
    @Body() body: CreateRefundDto,
  ) {
    return this.financeService.createRefund(resolveSchoolId(user, schoolId), user.id, paymentId, body);
  }

  @Get("reports/balances")
  balances(@CurrentUser() user: AuthenticatedUser, @Headers("x-school-id") schoolId?: string) {
    return this.financeService.getBalanceReport(resolveSchoolId(user, schoolId), user.id);
  }
}

@Controller("parent")
@UseGuards(AuthGuard)
export class ParentFinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get("invoices")
  invoices(@CurrentUser() user: AuthenticatedUser) {
    return this.financeService.listParentInvoices(user.id);
  }

  @Post("invoices/:invoiceId/payment-intents")
  paymentIntent(
    @CurrentUser() user: AuthenticatedUser,
    @Param("invoiceId", ParseUUIDPipe) invoiceId: string,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    if (!idempotencyKey) throw new BadRequestException("Idempotency-Key header is required.");
    return this.financeService.createPaymentIntent(user.id, invoiceId, idempotencyKey);
  }
}

@Controller("integrations/payments")
export class PaymentWebhookController {
  constructor(private readonly financeService: FinanceService) {}

  @Post(":provider/webhook")
  webhook(
    @Param("provider") provider: string,
    @Req() request: RawBodyRequest<Request>,
    @Headers("stripe-signature") signature?: string,
  ) {
    if (provider !== "stripe") throw new NotFoundException("Payment provider not found.");
    return this.financeService.handleStripeWebhook(request.rawBody, signature);
  }
}
