import { describe, it, expect } from 'vitest';
import { grade } from '@/engine/grading';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { getLabById } from './catalog';
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
] as const;

function runOn(ls: LabSession, id: string, lines: readonly string[]): LabSession {
  let cur: LabSession = { ...ls, activeDeviceId: id };
  for (const line of lines) cur = applyToActive(cur, line).session;
  return cur;
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
});
