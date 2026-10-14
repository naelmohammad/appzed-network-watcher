/**
 * AppZed network-watcher (managed=true). Track DNS answers and TLS
 * certificate expiry per domain via public transparency APIs. Hourly cron
 * refreshes every watched domain. Schema self-initializes.
 * Bindings: DB (d1). No AI needed.
 */
const SCHEMA = "CREATE TABLE IF NOT EXISTS domains (name TEXT PRIMARY KEY, expiry_date TEXT, days_left INTEGER, dns_answers TEXT, checked_at TEXT)";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, solution: "network-watcher" });
    }
    if (request.method === "POST" && url.pathname === "/domains") {
      const body = await request.json().catch(() => null);
      const domain = String(body?.domain || "").trim().toLowerCase();
      if (!/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) {
        return bad("a valid domain name is required.");
      }
      await env.DB.exec(SCHEMA);
      const snapshot = await checkDomain(domain);
      await env.DB.prepare(
        "INSERT INTO domains (name, expiry_date, days_left, dns_answers, checked_at) VALUES (?, ?, ?, ?, datetime('now')) ON CONFLICT(name) DO UPDATE SET expiry_date=excluded.expiry_date, days_left=excluded.days_left, dns_answers=excluded.dns_answers, checked_at=datetime('now')"
      ).bind(domain, snapshot.expiry_date, snapshot.days_left, JSON.stringify(snapshot.dns_answers)).run();
      return Response.json({ domain, ...snapshot }, { status: 201 });
    }
    if (request.method === "GET" && url.pathname === "/report") {
      await env.DB.exec(SCHEMA);
      const rows = await env.DB.prepare(
        "SELECT * FROM domains ORDER BY days_left ASC"
      ).all();
      const domains = (rows.results || []).map((r) => ({ ...r, dns_answers: JSON.parse(r.dns_answers || "[]") }));
      return Response.json({ domains });
    }
    return new Response("Not found", { status: 404 });
  },

  async scheduled(event, env) {
    await env.DB.exec(SCHEMA);
    const rows = await env.DB.prepare("SELECT name FROM domains").all();
    let checked = 0;
    for (const r of rows.results || []) {
      try {
        const snapshot = await checkDomain(r.name);
        await env.DB.prepare(
          "UPDATE domains SET expiry_date = ?, days_left = ?, dns_answers = ?, checked_at = datetime('now') WHERE name = ?"
        ).bind(snapshot.expiry_date, snapshot.days_left, JSON.stringify(snapshot.dns_answers), r.name).run();
        checked++;
      } catch {
        // One unreachable domain must not stop the rest of the sweep.
      }
    }
    return Response.json({ checked });
  },
};

async function checkDomain(domain) {
  const [dns, certs] = await Promise.all([resolveDNS(domain), fetchCerts(domain)]);
  let expiry_date = null;
  let days_left = null;
  if (certs.length > 0) {
    const latest = certs.map((c) => c.not_after).sort().pop();
    expiry_date = latest;
    days_left = Math.floor((new Date(latest).getTime() - Date.now()) / 86400000);
  }
  return { expiry_date, days_left, dns_answers: dns };
}

async function resolveDNS(domain) {
  const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${domain}&type=A`, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.Answer || []).filter((a) => a.type === 1).map((a) => a.data);
}

async function fetchCerts(domain) {
  const res = await fetch(`https://crt.sh/?q=%25.${domain}&output=json`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return [];
  const data = await res.json().catch(() => []);
  return Array.isArray(data) ? data.filter((c) => c.not_after) : [];
}

function bad(message) {
  return Response.json({ error: message }, { status: 400 });
}
