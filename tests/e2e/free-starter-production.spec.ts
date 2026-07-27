import { expect, test } from '@playwright/test';

const STARTER_IDS = [
  'ccna-starter-01-interface-ip',
  'ccna-starter-02-network-discovery',
  'ccna-starter-03-subnetting-routed-interfaces',
  'ccna-starter-04-static-route',
  'ccna-starter-05-ospf-neighbor',
  'ccna-starter-06-vlan-access-port',
  'ccna-starter-07-vlan-trunk',
  'ccna-starter-08-intervlan-routing',
  'ccna-starter-09-dhcp-server',
  'ccna-starter-10-default-route',
] as const;

function hasNoindexHeader(headers: string, path: string) {
  return headers
    .split(/\n(?=\/)/)
    .filter((block) => block.includes('X-Robots-Tag: noindex, nofollow'))
    .map((block) => block.split('\n', 1)[0].trim())
    .some((pattern) => {
      const expression = pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
      return new RegExp(`^${expression}$`).test(path);
    });
}

test('production bundle serves every dedicated public starter URL', async ({ page }) => {
  for (let index = 0; index < STARTER_IDS.length; index += 1) {
    await page.goto(`/try?lab=${STARTER_IDS[index]}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(`Starter ${index + 1}:`);
    await expect(page.getByRole('heading', { name: '10 Free CCNA Starter Labs' })).toBeVisible();
  }
});

test('production route fails paid and invalid lab ids safe to starter 1', async ({ page }) => {
  for (const requestedId of ['ccna-lab11-nat-pat', 'not-a-real-lab']) {
    await page.goto(`/try?lab=${requestedId}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Starter 1:');
  }
});

test('production raw SEO assets have correct content types and public-only content', async ({ request }) => {
  const robots = await request.get('/robots.txt');
  expect(robots.ok()).toBe(true);
  expect(robots.headers()['content-type']).toContain('text/plain');
  const robotsBody = await robots.text();
  const directives = robotsBody.split('\n').filter((line) => /^(?:Allow|Disallow):/.test(line));
  const isAllowed = (path: string) => directives
    .map((line) => {
      const [kind, rule] = line.split(': ');
      return { allowed: kind === 'Allow', rule };
    })
    .filter(({ rule }) => rule.endsWith('$') ? path === rule.slice(0, -1) : path.startsWith(rule))
    .sort((left, right) => right.rule.length - left.rule.length)[0]?.allowed ?? true;

  for (const path of ['/', '/unknown', '/embed/private-lab', '/pilot', '/dev/lab']) {
    expect(isAllowed(path), `${path} should be blocked from crawling`).toBe(false);
  }
  for (const path of ['/try', '/assets/index.js']) {
    expect(isAllowed(path), `${path} should be crawlable`).toBe(true);
  }
  expect(isAllowed('/try?lab=ccna-starter-01-interface-ip')).toBe(false);

  const headers = await request.get('/_headers');
  expect(headers.ok()).toBe(true);
  const headersBody = await headers.text();
  expect(headersBody).toContain('/embed/*');
  expect(headersBody).toContain('/pilot*');
  expect(headersBody).toMatch(/(?:^|\n)\/dev\n/);
  expect(headersBody).toContain('/dev/*');
  expect(hasNoindexHeader(headersBody, '/dev')).toBe(true);
  expect(hasNoindexHeader(headersBody, '/dev/preview')).toBe(true);
  expect(hasNoindexHeader(headersBody, '/try')).toBe(false);
  expect(headersBody).not.toMatch(/(?:^|\n)\/try(?:\s|\n)/);

  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.ok()).toBe(true);
  expect(sitemap.headers()['content-type']).toMatch(/(?:application|text)\/xml/);
  const sitemapBody = await sitemap.text();
  expect(sitemapBody).toContain('<loc>https://labs.certhead.com/try</loc>');
  expect(sitemapBody).not.toMatch(/embed|pilot|localhost/i);
  expect(sitemapBody.match(/<url>/g)).toHaveLength(1);
});

test('production page exposes canonical metadata and fallback raw H1', async ({ page, request }) => {
  await page.goto('/try');
  await expect(page).toHaveTitle('10 Free CCNA Labs | CertHead Labs');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://labs.certhead.com/try');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /10 free, hands-on CCNA starter labs/);

  const rawHtml = await (await request.get('/')).text();
  expect(rawHtml).toContain('<h1>10 Free Hands-On CCNA Starter Labs</h1>');
  expect(rawHtml).not.toMatch(/aggregateRating|reviewCount|ratingValue/);
});
