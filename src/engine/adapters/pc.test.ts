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
        { id: 'Eth0', name: 'Eth0', status: 'up', ip: '192.168.1.10', mask: '255.255.255.0' },
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

  it('records lastPing.ok=true on a successful ping with the right target', () => {
    const ls = fullyConfigured();
    expect((ls.devices['PC-A'] as PcSession).lastPing).toBeNull();
    const after = pingFrom(ls, 'PC-A', '192.168.2.10').session;
    const pc = after.devices['PC-A'] as PcSession;
    expect(pc.lastPing).toEqual({ target: '192.168.2.10', ok: true });
  });

  it('records lastPing.ok=false when the ping fails', () => {
    let ls = fullyConfigured();
    ls = configure(ls, 'R2', ['no ip route 192.168.1.0 255.255.255.0 192.168.12.1']);
    const after = pingFrom(ls, 'PC-A', '192.168.2.10').session;
    const pc = after.devices['PC-A'] as PcSession;
    expect(pc.lastPing).toEqual({ target: '192.168.2.10', ok: false });
  });

  it('does NOT update lastPing on a non-IPv4 ping (early-rejected, never reached canReach)', () => {
    const ls = fullyConfigured();
    const after = pingFrom(ls, 'PC-A', 'google.com').session;
    const pc = after.devices['PC-A'] as PcSession;
    expect(pc.lastPing).toBeNull();
  });
});

describe('pcAdapter — tracert / traceroute (hop walk + per-hop reachability)', () => {
  function pingLab(): Lab {
    return {
      id: 'pc-tracert-fixture',
      title: 'tracert fixture',
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

  function tracertFrom(ls: LabSession, pcId: string, target: string) {
    const cur = { ...ls, activeDeviceId: pcId };
    return applyToActive(cur, `tracert ${target}`);
  }

  it('working path: lists gateway → next-hop router → destination, ending in "Trace complete."', () => {
    const ls = fullyConfigured();
    const text = tracertFrom(ls, 'PC-A', '192.168.2.10').output.map((o) => o.text).join('\n');
    expect(text).toMatch(/Tracing route to 192\.168\.2\.10/);
    expect(text).toMatch(/1\s+<1 ms.*192\.168\.1\.1/);     // gateway = R1 LAN
    expect(text).toMatch(/2\s+<1 ms.*192\.168\.12\.2/);    // R2 ingress on R1-R2 link
    expect(text).toMatch(/3\s+<1 ms.*192\.168\.2\.10/);    // destination
    expect(text).toMatch(/Trace complete\./);
    // Working path stops at the destination — no spam timeouts past it.
    expect(text).not.toMatch(/Request timed out/);
  });

  it('traceroute (alias) routes to the same handler', () => {
    const ls = fullyConfigured();
    const cur = { ...ls, activeDeviceId: 'PC-A' };
    const text = applyToActive(cur, 'traceroute 192.168.2.10').output.map((o) => o.text).join('\n');
    expect(text).toMatch(/Tracing route to 192\.168\.2\.10/);
    expect(text).toMatch(/Trace complete\./);
  });

  // The bug-class assertion the spec called out by name: tracert on an
  // egress-down break MUST die at the shut router/interface — not show a
  // successful trace, not show a wrong failure sentence. Same FailReason
  // and same naming as the ping.
  it('egress-down break: hop 1 succeeds, hops 2+ time out, sentence names R1 Gi0/0', () => {
    let ls = fullyConfigured();
    ls = configure(ls, 'R1', ['interface gi0/0', 'shutdown']);
    const text = tracertFrom(ls, 'PC-A', '192.168.2.10').output.map((o) => o.text).join('\n');
    expect(text).toMatch(/1\s+<1 ms.*192\.168\.1\.1/);                 // gateway still reachable
    expect(text).toMatch(/2\s+\*\s+\*\s+\*\s+Request timed out\./);     // dies at hop 2
    expect(text).toMatch(/R1 Gi0\/0 is administratively down/);          // same sentence as ping
    expect(text).toMatch(/Trace did not complete:/);
  });

  it('missing return route: hop 1 succeeds; hop 2 times out (return walk fails at R2)', () => {
    let ls = fullyConfigured();
    ls = configure(ls, 'R2', ['no ip route 192.168.1.0 255.255.255.0 192.168.12.1']);
    const text = tracertFrom(ls, 'PC-A', '192.168.2.10').output.map((o) => o.text).join('\n');
    expect(text).toMatch(/1\s+<1 ms.*192\.168\.1\.1/);     // gateway OK (R1 has connected route back to PC-A)
    expect(text).toMatch(/2\s+\*\s+\*\s+\*\s+Request timed out\./);
    expect(text).toMatch(/R2 has no return route/);          // same sentence the ping prints
  });

  it('rejects a non-IPv4 target with a clear error (no walk attempted)', () => {
    const ls = fullyConfigured();
    const cur = { ...ls, activeDeviceId: 'PC-A' };
    const out = applyToActive(cur, 'tracert google.com').output;
    expect(out[0].kind).toBe('error');
    expect(out[0].text).toMatch(/not a valid IPv4/);
  });

  it('tracert does NOT touch lastPing (it is not a ping)', () => {
    const ls = fullyConfigured();
    expect((ls.devices['PC-A'] as PcSession).lastPing).toBeNull();
    const after = tracertFrom(ls, 'PC-A', '192.168.2.10').session;
    expect((after.devices['PC-A'] as PcSession).lastPing).toBeNull();
  });
});

describe('pcAdapter — ipconfig /all', () => {
  function preconfigured(): PcSession {
    return { ...pcAdapter.buildDevice(SPEC_PRECONFIGURED), nicUp: true };
  }

  it('`ipconfig /all` includes the Host Name and Description fields', () => {
    const text = pcAdapter
      .applyCommand(preconfigured(), 'ipconfig /all')
      .output.map((o) => o.text)
      .join('\n');
    expect(text).toMatch(/Windows IP Configuration/);
    expect(text).toMatch(/Host Name.*PC-A/);
    expect(text).toMatch(/Description.*Workstation/);
    // And the same fields plain ipconfig prints.
    expect(text).toMatch(/IPv4 Address.*192\.168\.1\.10/);
    expect(text).toMatch(/Default Gateway.*192\.168\.1\.1/);
  });

  it('plain `ipconfig` does NOT print the /all-only fields', () => {
    const text = pcAdapter
      .applyCommand(preconfigured(), 'ipconfig')
      .output.map((o) => o.text)
      .join('\n');
    expect(text).not.toMatch(/Windows IP Configuration/);
    expect(text).not.toMatch(/Host Name/);
    expect(text).not.toMatch(/Description/);
  });

  it('unknown ipconfig switch errors honestly (no silent fallback)', () => {
    const out = pcAdapter.applyCommand(preconfigured(), 'ipconfig /bogus').output;
    expect(out[0].kind).toBe('error');
    expect(out[0].text).toMatch(/Unknown ipconfig switch/);
  });
});

describe('pcAdapter — redirect tier (sensible-but-out-of-scope commands)', () => {
  function s(): PcSession {
    return { ...pcAdapter.buildDevice(SPEC_PRECONFIGURED), nicUp: true };
  }

  it.each([
    ['nslookup', /nslookup isn't part of this lab/i],
    ['nslookup google.com', /nslookup isn't part of this lab/i],
    ['arp -a', /arp isn't part of this lab/i],
    ['netstat -an', /netstat isn't part of this lab/i],
    ['telnet 192.168.2.1', /telnet isn't part of this lab/i],
    ['ssh admin@192.168.2.1', /ssh isn't part of this lab/i],
    ['ftp 192.168.2.10', /ftp isn't part of this lab/i],
    ['getmac', /getmac isn't part of this lab/i],
    ['route print', /route isn't part of this lab/i],
    ['nbtstat -n', /nbtstat isn't part of this lab/i],
  ])('`%s` → tailored system message, not a bare error', (line, expected) => {
    const out = pcAdapter.applyCommand(s(), line).output;
    // Redirects are `system` lines — neither a real `output` nor an `error`.
    expect(out[0].kind).toBe('system');
    expect(out[0].text).toMatch(expected);
  });

  it('redirects DO record to history (the command was recognized, just not implemented)', () => {
    const after = pcAdapter.applyCommand(s(), 'nslookup google.com').session;
    expect(after.history).toContain('nslookup google.com');
    expect(after.resolvedHistory).toContain('nslookup google.com');
  });

  it('alias collapsing: `traceroute X` records canonical `tracert X` in resolvedHistory', () => {
    // Tracert needs a lab context; use the redirect-shape interaction
    // (no lab needed) for history-shape only. Use a working alias that
    // doesn't require a network — clear alias if added later. For now,
    // verify via a redirect doesn't apply since redirects have no aliases.
    // Instead: invoke traceroute via the working-command path with a
    // dummy ip — handler will error on missing ctx but history is recorded
    // BEFORE the handler runs.
    const after = pcAdapter.applyCommand(s(), 'traceroute 1.2.3.4').session;
    expect(after.history).toContain('traceroute 1.2.3.4');
    expect(after.resolvedHistory).toContain('tracert 1.2.3.4');
  });
});

describe('pcAdapter — malformed / typo (still fails honestly)', () => {
  function s(): PcSession {
    return { ...pcAdapter.buildDevice(SPEC_PRECONFIGURED), nicUp: true };
  }

  it('genuine typo of a known command → bare Unrecognized error', () => {
    const out = pcAdapter.applyCommand(s(), 'tracerte 192.168.2.10').output;
    expect(out[0].kind).toBe('error');
    expect(out[0].text).toMatch(/% Unrecognized command: tracerte/);
  });

  it('no-space mash like `traceroute192.168.2.10` → bare Unrecognized error', () => {
    const out = pcAdapter.applyCommand(s(), 'traceroute192.168.2.10').output;
    expect(out[0].kind).toBe('error');
    expect(out[0].text).toMatch(/% Unrecognized command: traceroute192\.168\.2\.10/);
  });

  it('completely unknown command → bare Unrecognized error', () => {
    const out = pcAdapter.applyCommand(s(), 'dir').output;
    expect(out[0].kind).toBe('error');
    expect(out[0].text).toMatch(/% Unrecognized command: dir/);
  });

  it('unknown commands DO NOT record to history (parse failed)', () => {
    const after = pcAdapter.applyCommand(s(), 'tracerte 1.2.3.4').session;
    expect(after.history).not.toContain('tracerte 1.2.3.4');
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
