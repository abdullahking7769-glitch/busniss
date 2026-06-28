# Milk Ops Backend

A real backend for the dairy operations dashboard — replaces the browser-only
storage and password "obfuscation" in the front-end prototype with an actual
database, real password hashing (bcrypt), and real authentication (JWT).

This version is built for **free deployment on Render.com**, using Render's
free PostgreSQL database (so your data survives restarts and redeploys —
Render's free web service itself has no persistent disk, but a database
add-on does).

## Why this exists

The front-end dashboard you've been building runs entirely in the browser.
That's great for a prototype, but it means:
- Anyone with browser dev tools can read all the code, including login logic
- "Passwords" were reversibly encoded, not hashed — not real protection
- There's no real database — data lived in the browser's local storage

This backend fixes all three. Passwords are hashed with bcrypt (one-way —
even this server can't recover your original password from the hash).
Login happens here, on the server, not in the user's browser. Data lives in
a real PostgreSQL database.

## What's included

- `accounts` table — staff/admin logins (Staff, Admin, Super Admin roles)
- `customers` table — customer records + optional portal login
- `packages`, `customer_packages`, `orders`, `payments` — core data tables
- `activity_log` — every sign-in/sign-out/sign-up event, staff and customer
- Full staff auth: login, logout, create/delete accounts (Admin-only)
- Full customer auth: public signup (with duplicate-phone blocking), login,
  logout, "my profile + package + orders" endpoint
- Super-Admin-only "Danger Zone" endpoint to wipe everything
- Rate limiting on login/signup endpoints (20 attempts per 15 min per IP)
- CORS locked to an allowlist you configure

**Every endpoint below has been tested against a real running PostgreSQL
database** — login, signup, duplicate-blocking, role permissions, and the
Danger Zone wipe were all verified to work correctly, not just written.

## What's NOT included (yet)

This is a solid foundation, not the complete backend. Endpoints for
packages, orders, payments, deliveries, complaints, reports, etc. follow
the exact same pattern as `src/routes/admin.js` — ask me to build out any
of those next, or extend it yourself following that file as a template.

## Free deployment on Render — step by step

### 1. Put this code on GitHub
Render deploys from a GitHub repo. Create a new repo, push this `backend`
folder to it. `.gitignore` already excludes `node_modules` and `.env` — do
not commit `.env` (it holds secrets).

### 2. Create the free PostgreSQL database
1. Go to [render.com](https://render.com) → New → PostgreSQL
2. Pick the **Free** plan
3. Give it a name (e.g. `milk-ops-db`), choose a region close to your
   customers, click Create
4. Once it's ready, open it and copy the **Internal Database URL** — you'll
   need this in step 3

Render's free Postgres is free for 30 days, then either continues free
indefinitely or requires an upgrade depending on Render's current policy —
check the plan details on their pricing page before relying on it long-term.

### 3. Create the free web service
1. Render → New → Web Service → connect your GitHub repo
2. Root directory: `backend` (if you pushed other things alongside it)
3. Build command: `npm install`
4. Start command: `npm start`
5. Plan: **Free**
6. Under Environment Variables, add:
   - `DATABASE_URL` → paste the Internal Database URL from step 2
   - `JWT_SECRET` → generate one locally first:
     ```bash
     node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
     ```
     paste the output in
   - `JWT_EXPIRES_IN` → `7d`
   - `ALLOWED_ORIGINS` → your dashboard's URL once you have one (can be
     `http://localhost:3000` for now and updated later)
   - `NODE_ENV` → `production`
7. Click Create Web Service

### 4. Run the migration and create your first account
Render's free tier doesn't give you a persistent shell, so the easiest way
to run one-off commands is via Render's **Shell** tab on your service (in
their dashboard, under your web service → Shell), once it's deployed:
```bash
npm run migrate
node src/seed.js admin "choose-a-strong-password"
```
If the Shell tab isn't available on the free tier when you get there, the
alternative is running these same two commands from your own computer with
`DATABASE_URL` set to Render's **External** Database URL (shown on the
database's page) instead of the internal one.

### 5. Verify it's alive
Render gives your service a URL like `https://milk-ops-backend.onrender.com`.
Test it:
```bash
curl https://milk-ops-backend.onrender.com/api/health
```
Then test login with the account you seeded:
```bash
curl -X POST https://milk-ops-backend.onrender.com/api/staff/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"choose-a-strong-password"}'
```
A `token` coming back means it's really working.

### A free-tier quirk worth knowing
Render's free web services **sleep after 15 minutes with no traffic**, and
take 30-60 seconds to wake back up on the next request. For a small dairy
business this is usually fine — just don't be surprised if the first
request of the day feels slow.

## Local setup (for testing before you deploy)

You'll need [Node.js](https://nodejs.org) 18+ and a PostgreSQL database —
either install Postgres locally, or just use Render's free database from
the start and point your local `.env` at its External Database URL.

```bash
cd backend
npm install
cp .env.example .env
```
Fill in `.env` with your `DATABASE_URL` and a generated `JWT_SECRET` (same
command as above), then:
```bash
npm run migrate
node src/seed.js admin "choose-a-strong-password"
npm start
```

## Connecting the front-end dashboard to this

The dashboard you have now talks to `window.storage` (browser-only). To
connect it to this real backend instead, every place it currently does:
```js
await window.storage.get(key, false)
await window.storage.set(key, value, false)
```
would need to become a `fetch()` call to this API instead, e.g.:
```js
fetch(`${API_BASE_URL}/api/staff/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username, password }),
})
```
and the returned `token` stored (e.g. in memory or sessionStorage) and sent
as `Authorization: Bearer <token>` on every subsequent request.

This is a meaningful rewire of the dashboard's data layer — happy to do
that next, once this backend is deployed and you have a real API URL to
point it at.

## A honest note on what "secure" means here

This setup is a solid, real foundation — hashed passwords, server-side auth,
a real database. It is not a substitute for things a production system
would eventually also want: regular database backups (check what Render's
free tier actually guarantees here before trusting it with irreplaceable
data), monitoring, and probably a paid/managed database once you have
meaningful traffic or can't tolerate the free tier's sleep delay. Good
enough to stop being a "casual deterrent" — not the final word in security
for a system handling real customer payments at scale.
