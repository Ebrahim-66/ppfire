# FIRECO Portal deployment setup

## Current project status

The `ppfire` project has a Neon Postgres database, a private Vercel Blob store, and a Resend email resource connected. Production session and bootstrap account secrets are set in Vercel. The generated initial login details are stored only on the owner's computer in `.env.portal-credentials.local`, which is excluded from Git.

Resend cannot send from `firecots.com` until the domain's DNS records are verified. Set `EMAIL_FROM` only after verification, then redeploy. Until then, enquiries and applications are saved in the portal, but email notifications are unavailable. The portal allows sign-in when its database, private storage, session secret, and account secrets are ready; `/api/portal/health` reports full readiness only after email is configured too.

The website builds with `pnpm install --frozen-lockfile` and `pnpm run build`. The secure admin portal is served at `/adminportal` and uses a Vercel Node.js function at `/api/portal/*`.

## Required Vercel resources

Create or connect these resources to the `ppfire` Vercel project:

- **Neon Postgres**: set `DATABASE_URL` to the pooled connection string.
- **Vercel Blob**: create a private store and set `BLOB_READ_WRITE_TOKEN` to its write token. Uploaded CVs and replacement company profiles are private.
- **Resend**: verify a sending domain and set `RESEND_API_KEY` and `EMAIL_FROM` (for example, `FIRECO Website <website@firecots.com>` after the domain is verified).

Set these project environment variables for Production (and Preview if preview testing is needed):

| Variable | Value |
| --- | --- |
| `APP_ORIGIN` | `https://ppfire.vercel.app` |
| `PORTAL_SESSION_SECRET` | A newly generated random secret with at least 32 characters |
| `PORTAL_MANAGER_USERNAME` | `MANAGER` (optional; this is the default) |
| `PORTAL_MANAGER_PASSWORD` | A new, unique password with at least 12 characters |
| `PORTAL_ADMIN_USERNAME` | `admin` (optional; this is the default) |
| `PORTAL_ADMIN_PASSWORD` | A different new, unique password with at least 12 characters |

**Rotate any portal passwords previously shared in chat.** Do not reuse those values. Do not put secrets in the repository, source code, build logs, or chat. Use Vercel’s Environment Variables UI or a secure local secret manager. Redeploy after changing variables.

## First use

1. Open `https://ppfire.vercel.app/adminportal` after the production deployment is ready.
2. The first portal API request creates its database tables and imports the current client list. It also creates the initial manager and admin accounts from the two bootstrap environment variables. Initial account creation is one-time; later password changes belong in the portal.
3. The manager can manage enquiries, applicants and CVs, clients, users, notification addresses, and the public company profile PDF. The admin account can view enquiries, applications, and CVs without changing records.
4. Confirm a test enquiry and careers application appear in the portal and that notification emails arrive at `info@firecots.com` and `hr@firecots.com`.

`GET /api/portal/health` reports which required settings are present. It never returns secret values. It checks configuration presence, not whether credentials can reach their providers. Submit the two forms and sign in to verify the complete flow after deployment.

CVs and company profile PDFs must be valid PDF files no larger than 3 MB. Keep the Blob store private. Avoid using public Blob URLs for applicant documents.
