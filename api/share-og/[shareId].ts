/**
 * Vercel serverless function — per-share dynamic OG meta tags.
 *
 * Triggered by a User-Agent-conditional rewrite in vercel.json: when a
 * crawler (Twitterbot, facebookexternalhit, Discordbot, Slackbot, etc.)
 * hits /share/:shareId, this function fetches the share record from the
 * MathIQ Worker and returns minimal HTML with proper Open Graph + Twitter
 * Card meta tags so the link previews with the actual challenge data
 * instead of the generic homepage card.
 *
 * Real users (browsers without a crawler UA) bypass this function — the
 * usual /share/:shareId → /index.html rewrite serves the SPA as normal.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

const WORKER_BASE = 'https://mathiq-api.t-hamilton0416.workers.dev';

interface ShareApiResponse {
  shareId: string;
  date: string;
  challengeNumber: number;
  courseTitle: string;
  topicTitle: string;
  difficulty: 'easy' | 'mid' | 'hard' | 'cumulative';
  problemText: string;
  grade: {
    correct: boolean;
    studentAnswer: string;
    feedback: string;
  };
  hasPdf: boolean;
}

const DIFFICULTY_LABEL: Record<ShareApiResponse['difficulty'], string> = {
  easy: 'EASY',
  mid: 'MID',
  hard: 'HARD',
  cumulative: 'SUNDAY',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const shareId = String(req.query.shareId ?? '');
  if (!/^[a-f0-9]{4,64}$/i.test(shareId)) {
    return res.status(404).send(genericHtml('Shared challenge not found'));
  }

  let data: ShareApiResponse | null = null;
  try {
    const resp = await fetch(`${WORKER_BASE}/api/share/${encodeURIComponent(shareId)}`);
    if (resp.ok) {
      data = (await resp.json()) as ShareApiResponse;
    }
  } catch {
    // network/worker error — fall through to generic
  }

  res.setHeader('content-type', 'text/html; charset=utf-8');
  // 5-minute edge cache; Vercel will serve repeats from the CDN. Crawlers
  // re-crawl often enough that staleness within 5 min is invisible.
  res.setHeader('cache-control', 'public, s-maxage=300, stale-while-revalidate=600');

  if (!data || (data as unknown as { error?: string }).error) {
    return res.send(genericHtml('Shared MathIQ challenge'));
  }

  return res.send(crawlerHtml(data));
}

function crawlerHtml(d: ShareApiResponse): string {
  const verdict = d.grade.correct ? 'Solved' : 'Attempted';
  const label = DIFFICULTY_LABEL[d.difficulty];
  const title = `MathIQ #${d.challengeNumber} · ${label} · ${verdict}`;
  // Trim problem text to ~160 chars so the description doesn't get cut
  // mid-LaTeX. Strip $...$ delimiters so the preview reads like plain text.
  const cleanProblem = d.problemText
    .replace(/\$\$([\s\S]*?)\$\$/g, '$1')
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/\\[a-zA-Z]+\{?/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const truncated =
    cleanProblem.length > 160 ? cleanProblem.slice(0, 157) + '…' : cleanProblem;
  const description = `${d.courseTitle} · ${d.topicTitle}\n${truncated}`;
  const canonicalUrl = `https://mathiq.io/share/${d.shareId}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />

  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="MathIQ" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:image" content="https://mathiq.io/icon-192.png" />
  <meta property="og:url" content="${esc(canonicalUrl)}" />

  <meta name="twitter:card" content="summary" />
  <meta name="twitter:site" content="@mathiq" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(description)}" />
  <meta name="twitter:image" content="https://mathiq.io/icon-192.png" />

  <link rel="canonical" href="${esc(canonicalUrl)}" />
</head>
<body>
  <p>Loading MathIQ Daily Challenge #${d.challengeNumber}…</p>
  <p>If you don't get redirected, <a href="${esc(canonicalUrl)}">tap here</a>.</p>
</body>
</html>`;
}

function genericHtml(headline: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${esc(headline)} — MathIQ</title>
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${esc(headline)} — MathIQ" />
  <meta property="og:description" content="One math problem a day, walked through one line at a time." />
  <meta property="og:image" content="https://mathiq.io/icon-192.png" />
  <meta property="og:url" content="https://mathiq.io" />
</head>
<body>${esc(headline)}</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    if (c === '&') return '&amp;';
    if (c === '<') return '&lt;';
    if (c === '>') return '&gt;';
    if (c === '"') return '&quot;';
    return '&#39;';
  });
}
