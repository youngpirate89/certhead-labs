import { describe, it, expect } from 'vitest';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { canReach } from '@/engine/reachability';
import { grade } from '@/engine/grading';
import { lab08VlanTrunking as lab } from './lab-08-vlan-trunking';

function runOn(ls: LabSession, id: string, lines: string[]): LabSession {
  let cur: LabSession = { ...ls, activeDeviceId: id };
  for (const line of lines) cur = applyToActive(cur, line).session;
  return cur;
}

describe('lab-08-vlan-trunking — starting state', () => {
  it('topology shape: 4 devices (2 PCs, 2 switches), 3 links, isFree:false', () => {
    expect(lab.topology.devices).toHaveLength(4);
    expect(lab.topology.links).toHaveLength(3);
    expect(lab.isFree).toBe(false);
    const kinds = lab.topology.devices.map((d) => d.kind).sort();
    expect(kinds).toEqual(['pc', 'pc', 'switch', 'switch']);
  });

  it('SW1 and SW2 are seeded with VLAN 10 (Sales) and Fa0/1 assigned to it', () => {
    const ls = initLabSession(lab);
    for (const id of ['SW1', 'SW2'] as const) {
      const sw = ls.devices[id];
      if (sw.kind !== 'switch') throw new Error('shape');
      expect(sw.device.vlans.get(10)?.name).toBe('Sales');
      expect(sw.device.switchports['Fa0/1'].mode).toBe('access');
      expect(sw.device.switchports['Fa0/1'].accessVlan).toBe(10);
    }
  });

  it('inter-switch link Fa0/24 starts in default access mode on both ends', () => {
    const ls = initLabSession(lab);
    const sw1 = ls.devices.SW1;
    const sw2 = ls.devices.SW2;
    if (sw1.kind !== 'switch' || sw2.kind !== 'switch') throw new Error('shape');
    expect(sw1.device.switchports['Fa0/24'].mode).toBe('access');
    expect(sw2.device.switchports['Fa0/24'].mode).toBe('access');
  });

  it('PC-A CANNOT reach PC-B at lab start (trunk not configured)', () => {
    const ls = initLabSession(lab);
    const r = canReach(ls, 'PC-A', '192.168.10.20');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.failedAt.reason).toBe('trunk-not-configured');
    expect(r.failedAt.trunk).toEqual({
      aDevice: 'SW1',
      aIface: 'Fa0/24',
      bDevice: 'SW2',
      bIface: 'Fa0/24',
    });
  });

  it('seeded commands do NOT appear in the learner history', () => {
    const ls = initLabSession(lab);
    for (const id of ['SW1', 'SW2'] as const) {
      const sw = ls.devices[id];
      if (sw.kind !== 'switch') throw new Error('shape');
      expect(sw.history).toEqual([]);
      expect(sw.resolvedHistory).toEqual([]);
    }
  });

  it('all three objectives are unmet at start', () => {
    const ls = initLabSession(lab);
    const g = grade(lab, ls);
    expect(g.allMet).toBe(false);
    for (const o of g.objectives) expect(o.met).toBe(false);
  });
});

describe('lab-08-vlan-trunking — happy path', () => {
  function configureTrunk(ls: LabSession): LabSession {
    let cur = runOn(ls, 'SW1', [
      'enable',
      'configure terminal',
      'interface fa0/24',
      'switchport mode trunk',
      'end',
    ]);
    cur = runOn(cur, 'SW2', [
      'enable',
      'configure terminal',
      'interface fa0/24',
      'switchport mode trunk',
      'end',
    ]);
    return cur;
  }

  it('trunk-configured ticks once both Fa0/24 ports are in trunk mode', () => {
    const ls = configureTrunk(initLabSession(lab));
    const g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'trunk-configured')?.met).toBe(true);
  });

  it('trunk-verified needs `show interfaces trunk` AND VLAN 10 in both allowed lists', () => {
    // Configure the trunk but DON'T run the verification command yet.
    let ls = configureTrunk(initLabSession(lab));
    let g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'trunk-verified')?.met).toBe(false);

    // Run show interfaces trunk on SW1 — should tick (default allow=all
    // includes VLAN 10 on both ends).
    ls = runOn(ls, 'SW1', ['enable', 'show interfaces trunk']);
    g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'trunk-verified')?.met).toBe(true);
  });

  it('reachability ticks once PC-A successfully pings PC-B', () => {
    let ls = configureTrunk(initLabSession(lab));
    ls = runOn(ls, 'SW1', ['enable', 'show interfaces trunk']);

    // Before the ping, reachability is unmet (lastPing null).
    let g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'reachability')?.met).toBe(false);

    ls = runOn(ls, 'PC-A', ['ping 192.168.10.20']);
    g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'reachability')?.met).toBe(true);
  });

  it('full walkthrough: configure trunk → verify → ping → all three objectives met', () => {
    let ls = configureTrunk(initLabSession(lab));
    ls = runOn(ls, 'SW2', ['enable', 'sh int tr']); // abbreviated form must count
    ls = runOn(ls, 'PC-A', ['ping 192.168.10.20']);
    const g = grade(lab, ls);
    expect(g.allMet).toBe(true);
  });
});

describe('lab-08-vlan-trunking — partial-credit guards', () => {
  it('only ONE end of the trunk configured → trunk-configured unmet, ping still fails', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'SW1', [
      'enable',
      'configure terminal',
      'interface fa0/24',
      'switchport mode trunk',
      'end',
    ]);
    const g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'trunk-configured')?.met).toBe(false);
    const r = canReach(ls, 'PC-A', '192.168.10.20');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    // SW2's side is still access, so the engine reports trunk-not-configured.
    expect(r.failedAt.reason).toBe('trunk-not-configured');
  });

  it('trunk on both ends but VLAN 10 stripped from SW1\'s allowed list → vlan-not-allowed', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'SW1', [
      'enable',
      'configure terminal',
      'interface fa0/24',
      'switchport mode trunk',
      'switchport trunk allowed vlan 20', // VLAN 10 absent — Sales is gated
      'end',
    ]);
    ls = runOn(ls, 'SW2', [
      'enable',
      'configure terminal',
      'interface fa0/24',
      'switchport mode trunk',
      'end',
    ]);
    const r = canReach(ls, 'PC-A', '192.168.10.20');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.failedAt.reason).toBe('vlan-not-allowed');
    expect(r.failedAt.vlanAllow).toEqual({ vlanId: 10 });
  });

  it('verify command run at t=0 (no trunk configured) → trunk-verified unmet', () => {
    // Regression: default access ports carry `trunkAllowedVlans === 'all'` —
    // running `show interfaces trunk` BEFORE configuring trunks must NOT
    // satisfy trunk-verified, because no trunk exists yet.
    let ls = initLabSession(lab);
    ls = runOn(ls, 'SW1', ['enable', 'show interfaces trunk']);
    const g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'trunk-configured')?.met).toBe(false);
    expect(g.objectives.find((o) => o.id === 'trunk-verified')?.met).toBe(false);
  });

  it('configured + pinged BUT never ran `show interfaces trunk` → trunk-verified unmet', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'SW1', [
      'enable',
      'configure terminal',
      'interface fa0/24',
      'switchport mode trunk',
      'end',
    ]);
    ls = runOn(ls, 'SW2', [
      'enable',
      'configure terminal',
      'interface fa0/24',
      'switchport mode trunk',
      'end',
    ]);
    ls = runOn(ls, 'PC-A', ['ping 192.168.10.20']);
    const g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'trunk-configured')?.met).toBe(true);
    expect(g.objectives.find((o) => o.id === 'trunk-verified')?.met).toBe(false);
    expect(g.objectives.find((o) => o.id === 'reachability')?.met).toBe(true);
    expect(g.allMet).toBe(false);
  });

  it('verify-at-t=0 then configure trunks → trunk-verified stays unmet (stale snapshot)', () => {
    // Ordering regression: running the verify command BEFORE the trunk is
    // configured stamps a snapshot with no trunk ports. Configuring trunks
    // afterward must NOT retroactively satisfy trunk-verified — the learner
    // has to re-run the verify command for the snapshot to update.
    let ls = initLabSession(lab);
    ls = runOn(ls, 'SW1', ['enable', 'show interfaces trunk']);
    ls = runOn(ls, 'SW1', [
      'configure terminal',
      'interface fa0/24',
      'switchport mode trunk',
      'end',
    ]);
    ls = runOn(ls, 'SW2', [
      'enable',
      'configure terminal',
      'interface fa0/24',
      'switchport mode trunk',
      'end',
    ]);
    const g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'trunk-configured')?.met).toBe(true);
    expect(g.objectives.find((o) => o.id === 'trunk-verified')?.met).toBe(false);
  });

  it('only SW1 trunked + verify on SW1 → trunk-verified unmet (SW2 still access)', () => {
    // Regression: a factory access port carries trunkAllowedVlans:'all', so
    // reading SW2's allowed list without first checking mode === 'trunk' would
    // soft-pass trunk-verified while SW2 Fa0/24 is still in access mode.
    let ls = initLabSession(lab);
    ls = runOn(ls, 'SW1', [
      'enable',
      'configure terminal',
      'interface fa0/24',
      'switchport mode trunk',
      'end',
      'show interfaces trunk',
    ]);
    // SW2 left untouched — Fa0/24 is still access mode.
    const g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'trunk-configured')?.met).toBe(false);
    expect(g.objectives.find((o) => o.id === 'trunk-verified')?.met).toBe(false);
  });

  it('verify-at-t=0 → configure → verify-again → trunk-verified flips to met', () => {
    // Companion to the previous test: once the learner re-runs the verify
    // command POST-config, the fresh snapshot includes Fa0/24 and the
    // objective ticks.
    let ls = initLabSession(lab);
    ls = runOn(ls, 'SW1', ['enable', 'show interfaces trunk']);
    ls = runOn(ls, 'SW1', [
      'configure terminal',
      'interface fa0/24',
      'switchport mode trunk',
      'end',
    ]);
    ls = runOn(ls, 'SW2', [
      'enable',
      'configure terminal',
      'interface fa0/24',
      'switchport mode trunk',
      'end',
    ]);
    expect(grade(lab, ls).objectives.find((o) => o.id === 'trunk-verified')?.met).toBe(false);
    ls = runOn(ls, 'SW1', ['show interfaces trunk']);
    expect(grade(lab, ls).objectives.find((o) => o.id === 'trunk-verified')?.met).toBe(true);
  });
});

describe('lab-08-vlan-trunking — admin/protocol state on the trunk', () => {
  function configureTrunk(ls: LabSession): LabSession {
    let cur = runOn(ls, 'SW1', [
      'enable',
      'configure terminal',
      'interface fa0/24',
      'switchport mode trunk',
      'end',
    ]);
    cur = runOn(cur, 'SW2', [
      'enable',
      'configure terminal',
      'interface fa0/24',
      'switchport mode trunk',
      'end',
    ]);
    return cur;
  }

  /** Run one command on `id` and return the rendered output as a single
   *  string — used to assert what `show interfaces trunk` prints. */
  function outputOf(ls: LabSession, id: string, line: string): string {
    const res = applyToActive({ ...ls, activeDeviceId: id }, line);
    return res.output.map((o) => o.text).join('\n');
  }

  it('both ends up: ping succeeds AND show interfaces trunk reports trunking', () => {
    const ls = configureTrunk(initLabSession(lab));
    expect(canReach(ls, 'PC-A', '192.168.10.20').ok).toBe(true);
    const show = outputOf(ls, 'SW1', 'show interfaces trunk');
    expect(show).toContain('Fa0/24');
    expect(show).toContain('trunking');
    expect(show).not.toContain('not-trunking');
  });

  it('shut SW1 Fa0/24: ping FAILS (trunk-link-down) AND show says not-trunking — same state', () => {
    let ls = configureTrunk(initLabSession(lab));
    ls = runOn(ls, 'SW1', ['configure terminal', 'interface fa0/24', 'shutdown', 'end']);

    // Forwarding: the down trunk no longer carries the frame.
    const r = canReach(ls, 'PC-A', '192.168.10.20');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.failedAt.reason).toBe('trunk-link-down');

    // Render must AGREE: the shut port shows not-trunking on the local switch,
    // and — because a link is both ends — on the peer switch too (its end's
    // protocolUp dropped when SW1 went admin-down).
    expect(outputOf(ls, 'SW1', 'show interfaces trunk')).toContain('not-trunking');
    expect(outputOf(ls, 'SW2', 'show interfaces trunk')).toContain('not-trunking');
  });

  it('shut SW2 Fa0/24 (the OTHER end): ping FAILS too — link = both ends', () => {
    let ls = configureTrunk(initLabSession(lab));
    ls = runOn(ls, 'SW2', ['configure terminal', 'interface fa0/24', 'shutdown', 'end']);
    const r = canReach(ls, 'PC-A', '192.168.10.20');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.failedAt.reason).toBe('trunk-link-down');
  });

  it('no shutdown restores the trunk: ping succeeds and show returns to trunking', () => {
    let ls = configureTrunk(initLabSession(lab));
    ls = runOn(ls, 'SW1', ['configure terminal', 'interface fa0/24', 'shutdown', 'end']);
    expect(canReach(ls, 'PC-A', '192.168.10.20').ok).toBe(false);

    ls = runOn(ls, 'SW1', ['configure terminal', 'interface fa0/24', 'no shutdown', 'end']);
    expect(canReach(ls, 'PC-A', '192.168.10.20').ok).toBe(true);
    const show = outputOf(ls, 'SW1', 'show interfaces trunk');
    expect(show).toContain('trunking');
    expect(show).not.toContain('not-trunking');
  });
});
