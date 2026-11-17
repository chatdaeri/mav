// SPDX-License-Identifier: Apache-2.0
/** Deployment policy is independent of whether a payment provider is configured.
 * 마브 has no managed (Cloud) instance: every server is a team's own, so an
 * omitted setting means self-hosted — no plan limits, no note cap. Baalda
 * defaulted to Cloud restrictions for its managed deployment. */
export function requiresCloudPlan(): boolean {
  const deployment = process.env.BAALDA_DEPLOYMENT ?? "self-hosted";
  if (deployment !== "cloud" && deployment !== "self-hosted") {
    throw new Error("BAALDA_DEPLOYMENT must be cloud or self-hosted");
  }
  return deployment === "cloud";
}
