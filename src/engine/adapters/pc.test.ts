import { describe, it, expect } from 'vitest';
import { pcAdapter, type PcSession } from './pc';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import type { Lab } from '@/engine/types';

const SPEC = {
  id: 'PC-A',
  kind: 'pc' as const,
  platform: 'Workstation',
  interfaces: ['Eth0'],
};

const SPEC_PRECONFIGURED = {
  ...SPEC,
  pc: { ip: '192.168.1.10', mask: '255.255.255.0', gateway: '192.168.1.1' },
};

describe('pcAdapter — basics', () => {
  it('exposes kind = pc', () => {
    expect(pcAdapter.kind).toBe('pc');
  });

  it('buildDevice with no `pc` spec produces an unconfigured PcSession', () => {
    const s = pcAdapter.buildDevice(SPEC);
    expect(s).toMatchObject({
      kind: 'pc',
      id: 'PC-A',
      hostname: 'PC-A',
      nic: 'Eth0',
      ip: null,
      mask: null,
      gateway: null,
      nicUp: false,
      history: [],
      resolvedHistory: [],
    });
  });

  it('buildDevice carries the lab-spec pc initial config', () => {
    const s = pcAdapter.buildDevice(SPEC_PRECONFIGURED);
    expect(s.ip).toBe('192.168.1.10');
    expect(s.mask).toBe('255.255.255.0');
    expect(s.gateway).toBe('192.168.1.1');
  });

  it('prompt is `<hostname>$`', () => {
    expect(pcAdapter.prompt(pcAdapter.buildDevice(SPEC))).toBe('PC-A$');
  });

  it('toTopologyView returns the kind-agnostic view (kind:pc)', () => {
    const s = { ...pcAdapter.buildDevice(SPEC_PRECONFIGURED), nicUp: true };
    const view = pcAdapter.toTopologyView(s);
    expect(view).toEqual({
      id: 'PC-A',
      kind: 'pc',
      hostname: 'PC-A',
      platform: 'Workstation',
      interfaces: [
        { id: 'Eth0', name: 'Eth0', status: 'up', ip: '192.168.1.10' },
      ],
    });
  });

  it('toTopologyView reflects nicUp (admin-down when link is down)', () => {
    const s = pcAdapter.buildDevice(SPEC_PRECONFIGURED);
    const view = pcAdapter.toTopologyView(s);
    expect(view.interfaces[0].status).toBe('admin-down');
  });
});

describe('pcAdapter — commands', () => {
  function run(s: PcSession, lines: string[]): PcSession {
    return lines.reduce(
      (acc, line) => pcAdapter.applyCommand(acc, line).session,
      s,
    );
  }

  it('`ipconfig` renders configured state', () => {
    const s = { ...pcAdapter.buildDevice(SPEC_PRECONFIGURED), nicUp: true };
    const text = pcAdapter
      .applyCommand(s, 'ipconfig')
      .output.map((o) => o.text)
      .join('\n');
    expect(text).toMatch(/Ethernet adapter Eth0/);
    expect(text).toMatch(/IPv4 Address.*192\.168\.1\.10/);
    expect(text).toMatch(/Subnet Mask.*255\.255\.255\.0/);
    expect(text).toMatch(/Default Gateway.*192\.168\.1\.1/);
    expect(text).toMatch(/Media State.*connected/);
  });

  it('`ipconfig` shows (none) on an unconfigured PC and "Media disconnected" when nicUp=false', () => {
    const text = pcAdapter
      .applyCommand(pcAdapter.buildDevice(SPEC), 'ipconfig')
      .output.map((o) => o.text)
      .join('\n');
    expect(text).toMatch(/IPv4 Address.*\(none\)/);
    expect(text).toMatch(/Media State.*Media disconnected/);
  });

  it('`ip <ip> <mask>` sets the NIC IP / mask', () => {
    const s = run(pcAdapter.buildDevice(SPEC), ['ip 10.0.0.42 255.255.255.0']);
    expect(s.ip).toBe('10.0.0.42');
    expect(s.mask).toBe('255.255.255.0');
  });

  it('`gateway <ip>` sets the default gateway', () => {
    const s = run(pcAdapter.buildDevice(SPEC), ['gateway 10.0.0.1']);
    expect(s.gateway).toBe('10.0.0.1');
  });

  it('rejects invalid IP / mask with a clear error', () => {
    const s = pcAdapter.buildDevice(SPEC);
    expect(pcAdapter.applyCommand(s, 'ip bogus 255.255.255.0').output[0].kind).toBe('error');
    expect(pcAdapter.applyCommand(s, 'ip 10.0.0.1 255.255.0.255').output[0].kind).toBe('error');
    expect(pcAdapter.applyCommand(s, 'gateway not-an-ip').output[0].kind).toBe('error');
  });

  it('does not mutate the input session', () => {
    const s = pcAdapter.buildDevice(SPEC);
    const before = structuredClone(s);
    pcAdapter.applyCommand(s, 'ip 10.0.0.42 255.255.255.0');
    expect(s).toEqual(before);
  });
});

describe('pcAdapter — ping (calls canReach)', () => {
  // Build the same PC-A — R1 — R2 — PC-B topology the reachability tests use.
  function pingLab(): Lab {
    return {
      id: 'pc-ping-fixture',
      title: 'ping fixture',
      exam: 'TEST',
      difficulty: 1,
      estimatedMinutes: 1,
      isFree: false,
      scenario: 'fixture',
      topology: {
        devices: [
          {
            id: 'PC-A',
            kind: 'pc',
            platform: 'Workstation',
            interfaces: ['Eth0'],
            pc: { ip: '192.168.1.10', mask: '255.255.255.0', gateway: '192.168.1.1' },
          },
          { id: 'R1', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0', 'Gi0/1'] },
          { id: 'R2', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0', 'Gi0/1'] },
          {
            id: 'PC-B',
            kind: 'pc',
            platform: 'Workstation',
            interfaces: ['Eth0'],
            pc: { ip: '192.168.2.10', mask: '255.255.255.0', gateway: '192.168.2.1' },
          },
        ],
        links: [
          { a: { deviceId: 'PC-A', iface: 'Eth0' }, b: { deviceId: 'R1', iface: 'Gi0/1' } },
          { a: { deviceId: 'R1', iface: 'Gi0/0' }, b: { deviceId: 'R2', iface: 'Gi0/0' } },
          { a: { deviceId: 'R2', iface: 'Gi0/1' }, b: { deviceId: 'PC-B', iface: 'Eth0' } },
        ],
      },
      objectives: [],
      hints: [],
    };
  }

  function configure(ls: LabSession, id: string, lines: string[]): LabSession {
    let cur: LabSession = { ...ls, activeDeviceId: id };
    for (const line of lines) cur = applyToActive(cur, line).session;
    return cur;
  }

  function fullyConfigured(): LabSession {
    let ls = initLabSession(pingLab());
    ls = configure(ls, 'R1', [
      'enable',
      'configure terminal',
      'interface gi0/1',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
      'exit',
      'interface gi0/0',
      'ip address 192.168.12.1 255.255.255.252',
      'no shutdown',
      'exit',
      'ip route 192.168.2.0 255.255.255.0 192.168.12.2',
    ]);
    ls = configure(ls, 'R2', [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 192.168.12.2 255.255.255.252',
      'no shutdown',
      'exit',
      'interface gi0/1',
      'ip address 192.168.2.1 255.255.255.0',
      'no shutdown',
      'exit',
      'ip route 192.168.1.0 255.255.255.0 192.168.12.1',
    ]);
    return ls;
  }

  function pingFrom(ls: LabSession, pcId: string, target: string) {
    const cur = { ...ls, activeDeviceId: pcId };
    return applyToActive(cur, `ping ${target}`);
  }

  it('PC-A ping PC-B succeeds end-to-end (Reply lines printed)', () => {
    const ls = fullyConfigured();
    const out = pingFrom(ls, 'PC-A', '192.168.2.10').output.map((o) => o.text).join('\n');
    expect(out).toMatch(/Pinging 192\.168\.2\.10/);
    expect(out).toMatch(/Reply from 192\.168\.2\.10/);
    expect(out).toMatch(/Received = 2, Lost = 0/);
  });

  it('missing return route → "Reply timed out — R2 has no return route" sentence', () => {
    let ls = fullyConfigured();
    ls = configure(ls, 'R2', ['no ip route 192.168.1.0 255.255.255.0 192.168.12.1']);
    const out = pingFrom(ls, 'PC-A', '192.168.2.10').output.map((o) => o.text).join('\n');
    expect(out).toMatch(/Request timed out\.\nRequest timed out\./);
    expect(out).toMatch(/100% loss/);
    expect(out).toMatch(/Reply timed out.*R2 has no return route/);
  });

  it('no forward route on R1 → "Request timed out — R1 has no route to <target>"', () => {
    let ls = fullyConfigured();
    ls = configure(ls, 'R1', ['no ip route 192.168.2.0 255.255.255.0 192.168.12.2']);
    const out = pingFrom(ls, 'PC-A', '192.168.2.10').output.map((o) => o.text).join('\n');
    expect(out).toMatch(/Request timed out.*R1 has no route to 192\.168\.2\.10/);
  });

  it('egress interface admin-down → "R1 Gi0/0 is administratively down"', () => {
    let ls = fullyConfigured();
    ls = configure(ls, 'R1', ['interface gi0/0', 'shutdown']);
    const out = pingFrom(ls, 'PC-A', '192.168.2.10').output.map((o) => o.text).join('\n');
    expect(out).toMatch(/R1 Gi0\/0 is administratively down/);
  });

  it('PC pinging its own gateway succeeds (local-subnet delivery)', () => {
    const ls = fullyConfigured();
    const out = pingFrom(ls, 'PC-A', '192.168.1.1').output.map((o) => o.text).join('\n');
    expect(out).toMatch(/Reply from 192\.168\.1\.1/);
  });

  it('rejects a non-IPv4 ping target with a clear error', () => {
    const ls = fullyConfigured();
    const out = pingFrom(ls, 'PC-A', 'google.com').output;
    expect(out[0].kind).toBe('error');
    expect(out[0].text).toMatch(/not a valid IPv4/);
  });
});

describe('pcAdapter — endpoint guarantee (never a transit hop)', () => {
  it('PcSession lacks a routing table — canReach cannot route through it', () => {
    const s = pcAdapter.buildDevice(SPEC) as unknown as Record<string, unknown>;
    expect('staticRoutes' in s).toBe(false);
    expect('routingTable' in s).toBe(false);
  });

  it('PcSession exposes ONLY one NIC', () => {
    const s = pcAdapter.buildDevice(SPEC);
    const view = pcAdapter.toTopologyView({ ...s, nicUp: true });
    expect(view.interfaces).toHaveLength(1);
  });
});
