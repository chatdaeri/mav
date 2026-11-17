/**
 * 마브 ships without a payment provider. Every team runs its own server and
 * nothing is sold, so this is the only `BillingProvider`: each call refuses,
 * webhooks are ignored, and `planEnforced()` stays false (no provider env is
 * ever set), which leaves every vault unlimited — the same state a
 * billing-disabled Baalda self-host was always in.
 */
import {
  WebhookSignatureError,
  type BillingProvider,
  type NormalizedBillingEvent,
} from "./provider.js";

export class BillingDisabledError extends Error {
  constructor() {
    super("Billing is not available on this server.");
    this.name = "BillingDisabledError";
  }
}

const refuse = async (): Promise<never> => {
  throw new BillingDisabledError();
};

export class DisabledBillingProvider implements BillingProvider {
  createCheckout = refuse;
  getPortalUrl = refuse;
  cancelSubscription = refuse;
  resumeSubscription = refuse;
  getSubscription = refuse;
  getCheckout = refuse;
  setSubscriptionOrg = refuse;
  setSubscriptionAccount = refuse;
  updateSeats = refuse;
  changeProduct = refuse;
  applyDiscount = refuse;
  createDiscount = refuse;
  previewSeatChange = refuse;
  verifyAndNormalizeWebhook(): NormalizedBillingEvent | null {
    // No provider means no signing secret: every webhook is unsigned.
    throw new WebhookSignatureError("Billing is not available on this server.");
  }
}
