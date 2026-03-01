// lib/webpush.js
// Minimal Web Push sender for Cloudflare Pages
import * as webpush from 'web-push-standalone';

export async function webPushSend(subscription, payload, { publicKey, privateKey, subject }) {
  return await webpush.sendNotification(
    subscription,
    payload,
    {
      vapidPublicKey: publicKey,
      vapidPrivateKey: privateKey,
      subject: subject,
      TTL: 60
    }
  );
}
