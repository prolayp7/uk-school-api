import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Stripe from "stripe";

@Injectable()
export class PaymentProviderService {
  private readonly stripe?: Stripe;
  private readonly webhookSecret?: string;

  constructor(config: ConfigService) {
    const secretKey = config.get<string>("STRIPE_SECRET_KEY");
    this.webhookSecret = config.get<string>("STRIPE_WEBHOOK_SECRET");
    if (secretKey) this.stripe = new Stripe(secretKey);
  }

  async createPaymentIntent(input: {
    amountMinor: number;
    currency: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }) {
    const stripe = this.requireStripe();
    const intent = await stripe.paymentIntents.create(
      {
        amount: input.amountMinor,
        currency: input.currency.toLowerCase(),
        metadata: input.metadata,
        automatic_payment_methods: { enabled: true },
      },
      { idempotencyKey: input.idempotencyKey },
    );
    if (!intent.client_secret) {
      throw new ServiceUnavailableException("Payment provider did not return a client secret.");
    }
    return { id: intent.id, clientSecret: intent.client_secret, status: intent.status };
  }

  async retrievePaymentIntent(providerReference: string) {
    const intent = await this.requireStripe().paymentIntents.retrieve(providerReference);
    if (!intent.client_secret) {
      throw new ServiceUnavailableException("Payment provider did not return a client secret.");
    }
    return { id: intent.id, clientSecret: intent.client_secret, status: intent.status };
  }

  async createRefund(input: {
    paymentIntentId: string;
    amountMinor: number;
    reason: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }) {
    const refund = await this.requireStripe().refunds.create(
      {
        payment_intent: input.paymentIntentId,
        amount: input.amountMinor,
        reason: "requested_by_customer",
        metadata: { ...input.metadata, reason: input.reason.slice(0, 480) },
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return { id: refund.id, status: refund.status ?? "pending" };
  }

  constructWebhookEvent(rawBody: Buffer | undefined, signature: string | undefined): Stripe.Event {
    if (!rawBody || !signature || !this.webhookSecret) {
      throw new ServiceUnavailableException("Verified payment webhooks are not configured.");
    }
    try {
      return this.requireStripe().webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    } catch {
      throw new BadRequestException("Payment webhook signature verification failed.");
    }
  }

  private requireStripe(): Stripe {
    if (!this.stripe) {
      throw new ServiceUnavailableException("Payment provider is not configured.");
    }
    return this.stripe;
  }
}
