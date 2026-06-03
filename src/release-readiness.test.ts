import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FREE_LAB_REGISTER_URL, FREE_LAB_UPSELL_COPY } from '@/modes/TryMode';

describe('release readiness — public free-lab surface', () => {
  it('keeps the public CTA aligned to the Pro bundle and current 50-lab catalog', () => {
    expect(FREE_LAB_REGISTER_URL).toBe('https://certhead.com/register?source=free-lab');
    expect(FREE_LAB_UPSELL_COPY.nextLab).toBe('Lab 04 — Static Routing');
    expect(FREE_LAB_UPSELL_COPY.proLibrary).toBe('Pro includes the full 50-lab CCNA library.');
    expect(FREE_LAB_UPSELL_COPY.cta).toBe('Unlock with CertHead Pro');
    expect(FREE_LAB_UPSELL_COPY.proLibrary).not.toMatch(/20\+|25\+|30\+|40\+/);
    expect(FREE_LAB_UPSELL_COPY.proLibrary).not.toMatch(/\$4\.99|question-only|exam-only/i);
  });

  it('keeps Pro catalog tooling out of the production App static import graph', () => {
    const appSource = readFileSync(`${process.cwd()}/src/App.tsx`, 'utf8');

    expect(appSource).toContain('import.meta.env.DEV');
    expect(appSource).not.toMatch(/from ['"]@\/labs\/catalog['"]/);
    expect(appSource).not.toMatch(/from ['"]@\/labs\/_pilots\/registry['"]/);
    expect(appSource).not.toMatch(/from ['"]@\/modes\/PilotMode['"]/);
  });
});
