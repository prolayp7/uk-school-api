import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type Stripe from "stripe";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateChargeDto,
  CreateInvoiceDto,
  CreateRefundDto,
} from "./admissions-finance.dto";
import { PaymentProviderService } from "./payment-provider.service";

const FINANCE_ROLES = ["FINANCE", "HEADTEACHER", "SLT", "ADMIN"];

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2));
}

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentProvider: PaymentProviderService,
  ) {}

  async createCharge(schoolId: string, userId: string, input: CreateChargeDto) {
    await this.requireFinanceRole(schoolId, userId);
    if (input.pupilId) {
      const pupil = await this.prisma.pupilProfile.findFirst({ where: { schoolId, id: input.pupilId }, select: { id: true } });
      if (!pupil) throw new BadRequestException("Charge pupil must belong to this school.");
    }
    return this.prisma.$transaction(async (transaction) => {
      const charge = await transaction.charge.create({
        data: {
          schoolId,
          createdByUserId: userId,
          code: input.code.trim().toUpperCase(),
          description: input.description.trim(),
          amount: decimal(input.amount),
          currency: input.currency ?? "GBP",
          pupilId: input.pupilId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "finance.charge.created",
          entityType: "charge",
          entityId: charge.id,
          metadata: { code: charge.code, amount: charge.amount.toFixed(2), currency: charge.currency },
        },
      });
      return charge;
    });
  }

  async createInvoice(schoolId: string, userId: string, input: CreateInvoiceDto) {
    await this.requireFinanceRole(schoolId, userId);
    const parent = await this.prisma.schoolMembership.findFirst({
      where: {
        schoolId,
        userId: input.parentUserId,
        status: "active",
        membershipRoles: { some: { role: { code: "PARENT" } } },
      },
      select: { id: true },
    });
    if (!parent) throw new BadRequestException("Invoice recipient must be an active parent in this school.");
    if (input.applicationId) {
      const application = await this.prisma.application.findFirst({ where: { schoolId, id: input.applicationId }, select: { id: true, applicantUserId: true } });
      if (!application || application.applicantUserId !== input.parentUserId) {
        throw new BadRequestException("Invoice application must be linked to the selected parent.");
      }
    }

    const lineSpecs: Array<{ chargeId?: string; description: string; quantity: number; unitAmount: Prisma.Decimal }> = [];
    for (const line of input.lines) {
      if (line.chargeId) {
        const charge = await this.prisma.charge.findFirst({ where: { schoolId, id: line.chargeId, isActive: true } });
        if (!charge) throw new BadRequestException("Every referenced charge must be active and belong to this school.");
        if (line.unitAmount !== Number(charge.amount)) throw new BadRequestException("Charge-backed invoice lines must use the configured charge amount.");
        lineSpecs.push({ chargeId: charge.id, description: charge.description, quantity: line.quantity, unitAmount: charge.amount });
      } else {
        lineSpecs.push({ description: line.description.trim(), quantity: line.quantity, unitAmount: decimal(line.unitAmount) });
      }
    }
    const totalAmount = lineSpecs.reduce((total, line) => total.add(line.unitAmount.mul(line.quantity)), new Prisma.Decimal(0));

    return this.prisma.$transaction(async (transaction) => {
      const invoice = await transaction.invoice.create({
        data: {
          schoolId,
          parentUserId: input.parentUserId,
          applicationId: input.applicationId,
          createdByUserId: userId,
          reference: `INV-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
          totalAmount,
          dueAt: input.dueAt ? new Date(`${input.dueAt}T00:00:00.000Z`) : null,
          lines: {
            create: lineSpecs.map((line) => ({
              schoolId,
              chargeId: line.chargeId,
              description: line.description,
              quantity: line.quantity,
              unitAmount: line.unitAmount,
              lineAmount: line.unitAmount.mul(line.quantity),
            })),
          },
        },
        include: { lines: true },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "finance.invoice.created",
          entityType: "invoice",
          entityId: invoice.id,
          metadata: { reference: invoice.reference, lineCount: invoice.lines.length, total: invoice.totalAmount.toFixed(2) },
        },
      });
      return invoice;
    });
  }

  async updateInvoiceStatus(schoolId: string, userId: string, invoiceId: string, status: "issued" | "void") {
    await this.requireFinanceRole(schoolId, userId);
    return this.prisma.$transaction(async (transaction) => {
      const invoice = await transaction.invoice.findFirst({
        where: { schoolId, id: invoiceId },
        select: { id: true, status: true, _count: { select: { payments: true } } },
      });
      if (!invoice) throw new NotFoundException("Invoice not found.");
      if (invoice.status !== "draft" && status === "issued") throw new BadRequestException("Only draft invoices can be issued.");
      if (status === "void" && invoice._count.payments > 0) throw new ConflictException("Invoices with payment activity cannot be voided.");
      const updated = await transaction.invoice.update({
        where: { schoolId_id: { schoolId, id: invoiceId } },
        data: { status, issuedAt: status === "issued" ? new Date() : null },
        select: { id: true, status: true, issuedAt: true },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: `finance.invoice.${status}`,
          entityType: "invoice",
          entityId: invoiceId,
          metadata: { previousStatus: invoice.status },
        },
      });
      return updated;
    });
  }

  async listParentInvoices(userId: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: { parentUserId: userId, status: { notIn: ["draft", "void"] } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        schoolId: true,
        reference: true,
        status: true,
        totalAmount: true,
        currency: true,
        dueAt: true,
        issuedAt: true,
        lines: { select: { description: true, quantity: true, unitAmount: true, lineAmount: true } },
        payments: {
          select: {
            amount: true,
            currency: true,
            status: true,
            createdAt: true,
            refunds: { select: { amount: true, status: true, createdAt: true } },
          },
        },
      },
    });
    for (const invoice of invoices) {
      await this.auditRead(invoice.schoolId, userId, invoice.id, "finance.parent_invoice.viewed", {});
    }
    return { items: invoices, total: invoices.length };
  }

  async createPaymentIntent(userId: string, invoiceId: string, idempotencyKey: string) {
    if (idempotencyKey.length < 8 || idempotencyKey.length > 160) {
      throw new BadRequestException("Idempotency-Key must be between 8 and 160 characters.");
    }
    const localKey = `${userId}:${idempotencyKey}`;
    const reservation = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId}::uuid AND parent_user_id = ${userId}::uuid FOR UPDATE`;
      const invoice = await transaction.invoice.findFirst({
        where: { id: invoiceId, parentUserId: userId, status: { in: ["issued", "partially_paid"] } },
        select: { id: true, schoolId: true, totalAmount: true, currency: true },
      });
      if (!invoice) throw new ForbiddenException("This invoice is unavailable to your parent account.");
      const existing = await transaction.payment.findUnique({
        where: { schoolId_idempotencyKey: { schoolId: invoice.schoolId, idempotencyKey: localKey } },
      });
      if (existing) {
        if (existing.invoiceId !== invoice.id) throw new ConflictException("Idempotency key was already used for another invoice.");
        if (existing.status !== "pending") throw new ConflictException("This idempotency key already has a terminal payment result.");
        return { invoice, payment: existing, balance: existing.amount };
      }
      const reservedPayments = await transaction.payment.findMany({
        where: { schoolId: invoice.schoolId, invoiceId: invoice.id, status: { in: ["pending", "succeeded"] } },
        select: { id: true, amount: true, status: true },
      });
      const successfulIds = reservedPayments.filter(({ status }) => status === "succeeded").map(({ id }) => id);
      const refunded = successfulIds.length
        ? await transaction.refund.aggregate({
            where: { schoolId: invoice.schoolId, paymentId: { in: successfulIds }, status: "succeeded" },
            _sum: { amount: true },
          })
        : { _sum: { amount: null } };
      const reservedAmount = reservedPayments.reduce((total, payment) => total.add(payment.amount), new Prisma.Decimal(0))
        .sub(refunded._sum.amount ?? new Prisma.Decimal(0));
      const balance = invoice.totalAmount.sub(reservedAmount);
      if (balance.lte(0)) throw new BadRequestException("Invoice has no outstanding balance.");
      const payment = await transaction.payment.create({
        data: {
          schoolId: invoice.schoolId,
          invoiceId: invoice.id,
          initiatedByUserId: userId,
          providerName: "stripe",
          idempotencyKey: localKey,
          amount: balance,
          currency: invoice.currency,
          status: "pending",
        },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId: invoice.schoolId,
          actorUserId: userId,
          action: "finance.payment_intent.reserved",
          entityType: "payment",
          entityId: payment.id,
          metadata: { invoiceId: invoice.id, amount: balance.toFixed(2) },
        },
      });
      return { invoice, payment, balance };
    });

    if (reservation.payment.providerReference) {
      const intent = await this.paymentProvider.retrievePaymentIntent(reservation.payment.providerReference);
      return { paymentId: reservation.payment.id, clientSecret: intent.clientSecret, status: reservation.payment.status };
    }
    const intent = await this.paymentProvider.createPaymentIntent({
      amountMinor: Number(reservation.balance.mul(100).toDecimalPlaces(0).toString()),
      currency: reservation.invoice.currency,
      idempotencyKey: `${reservation.invoice.schoolId}:${localKey}`,
      metadata: { schoolId: reservation.invoice.schoolId, paymentId: reservation.payment.id, invoiceId: reservation.invoice.id },
    });
    const saved = await this.prisma.payment.update({
      where: { schoolId_id: { schoolId: reservation.invoice.schoolId, id: reservation.payment.id } },
      data: { providerReference: intent.id, providerIntentReference: intent.id, status: "pending" },
    });
    return { paymentId: saved.id, clientSecret: intent.clientSecret, status: saved.status };
  }

  async handleStripeWebhook(rawBody: Buffer | undefined, signature: string | undefined) {
    const event = this.paymentProvider.constructWebhookEvent(rawBody, signature);
    const paymentEventTypes = ["payment_intent.succeeded", "payment_intent.payment_failed", "payment_intent.canceled"];
    const refundEventTypes = ["refund.updated", "refund.failed"];
    if (![...paymentEventTypes, ...refundEventTypes].includes(event.type)) {
      return { received: true, ignored: true };
    }
    const payloadHash = createHash("sha256").update(rawBody ?? Buffer.alloc(0)).digest("hex");
    const isRefundEvent = refundEventTypes.includes(event.type);
    const paymentIntent = isRefundEvent ? null : event.data.object as Stripe.PaymentIntent;
    const refund = isRefundEvent ? event.data.object as Stripe.Refund : null;
    const metadata = paymentIntent?.metadata ?? refund?.metadata;
    const schoolId = metadata?.schoolId;
    const localPaymentId = metadata?.paymentId;
    if (!schoolId || !localPaymentId) throw new BadRequestException("Payment event is missing local correlation metadata.");
    const localRefundId = metadata?.refundId;
    if (isRefundEvent && !localRefundId) throw new BadRequestException("Refund event is missing local correlation metadata.");

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const payment = await transaction.payment.findFirst({
          where: {
            schoolId,
            id: localPaymentId,
            providerName: "stripe",
            ...(paymentIntent ? { providerReference: paymentIntent.id } : {}),
          },
          select: { id: true, invoiceId: true, amount: true, status: true },
        });
        if (!payment) throw new NotFoundException("Payment reference not found.");
        await transaction.paymentProviderEvent.create({
          data: {
            schoolId,
            paymentId: payment.id,
            providerName: "stripe",
            externalEventId: event.id,
            eventType: event.type,
            payloadHash,
            signatureVerified: true,
            processedAt: new Date(),
          },
        });
        if (isRefundEvent && localRefundId && refund) {
          const refundStatus = event.type === "refund.failed" || refund.status === "failed"
            ? "failed"
            : refund.status === "succeeded" ? "succeeded" : "pending";
          const updatedRefund = await transaction.refund.updateMany({
            where: { schoolId, id: localRefundId, paymentId: payment.id },
            data: { status: refundStatus, providerReference: refund.id },
          });
          if (updatedRefund.count === 0) throw new NotFoundException("Refund reference not found.");
          const invoicePayments = await transaction.payment.findMany({
            where: { schoolId, invoiceId: payment.invoiceId, status: "succeeded" },
            select: { id: true, amount: true },
          });
          const refunded = invoicePayments.length
            ? await transaction.refund.aggregate({
                where: { schoolId, paymentId: { in: invoicePayments.map(({ id }) => id) }, status: "succeeded" },
                _sum: { amount: true },
              })
            : { _sum: { amount: null } };
          const netPaid = invoicePayments.reduce((total, item) => total.add(item.amount), new Prisma.Decimal(0))
            .sub(refunded._sum.amount ?? new Prisma.Decimal(0));
          const invoice = await transaction.invoice.findFirst({ where: { schoolId, id: payment.invoiceId }, select: { totalAmount: true } });
          if (invoice) {
            await transaction.invoice.update({
              where: { schoolId_id: { schoolId, id: payment.invoiceId } },
              data: { status: netPaid.gte(invoice.totalAmount) ? "paid" : netPaid.gt(0) ? "partially_paid" : "issued" },
            });
          }
          await transaction.auditEvent.create({
            data: {
              schoolId,
              action: "finance.refund.provider_event_processed",
              entityType: "refund",
              entityId: localRefundId,
              metadata: { eventType: event.type, status: refundStatus },
            },
          });
          return { received: true, processed: true, status: refundStatus };
        }

        if (!paymentIntent) throw new BadRequestException("Payment event payload is invalid.");
        const status = event.type === "payment_intent.succeeded"
          ? "succeeded"
          : event.type === "payment_intent.canceled" ? "canceled" : "failed";
        await transaction.payment.update({
          where: { schoolId_id: { schoolId, id: payment.id } },
          data: { status },
        });
        if (status === "succeeded") {
          const invoicePayments = await transaction.payment.findMany({
            where: { schoolId, invoiceId: payment.invoiceId, status: "succeeded" },
            select: { id: true, amount: true },
          });
          const refunds = invoicePayments.length
            ? await transaction.refund.aggregate({
                where: { schoolId, paymentId: { in: invoicePayments.map(({ id }) => id) }, status: "succeeded" },
                _sum: { amount: true },
              })
            : { _sum: { amount: null } };
          const netPaid = invoicePayments.reduce((total, item) => total.add(item.amount), new Prisma.Decimal(0))
            .sub(refunds._sum.amount ?? new Prisma.Decimal(0));
          const invoice = await transaction.invoice.findFirst({
            where: { schoolId, id: payment.invoiceId },
            select: { totalAmount: true },
          });
          if (invoice) {
            await transaction.invoice.update({
              where: { schoolId_id: { schoolId, id: payment.invoiceId } },
              data: { status: netPaid.gte(invoice.totalAmount) ? "paid" : netPaid.gt(0) ? "partially_paid" : "issued" },
            });
          }
        }
        await transaction.auditEvent.create({
          data: {
            schoolId,
            action: "finance.payment.provider_event_processed",
            entityType: "payment",
            entityId: payment.id,
            metadata: { eventType: event.type, status },
          },
        });
        return { received: true, processed: true, status };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return { received: true, duplicate: true };
      }
      throw error;
    }
  }

  async createRefund(schoolId: string, userId: string, paymentId: string, input: CreateRefundDto) {
    await this.requireFinanceRole(schoolId, userId);
    const idempotencyKey = input.idempotencyKey.trim();
    if (idempotencyKey.length < 8) throw new BadRequestException("Refund idempotency key must be at least 8 characters.");
    const existingRefund = await this.prisma.refund.findUnique({
      where: { schoolId_idempotencyKey: { schoolId, idempotencyKey } },
    });
    if (existingRefund) return existingRefund;

    const refundResult = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM payments WHERE school_id = ${schoolId}::uuid AND id = ${paymentId}::uuid FOR UPDATE`;
      const payment = await transaction.payment.findFirst({
        where: { schoolId, id: paymentId, status: "succeeded" },
        select: { id: true, amount: true, providerReference: true },
      });
      if (!payment?.providerReference) throw new BadRequestException("Only completed provider payments can be refunded.");
      const concurrentRefund = await transaction.refund.findUnique({
        where: { schoolId_idempotencyKey: { schoolId, idempotencyKey } },
      });
      if (concurrentRefund) return { refund: concurrentRefund, paymentIntentId: payment.providerReference, alreadyExists: true };
      const prior = await transaction.refund.aggregate({
        where: { schoolId, paymentId, status: { in: ["pending", "succeeded"] } },
        _sum: { amount: true },
      });
      const remaining = payment.amount.sub(prior._sum.amount ?? new Prisma.Decimal(0));
      const amount = decimal(input.amount);
      if (amount.gt(remaining)) throw new BadRequestException("Refund exceeds the unrefunded payment balance.");
      const created = await transaction.refund.create({
        data: { schoolId, paymentId, createdByUserId: userId, idempotencyKey, amount, reason: input.reason.trim() },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "finance.refund.requested",
          entityType: "refund",
          entityId: created.id,
          metadata: { paymentId, amount: amount.toFixed(2) },
        },
      });
      return { refund: created, paymentIntentId: payment.providerReference, alreadyExists: false };
    });
    if (refundResult.alreadyExists) return refundResult.refund;

    try {
      const providerRefund = await this.paymentProvider.createRefund({
        paymentIntentId: refundResult.paymentIntentId,
        amountMinor: Number(refundResult.refund.amount.mul(100).toDecimalPlaces(0).toString()),
        reason: input.reason,
        idempotencyKey: `${schoolId}:${idempotencyKey}`,
        metadata: { schoolId, paymentId, refundId: refundResult.refund.id },
      });
      return this.prisma.refund.update({
        where: { schoolId_id: { schoolId, id: refundResult.refund.id } },
        data: { providerReference: providerRefund.id, status: providerRefund.status === "succeeded" ? "succeeded" : "pending" },
      });
    } catch {
      await this.prisma.refund.update({
        where: { schoolId_id: { schoolId, id: refundResult.refund.id } },
        data: { status: "failed" },
      });
      throw new BadRequestException("Payment provider could not process the refund.");
    }
  }

  async getBalanceReport(schoolId: string, userId: string) {
    await this.requireFinanceRole(schoolId, userId);
    const invoices = await this.prisma.invoice.findMany({
      where: { schoolId, status: { in: ["issued", "partially_paid", "overdue"] } },
      select: {
        id: true,
        reference: true,
        status: true,
        totalAmount: true,
        payments: {
          where: { status: "succeeded" },
          select: {
            amount: true,
            refunds: { where: { status: "succeeded" }, select: { amount: true } },
          },
        },
      },
    });
    const balances = invoices.map((invoice) => {
      const paid = invoice.payments.reduce((total, payment) => {
        const refunded = payment.refunds.reduce((subtotal, refund) => subtotal.add(refund.amount), new Prisma.Decimal(0));
        return total.add(payment.amount.sub(refunded));
      }, new Prisma.Decimal(0));
      return {
        invoiceId: invoice.id,
        reference: invoice.reference,
        status: invoice.status,
        total: invoice.totalAmount,
        paid,
        outstanding: invoice.totalAmount.sub(paid),
      };
    });
    await this.auditRead(schoolId, userId, null, "finance.balance_report.viewed", { invoiceCount: invoices.length });
    return { items: balances, totalOutstanding: balances.reduce((total, row) => total.add(row.outstanding), new Prisma.Decimal(0)) };
  }

  private async requireFinanceRole(schoolId: string, userId: string): Promise<void> {
    const membership = await this.prisma.schoolMembership.findFirst({
      where: { schoolId, userId, status: "active", membershipRoles: { some: { role: { code: { in: FINANCE_ROLES } } } } },
      select: { id: true },
    });
    if (!membership) throw new ForbiddenException("Finance staff authorization is required.");
  }

  private auditRead(schoolId: string, userId: string, entityId: string | null, action: string, metadata: object) {
    return this.prisma.auditEvent.create({
      data: { schoolId, actorUserId: userId, action, entityType: "finance_record", entityId, metadata },
    });
  }
}
