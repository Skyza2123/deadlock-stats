Deadlock Stats

Next.js app for Deadlock match, player, and team stats with Postgres + Drizzle ORM and NextAuth (Steam + credentials).

## Local Development

1. Copy `.env.example` to `.env.local` and fill required values.
2. Install dependencies:

```bash
npm install
```

3. Start Postgres and ensure `DATABASE_URL` is reachable.
4. Run database migrations:

```bash
npm run db:migrate
```

5. Start dev server:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Required Environment Variables

- `DATABASE_URL`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `STEAM_SECRET`
- `DEADLOCK_API_KEY`

Optional:

- `AUTH_EMAIL`
- `AUTH_PASSWORD`
- `NEXT_PUBLIC_USE_EXTRACTED_HERO_ASSETS` (defaults to API fallback when unset/0)

## Env Helper Commands

- Generate a new auth secret:

```bash
npm run auth:secret
```

- Check required vars from `.env.local` + current shell env:

```bash
npm run env:check
```

- Run production-focused checks (`https` URL, no `trycloudflare.com`):

```bash
npm run env:check:prod
```

## Production Hosting Checklist (Vercel)

1. **Create managed Postgres** (Neon/Supabase/Railway/etc) and copy the connection string.
2. **Push this repo** to GitHub.
3. **Import project into Vercel** and set framework to Next.js (auto-detected).
4. **Add production env vars** in Vercel Project Settings:

	- `DATABASE_URL`
	- `NEXTAUTH_URL` = `https://your-domain.com`
	- `NEXTAUTH_SECRET` (generate a long random secret)
	- `STEAM_SECRET`
	- `DEADLOCK_API_KEY`
	- `AUTH_EMAIL` / `AUTH_PASSWORD` (optional)
	- `NEXT_PUBLIC_USE_EXTRACTED_HERO_ASSETS=0` unless `public/assets/heroes` is populated

5. **Run migrations against production DB**:

```bash
npm run db:migrate
```

6. **Set custom domain** in Vercel and update `NEXTAUTH_URL` to match it exactly.
7. **Redeploy** after env changes.
8. **Run a final env validation** before release:

```bash
npm run env:check:prod
```

## Cloudflare Tunnel Note

`trycloudflare.com` URLs are temporary and suitable for dev/demo only. For stable hosting, use a permanent production URL (for example, Vercel + custom domain).

## Security

- Never commit `.env.local`.
- Rotate any secrets that have been shared in plaintext.
