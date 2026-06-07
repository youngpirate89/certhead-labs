import { describe, it, expect } from 'vitest';
import { grade } from '@/engine/grading';
import { applyToActive, initLabSession, type DeviceSession, type LabSession } from '@/engine/lab-session';
import { getCatalogLabs, getLabById } from './catalog';
import { lab01InterfaceIp } from './ccna/lab-01-interface-ip';

// Stable, permanent ids the embed/JWT contract will encode. Adding a lab to
// the catalog requires adding its id here — that's the point: the test is the
// catalog membership contract.
const CATALOG_IDS = [
  'ccna-l01-interface-ip',
  'ccna-lab02-network-discovery',
  'ccna-lab03-ipv4-subnetting-routed-interfaces',
  'ccna-lab04-static-route-fundamentals',
  'ccna-lab05-ospf-single-area',
  'ccna-lab06-standard-acl',
  'ccna-lab07-vlan-access-ports',
  'ccna-lab08-vlan-trunking',
  'ccna-lab09-intervlan-routing',
  'ccna-lab10-dhcp-server',
  'ccna-lab11-nat-pat',
  'ccna-lab12-extended-acl',
  'ccna-lab13-ospf-tshoot',
  'ccna-lab14-dhcp-relay',
  'ccna-lab15-default-static-route',
  'ccna-lab16-floating-static-route',
  'ccna-lab17-ospf-passive-interface',
  'ccna-lab18-ospf-tshoot-passive',
  'ccna-lab19-ospf-tshoot-hello-timers',
  'ccna-lab20-ospf-tshoot-auth',
  'ccna-lab21-ospf-default-information',
  'ccna-lab22-etherchannel-lacp',
  'ccna-lab23-stp-root-bridge',
  'ccna-lab24-ipv6-addressing-default-gateway',
  'ccna-lab25-ipv6-static-route',
  'ccna-lab26-device-hardening-ssh',
  'ccna-lab27-ntp-syslog-basics',
  'ccna-lab28-wireless-wlan-vlan-mapping',
  'ccna-lab29-automation-api-basics',
  'ccna-lab30-vlan-dhcp-ticket',
  'ccna-lab31-loopback-ospf-router-id',
  'ccna-lab32-tshoot-loopback-not-advertised',
  'ccna-lab33-stp-port-roles',
  'ccna-lab34-tshoot-stp-wrong-root',
  'ccna-lab35-portfast-bpduguard-access',
  'ccna-tshoot-return-route',
  'ccna-tshoot-wrong-next-hop',
  'ccna-tshoot-wan-subnet-mismatch',
  'ccna-tshoot-egress-down',
  'ccna-tshoot-vlan-trunk-allowed-list',
  'ccna-tshoot-dhcp-relay-missing',
  'ccna-tshoot-acl-blocks-business-app',
  'ccna-tshoot-ospf-neighbor-change-window',
  'ccna-tshoot-nat-vlan-omission',
  'ccna-tshoot-default-route-lost-at-branch',
  'ccna-tshoot-return-route-missing-server-vlan',
  'ccna-tshoot-floating-static-failover-broken',
  'ccna-tshoot-ssh-management-denied',
  'ccna-tshoot-ntp-syslog-source-mismatch',
  'ccna-tshoot-wireless-client-wrong-vlan',
  'ccna-tshoot-port-security-errdisabled-user',
  'ccna-tshoot-ipv6-missing-default-gateway',
  'ccna-tshoot-api-management-acl-repair',
  'ccna-tshoot-ospf-acl-overlap-ticket',
  'ccna-tshoot-branch-multi-symptom-final',
] as const;

function runOn(ls: LabSession, id: string, lines: readonly string[]): LabSession {
  let cur: LabSession = { ...ls, activeDeviceId: id };
  for (const line of lines) cur = applyToActive(cur, line).session;
  return cur;
}

function modeOf(device: DeviceSession): string | undefined {
  return 'mode' in device ? device.mode : undefined;
}

function isVerificationCommand(command: string): boolean {
  return /^(show|ping|ipconfig|curl|Get-NetIPConfiguration)\b/i.test(command.trim());
}

function learnerFacingStrings(lab: NonNullable<ReturnType<typeof getLabById>>): string[] {
  return [
    lab.title,
    lab.scenario,
    ...lab.objectives.map((objective) => objective.text),
    ...lab.hints.map((hint) => hint.text),
    ...(lab.solution?.steps.flatMap((step) => [step.note ?? '', ...step.commands]) ?? []),
  ];
}

describe('lab catalog — getLabById', () => {
  it.each(CATALOG_IDS)('resolves catalog id %s to a Lab', (id) => {
    const lab = getLabById(id);
    expect(lab).not.toBeNull();
    // Belt-and-braces: the returned lab's id matches the lookup key.
    expect(lab?.id).toBe(id);
  });

  it('returns null for an unknown id', () => {
    expect(getLabById('definitely-not-a-real-lab')).toBeNull();
  });

  it('returns null for the empty string', () => {
    expect(getLabById('')).toBeNull();
  });

  it('still resolves the free lab — same object, isFree intact, id unchanged', () => {
    const lab = getLabById('ccna-l01-interface-ip');
    expect(lab).toBe(lab01InterfaceIp);
    expect(lab?.isFree).toBe(true);
    expect(lab?.id).toBe('ccna-l01-interface-ip');
  });

  it('the free lab is the only catalog member with isFree: true', () => {
    const free = CATALOG_IDS.map((id) => getLabById(id)).filter((l) => l?.isFree === true);
    expect(free).toHaveLength(1);
    expect(free[0]?.id).toBe('ccna-l01-interface-ip');
  });

  it('keeps the private catalog contract at 55 total labs with one free public lab', () => {
    const labs = CATALOG_IDS.map((id) => getLabById(id));
    expect(CATALOG_IDS).toHaveLength(55);
    expect(labs.filter((lab) => lab?.isFree === true)).toHaveLength(1);
    expect(labs.filter((lab) => lab?.isFree !== true)).toHaveLength(54);
  });

  it('keeps the private source catalog at exactly 55 labs with one public free lab', () => {
    const labs = getCatalogLabs();
    expect(labs).toHaveLength(55);
    expect(labs.filter((lab) => lab.isFree === true)).toHaveLength(1);
    expect(labs.filter((lab) => lab.isFree !== true)).toHaveLength(54);
    expect(labs.find((lab) => lab.isFree === true)?.id).toBe('ccna-l01-interface-ip');
  });

  it.each(CATALOG_IDS)('published solution for %s completes all objectives', (id) => {
    const lab = getLabById(id);
    expect(lab).not.toBeNull();
    const solution = lab?.solution;
    expect(solution, `${id} should expose a learner-facing solution`).toBeDefined();

    let ls = initLabSession(lab!);
    for (const step of solution!.steps) {
      ls = runOn(ls, step.device, step.commands);
    }

    const result = grade(lab!, ls);
    expect(
      result.objectives.map((objective) => [objective.id, objective.met]),
      `${id} incomplete objectives`,
    ).toEqual(result.objectives.map((objective) => [objective.id, true]));
    expect(result.allMet).toBe(true);
  });

  it.each(CATALOG_IDS)('published solution for %s runs verification commands from exec/user contexts', (id) => {
    const lab = getLabById(id);
    expect(lab).not.toBeNull();
    expect(lab?.solution, `${id} should expose a learner-facing solution`).toBeDefined();

    let ls = initLabSession(lab!);
    for (const step of lab!.solution!.steps) {
      ls = { ...ls, activeDeviceId: step.device };
      for (const command of step.commands) {
        const modeBefore = modeOf(ls.devices[step.device]);
        if (isVerificationCommand(command) && modeBefore !== undefined) {
          expect(
            modeBefore,
            `${id} solution runs '${command}' on ${step.device} from ${modeBefore}`,
          ).not.toMatch(/^config/);
        }
        ls = applyToActive(ls, command).session;
      }
    }
  });

  it('keeps explicit two-device topology spacing wide enough for readable labels', () => {
    const explicitTwoDeviceLabs = getCatalogLabs().filter(
      (lab) =>
        lab.topology.devices.length === 2 &&
        lab.topology.links.length >= 1 &&
        lab.topology.devices.every((device) => device.position !== undefined),
    );

    expect(explicitTwoDeviceLabs.length).toBeGreaterThan(0);

    for (const lab of explicitTwoDeviceLabs) {
      const [a, b] = lab.topology.devices;
      const dx = Math.abs(b.position!.x - a.position!.x);
      const dy = Math.abs(b.position!.y - a.position!.y);

      expect(
        Math.max(dx, dy),
        `${lab.id} should keep two device cards at least 320px apart to protect interface labels`,
      ).toBeGreaterThanOrEqual(320);
    }
  });

  it.each(CATALOG_IDS)('learner-facing copy for %s stays professional and product-tier neutral', (id) => {
    const lab = getLabById(id);
    expect(lab).not.toBeNull();

    const forbidden = [
      /PuTTY-style/i,
      /\bcheap(?:est)?\b/i,
      /\bfake\b/i,
      /\btoy\b/i,
      /\bChatGPT\b/i,
      /\bClaude\b/i,
      /\$4\.99/i,
      /\$9\.99/i,
      /question\/exam-only/i,
    ];

    for (const text of learnerFacingStrings(lab!)) {
      for (const pattern of forbidden) {
        expect(text, `${id} copy should not match ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
