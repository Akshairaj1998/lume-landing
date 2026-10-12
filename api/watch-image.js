const ALLOWED_HOSTS = [
  'hodinkee.com',
  'hodinkee.imgix.net',
  'fratellowatches.com',
  'monochrome-watches.com',
  'timeandtidewatches.com',
  'watchpro.com',
];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function isAllowedUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ALLOWED_HOSTS.some((host) =>
      url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).end();
  }

  let url;
  try {
    url = new URL(request.url, `https://${request.headers.host}`).searchParams.get('url');
  } catch {
    return response.status(400).end('Invalid image URL');
  }
  if (!url || !isAllowedUrl(url)) return response.status(400).end('Unsupported image host');

  try {
    let upstream;
    for (let redirects = 0; redirects <= 3; redirects++) {
      upstream = await fetch(url, {
        headers: { 'User-Agent': 'LUME-Watch-News/1.0 (+https://lumewatchapp.com)' },
        redirect: 'manual',
        signal: AbortSignal.timeout(12000),
      });
      if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
      const location = upstream.headers.get('location');
      if (!location || redirects === 3) return response.status(502).end('Image redirect failed');
      url = new URL(location, url).toString();
      if (!isAllowedUrl(url)) return response.status(502).end('Unsupported image redirect');
    }

    if (!upstream.ok) return response.status(502).end('Image source unavailable');
    const contentType = upstream.headers.get('content-type')?.split(';')[0] || '';
    if (!contentType.startsWith('image/')) return response.status(415).end('Not an image');
    const declaredLength = Number(upstream.headers.get('content-length'));
    if (declaredLength > MAX_IMAGE_BYTES) return response.status(413).end('Image too large');
    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) return response.status(413).end('Image too large');

    response.setHeader('Content-Type', contentType);
    response.setHeader('Content-Length', bytes.length);
    response.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return response.status(200).send(bytes);
  } catch {
    return response.status(502).end('Image source unavailable');
  }
}
