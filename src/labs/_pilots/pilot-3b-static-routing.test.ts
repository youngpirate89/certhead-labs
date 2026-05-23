import { describe, it, expect } from 'vitest';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { grade } from '@/engine/grading';
import { pilot3bStaticRouting as lab } from './pilot-3b-static-routing';

function configure(ls: LabSession, id: string, lines: string[]): LabSession {
  let cur: LabSession = { ...ls, activeDeviceId: id };
  for (const line of lines) cur = applyToActive(cur, line).session;
  return cur;
}

function metIds(ls: LabSession): string[] {
  return grade(lab, ls)
    .objectives.filter((o) => o.met)
    .map((o) => o.id);
}

describe('pilot 3b — static routing (PC-A → PC-B)', () => {
  it('declares the right topology shape (2 PCs, 2 routers, 3 links)', () => {
    expect(lab.topology.devices).toHaveLength(4);
    expect(lab.topology.links).toHaveLength(3);
    expect(lab.isFree).toBe(false);
  });

  it('starts with everything unmet', () => {
    const ls = initLabSession(lab);
    expect(grade(lab, ls).allMet).toBe(false);
    expect(metIds(ls)).toEqual([]);
  });

  it('headline failure: forward statics only → reach UNMET; adding the return route alone is still NOT ENOUGH — learner must ping to satisfy reach', () => {
    let ls = initLabSession(lab);

    // Configure R1 fully (interfaces + forward static).
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

    // Configure R2 INTERFACES only — no return static yet (instructive bug).
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
    ]);

    const intermediate = grade(lab, ls);
    expect(intermediate.objectives.find((o) => o.id === 'r1-static-forward')?.met).toBe(true);
    expect(intermediate.objectives.find((o) => o.id === 'r2-static-return')?.met).toBe(false);
    expect(intermediate.objectives.find((o) => o.id === 'reach-pc-a-to-pc-b')?.met).toBe(false);
    expect(intermediate.allMet).toBe(false);

    // Add the return route on R2 — state now PERMITS reachability, but the
    // learner hasn't pinged yet, so the reach objective stays unmet.
    ls = configure(ls, 'R2', ['ip route 192.168.1.0 255.255.255.0 192.168.12.1']);
    const stateOk = grade(lab, ls);
    expect(stateOk.objectives.find((o) => o.id === 'r2-static-return')?.met).toBe(true);
    expect(stateOk.objectives.find((o) => o.id === 'reach-pc-a-to-pc-b')?.met).toBe(false);
    expect(stateOk.allMet).toBe(false);

    // The learner pings — only NOW does reach flip to met.
    ls = configure(ls, 'PC-A', ['ping 192.168.2.10']);
    const final = grade(lab, ls);
    expect(final.objectives.find((o) => o.id === 'reach-pc-a-to-pc-b')?.met).toBe(true);
    expect(final.allMet).toBe(true);
  });

  it('un-meets gracefully: shutting an interface flips reachability back to false on the NEXT ping', () => {
    // Fully configured + already-pinged baseline.
    let ls = initLabSession(lab);
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
    ls = configure(ls, 'PC-A', ['ping 192.168.2.10']);
    expect(grade(lab, ls).allMet).toBe(true);

    // Shut R1's WAN interface — reach OBJECTIVE still met (lastPing.ok=true
    // is sticky until the next ping). The next ping (now failing) un-meets it.
    ls = configure(ls, 'R1', ['interface gi0/0', 'shutdown']);
    ls = configure(ls, 'PC-A', ['ping 192.168.2.10']);
    expect(grade(lab, ls).objectives.find((o) => o.id === 'reach-pc-a-to-pc-b')?.met).toBe(false);
  });
});
