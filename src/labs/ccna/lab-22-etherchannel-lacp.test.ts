import { describe, it, expect } from 'vitest';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { grade } from '@/engine/grading';
import { lab22EtherchannelLacp as lab } from './lab-22-etherchannel-lacp';

function runOn(ls: LabSession, id: string, lines: string[]): LabSession {
  let cur: LabSession = { ...ls, activeDeviceId: id };
  for (const line of lines) cur = applyToActive(cur, line).session;
  return cur;
}

function configureSw1(ls: LabSession): LabSession {
  return runOn(ls, 'SW1', [
    'enable',
    'configure terminal',
    'interface fa0/23',
    'channel-group 1 mode active',
    'interface fa0/24',
    'channel-group 1 mode active',
    'interface port-channel 1',
    'switchport mode trunk',
    'end',
  ]);
}

function configureSw2(ls: LabSession): LabSession {
  return runOn(ls, 'SW2', [
    'enable',
    'configure terminal',
    'interface fa0/23',
    'channel-group 1 mode active',
    'interface fa0/24',
    'channel-group 1 mode active',
    'interface port-channel 1',
    'switchport mode trunk',
    'end',
  ]);
}

describe('lab-22-etherchannel-lacp — starting state', () => {
  it('topology shape: 2 switches, 2 parallel links, isFree:false', () => {
    expect(lab.topology.devices).toHaveLength(2);
    expect(lab.topology.links).toHaveLength(2);
    expect(lab.isFree).toBe(false);
    expect(lab.topology.devices.map((d) => d.kind)).toEqual(['switch', 'switch']);
  });

  it('starts with no channel-groups, no Port-channel interfaces, and all objectives unmet', () => {
    const ls = initLabSession(lab);
    for (const id of ['SW1', 'SW2'] as const) {
      const sw = ls.devices[id];
      if (sw.kind !== 'switch') throw new Error('shape');
      expect(sw.device.portChannels.size).toBe(0);
      expect(sw.device.switchports['Fa0/23'].channelGroup).toBeNull();
      expect(sw.device.switchports['Fa0/24'].channelGroup).toBeNull();
    }
    const g = grade(lab, ls);
    expect(g.allMet).toBe(false);
    for (const o of g.objectives) expect(o.met).toBe(false);
  });
});

describe('lab-22-etherchannel-lacp — engine behavior', () => {
  it('passive/passive LACP does not bundle, but active/passive does', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'SW1', [
      'enable',
      'configure terminal',
      'interface fa0/23',
      'channel-group 1 mode passive',
      'end',
    ]);
    ls = runOn(ls, 'SW2', [
      'enable',
      'configure terminal',
      'interface fa0/23',
      'channel-group 1 mode passive',
      'end',
    ]);
    let sw1 = ls.devices.SW1;
    if (sw1.kind !== 'switch') throw new Error('shape');
    expect(sw1.device.portChannels.get(1)?.bundled).toBe(false);

    ls = runOn(ls, 'SW2', ['configure terminal', 'interface fa0/23', 'channel-group 1 mode active', 'end']);
    sw1 = ls.devices.SW1;
    const sw2 = ls.devices.SW2;
    if (sw1.kind !== 'switch' || sw2.kind !== 'switch') throw new Error('shape');
    expect(sw1.device.switchports['Fa0/23'].bundled).toBe(true);
    expect(sw2.device.switchports['Fa0/23'].bundled).toBe(true);
    expect(sw1.device.portChannels.get(1)?.bundled).toBe(true);
    expect(sw2.device.portChannels.get(1)?.bundled).toBe(true);
  });

  it('show etherchannel summary stamps verify state only when run after bundle forms', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'SW1', ['enable', 'show etherchannel summary']);
    let sw1 = ls.devices.SW1;
    if (sw1.kind !== 'switch') throw new Error('shape');
    expect(sw1.lastShowEtherchannelSummary?.bundledGroups).toEqual([]);

    ls = configureSw2(configureSw1(ls));
    let g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'etherchannel-verified')?.met).toBe(false);

    ls = runOn(ls, 'SW1', ['show etherchannel summary']);
    sw1 = ls.devices.SW1;
    if (sw1.kind !== 'switch') throw new Error('shape');
    expect(sw1.lastShowEtherchannelSummary?.bundledGroups).toEqual([1]);
    g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'etherchannel-verified')?.met).toBe(true);
  });
});

describe('lab-22-etherchannel-lacp — happy path', () => {
  it('full walkthrough completes all objectives', () => {
    let ls = initLabSession(lab);
    ls = configureSw1(ls);
    ls = configureSw2(ls);
    ls = runOn(ls, 'SW2', ['show etherchannel summary']);

    const g = grade(lab, ls);
    expect(g.allMet).toBe(true);
    expect(g.objectives.map((o) => [o.id, o.met])).toEqual([
      ['members-added', true],
      ['portchannel-trunk', true],
      ['etherchannel-verified', true],
    ]);
  });

  it('configured bundle without Port-channel trunk config does not complete the trunk objective', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'SW1', [
      'enable',
      'configure terminal',
      'interface fa0/23',
      'channel-group 1 mode active',
      'interface fa0/24',
      'channel-group 1 mode active',
      'end',
    ]);
    ls = runOn(ls, 'SW2', [
      'enable',
      'configure terminal',
      'interface fa0/23',
      'channel-group 1 mode active',
      'interface fa0/24',
      'channel-group 1 mode active',
      'end',
    ]);
    ls = runOn(ls, 'SW1', ['show etherchannel summary']);

    const g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'members-added')?.met).toBe(true);
    expect(g.objectives.find((o) => o.id === 'portchannel-trunk')?.met).toBe(false);
    expect(g.allMet).toBe(false);
  });
});
