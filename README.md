# FIRECO Website

Bilingual English and Arabic website for FIRECO Technical Services LLC. The site presents fire alarm and firefighting system design, supply, installation, maintenance, annual maintenance contracts, and Civil Defence certificate assistance across the UAE.

## Build and preview

Requirements: Node.js and pnpm (the repository pins pnpm in `package.json`).

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm run preview
```

The production client is written to `dist/client`. The build also prepares the server and hosting metadata in `dist/`.

## Website content

- `src/` contains the responsive React website and English/Arabic content.
- `public/assets/` and `public/clients/` contain site photography, the company logo, profile PDF, and client marks.
- `data/clients.json` stores the 71 client and project references.
- `admin/` contains the CMS interface and GitHub backend configuration for `Ebrahim-66/fireco-web`.
- `worker/` and `vercel.json` contain the hosting/security routing configuration.

The enquiry form opens the visitor’s email application with a prepared message addressed to `info@firecots.com`; it does not send mail from a server.

## Deployment

Deploy the repository using the hosting provider’s project settings. Use `pnpm run build` as the build command and `dist/client` as the static output directory when the provider requests one. The repository does not contain hosting credentials or perform deployment automatically.
