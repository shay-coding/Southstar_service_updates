// functions/api/subscribe.js
// Cloudflare Pages Function — stores push subscriptions in KV

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const sub = await request.json();

    if (!sub || !sub.endpoint) {
      return new Response(JSON.stringify({ error: 'Invalid subscription' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // Use the endpoint URL as the key (hashed to keep it short)
    const key = await hashEndpoint(sub.endpoint);

    // Store in KV — env.PUSH_SUBSCRIPTIONS is the KV namespace binding
    await env.PUSH_SUBSCRIPTIONS.put(key, JSON.stringify(sub));

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}

async function hashEndpoint(endpoint) {
  const encoder  = new TextEncoder();
  const data     = encoder.encode(endpoint);
  const hashBuf  = await crypto.subtle.digest('SHA-256', data);
  const hashArr  = Array.from(new Uint8Array(hashBuf));
  return hashArr.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
