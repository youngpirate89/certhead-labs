import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FREE_LAB_REGISTER_URL, FREE_LAB_UPSELL_COPY } from '@/modes/TryMode';

describe('release readiness — public free-lab surface', () => {
  it('keeps the public CTA aligned to the Pro bundle and current 50-lab catalog', () => {
    expect(FREE_LAB_REGISTER_URL).toBe('https://certhead.com/register?source=free-lab');
    expect(FREE_LAB_UPSELL_COPY.nextLab).toBe('Lab 04: Static Routing');
    expect(FREE_LAB_UPSELL_COPY.proLibrary).toBe('Pro includes the full 50-lab CCNA library.');
    expect(FREE_LAB_UPSELL_COPY.cta).toBe('Unlock with CertHead Pro');
    expect(FREE_LAB_UPSELL_COPY.proLibrary).not.toMatch(/20\+|25\+|30\+|40\+/);
    expect(FREE_LAB_UPSELL_COPY.proLibrary).not.toMatch(/\$4\.99|question-only|exam-only/i);
    expect(FREE_LAB_UPSELL_COPY.nextLab).not.toContain('—');
    expect(FREE_LAB_UPSELL_COPY.proLibrary).not.toContain('—');
    expect(FREE_LAB_UPSELL_COPY.cta).not.toContain('—');
  });

  it('keeps Pro catalog tooling out of the production App static import graph', () => {
    const appSource = readFileSync(`${process.cwd()}/src/App.tsx`, 'utf8');

    expect(appSource).toContain('import.meta.env.DEV');
    expect(appSource).not.toMatch(/from ['"]@\/labs\/catalog['"]/);
    expect(appSource).not.toMatch(/from ['"]@\/labs\/_pilots\/registry['"]/);
    expect(appSource).not.toMatch(/from ['"]@\/modes\/PilotMode['"]/);
  });

  it('keeps TryMode hardwired to the single public free lab', () => {
    const tryModeSource = readFileSync(`${process.cwd()}/src/modes/TryMode.tsx`, 'utf8');

    expect(tryModeSource).toContain("import { lab01InterfaceIp } from '@/labs/ccna/lab-01-interface-ip';");
    expect(tryModeSource).toContain('const lab = lab01InterfaceIp;');
    expect(tryModeSource).not.toMatch(/from ['"]@\/labs\/catalog['"]/);
    expect(tryModeSource).not.toContain('getLabById');
    expect(tryModeSource).not.toContain('Lab complete —');
  });

  it('documents the future embed assumption without adding a public route implementation', () => {
    const appSource = readFileSync(`${process.cwd()}/src/App.tsx`, 'utf8');
    const catalogSource = readFileSync(`${process.cwd()}/src/labs/catalog.ts`, 'utf8');

    expect(appSource).toContain('The `/embed` Pro route (JWT auth + postMessage) is not implemented here.');
    expect(appSource).toContain('Do not expose private catalog labs publicly without the CertHead entitlement gate.');
    expect(catalogSource).toContain('the `/embed` Pro route uses to resolve a token');
  });
});
