/**
 * Subinterface-aware reachability — Lab 09 router-on-a-stick.
 *
 * Fixture: PC-A (VLAN 10) — SW1 Gi0/1 access 10, Gi0/0 trunk allow 1,10,20,
 *          R1 Gi0/0.10 (192.168.10.1) / Gi0/0.20 (192.168.20.1) — Gi0/2 access
 *          20 — PC-B (VLAN 20). One switch, one router, two VLANs.
 *
 * These tests pin both directions of the L3 walk (forward + return) plus the
 * failure modes called out in the work order §3.6 / §3.8 so a future refactor
 * of canReach doesn't quietly drop the subif path.
 */
import { describe, it, expect } from 'vitest';
import { canReach } from './reachability';
import {
  applyToActive,
  initLabSession,
  type LabSession,
} from './lab-session';
import type { Lab, Link } from './types';

/** Lab 09 topology bare-bones — same shape as the lab module, sufficient for
 *  the reachability tests. The lab module itself adds objectives/hints. */
function roasLab(): Lab {
  return {
    id: 'fixture-roas',
    title: 'fixture-roas',
    exam: 'TEST',
    difficulty: 1,
    estimatedMinutes: 1,
    isFree: false,
    scenario: 'fixture',
    topology: {
      devices: [
        {
          id: 'R1',
          kind: 'router',
          platform: 'ISR4321',
          interfaces: ['Gi0/0', 'Gi0/1'],
        },
        {
          id: 'SW1',
          kind: 'switch',
          platform: 'C2960',
          interfaces: ['Gi0/0', 'Gi0/1', 'Gi0/2'],
        },
        {
          id: 'PC-A',
          kind: 'pc',
          platform: 'Workstation',
          interfaces: ['Eth0'],
          pc: { ip: '192.168.10.10', mask: '255.255.255.0', gateway: '192.168.10.1' },
        },
        {
          id: 'PC-B',
          kind: 'pc',
          platform: 'Workstation',
          interfaces: ['Eth0'],
          pc: { ip: '192.168.20.10', mask: '255.255.255.0', gateway: '192.168.20.1' },
        },
      ],
      links: [
        { a: { deviceId: 'R1', iface: 'Gi0/0' }, b: { deviceId: 'SW1', iface: 'Gi0/0' } },
        { a: { deviceId: 'SW1', iface: 'Gi0/1' }, b: { deviceId: 'PC-A', iface: 'Eth0' } },
        { a: { deviceId: 'SW1', iface: 'Gi0/2' }, b: { deviceId: 'PC-B', iface: 'Eth0' } },
      ] satisfies Link[],
    },
    // setup seeds the switch (VLANs + trunk + access ports) so each test case
    // starts at "router unconfigured" — the dimension we actually want to
    // vary across cases. The router is configured per-test below.
    setup: {
      SW1: [
        'enable',
        'configure terminal',
        'vlan 10',
        'exit',
        'vlan 20',
        'exit',
        'interface gi0/0',
        'switchport mode trunk',
        'switchport trunk allowed vlan 1,10,20',
        'exit',
        'interface gi0/1',
        'switchport mode access',
        'switchport access vlan 10',
        'exit',
        'interface gi0/2',
        'switchport mode access',
        'switchport access vlan 20',
      ],
    },
    objectives: [],
    hints: [],
  };
}

function runOn(ls: LabSession, deviceId: string, lines: string[]): LabSession {
  let cur = ls;
  if (cur.activeDeviceId !== deviceId) cur = { ...cur, activeDeviceId: deviceId };
  for (const line of lines) cur = applyToActive(cur, line).session;
  return cur;
}

/** Fully-configured R1 ROAS state: Gi0/0 up (no IP), Gi0/0.10 (192.168.10.1)
 *  with dot1q 10 + no shutdown, Gi0/0.20 (192.168.20.1) with dot1q 20 + no
 *  shutdown. Returns the same session shape as the test helpers expect. */
function solveR1(ls: LabSession): LabSession {
  return runOn(ls, 'R1', [
    'enable',
    'configure terminal',
    'interface gi0/0',
    'no shutdown',
    'exit',
    'interface gi0/0.10',
    'encapsulation dot1q 10',
    'ip address 192.168.10.1 255.255.255.0',
    'no shutdown',
    'exit',
    'interface gi0/0.20',
    'encapsulation dot1q 20',
    'ip address 192.168.20.1 255.255.255.0',
    'no shutdown',
    'end',
  ]);
}

describe('canReach — Lab 09 router-on-a-stick', () => {
  it('happy path: PC-A pings PC-B after full ROAS config', () => {
    let ls = initLabSession(roasLab());
    ls = solveR1(ls);
    const result = canReach(ls, 'PC-A', '192.168.20.10');
    expect(result.ok).toBe(true);
  });

  it('happy path: PC-A pings gateway 192.168.10.1 (R1 subif IP)', () => {
    let ls = initLabSession(roasLab());
    ls = solveR1(ls);
    expect(canReach(ls, 'PC-A', '192.168.10.1').ok).toBe(true);
  });

  it('no encapsulation on Gi0/0.10 → PC-A cannot ping gateway', () => {
    let ls = initLabSession(roasLab());
    // Configure Gi0/0.10 without encap. Gi0/0.20 is fully configured.
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'no shutdown',
      'exit',
      'interface gi0/0.10',
      'ip address 192.168.10.1 255.255.255.0',
      'no shutdown',
      'exit',
      'interface gi0/0.20',
      'encapsulation dot1q 20',
      'ip address 192.168.20.1 255.255.255.0',
      'no shutdown',
      'end',
    ]);
    const result = canReach(ls, 'PC-A', '192.168.20.10');
    expect(result.ok).toBe(false);
  });

  it('Gi0/0.10 adminDown → PC-A cannot ping PC-B', () => {
    let ls = initLabSession(roasLab());
    ls = solveR1(ls);
    // Now shut down Gi0/0.10.
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'interface gi0/0.10',
      'shutdown',
      'end',
    ]);
    const result = canReach(ls, 'PC-A', '192.168.20.10');
    expect(result.ok).toBe(false);
    // PC-A can't even reach its gateway, so the failure point is on PC-A.
    if (!result.ok) {
      expect(result.failedAt.reason).toBe('no-gateway');
    }
  });

  it('parent Gi0/0 adminDown → PC-A cannot ping PC-B', () => {
    let ls = initLabSession(roasLab());
    ls = solveR1(ls);
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'shutdown',
      'end',
    ]);
    const result = canReach(ls, 'PC-A', '192.168.20.10');
    expect(result.ok).toBe(false);
  });

  it("trunk doesn't allow VLAN 10 → PC-A cannot ping PC-B", () => {
    let ls = initLabSession(roasLab());
    ls = solveR1(ls);
    // Drop VLAN 10 from the trunk's allowed list.
    ls = runOn(ls, 'SW1', [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'switchport trunk allowed vlan 1,20',
      'end',
    ]);
    const result = canReach(ls, 'PC-A', '192.168.20.10');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The walk goes PC-A → SW1 first; the trunk-allowed lookup happens in
      // findGatewayThroughSwitch — failure surfaces as 'no-gateway' because
      // the router subif is no longer reachable on VLAN 10 from SW1.
      expect(['no-gateway', 'vlan-not-allowed']).toContain(result.failedAt.reason);
    }
  });

  it('only Gi0/0.10 configured → PC-A can ping its gateway, cannot ping PC-B', () => {
    let ls = initLabSession(roasLab());
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'no shutdown',
      'exit',
      'interface gi0/0.10',
      'encapsulation dot1q 10',
      'ip address 192.168.10.1 255.255.255.0',
      'no shutdown',
      'end',
    ]);
    expect(canReach(ls, 'PC-A', '192.168.10.1').ok).toBe(true);
    expect(canReach(ls, 'PC-A', '192.168.20.10').ok).toBe(false);
  });
});

describe('discoverHops — Lab 09 tracert parity', () => {
  it('PC-A → PC-B trace lists R1 gateway IP and PC-B as final hop', async () => {
    let ls = initLabSession(roasLab());
    ls = solveR1(ls);
    // Drive tracert through the PC adapter: applyToActive on PC-A.
    const pcA = { ...ls, activeDeviceId: 'PC-A' };
    const { __setTracertDelayMs } = await import('./adapters/pc');
    __setTracertDelayMs(0);
    const result = applyToActive(pcA, 'tracert 192.168.20.10');
    // Drain the stream so we see all hop rows.
    const lines: string[] = result.output.map((o) => o.text);
    if (result.stream) {
      for await (const out of result.stream) lines.push(out.text);
    }
    const joined = lines.join('\n');
    // The trace lists R1's gateway (192.168.10.1) and the destination
    // (192.168.20.10), and completes cleanly.
    expect(joined).toMatch(/192\.168\.10\.1/);
    expect(joined).toMatch(/192\.168\.20\.10/);
    expect(joined).toMatch(/Trace complete/);
  });
});
