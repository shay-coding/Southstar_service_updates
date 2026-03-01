// functions/api/notify.js
// Cloudflare Pages Function — triggered by GitHub webhook on push
// Sends a Web Push notification to all stored subscribers

import { WebPush } from '../../lib/webpush.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  // ── Verify GitHub webhook secret ──────────────────────────────────────────
  const signature = request.headers.get('x-hub-signature-256');
  const body      = await request.text();

  if (!await verifyGithubSignature(body, signature, env.GITHUB_WEBHOOK_SECRET)) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Only fire on pushes to main branch
  let payload;
  try { payload = JSON.parse(body); } catch { return new Response('Bad JSON', { status: 400 }); }
  if (payload.ref && payload.ref !== 'refs/heads/main') {
    return new Response('Not main branch — skipping', { status: 200 });
  }

  // ── Gather all subscriptions from KV ─────────────────────────────────────
  const list = await env.PUSH_SUBSCRIPTIONS.list();
  if (!list.keys.length) {
    return new Response('No subscribers', { status: 200 });
  }

  const vapidKeys = {
    publicKey:  env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject:    'mailto:' + env.CONTACT_EMAIL   // set this in Cloudflare dashboard
  };

  const pushData = JSON.stringify({
    title: 'SouthStar — New Service Update',
    body:  'A new service update has been posted. Tap to view.',
    url:   '/'
  });

  // ── Send to each subscriber ───────────────────────────────────────────────
  const results = await Promise.allSettled(
    list.keys.map(async ({ name: key }) => {
      const raw = await env.PUSH_SUBSCRIPTIONS.get(key);
      if (!raw) return;

      const sub = JSON.parse(raw);

      try {
        await WebPush.send(sub, pushData, vapidKeys);
      } catch (e) {
        // 410 Gone = subscription expired/unsubscribed, clean it up
        if (e.statusCode === 410 || e.statusCode === 404) {
          await env.PUSH_SUBSCRIPTIONS.delete(key);
        }
        throw e;
      }
    })
  );

  const sent   = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;

  return new Response(JSON.stringify({ sent, failed }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function verifyGithubSignature(body, signature, secret) {
  if (!signature || !secret) return false;
  const encoder  = new TextEncoder();
  const keyData  = encoder.encode(secret);
  const key      = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig      = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const expected = 'sha256=' + Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(signature, expected);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
