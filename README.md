# six ✦

**six** is his own app now — the AI from 6ixNetworks, set free. A sharp, funny,
extremely capable assistant with real personality: chat, homework, code, ideas,
and drawings, with zero corporate stiffness.

## Features

- **Streaming chat** — replies type out live, powered by Gemini with a
  multi-model fallback chain (server-side key, never exposed to the browser)
- **Six's personality** — direct, high-energy, funny; matches your energy and
  raises it
- **Draw mode** — hit the image button in the composer and describe a picture
  (Flux via Cloudflare Workers AI, when configured)
- **Real chat app chrome** — multiple conversations in a sidebar, search,
  per-chat history, message copy, code blocks with copy buttons, markdown +
  tables
- **Private by default** — conversations are stored only in the browser's
  local storage on the device; the server keeps nothing
- **Installable PWA** — add it to a home screen like a native app
- Zero dependencies. One Node file serves everything.

## Run it

```bash
GEMINI_API_KEY=your_key node server.js
# → http://localhost:3000
```

### Environment

| Variable         | Required | Purpose                                        |
| ---------------- | -------- | ---------------------------------------------- |
| `GEMINI_API_KEY` | yes      | Six's brain (Google AI Studio key)             |
| `CF_ACCOUNT_ID`  | no       | Enables drawing (Cloudflare Workers AI)        |
| `CF_API_TOKEN`   | no       | Enables drawing (token with Workers AI access) |
| `PORT`           | no       | Set automatically on Render (default 3000)     |

## Deploy (Cloudflare Workers — the main way)

1. Cloudflare dashboard → **Workers & Pages → Create → Import a repository** →
   pick this repo. The included `wrangler.toml` configures everything
   (worker entry `worker.js`, static files from `public/`).
2. After the first deploy, open the worker → **Settings → Variables and
   Secrets** and add:
   - `GEMINI_API_KEY` as a **Secret** (required — Six's brain)
   - `CF_ACCOUNT_ID` + `CF_API_TOKEN` (optional — lights up drawing)
3. Redeploy once so the secret binds. Done — he lives at
   `https://six-ai.<your-subdomain>.workers.dev` (or a custom domain).

CLI instead? `npx wrangler deploy` then `npx wrangler secret put GEMINI_API_KEY`.

### Or on Node (Render etc.)

`server.js` is the same app as a zero-dependency Node server — `render.yaml`
is included for a one-click Render service; set the same env vars there.

## Layout

```
worker.js            the Cloudflare Worker (api + assets host)
server.js            the same app on plain Node (alternative host)
wrangler.toml        Cloudflare config
public/
  index.html         the app shell
  style.css          the design system
  app.js             chat engine, markdown renderer, local history
  manifest.webmanifest
  icon.svg
```
