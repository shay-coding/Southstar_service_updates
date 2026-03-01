// lib/webpush.js
// Minimal Web Push (RFC 8291 / RFC 8292) implementation for Cloudflare Workers
// No npm dependencies — uses only the Web Crypto API

export const WebPush = {
  async send(subscription, data, vapidKeys) {
    const { endpoint, keys: { p256dh, auth } } = subscription;

    const serverKeys = await generateServerKeys();
    const salt       = crypto.getRandomValues(new Uint8Array(16));

    const encrypted = await encrypt(
      data,
      base64ToUint8(p256dh),
      base64ToUint8(auth),
      serverKeys,
      salt
    );

    const vapidHeader = await buildVapidHeader(endpoint, vapidKeys);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type':     'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'TTL':              '86400',
        'Authorization':    vapidHeader,
      },
      body: encrypted
    });

    if (!response.ok && response.status !== 201) {
      const err = new Error(`Push failed: ${response.status}`);
      err.statusCode = response.status;
      throw err;
    }

    return response;
  }
};

// ── Encryption helpers ────────────────────────────────────────────────────────

async function generateServerKeys() {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  );
  const publicRaw = await crypto.subtle.exportKey('raw', pair.publicKey);
  return { pair, publicRaw: new Uint8Array(publicRaw) };
}

async function encrypt(plaintext, receiverPublicKey, authSecret, serverKeys, salt) {
  const encoder = new TextEncoder();
  const data    = typeof plaintext === 'string' ? encoder.encode(plaintext) : plaintext;

  const receiverKey = await crypto.subtle.importKey(
    'raw', receiverPublicKey, { name: 'ECDH', namedCurve: 'P-256' }, true, []
  );

  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: receiverKey },
    serverKeys.pair.privateKey,
    256
  );

  // HKDF to derive content encryption key and nonce
  const prk     = await hkdf(authSecret, new Uint8Array(sharedBits),
    buildInfo('auth', new Uint8Array(0), new Uint8Array(0)), 32);

  const contentKey   = await hkdf(salt, prk,
    buildInfo('aesgcm', receiverPublicKey, serverKeys.publicRaw), 16);

  const contentNonce = await hkdf(salt, prk,
    buildInfo('nonce', receiverPublicKey, serverKeys.publicRaw), 12);

  const key = await crypto.subtle.importKey(
    'raw', contentKey, { name: 'AES-GCM' }, false, ['encrypt']
  );

  // 2-byte padding length + data
  const padded = new Uint8Array(2 + data.length);
  padded.set(data, 2);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: contentNonce }, key, padded
  );

  // Build aes128gcm content-encoding header
  // salt(16) + rs(4) + idlen(1) + keyid(65) + ciphertext
  const rs     = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);
  const result = new Uint8Array(16 + 4 + 1 + 65 + ciphertext.byteLength);
  let offset   = 0;
  result.set(salt, offset);         offset += 16;
  result.set(rs, offset);           offset += 4;
  result[offset++] = 65;
  result.set(serverKeys.publicRaw, offset); offset += 65;
  result.set(new Uint8Array(ciphertext), offset);
  return result;
}

async function hkdf(salt, ikm, info, length) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', ikm, { name: 'HKDF' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info }, keyMaterial, length * 8
  );
  return new Uint8Array(bits);
}

function buildInfo(type, clientKey, serverKey) {
  const encoder = new TextEncoder();
  const typeBytes = encoder.encode(`Content-Encoding: ${type}\0`);
  const label     = encoder.encode('P-256\0');
  const info      = new Uint8Array(typeBytes.length + label.length + 2 + clientKey.length + 2 + serverKey.length);
  let i = 0;
  info.set(typeBytes, i); i += typeBytes.length;
  info.set(label, i);     i += label.length;
  new DataView(info.buffer).setUint16(i, clientKey.length, false); i += 2;
  info.set(clientKey, i); i += clientKey.length;
  new DataView(info.buffer).setUint16(i, serverKey.length, false); i += 2;
  info.set(serverKey, i);
  return info;
}

// ── VAPID header ──────────────────────────────────────────────────────────────

async function buildVapidHeader(endpoint, { publicKey, privateKey, subject }) {
  const audience = new URL(endpoint).origin;
  const expiry   = Math.floor(Date.now() / 1000) + 43200; // 12 hours

  const header  = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64url(JSON.stringify({ aud: audience, exp: expiry, sub: subject }));
  const toSign  = `${header}.${payload}`;

  const privKeyBytes = base64ToUint8(privateKey);
  const cryptoKey    = await crypto.subtle.importKey(
    'pkcs8', privKeyBytes,
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    new TextEncoder().encode(toSign)
  );

  const token = `${toSign}.${uint8ToBase64Url(new Uint8Array(sig))}`;
  return `vapid t=${token}, k=${publicKey}`;
}

// ── Utility ───────────────────────────────────────────────────────────────────

function base64ToUint8(b64) {
  const padding = '='.repeat((4 - b64.length % 4) % 4);
  const raw     = atob((b64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

function uint8ToBase64Url(arr) {
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64url(str) {
  return uint8ToBase64Url(new TextEncoder().encode(str));
}
