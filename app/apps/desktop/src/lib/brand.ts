// The ONLY place the brand name lives in desktop code. Everything durable
// (storage keys, identifiers, protocol names) uses the permanent neutral
// codename "context" — see docs/BRANDING.md.
export const BRAND_NAME = "마이 세컨드 브레인";
export const BRAND_DOMAIN = "github.com/chatdaeri/mav";

/** 마브 sells nothing: the Plan & Billing screens stay hidden. The server runs
 *  `DisabledBillingProvider`, so no plan limit or upgrade prompt is ever raised. */
export const BILLING_UI = false;
