import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFreeLabRegisterUrl } from '@/conversion/freeLabIntent';
import { FREE_CCNA_STARTER_LAB_IDS } from '@/labs/free-starter';
import { FREE_LAB_UPSELL_COPY } from '@/modes/TryMode';
import { DEFAULT_FREE_CCNA_STARTER_LAB_ID, resolveTryModeLabId } from '@/routing/tryLabSelection';

const EM_DASH = '\u2014';

describe('release readiness: public free-lab surface', () => {
  it('keeps the public CTA aligned to the Pro bundle and current 60-lab catalog', () => {
    const registerUrl = new URL(buildFreeLabRegisterUrl('ccna-starter-10-default-route'));
    expect(registerUrl.origin).toBe('https://certhead.com');
    expect(registerUrl.pathname).toBe('/register');
    expect(registerUrl.searchParams.get('source')).toBe('free-lab');
    expect(registerUrl.searchParams.get('lab')).toBe('ccna-starter-10-default-route');

    const upgradeUrl = new URL(registerUrl.searchParams.get('redirect')!, registerUrl.origin);
    expect(upgradeUrl.pathname).toBe('/upgrade');
    expect(upgradeUrl.searchParams.get('source')).toBe('free-lab');
    expect(upgradeUrl.searchParams.get('redirect')).toBe('/labs');

    expect(FREE_LAB_UPSELL_COPY.proLibrary).toBe('Pro includes the full 60-lab CCNA library.');
    expect(FREE_LAB_UPSELL_COPY.cta).toBe('Unlock with CertHead Pro');
    expect(FREE_LAB_UPSELL_COPY.proLibrary).not.toMatch(/20\+|25\+|30\+|40\+/);
    expect(FREE_LAB_UPSELL_COPY.proLibrary).not.toMatch(/\$4\.99|question-only|exam-only/i);
    expect(FREE_LAB_UPSELL_COPY.proLibrary).not.toContain(EM_DASH);
    expect(FREE_LAB_UPSELL_COPY.cta).not.toContain(EM_DASH);
  });

  it('keeps all ten starter URLs public while paid and invalid ids fail safe', () => {
    expect(FREE_CCNA_STARTER_LAB_IDS).toHaveLength(10);
    for (const labId of FREE_CCNA_STARTER_LAB_IDS) {
      expect(resolveTryModeLabId(`?lab=${encodeURIComponent(labId)}`)).toBe(labId);
    }
    expect(resolveTryModeLabId('?lab=ccna-lab11-nat-pat')).toBe(DEFAULT_FREE_CCNA_STARTER_LAB_ID);
    expect(resolveTryModeLabId('?lab=not-a-real-lab')).toBe(DEFAULT_FREE_CCNA_STARTER_LAB_ID);
  });

  it('keeps Pro catalog tooling out of the production App static import graph', () => {
    const appSource = readFileSync(`${process.cwd()}/src/App.tsx`, 'utf8');

    expect(appSource).toContain('import.meta.env.DEV');
    expect(appSource).not.toMatch(/from ['"]@\/labs\/catalog['"]/);
    expect(appSource).not.toMatch(/from ['"]@\/labs\/_pilots\/registry['"]/);
    expect(appSource).not.toMatch(/from ['"]@\/modes\/PilotMode['"]/);
  });

  it('keeps TryMode hardwired to the public CCNA starter list without importing the Pro catalog', () => {
    const tryModeSource = readFileSync(`${process.cwd()}/src/modes/TryMode.tsx`, 'utf8');

    expect(tryModeSource).toContain("import { FREE_CCNA_STARTER_LAB_IDS, getFreeCcnaStarterLabById, getFreeCcnaStarterLabs } from '@/labs/free-starter';");
    expect(tryModeSource).toContain("import { DEFAULT_FREE_CCNA_STARTER_LAB_ID, resolveTryModeLabId } from '@/routing/tryLabSelection';");
    expect(tryModeSource).not.toMatch(/from ['"]@\/labs\/catalog['"]/);
    expect(tryModeSource).not.toContain('getLabById');
    expect(tryModeSource).not.toContain(`Lab complete ${EM_DASH}`);
  });

  it('documents the Pro embed integration contract without implementing server auth here', () => {
    const contractPath = `${process.cwd()}/docs/pro-embed-integration-contract.md`;
    expect(existsSync(contractPath)).toBe(true);

    const contract = readFileSync(contractPath, 'utf8');
    expect(contract).toContain('Owned here');
    expect(contract).toContain('Owned by the main CertHead app or API');
    expect(contract).toContain('claim: labId');
    expect(contract).toContain('claim: entitlement');
    expect(contract).toContain('value: pro');
    expect(contract).toContain('getLabById(labId)');
    expect(contract).toContain('unknown, missing, expired, or non-Pro tokens fail closed');
    expect(contract).toContain('ten free CCNA starter labs');
    expect(contract).toContain('60 catalog labs require Pro');
    expect(contract).toContain('completion message');
    expect(contract).toContain('window.parent.postMessage');
    expect(contract).toContain('The targetOrigin must not be `*`.');
    expect(contract).not.toContain('$4.99');
    expect(contract).not.toContain('question/exam-only');
    expect(contract).not.toContain(EM_DASH);
  });

  it('keeps deployment docs aligned with static build output, redirects, and analytics events', () => {
    const deploy = readFileSync(`${process.cwd()}/docs/DEPLOY.md`, 'utf8');
    const redirects = readFileSync(`${process.cwd()}/public/_redirects`, 'utf8');
    const wrangler = readFileSync(`${process.cwd()}/wrangler.toml`, 'utf8');
    const packageJson = JSON.parse(readFileSync(`${process.cwd()}/package.json`, 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.build).toBe('tsc -b && vite build');
    expect(wrangler).toContain('pages_build_output_dir = "dist"');
    expect(redirects.trim()).toBe('/*    /index.html   200');
    expect(deploy).toContain('Build command: `npm run build`');
    expect(deploy).toContain('Output directory: `dist`');
    expect(deploy).toContain('`public/_redirects` ships an SPA fallback (`/* /index.html 200`)');

    for (const event of [
      'lab_viewed',
      'lab_started',
      'lab_brief_dismissed',
      'lab_completed',
      'lab_reset',
      'hint_shown',
      'cta_clicked',
    ]) {
      expect(deploy).toContain(event);
    }

    expect(deploy).not.toContain(EM_DASH);
  });

  it('publishes crawlable raw SEO assets for only the canonical public try route', () => {
    const robots = readFileSync(`${process.cwd()}/public/robots.txt`, 'utf8');
    const headers = readFileSync(`${process.cwd()}/public/_headers`, 'utf8');
    const sitemap = readFileSync(`${process.cwd()}/public/sitemap.xml`, 'utf8');
    const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');

    expect(robots).toContain('User-agent: *');
    expect(robots).toContain('Allow: /try$');
    expect(robots).toContain('Allow: /assets/');
    expect(robots).toContain('Disallow: /');
    expect(robots).toContain('Sitemap: https://labs.certhead.com/sitemap.xml');

    const directives = robots.split('\n').filter((line) => /^(?:Allow|Disallow):/.test(line));
    const isAllowed = (path: string) => {
      const matching = directives
        .map((line) => {
          const [kind, rule] = line.split(': ');
          return { allowed: kind === 'Allow', rule };
        })
        .filter(({ rule }) => rule.endsWith('$') ? path === rule.slice(0, -1) : path.startsWith(rule))
        .sort((left, right) => right.rule.length - left.rule.length);
      return matching[0]?.allowed ?? true;
    };
    expect(isAllowed('/')).toBe(false);
    expect(isAllowed('/unknown')).toBe(false);
    expect(isAllowed('/embed/private-lab')).toBe(false);
    expect(isAllowed('/pilot')).toBe(false);
    expect(isAllowed('/try')).toBe(true);
    expect(isAllowed('/try?lab=ccna-starter-01-interface-ip')).toBe(false);
    expect(isAllowed('/assets/index.js')).toBe(true);

    expect(headers).toContain('/embed/*');
    expect(headers).toContain('/pilot*');
    expect(headers).toContain('/dev/*');
    expect(headers.match(/X-Robots-Tag: noindex, nofollow/g)).toHaveLength(5);
    expect(headers).not.toMatch(/(?:^|\n)\/try(?:\s|\n)/);

    expect(sitemap).toContain('<loc>https://labs.certhead.com/try</loc>');
    expect(sitemap).not.toMatch(/<loc>[^<]*(?:embed|pilot|dev|localhost)[^<]*<\/loc>/i);
    expect((sitemap.match(/<url>/g) ?? [])).toHaveLength(1);

    expect(html).toContain('<title>10 Free CCNA Labs | CertHead Labs</title>');
    expect(html).toContain('Practice 10 free, hands-on CCNA starter labs');
    expect(html).toContain('<link rel="canonical" href="https://labs.certhead.com/try" />');
    expect(html).toContain('<meta name="robots" content="index, follow" />');
    expect(html).toContain('property="og:title"');
    expect(html).toContain('property="og:url" content="https://labs.certhead.com/try"');
    expect(html).toContain('name="twitter:card" content="summary"');
    expect(html).toContain('"@type": ["EducationalApplication", "WebApplication"]');
    expect(html).not.toMatch(/aggregateRating|reviewCount|ratingValue/);
    expect(html).toMatch(/<div id="root">[\s\S]*<h1>10 Free Hands-On CCNA Starter Labs<\/h1>/);
  });

  it('documents the current offer as 10 dedicated public starters plus 60 separate Pro labs', () => {
    for (const path of ['README.md', 'docs/DEPLOY.md', 'CLAUDE.md', 'LAB_CATALOG.md']) {
      const doc = readFileSync(`${process.cwd()}/${path}`, 'utf8');
      expect(doc).toContain('10 dedicated public CCNA starter labs');
      expect(doc).toContain('60 separate Pro catalog labs');
    }
    const claude = readFileSync(`${process.cwd()}/CLAUDE.md`, 'utf8');
    expect(claude).not.toContain('**Catalog (21 labs):**');
  });

  it('has a launch checklist for validations that belong outside this repo', () => {
    const checklistPath = `${process.cwd()}/docs/launch-checklist.md`;
    expect(existsSync(checklistPath)).toBe(true);

    const checklist = readFileSync(checklistPath, 'utf8');
    expect(checklist).toContain('Main CertHead app or API');
    expect(checklist).toContain('Hosting provider');
    expect(checklist).toContain('labs.certhead.com/try');
    expect(checklist).toContain('VITE_POSTHOG_KEY');
    expect(checklist).toContain('10 free CCNA starter labs');
    expect(checklist).toContain('$9.99 CertHead Pro bundle');
    expect(checklist).not.toContain('$4.99');
    expect(checklist).not.toContain(EM_DASH);
  });
});
