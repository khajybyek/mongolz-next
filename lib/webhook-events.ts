/**
 * Webhook event vocabulary — client-safe (no node:* imports), so the
 * /webhooks form and table can share it with the server dispatcher.
 *
 * Only events something actually dispatches are offered. `alert_created`,
 * `system_health` and `audit_critical` used to be listed (alert_created even
 * pre-checked) although nothing ever sent them: admins believed suspect
 * matches were forwarded to Slack/Discord when nothing was. Wire a sender
 * first, then add the event back here.
 */
export const WEBHOOK_EVENTS = ["reveal_requested", "reveal_completed"] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function isDeliveredWebhookEvent(e: string): e is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(e);
}
