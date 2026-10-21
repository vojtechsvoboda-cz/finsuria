/**
 * FINSURIA – Cloudflare Worker
 *
 * Serves the static site from ./public and handles the contact form:
 *   GET  /api/config    → public config for the page (Turnstile site key)
 *   POST /api/poptavka  → validate, store in D1 (env.DB), send e-mail (env.EMAIL)
 *
 * Everything optional is detected at runtime, so the site works before the
 * e-mail or Turnstile are set up. A lead is accepted when at least one
 * delivery channel (D1 or e-mail) succeeds.
 */

const ROLES = ["Předseda výboru", "Člen výboru", "Člen SVJ", "Správce SVJ"];
const TOPICS = [
  "Snížit náklady na energie",
  "Tepelné čerpadlo",
  "Fotovoltaika",
  "Výběr dodavatele a realizace",
  "Zatím nevíme",
];
const UNITS = ["", "do 12", "13–30", "31–60", "více než 60", "nevím"];
const HEATING = ["", "Dálkové teplo (teplárna)", "Vlastní plynová kotelna", "Elektřina", "Jiný zdroj", "Nevím"];
const CONTACT_PREF = ["Telefonicky", "E-mailem"];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/config") {
      return json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY || null }, 200, {
        "cache-control": "public, max-age=300",
      });
    }

    if (url.pathname === "/api/poptavka") {
      if (request.method !== "POST") return json({ ok: false, error: "Metoda není povolena." }, 405);
      return handleLead(request, env, ctx);
    }

    if (url.pathname.startsWith("/api/")) return json({ ok: false, error: "Nenalezeno." }, 404);

    return env.ASSETS.fetch(request);
  },
};

async function handleLead(request, env, ctx) {
  // Same-origin only (browsers always send Origin on POST fetch)
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    return json({ ok: false, error: "Neplatný požadavek." }, 403);
  }

  if (Number(request.headers.get("content-length") || 0) > 20_000) {
    return json({ ok: false, error: "Zpráva je příliš dlouhá." }, 413);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Neplatná data formuláře." }, 400);
  }

  // Spam traps: honeypot filled or submitted inhumanly fast → pretend success.
  if (str(body.web) || Number(body.elapsed) < 2500) {
    return json({ ok: true });
  }

  // Turnstile (only when the secret is configured)
  if (env.TURNSTILE_SECRET_KEY) {
    const passed = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, str(body.turnstile), request.headers.get("cf-connecting-ip"));
    if (!passed) {
      return json({ ok: false, error: "Nepodařilo se ověřit, že nejste robot. Obnovte stránku a zkuste to znovu." }, 400);
    }
  }

  const lead = {
    jmeno: str(body.jmeno, 120),
    role: str(body.role, 40),
    svj: str(body.svj, 200),
    pocet_jednotek: str(body.pocet_jednotek, 40),
    vytapeni: str(body.vytapeni, 60),
    temata: Array.isArray(body.temata) ? body.temata.map((t) => str(t, 60)).filter((t) => TOPICS.includes(t)) : [],
    zprava: str(body.zprava, 3000),
    telefon: str(body.telefon, 40),
    email: str(body.email, 160),
    preferovany_kontakt: str(body.preferovany_kontakt, 20),
  };

  const fields = {};
  if (!lead.svj) fields.svj = "Vyplňte název SVJ nebo adresu domu.";
  if (!lead.jmeno) fields.jmeno = "Vyplňte jméno a příjmení.";
  if (!ROLES.includes(lead.role)) fields.role = "Vyberte svou roli v SVJ.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(lead.email)) fields.email = "E-mail nemá správný tvar, zkontrolujte ho.";
  if (lead.telefon && lead.telefon.replace(/\D/g, "").length < 9) fields.telefon = "Telefon by měl mít aspoň 9 číslic.";
  if (lead.preferovany_kontakt === "Telefonicky" && !lead.telefon) fields.telefon = "Chcete, abychom zavolali. Doplňte prosím telefon.";
  if (!UNITS.includes(lead.pocet_jednotek)) lead.pocet_jednotek = "";
  if (!HEATING.includes(lead.vytapeni)) lead.vytapeni = "";
  if (!CONTACT_PREF.includes(lead.preferovany_kontakt)) lead.preferovany_kontakt = "";

  if (Object.keys(fields).length) {
    return json({ ok: false, error: "Zkontrolujte označená pole.", fields }, 400);
  }

  const country = request.cf?.country || "";
  let stored = false;
  let mailed = false;
  let leadId = null;

  if (env.DB) {
    try {
      const res = await env.DB.prepare(
        `INSERT INTO poptavky (jmeno, role, svj, pocet_jednotek, vytapeni, temata, zprava, telefon, email, preferovany_kontakt, ip_zeme)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(lead.jmeno, lead.role, lead.svj, lead.pocet_jednotek, lead.vytapeni, lead.temata.join(", "), lead.zprava, lead.telefon, lead.email, lead.preferovany_kontakt, country)
        .run();
      stored = true;
      leadId = res.meta?.last_row_id ?? null;
    } catch (err) {
      console.error("D1 insert failed", err);
    }
  }

  if (env.EMAIL && env.LEAD_TO && env.LEAD_FROM) {
    try {
      await env.EMAIL.send(buildEmail(lead, env));
      mailed = true;
    } catch (err) {
      console.error("E-mail send failed", err);
    }
    if (mailed && stored && leadId) {
      ctx.waitUntil(env.DB.prepare("UPDATE poptavky SET email_odeslan = 1 WHERE id = ?").bind(leadId).run().catch(() => {}));
    }
  }

  if (!stored && !mailed) {
    console.error("Lead not delivered – no working channel", { svj: lead.svj });
    return json({ ok: false, error: "Poptávku se teď nepodařilo odeslat." }, 503);
  }

  return json({ ok: true });
}

function buildEmail(lead, env) {
  const to = env.LEAD_TO.split(",").map((s) => s.trim()).filter(Boolean);
  const rows = [
    ["Jméno", lead.jmeno],
    ["Role", lead.role],
    ["SVJ / adresa", lead.svj],
    ["Počet jednotek", lead.pocet_jednotek],
    ["Vytápění", lead.vytapeni],
    ["S čím pomoci", lead.temata.join(", ")],
    ["E-mail", lead.email],
    ["Telefon", lead.telefon],
    ["Preferuje kontakt", lead.preferovany_kontakt],
  ].filter(([, v]) => v);

  const text =
    rows.map(([k, v]) => `${k}: ${v}`).join("\n") +
    (lead.zprava ? `\n\nZpráva:\n${lead.zprava}` : "") +
    "\n\n— Odesláno z formuláře na finsuria.cz";

  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#1a1d23;line-height:1.5">
<h2 style="margin:0 0 16px;font-size:20px">Nová poptávka z webu</h2>
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:15px">
${rows.map(([k, v]) => `<tr><td style="color:#5a606b;padding-right:18px;vertical-align:top">${esc(k)}</td><td><strong>${esc(v)}</strong></td></tr>`).join("\n")}
</table>
${lead.zprava ? `<p style="margin:20px 0 6px;color:#5a606b">Zpráva</p><p style="margin:0;white-space:pre-wrap">${esc(lead.zprava)}</p>` : ""}
<p style="margin-top:28px;font-size:13px;color:#9aa0aa">Odesláno z formuláře na finsuria.cz. Odpovědí na tento e-mail napíšete přímo tazateli.</p>
</body></html>`;

  return {
    from: { email: env.LEAD_FROM, name: "Web FINSURIA" },
    to,
    replyTo: { email: lead.email, name: lead.jmeno },
    subject: `Nová poptávka: ${lead.svj}`,
    text,
    html,
  };
}

async function verifyTurnstile(secret, token, ip) {
  if (!token) return false;
  try {
    const form = new FormData();
    form.append("secret", secret);
    form.append("response", token);
    if (ip) form.append("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const data = await res.json();
    return Boolean(data.success);
  } catch {
    return false;
  }
}

function str(v, max = 500) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}
