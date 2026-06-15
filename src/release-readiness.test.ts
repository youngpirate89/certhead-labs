import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FREE_LAB_REGISTER_URL, FREE_LAB_UPSELL_COPY } from '@/modes/TryMode';

const EM_DASH = '\u2014';

describe('release readiness: public free-lab surface', () => {
  it('keeps the public CTA aligned to the Pro bundle and current 50-lab catalog', () => {
    expect(FREE_LAB_REGISTER_URL).toBe('https://certhead.com/register?source=free-lab');
    expect(FREE_LAB_UPSELL_COPY.proLibrary).toBe('Pro includes the full 50-lab CCNA library.');
    expect(FREE_LAB_UPSELL_COPY.cta).toBe('Unlock with CertHead Pro');
    expect(FREE_LAB_UPSELL_COPY.proLibrary).not.toMatch(/20\+|25\+|30\+|40\+/);
    expect(FREE_LAB_UPSELL_COPY.proLibrary).not.toMatch(/\$4\.99|question-only|exam-only/i);
    expect(FREE_LAB_UPSELL_COPY.proLibrary).not.toContain(EM_DASH);
    expect(FREE_LAB_UPSELL_COPY.cta).not.toContain(EM_DASH);
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
    expect(contract).toContain('50 catalog labs require Pro');
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
