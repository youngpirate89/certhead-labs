import { existsSync, readFileSync } from 'node:fs';
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
    expect(contract).toContain('only `ccna-l01-interface-ip` is free');
    expect(contract).toContain('49 catalog labs require Pro');
    expect(contract).toContain('completion message');
    expect(contract).toContain('window.parent.postMessage');
    expect(contract).toContain('The targetOrigin must not be `*`.');
    expect(contract).not.toContain('$4.99');
    expect(contract).not.toContain('question/exam-only');
    expect(contract).not.toContain('—');
  });
});
