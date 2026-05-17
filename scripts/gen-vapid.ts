#!/usr/bin/env tsx
/**
 * Generate a VAPID key pair for Web Push.
 * Outputs env-style lines to copy into Vercel project settings.
 */
import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();
const subject = process.env.VAPID_SUBJECT ?? "mailto:admin@mongolz.local";

process.stdout.write(`# Copy these into Vercel env (Production scope):\n`);
process.stdout.write(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${keys.publicKey}\n`);
process.stdout.write(`VAPID_PRIVATE_KEY=${keys.privateKey}\n`);
process.stdout.write(`VAPID_SUBJECT=${subject}\n`);
