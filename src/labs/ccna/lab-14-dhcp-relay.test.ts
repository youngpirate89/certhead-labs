import { describe, it, expect } from 'vitest';
import {
  initLabSession,
  applyToDevice,
  setActive,
  type LabSession,
} from '@/engine/lab-session';
import { grade } from '@/engine/grading';
import { lab14DhcpRelay } from './lab-14-dhcp-relay';
import type { Session as RouterSession } from '@/engine/adapters/ios/state';
import type { PcSession } from '@/engine/adapters/pc';

/** Apply a sequence of commands to one device, threading the session. */
function runOn(lab: LabSession, deviceId: string, lines: readonly string[]): LabSession {
  let cur = setActive(lab, deviceId);
  for (const line of lines) {
    cur = applyToDevice(cur, deviceId, line).session;
  }
  return cur;
}

function fresh(): LabSession {
  return initLabSession(lab14DhcpRelay);
}

function router(lab: LabSession, id: string): RouterSession {
  const s = lab.devices[id];
  if (s.kind !== 'router') throw new Error(`${id} is not a router`);
  return s;
}

function pca(lab: LabSession): PcSession {
  const s = lab.devices['PC-A'];
  if (s.kind !== 'pc') throw new Error('PC-A is not a pc');
  return s;
}

/** SRV1 DHCP server config — full happy-path. */
const SRV1_DHCP: readonly string[] = [
  'enable',
  'configure terminal',
  'ip dhcp excluded-address 192.168.10.1 192.168.10.10',
  'ip dhcp pool CLIENT_POOL',
  'network 192.168.10.0 255.255.255.0',
  'default-router 192.168.10.1',
  'dns-server 8.8.8.8',
  'end',
];

/** R1 helper-address config. */
const R1_HELPER: readonly string[] = [
  'enable',
  'configure terminal',
  'interface gi0/0',
  'ip helper-address 172.16.0.2',
  'end',
];

describe('Lab 14 — ip helper-address parser', () => {
  it('ip helper-address in config-if sets helperAddress on the interface', () => {
    const lab = runOn(fresh(), 'R1', [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip helper-address 172.16.0.2',
    ]);
    expect(router(lab, 'R1').device.interfaces['Gi0/0'].helperAddress).toBe('172.16.0.2');
  });

  it('no ip helper-address clears helperAddress', () => {
    const lab = runOn(fresh(), 'R1', [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip helper-address 172.16.0.2',
      'no ip helper-address',
    ]);
    expect(router(lab, 'R1').device.interfaces['Gi0/0'].helperAddress).toBeUndefined();
  });

  it('ip helper-address with an invalid IP errors', () => {
    const lab = setActive(fresh(), 'R1');
    const seeded = runOn(lab, 'R1', [
      'enable',
      'configure terminal',
      'interface gi0/0',
    ]);
    const { output, session } = applyToDevice(seeded, 'R1', 'ip helper-address not-an-ip');
    expect(output.some((o) => o.kind === 'error')).toBe(true);
    expect(router(session, 'R1').device.interfaces['Gi0/0'].helperAddress).toBeUndefined();
  });

  it('show running-config includes the ip helper-address line', () => {
    const lab = runOn(fresh(), 'R1', R1_HELPER);
    const { output } = applyToDevice(setActive(lab, 'R1'), 'R1', 'show running-config');
    const text = output.map((o) => o.text).join('\n');
    expect(text).toContain('ip helper-address 172.16.0.2');
  });

  it('show running-config interface Gi0/0 includes the ip helper-address line', () => {
    const lab = runOn(fresh(), 'R1', R1_HELPER);
    const { output } = applyToDevice(
      setActive(lab, 'R1'),
      'R1',
      'show running-config interface Gi0/0',
    );
    const text = output.map((o) => o.text).join('\n');
    expect(text).toContain('ip helper-address 172.16.0.2');
  });

  it('show running-config omits the line when helperAddress is unset', () => {
    const lab = fresh();
    const { output } = applyToDevice(setActive(lab, 'R1'), 'R1', 'show running-config');
    const text = output.map((o) => o.text).join('\n');
    expect(text).not.toContain('ip helper-address');
  });
});

describe('Lab 14 — DHCP relay allocator', () => {
  it('PC-A starts unbound (no helper-address, no remote pool)', () => {
    const pc = pca(fresh());
    expect(pc.dhcpMode).toBe(true);
    expect(pc.ip).toBeNull();
    expect(pc.mask).toBeNull();
    expect(pc.gateway).toBeNull();
  });

  it('SRV1 pool alone does not bind PC-A — relay is required', () => {
    const lab = runOn(fresh(), 'SRV1', SRV1_DHCP);
    expect(pca(lab).ip).toBeNull();
    expect(router(lab, 'SRV1').device.dhcpBindings.size).toBe(0);
  });

  it('R1 helper-address alone does not bind PC-A — pool is required', () => {
    const lab = runOn(fresh(), 'R1', R1_HELPER);
    expect(pca(lab).ip).toBeNull();
  });

  it('binding lands on SRV1 once pool + helper-address are both configured', () => {
    let lab = runOn(fresh(), 'SRV1', SRV1_DHCP);
    lab = runOn(lab, 'R1', R1_HELPER);
    const binding = router(lab, 'SRV1').device.dhcpBindings.get('PC-A');
    expect(binding).toBeDefined();
    expect(binding?.poolName).toBe('CLIENT_POOL');
    expect(binding?.ip).toBe('192.168.10.11');
  });

  it('PC-A inherits ip/mask/gateway from the remote pool', () => {
    let lab = runOn(fresh(), 'SRV1', SRV1_DHCP);
    lab = runOn(lab, 'R1', R1_HELPER);
    const pc = pca(lab);
    expect(pc.ip).toBe('192.168.10.11');
    expect(pc.mask).toBe('255.255.255.0');
    expect(pc.gateway).toBe('192.168.10.1');
  });

  it('R1 binding table stays empty — the binding lives on SRV1, not the relay', () => {
    let lab = runOn(fresh(), 'SRV1', SRV1_DHCP);
    lab = runOn(lab, 'R1', R1_HELPER);
    expect(router(lab, 'R1').device.dhcpBindings.size).toBe(0);
  });

  it('removing helper-address clears the binding (no longer relayed)', () => {
    let lab = runOn(fresh(), 'SRV1', SRV1_DHCP);
    lab = runOn(lab, 'R1', R1_HELPER);
    expect(pca(lab).ip).toBe('192.168.10.11');
    lab = runOn(lab, 'R1', [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'no ip helper-address',
    ]);
    expect(pca(lab).ip).toBeNull();
    expect(router(lab, 'SRV1').device.dhcpBindings.size).toBe(0);
  });
});

describe('Lab 10 regression — same-subnet DHCP allocator path is preserved', () => {
  // Mini-topology synthesised inline: a PC cabled directly to a router whose
  // own interface has the matching pool. No helper-address involved. This
  // mirrors Lab 10's full lifecycle to prove the same-subnet path still
  // wins when both pool sources could match.
  it('PC bound by same-subnet pool on the cabled router (no relay)', async () => {
    const { lab10Dhcp } = await import('./lab-10-dhcp');
    const lab = initLabSession(lab10Dhcp);
    const configured = runOn(lab, 'R1', [
      'enable',
      'configure terminal',
      'ip dhcp excluded-address 192.168.1.1 192.168.1.10',
      'ip dhcp pool LAN',
      'network 192.168.1.0 255.255.255.0',
      'default-router 192.168.1.1',
      'dns-server 8.8.8.8',
      'end',
    ]);
    const r1 = configured.devices.R1;
    if (r1.kind !== 'router') throw new Error('R1 not a router');
    const pc = configured.devices['PC-A'];
    if (pc.kind !== 'pc') throw new Error('PC-A not a pc');
    expect(r1.device.dhcpBindings.get('PC-A')?.ip).toBe('192.168.1.11');
    expect(pc.ip).toBe('192.168.1.11');
  });
});

describe('Lab 14 — ipconfig stamps lastIpconfig', () => {
  it('lastIpconfig starts at 0', () => {
    expect(pca(fresh()).lastIpconfig).toBe(0);
  });

  it('ipconfig stamps lastIpconfig to a positive engine seq', () => {
    const lab = runOn(fresh(), 'PC-A', ['ipconfig']);
    expect(pca(lab).lastIpconfig).toBeGreaterThan(0);
  });

  it('ipconfig /all also stamps lastIpconfig', () => {
    const lab = runOn(fresh(), 'PC-A', ['ipconfig /all']);
    expect(pca(lab).lastIpconfig).toBeGreaterThan(0);
  });

  it('an invalid ipconfig switch does NOT stamp', () => {
    const lab = runOn(fresh(), 'PC-A', ['ipconfig /wrong']);
    expect(pca(lab).lastIpconfig).toBe(0);
  });
});

describe('Lab 14 — objective coverage', () => {
  it('all objectives unmet on a fresh session', () => {
    const result = grade(lab14DhcpRelay, fresh());
    expect(result.allMet).toBe(false);
    for (const o of result.objectives) {
      expect(o.met).toBe(false);
    }
  });

  it('dhcp-excluded objective flips after SRV1 excludes the range', () => {
    const lab = runOn(fresh(), 'SRV1', [
      'enable',
      'configure terminal',
      'ip dhcp excluded-address 192.168.10.1 192.168.10.10',
    ]);
    const o = grade(lab14DhcpRelay, lab).objectives.find((x) => x.id === 'dhcp-excluded');
    expect(o?.met).toBe(true);
  });

  it('helper-address objective flips after R1 configures the relay target', () => {
    const lab = runOn(fresh(), 'R1', R1_HELPER);
    const o = grade(lab14DhcpRelay, lab).objectives.find((x) => x.id === 'helper-address');
    expect(o?.met).toBe(true);
  });

  it('dhcp-binding objective flips once the full path is configured', () => {
    let lab = runOn(fresh(), 'SRV1', SRV1_DHCP);
    lab = runOn(lab, 'R1', R1_HELPER);
    const o = grade(lab14DhcpRelay, lab).objectives.find((x) => x.id === 'dhcp-binding');
    expect(o?.met).toBe(true);
  });

  it('verify-ipconfig objective requires the learner to actually run ipconfig', () => {
    let lab = runOn(fresh(), 'SRV1', SRV1_DHCP);
    lab = runOn(lab, 'R1', R1_HELPER);
    expect(
      grade(lab14DhcpRelay, lab).objectives.find((x) => x.id === 'verify-ipconfig')?.met,
    ).toBe(false);
    lab = runOn(lab, 'PC-A', ['ipconfig']);
    expect(
      grade(lab14DhcpRelay, lab).objectives.find((x) => x.id === 'verify-ipconfig')?.met,
    ).toBe(true);
  });

  it('full configuration + verify satisfies every objective', () => {
    let lab = runOn(fresh(), 'SRV1', SRV1_DHCP);
    lab = runOn(lab, 'R1', R1_HELPER);
    lab = runOn(lab, 'PC-A', ['ipconfig']);
    const result = grade(lab14DhcpRelay, lab);
    const unmet = result.objectives.filter((o) => !o.met).map((o) => o.id);
    expect(unmet).toEqual([]);
    expect(result.allMet).toBe(true);
  });
});
