import { webPushSend } from '../../lib/webpush.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.text();
    let payload;
    try {
      payload = JSON.parse(body.startsWith('payload=') ? decodeURIComponent(body.slice(8)) : body);
    } catch {
      return new Response('Bad JSON', { status: 400 });
    }

    if (payload.ref && payload.ref !== 'refs/heads/main') {
      return new Response('Not main branch — skipping', { status: 200 });
    }

    const list = await env.PUSH_SUBSCRIPTIONS.list();
    if (!list.keys.length) return new Response('No subscribers', { status: 200 });

    const vapidKeys = {
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
      subject: 'mailto:' + env.CONTACT_EMAIL
    };

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
          await webPushSend(sub, pushData, vapidKeys);
        } catch (e) {
          if (e.statusCode === 410 || e.statusCode === 404) {
            await env.PUSH_SUBSCRIPTIONS.delete(key);
          }
          throw e;
        }
      })
    );

    const sent = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    return new Response(JSON.stringify({ sent, failed }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
