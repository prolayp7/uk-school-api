import { ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { PrismaService } from "../prisma/prisma.service";
jest.mock("./payment-provider.service", () => ({
  PaymentProviderService: class PaymentProviderService {},
}));
import { FinanceService } from "./finance.service";
import type { PaymentProviderService } from "./payment-provider.service";

describe("FinanceService", () => {
  it("calculates invoice totals from line items and audits without storing card data", async () => {
    const invoice = { id: "invoice-1", reference: "INV-1", totalAmount: new Prisma.Decimal("25.00"), lines: [] };
    const invoiceCreate = jest.fn().mockResolvedValue(invoice);
    const auditCreate = jest.fn().mockResolvedValue({});
    const transaction = {
      invoice: { create: invoiceCreate },
      auditEvent: { create: auditCreate },
    };
    const service = new FinanceService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue({ id: "finance-membership" }) },
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    } as unknown as PrismaService, {} as PaymentProviderService);

    await service.createInvoice("school-1", "finance-1", {
      parentUserId: "parent-1",
      lines: [{ description: "School trip", quantity: 2, unitAmount: 12.5 }],
    });

    expect(invoiceCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        totalAmount: new Prisma.Decimal("25.00"),
        lines: { create: [expect.objectContaining({ lineAmount: new Prisma.Decimal("25.00") })] },
      }),
    }));
    expect(JSON.stringify(auditCreate.mock.calls)).not.toMatch(/card|pan|cvv/i);
  });

  it("does not expose another parent's invoice to a payment-intent request", async () => {
    const providerIntent = jest.fn();
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      invoice: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new FinanceService({
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    } as unknown as PrismaService, {
      createPaymentIntent: providerIntent,
    } as unknown as PaymentProviderService);

    await expect(service.createPaymentIntent("parent-1", "invoice-owned-by-parent-2", "request-key-001"))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(providerIntent).not.toHaveBeenCalled();
  });

  it("requires an exact parent link for application-related invoices", async () => {
    const transaction = jest.fn();
    const membershipFindFirst = jest.fn()
      .mockResolvedValueOnce({ id: "finance-membership" })
      .mockResolvedValueOnce({ id: "parent-membership" });
    const service = new FinanceService({
      schoolMembership: { findFirst: membershipFindFirst },
      application: { findFirst: jest.fn().mockResolvedValue({ id: "application-1", applicantUserId: null }) },
      $transaction: transaction,
    } as unknown as PrismaService, {} as PaymentProviderService);

    await expect(service.createInvoice("school-1", "finance-1", {
      parentUserId: "parent-1",
      applicationId: "application-1",
      lines: [{ description: "Application fee", quantity: 1, unitAmount: 25 }],
    })).rejects.toThrow("Invoice application must be linked to the selected parent.");

    expect(transaction).not.toHaveBeenCalled();
  });

  it("stores a signature-verified event hash and reconciles payment/invoice status", async () => {
    const rawBody = Buffer.from("signed event body");
    const paymentUpdate = jest.fn().mockResolvedValue({});
    const eventCreate = jest.fn().mockResolvedValue({});
    const invoiceUpdate = jest.fn().mockResolvedValue({});
    const auditCreate = jest.fn().mockResolvedValue({});
    const transaction = {
      payment: {
        findFirst: jest.fn().mockResolvedValue({ id: "payment-1", invoiceId: "invoice-1", amount: new Prisma.Decimal("20.00"), status: "pending" }),
        findMany: jest.fn().mockResolvedValue([{ id: "payment-1", amount: new Prisma.Decimal("20.00") }]),
        update: paymentUpdate,
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: new Prisma.Decimal("20.00") } }),
      },
      paymentProviderEvent: { create: eventCreate },
      invoice: {
        findFirst: jest.fn().mockResolvedValue({ totalAmount: new Prisma.Decimal("20.00") }),
        update: invoiceUpdate,
      },
      refund: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }) },
      auditEvent: { create: auditCreate },
    };
    const stripeEvent = {
      id: "evt-1",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi-1", metadata: { schoolId: "school-1", paymentId: "payment-1" } } },
    };
    const constructWebhookEvent = jest.fn().mockReturnValue(stripeEvent);
    const service = new FinanceService({
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    } as unknown as PrismaService, {
      constructWebhookEvent,
    } as unknown as PaymentProviderService);

    const result = await service.handleStripeWebhook(rawBody, "stripe-signature");

    expect(result).toMatchObject({ received: true, processed: true, status: "succeeded" });
    expect(constructWebhookEvent).toHaveBeenCalledWith(rawBody, "stripe-signature");
    expect(eventCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        externalEventId: "evt-1",
        signatureVerified: true,
        payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    }));
    expect(invoiceUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "paid" } }));
    expect(JSON.stringify(eventCreate.mock.calls)).not.toContain("signed event body");
  });

  it("returns a prior refund for the same idempotency key without calling the provider again", async () => {
    const existingRefund = { id: "refund-1", status: "pending" };
    const createRefund = jest.fn();
    const service = new FinanceService({
      schoolMembership: { findFirst: jest.fn().mockResolvedValue({ id: "finance-membership" }) },
      refund: { findUnique: jest.fn().mockResolvedValue(existingRefund) },
    } as unknown as PrismaService, { createRefund } as unknown as PaymentProviderService);

    const result = await service.createRefund("school-1", "finance-1", "payment-1", {
      idempotencyKey: "refund-request-001",
      amount: 4.5,
      reason: "Duplicate payment",
    });

    expect(result).toBe(existingRefund);
    expect(createRefund).not.toHaveBeenCalled();
  });
});
