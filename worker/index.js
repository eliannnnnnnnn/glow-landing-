/**
 * GLOW Landing – Cloudflare Worker
 * 
 * Routes:
 *   POST /subscribe   → enregistre email dans KV
 *   GET  /subscribers  → liste toutes les inscriptions (admin debug)
 *   GET  /count        → nombre d'inscrits
 * 
 * KV: GLOW_STORAGE  (email → JSON { date, plan })
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const BLOCKED_DOMAINS = [
  'yopmail.com', 'temp-mail.org', 'guerrillamail.com',
  'mailinator.com', 'throwaway.email', 'tempail.com',
  'fakeinbox.com', 'sharklasers.com', 'guerrillamailblock.com',
  'grr.la', 'dispostable.com',
];

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function validateEmail(email) {
  if (!email || typeof email !== 'string') return 'Email requis.';
  const trimmed = email.trim().toLowerCase();
  if (trimmed.length < 5 || trimmed.length > 254) return 'Email invalide.';
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!re.test(trimmed)) return 'Format d\'email invalide.';
  const domain = trimmed.split('@')[1];
  if (BLOCKED_DOMAINS.some(b => domain.includes(b))) return 'Domaine non autorisé.';
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // ─── POST /subscribe ───────────────────────────────
    if (url.pathname === '/subscribe' && request.method === 'POST') {
      try {
        const body = await request.json();
        const email = (body.email || '').trim().toLowerCase();
        const plan = body.plan || 'free'; // "free" | "glow+" | "waitlist"

        // Validation
        const error = validateEmail(email);
        if (error) {
          return jsonResponse({ ok: false, error }, 400);
        }

        // Vérifier si déjà inscrit
        const existing = await env.GLOW_STORAGE.get(email);
        if (existing) {
          return jsonResponse({ ok: false, error: 'Tu es déjà inscrit(e) ! 🎉' }, 409);
        }

        // Enregistrer dans KV : clé = email, valeur = JSON
        const value = JSON.stringify({
          date: new Date().toISOString(),
          plan,
          ua: request.headers.get('User-Agent') || '',
        });
        await env.GLOW_STORAGE.put(email, value);

        return jsonResponse({ ok: true, message: 'Inscription réussie !' });
      } catch (e) {
        return jsonResponse({ ok: false, error: 'Erreur serveur. Réessaie.' }, 500);
      }
    }

    // ─── GET /count ────────────────────────────────────
    if (url.pathname === '/count' && request.method === 'GET') {
      try {
        const list = await env.GLOW_STORAGE.list();
        return jsonResponse({ ok: true, count: list.keys.length });
      } catch (e) {
        return jsonResponse({ ok: false, count: 0 }, 500);
      }
    }

    // ─── GET /subscribers (debug/admin) ────────────────
    if (url.pathname === '/subscribers' && request.method === 'GET') {
      try {
        const list = await env.GLOW_STORAGE.list();
        const subs = [];
        for (const key of list.keys) {
          const val = await env.GLOW_STORAGE.get(key.name);
          subs.push({ email: key.name, ...JSON.parse(val || '{}') });
        }
        return jsonResponse({ ok: true, subscribers: subs, total: subs.length });
      } catch (e) {
        return jsonResponse({ ok: false, error: e.message }, 500);
      }
    }

    // 404
    return jsonResponse({ error: 'Not found' }, 404);
  },
};
