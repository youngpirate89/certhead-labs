import { describe, it, expect } from 'vitest';
import { pcAdapter, type PcSession } from './pc';

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
