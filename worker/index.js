export default {
  async fetch(request, env) {
    let response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");

    if (response.status === 404 && acceptsHtml && ["GET", "HEAD"].includes(request.method)) {
      const indexUrl = new URL(request.url);
      indexUrl.pathname = "/index.html";
      indexUrl.search = "";
      response = await env.ASSETS.fetch(new Request(indexUrl, request));
    }

    return secureResponse(response, new URL(request.url).pathname);
  },
};

function secureResponse(response, pathname) {
  // These statuses cannot be wrapped in a new Response by the Fetch API.
  // The browser will reuse the headers from the cached successful response.
  if ([101, 204, 205, 304].includes(response.status)) return response;

  const headers = new Headers(response.headers);
  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");

  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("X-Permitted-Cross-Domain-Policies", "none");
  headers.set("X-Robots-Tag", isAdmin ? "noindex, nofollow, noarchive" : "index, follow");

  if (isAdmin) {
    headers.set("Cache-Control", "no-store, max-age=0");
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; base-uri 'self'; form-action 'self' https://github.com; frame-ancestors 'none'; object-src 'none'; script-src 'self' https://unpkg.com; style-src 'self' 'unsafe-inline'; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https://avatars.githubusercontent.com https://github.com; connect-src 'self' https://api.github.com https://github.com; frame-src https://github.com; upgrade-insecure-requests",
    );
  } else {
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; base-uri 'self'; form-action 'self' mailto:; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; upgrade-insecure-requests",
    );
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
