import { describe, it, expect } from 'vitest';
import { routerAdapter } from './router';

const SPEC = {
  id: 'R1',
  kind: 'router' as const,
  platform: 'ISR4321',
  interfaces: ['Gi0/0', 'Gi0/1'],
};

describe('routerAdapter', () => {
  it('exposes kind = router', () => {
    expect(routerAdapter.kind).toBe('router');
  });

  it('buildDevice produces a fresh router session at the user prompt', () => {
    const s = routerAdapter.buildDevice(SPEC);
    expect(s.kind).toBe('router');
    expect(s.mode).toBe('user');
    expect(s.history).toEqual([]);
    expect(s.device.id).toBe('R1');
    expect(Object.keys(s.device.interfaces)).toEqual(['Gi0/0', 'Gi0/1']);
    expect(routerAdapter.prompt(s)).toBe('R1>');
  });

  it('applyCommand routes through the IOS engine and returns a new session', () => {
    const s0 = routerAdapter.buildDevice(SPEC);
    const { session: s1 } = routerAdapter.applyCommand(s0, 'enable');
    expect(s1.mode).toBe('priv');
    expect(routerAdapter.prompt(s1)).toBe('R1#');
    // Original session is not mutated.
    expect(s0.mode).toBe('user');
  });

  it('grammarFor returns the tree matching the session current mode', () => {
    const s0 = routerAdapter.buildDevice(SPEC);
    const userTree = routerAdapter.grammarFor(s0);
    expect(userTree.children).toBeDefined();
    expect(Object.keys(userTree.children!)).toContain('enable');

    const priv = routerAdapter.applyCommand(s0, 'enable').session;
    const privTree = routerAdapter.grammarFor(priv);
    expect(Object.keys(privTree.children!)).toContain('configure');
  });

  it('toTopologyView returns the agnostic view shape (id/kind/hostname/interfaces[ip,status])', () => {
    const s0 = routerAdapter.buildDevice(SPEC);
    const view = routerAdapter.toTopologyView(s0);
    expect(view).toEqual({
      id: 'R1',
      kind: 'router',
      hostname: 'R1',
      platform: 'ISR4321',
      interfaces: [
        { id: 'Gi0/0', name: 'GigabitEthernet0/0', status: 'admin-down', ip: null, mask: null },
        { id: 'Gi0/1', name: 'GigabitEthernet0/1', status: 'admin-down', ip: null, mask: null },
      ],
    });
  });

  it('toTopologyView reflects live interface state', () => {
    const s = ['enable', 'configure terminal', 'interface gi0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown']
      .reduce((acc, line) => routerAdapter.applyCommand(acc, line).session, routerAdapter.buildDevice(SPEC));
    const view = routerAdapter.toTopologyView(s);
    expect(view.interfaces[0]).toEqual({
      id: 'Gi0/0',
      name: 'GigabitEthernet0/0',
      status: 'up',
      ip: '192.168.1.1',
      mask: '255.255.255.0',
    });
    // Gi0/1 untouched.
    expect(view.interfaces[1].status).toBe('admin-down');
  });
});
