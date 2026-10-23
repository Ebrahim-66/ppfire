# FIRECO Website

Bilingual English and Arabic website for FIRECO Technical Services LLC. The website presents fire alarm and firefighting system design, supply, installation, maintenance, AMC support, Civil Defence certificate assistance, client references, and UAE office contact details.

## Build and preview

Requirements: Node.js 20+ and pnpm 11 (the repository pins pnpm in `package.json`).

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm run preview
```

Vite writes the production website to `dist/client`. The build command is `pnpm run build`; the Vercel output directory is `dist/client`.

## Pages

- `/` — bilingual company website.
- `/careers.html` — careers application form with private PDF CV upload.
- `/adminportal` — secure enquiry-management portal.

## Portal setup

The portal requires Neon Postgres, private Vercel Blob storage, and Resend email credentials. Configure the server-side Vercel environment variables before using the portal or online submission forms. See [PORTAL-SETUP.md](PORTAL-SETUP.md) for the exact checklist and first-use steps. Never commit secrets or applicant CVs.

The enquiry form stores enquiries and sends notifications to `info@firecots.com`. The careers form stores applications and CVs privately and sends notifications to `hr@firecots.com` once the required deployment services are configured.

## Content

- `src/` contains the responsive React website and portal UI.
- `public/assets/` contains the website images, company logo, and profile PDF.
- `data/clients.json` and `public/data/clients.json` contain synchronized client and project references.
- `api/portal/[...path].js` contains the Vercel serverless portal API.
- `vercel.json` configures the static output, portal route, and security headers.
