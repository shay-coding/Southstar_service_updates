// functions/api/notify.js
// Cloudflare Pages Function — triggered by GitHub webhook on push
// Sends Web Push notifications to all stored subscribers using Web Crypto API

export async function onRequestPost(context) {
  const { request, env } = context;

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return new Uint8Array([...rawData].map(c => c.charCodeAt(0)));
  }

  async function sendWebPush(subscription, payload) {
    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      {
        kty: 'EC',
        crv: 'P-256',
        x: subscription.keys.p256dh_x,
        y: subscription.keys.p256dh_y,
        d: subscription.keys.auth_d,
        ext: true
      },
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey']
    );
    // Using Cloudflare's built-in Push API
    await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: payload
    });
  }

  try {
    const body = await request.text();
    let payload;
    try {
      if (body.startsWith('payload=')) {
        payload = JSON.parse(decodeURIComponent(body.slice(8)));
      } else {
        payload = JSON.parse(body);
      }
    } catch {
      return new Response('Bad JSON', { status: 400 });
    }

    if (payload.ref && payload.ref !== 'refs/heads/main') {
      return new Response('Not main branch — skipping', { status: 200 });
    }

    const list = await env.PUSH_SUBSCRIPTIONS.list();
    if (!list.keys.length) return new Response('No subscribers', { status: 200 });

    const pushData = JSON.stringify({
      title: 'SouthStar — New Service Update',
      body: 'A new service update has been posted. Tap to view.',
      url: '/'
    });

    const results = await Promise.allSettled(
      list.keys.map(async ({ name: key }) => {
        const raw = await env.PUSH_SUBSCRIPTIONS.get(key);
        if (!raw) return;

        const sub = JSON.parse(raw);

        try {
          // Use the Fetch API directly for push
          await fetch(sub.endpoint, {
            method: 'POST',
            headers: {
              'TTL': '60',
              'Content-Type': 'application/json',
              'Authorization': `WebPush ${env.VAPID_PUBLIC_KEY}` // simplified VAPID header for demo
            },
            body: pushData
          });
        } catch (e) {
          if (e.status === 410 || e.status === 404) {
            await env.PUSH_SUBSCRIPTIONS.delete(key);
          } else {
            console.error('Failed to send push', e);
          }
        }
      })
    );

    const sent = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    return new Response(JSON.stringify({ sent, failed }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, stack: e.stack }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
