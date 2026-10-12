const FEEDS = [
  { source: 'Hodinkee', url: 'https://www.hodinkee.com/articles.rss' },
  { source: 'Fratello', url: 'https://www.fratellowatches.com/feed/' },
  { source: 'Monochrome', url: 'https://monochrome-watches.com/feed/' },
  { source: 'Time+Tide', url: 'https://timeandtidewatches.com/feed/' },
  { source: 'WatchPro', url: 'https://www.watchpro.com/feed/' },
];

function decodeEntities(value) {
  return value
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
      const key = entity.toLowerCase();
      if (key === 'amp') return '&';
      if (key === 'lt') return '<';
      if (key === 'gt') return '>';
      if (key === 'quot') return '"';
      if (key === 'apos' || key === '#39') return "'";
      if (key === 'nbsp') return ' ';
      const code = key.startsWith('#x')
        ? Number.parseInt(key.slice(2), 16)
        : Number.parseInt(key.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return match; }
    });
}

function tagValue(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!match) return null;
  let value = match[1].trim();
  const cdata = value.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) value = cdata[1];
  return decodeEntities(value.trim());
}

function attributeValue(xml, tag, attribute) {
  const tagMatch = xml.match(new RegExp(`<${tag}\\b([^>]*)>`, 'i'));
  if (!tagMatch) return null;
  const match = tagMatch[1].match(new RegExp(`\\b${attribute}=["']([^"']+)["']`, 'i'));
  return match ? decodeEntities(match[1].trim()) : null;
}

function extractThumbnail(item) {
  return attributeValue(item, '(?:media:)?thumbnail', 'url')
    || attributeValue(item, '(?:media:)?content', 'url')
    || attributeValue(item, 'enclosure', 'url')
    || (() => {
      const description = tagValue(item, 'description') || '';
      return description.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1] || null;
    })();
}

async function fetchFeed(feed) {
  const response = await fetch(feed.url, {
    headers: { 'User-Agent': 'LUME-Watch-News/1.0 (+https://lumewatchapp.com)' },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`${feed.source} returned ${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)]
    .map(([, item]) => {
      const title = tagValue(item, 'title');
      const url = tagValue(item, 'link');
      const publishedAt = tagValue(item, 'pubDate') || tagValue(item, 'dc:date');
      if (!title || !url || !publishedAt || Number.isNaN(Date.parse(publishedAt))) return null;
      return {
        title: title.replace(/<[^>]*>/g, '').trim(),
        source: feed.source,
        url: url.trim(),
        publishedAt: new Date(publishedAt).toISOString(),
        thumbnailUrl: extractThumbnail(item),
      };
    })
    .filter(Boolean);
}

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Method not allowed' });
  }

  response.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=3600');
  const results = await Promise.allSettled(FEEDS.map(fetchFeed));
  const articles = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  articles.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

  if (articles.length === 0) {
    return response.status(502).json({ error: 'Watch news sources are temporarily unavailable.' });
  }
  return response.status(200).json(articles);
}
