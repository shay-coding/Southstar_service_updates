// lib/webpush.js
// Minimal Web Push sender for Cloudflare Pages Functions

export async function webPushSend(subscription, payload, vapidKeys) {
  const webpushEndpoint = subscription.endpoint;
  const key = subscription.keys.p256dh;
  const auth = subscription.keys.auth;

  try {
    const res = await fetch(webpushEndpoint, {
      method: 'POST',
      headers: {
        'TTL': '60',
        'Content-Type': 'application/json',
        'Content-Encoding': 'aes128gcm',
        'Authorization': `WebPush ${vapidKeys.privateKey}` // minimal for CF, can adjust
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const error = new Error('Failed to send push: ' + res.status);
      error.statusCode = res.status;
      throw error;
    }
    return res;
  } catch (err) {
    throw err;
  }
}
