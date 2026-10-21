# FINSURIA – web

One-page web pro FINSURIA s.r.o. (poradenství SVJ k úsporám energií a investicím).
Běží jako **Cloudflare Worker se statickými soubory**. Formulář zpracovává tentýž Worker, žádná služba třetí strany.

```
public/          statický web (index.html, styles.css, app.js, favicon, 404)
src/worker.js    API formuláře + servírování webu
migrations/      schéma tabulky poptávek (D1)
wrangler.jsonc   konfigurace Workeru
```

## Lokálně

```bash
npm install
npx wrangler d1 execute DB --local --file migrations/0001_poptavky.sql   # jen poprvé
npm run dev        # http://localhost:8787
```

## Nasazení

V Cloudflare dashboardu **Workers & Pages → Create → Import a repository** → `vojtechsvoboda-cz/finsuria`.
Build command nechat prázdný, deploy command `npx wrangler deploy`. Každý push do `main` se nasadí sám.

## Formulář – jak to funguje

`POST /api/poptavka` poptávku zvaliduje a:

1. **uloží ji do D1** `finsuria-poptavky` (tabulka `poptavky`) – funguje hned, je to záloha, aby se nic neztratilo,
2. **pošle e-mail** přes Cloudflare Email Service – zapne se až po krocích níže.

Ochrana proti spamu: skryté pole (honeypot), minimální doba vyplnění, kontrola Originu, volitelně Turnstile.

Přehled poptávek: dashboard → **Storage & Databases → D1 → finsuria-poptavky → Console**:

```sql
SELECT * FROM poptavky ORDER BY id DESC;
```

## Zapnutí e-mailů (až bude doména na Cloudflare)

1. Přidat `finsuria.cz` do Cloudflare a u registrátora (WEDOS) přepnout NS na Cloudflare.
   **Pozor:** pokud firma používá e-mail na doméně, zkontrolovat, že se přenesly MX/SPF záznamy.
2. **Compute → Email Service → Email Routing**: zapnout a v *Destination addresses* přidat adresu(y),
   kam mají poptávky chodit. Příjemce musí kliknout na ověřovací e-mail.
   (Posílání na ověřené adresy je zdarma i na Free plánu.)
3. Ve `wrangler.jsonc` odkomentovat `send_email` a doplnit `LEAD_TO` (víc adres oddělit čárkou)
   a `LEAD_FROM` (např. `web@finsuria.cz`). Adresy v `allowed_destination_addresses` musí odpovídat `LEAD_TO`.
4. Push → nasadí se. Odpověď na e-mail s poptávkou jde rovnou tazateli (Reply-To).

## Turnstile (volitelné)

Dashboard → **Turnstile → Add widget** pro `finsuria.cz` → site key dát do `vars.TURNSTILE_SITE_KEY`,
secret key do **Settings → Variables and Secrets** Workeru jako `TURNSTILE_SECRET_KEY`.
Bez nich formulář funguje dál, jen bez tohoto ověření.

## Co ještě chybí od klienta

- logo / barvy (zatím typografický logotyp „finsuria“ s červenými tečkami)
- e-mail(y) pro poptávky
- údaje do patičky (IČO, sídlo, kontakt), případně fotky
