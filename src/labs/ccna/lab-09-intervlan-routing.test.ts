import { describe, it, expect } from 'vitest';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { canReach } from '@/engine/reachability';
import { grade } from '@/engine/grading';
import { lab09IntervlanRouting as lab } from './lab-09-intervlan-routing';

function runOn(ls: LabSession, id: string, lines: string[]): LabSession {
  let cur: LabSession = { ...ls, activeDeviceId: id };
  for (const line of lines) cur = applyToActive(cur, line).session;
  return cur;
}

/** Full ROAS configuration on R1: parent up + two dot1Q subifs with IPs. */
function configureR1Roas(ls: LabSession): LabSession {
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

describe('lab-09-intervlan-routing — starting state', () => {
  it('topology shape: 4 devices (2 PCs, 1 switch, 1 router), 3 links, isFree:true', () => {
    expect(lab.topology.devices).toHaveLength(4);
    expect(lab.topology.links).toHaveLength(3);
    expect(lab.isFree).toBe(false);
    const kinds = lab.topology.devices.map((d) => d.kind).sort();
    expect(kinds).toEqual(['pc', 'pc', 'router', 'switch']);
  });

  it('SW1 is seeded with VLANs 10/20, trunk on Gi0/0, access ports on Gi0/1 + Gi0/2', () => {
    const ls = initLabSession(lab);
    const sw = ls.devices.SW1;
    if (sw.kind !== 'switch') throw new Error('shape');
    expect(sw.device.vlans.get(10)?.name).toBe('Sales');
    expect(sw.device.vlans.get(20)?.name).toBe('Engineering');
    expect(sw.device.switchports['Gi0/0'].mode).toBe('trunk');
    const trunkAllowed = sw.device.switchports['Gi0/0'].trunkAllowedVlans;
    if (trunkAllowed === 'all') throw new Error('expected explicit list');
    expect(trunkAllowed).toEqual([1, 10, 20]);
    expect(sw.device.switchports['Gi0/1'].accessVlan).toBe(10);
    expect(sw.device.switchports['Gi0/2'].accessVlan).toBe(20);
  });

  it('R1 starts bare — no subinterfaces, Gi0/0 admin-down', () => {
    const ls = initLabSession(lab);
    const r1 = ls.devices.R1;
    if (r1.kind !== 'router') throw new Error('shape');
    expect(r1.device.subInterfaces).toEqual({});
    expect(r1.device.interfaces['Gi0/0'].adminUp).toBe(false);
  });

  it('PC-A CANNOT ping PC-B at lab start (no router config)', () => {
    const ls = initLabSession(lab);
    const r = canReach(ls, 'PC-A', '192.168.20.10');
    expect(r.ok).toBe(false);
  });

  it('seeded SW1 commands do NOT appear in the learner history', () => {
    const ls = initLabSession(lab);
    const sw = ls.devices.SW1;
    if (sw.kind !== 'switch') throw new Error('shape');
    expect(sw.history).toEqual([]);
    expect(sw.resolvedHistory).toEqual([]);
  });

  it('all six objectives are unmet at start', () => {
    const ls = initLabSession(lab);
    const g = grade(lab, ls);
    expect(g.allMet).toBe(false);
    for (const o of g.objectives) expect(o.met).toBe(false);
  });
});

describe('lab-09-intervlan-routing — happy path', () => {
  it('full walkthrough: configure both subifs → verify → ping → all objectives met', () => {
    let ls = initLabSession(lab);
    ls = configureR1Roas(ls);
    ls = runOn(ls, 'R1', ['enable', 'show ip interface brief']);
    ls = runOn(ls, 'PC-A', ['ping 192.168.20.10']);
    const g = grade(lab, ls);
    expect(g.allMet).toBe(true);
    for (const o of g.objectives) expect(o.met).toBe(true);
  });

  it('TEXTBOOK RECIPE: physical no shutdown ONLY (no per-subif no shutdown) → all objectives met', () => {
    // The curriculum recipe: `no shutdown` the physical Gi0/0; the subifs come
    // up off the parent. No per-subif `no shutdown` typed. This is the path the
    // false-fail bug used to break — it must now reach allMet.
    let ls = initLabSession(lab);
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'no shutdown',
      'exit',
      'interface gi0/0.10',
      'encapsulation dot1q 10',
      'ip address 192.168.10.1 255.255.255.0',
      'exit',
      'interface gi0/0.20',
      'encapsulation dot1q 20',
      'ip address 192.168.20.1 255.255.255.0',
      'end',
    ]);
    ls = runOn(ls, 'R1', ['enable', 'show ip interface brief']);
    ls = runOn(ls, 'PC-A', ['ping 192.168.20.10']);
    const g = grade(lab, ls);
    expect(g.allMet).toBe(true);
    for (const o of g.objectives) expect(o.met).toBe(true);
  });

  it('PC-A can ping its gateway 192.168.10.1 after R1 config', () => {
    let ls = initLabSession(lab);
    ls = configureR1Roas(ls);
    expect(canReach(ls, 'PC-A', '192.168.10.1').ok).toBe(true);
  });

  it('PC-B can ping its gateway 192.168.20.1 after R1 config', () => {
    let ls = initLabSession(lab);
    ls = configureR1Roas(ls);
    expect(canReach(ls, 'PC-B', '192.168.20.1').ok).toBe(true);
  });

  it('return path: PC-B can ping PC-A across VLANs', () => {
    let ls = initLabSession(lab);
    ls = configureR1Roas(ls);
    expect(canReach(ls, 'PC-B', '192.168.10.10').ok).toBe(true);
  });
});

describe('lab-09-intervlan-routing — partial-credit guards', () => {
  it('skip `encapsulation dot1q 10` → subif10-encap unmet, ping fails', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'no shutdown',
      'exit',
      'interface gi0/0.10',
      // No encapsulation set
      'ip address 192.168.10.1 255.255.255.0',
      'no shutdown',
      'exit',
      'interface gi0/0.20',
      'encapsulation dot1q 20',
      'ip address 192.168.20.1 255.255.255.0',
      'no shutdown',
      'end',
    ]);
    const g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'subif10-encap')?.met).toBe(false);
    expect(g.objectives.find((o) => o.id === 'ping-cross-vlan')?.met).toBe(false);
    expect(canReach(ls, 'PC-A', '192.168.20.10').ok).toBe(false);
  });

  it('shutdown Gi0/0.10 is a no-op → ping still succeeds (subif follows the parent)', () => {
    let ls = initLabSession(lab);
    ls = configureR1Roas(ls);
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'interface gi0/0.10',
      'shutdown',
      'end',
    ]);
    expect(canReach(ls, 'PC-A', '192.168.20.10').ok).toBe(true);
  });

  it('shutdown the PHYSICAL Gi0/0 → ping fails (the real lever)', () => {
    let ls = initLabSession(lab);
    ls = configureR1Roas(ls);
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'shutdown',
      'end',
    ]);
    expect(canReach(ls, 'PC-A', '192.168.20.10').ok).toBe(false);
  });

  it('only Gi0/0.10 configured (missing Gi0/0.20) → subif20-* unmet, ping fails', () => {
    let ls = initLabSession(lab);
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
    const g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'subif10-encap')?.met).toBe(true);
    expect(g.objectives.find((o) => o.id === 'subif20-encap')?.met).toBe(false);
    expect(g.objectives.find((o) => o.id === 'subif20-ip')?.met).toBe(false);
    expect(g.objectives.find((o) => o.id === 'ping-cross-vlan')?.met).toBe(false);
    // PC-A reaches its gateway, but not PC-B (other side of the router has no
    // route to 192.168.20.0/24).
    expect(canReach(ls, 'PC-A', '192.168.10.1').ok).toBe(true);
    expect(canReach(ls, 'PC-A', '192.168.20.10').ok).toBe(false);
  });

  it('configured but never ran `show ip interface brief` → verify-brief unmet', () => {
    let ls = initLabSession(lab);
    ls = configureR1Roas(ls);
    ls = runOn(ls, 'PC-A', ['ping 192.168.20.10']);
    const g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'subif10-encap')?.met).toBe(true);
    expect(g.objectives.find((o) => o.id === 'subif20-encap')?.met).toBe(true);
    expect(g.objectives.find((o) => o.id === 'verify-brief')?.met).toBe(false);
    expect(g.objectives.find((o) => o.id === 'ping-cross-vlan')?.met).toBe(true);
    expect(g.allMet).toBe(false);
  });

  it('verify-at-t=0 then configure → verify-brief stays unmet (ordering)', () => {
    // Regression: running `show ip interface brief` BEFORE configuring the
    // subifs must NOT retroactively satisfy verify-brief. The learner has to
    // re-run the verify command AFTER bringing the subifs up.
    let ls = initLabSession(lab);
    ls = runOn(ls, 'R1', ['enable', 'show ip interface brief']);
    ls = configureR1Roas(ls);
    const g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'verify-brief')?.met).toBe(false);
  });

  it('verify-at-t=0 → configure → verify-again → verify-brief ticks', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'R1', ['enable', 'show ip interface brief']);
    ls = configureR1Roas(ls);
    expect(grade(lab, ls).objectives.find((o) => o.id === 'verify-brief')?.met).toBe(false);
    ls = runOn(ls, 'R1', ['enable', 'show ip interface brief']);
    expect(grade(lab, ls).objectives.find((o) => o.id === 'verify-brief')?.met).toBe(true);
  });

  it('configured + verified BUT never pinged → ping-cross-vlan unmet', () => {
    let ls = initLabSession(lab);
    ls = configureR1Roas(ls);
    ls = runOn(ls, 'R1', ['enable', 'show ip interface brief']);
    const g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'verify-brief')?.met).toBe(true);
    expect(g.objectives.find((o) => o.id === 'ping-cross-vlan')?.met).toBe(false);
    expect(g.allMet).toBe(false);
  });
});
