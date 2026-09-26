# Maat demo

A three-column view for the public Maat demos. Each column has its own URL field and iframe. The Agent, Gateway, and Merchant pages load on startup. Focus a URL field to choose Agent, Gateway, Merchant, or Swap, or enter any HTTP or HTTPS URL and press Enter or leave the field.

## Run locally

```bash
cd maat-demo
cp .env.example .env
npm install
npm run dev
```

Open the URL printed by Vite. `npm run build` creates the static site in `dist/`.

Browsers can display a site in an iframe only when that site's response headers allow embedding. If a view is blocked, use its open-in-new-tab button.

## Deploy

Set the deployment values in the ignored `.env`. The site is a static Vite build served by Caddy, without a PM2 process.

```bash
npm run check
npm run deploy
```

The deployment script uploads `dist/` to the configured host, validates the Caddy configuration, and activates the site. The DNS record is managed by `deploy/cloudflare/dns.mjs` using a Cloudflare token injected at run time.
