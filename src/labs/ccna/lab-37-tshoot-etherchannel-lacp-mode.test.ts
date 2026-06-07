import { describe, expect, it } from 'vitest';
import { grade } from '@/engine/grading';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { lab37TshootEtherchannelLacpMode } from './lab-37-tshoot-etherchannel-lacp-mode';

function runOn(ls: LabSession, id: string, lines: readonly string[]): LabSession {
  let cur: LabSession = { ...ls, activeDeviceId: id };
  for (const line of lines) cur = applyToActive(cur, line).session;
  return cur;
}

function outputOn(ls: LabSession, id: string, command: string): string {
  const { output } = applyToActive({ ...ls, activeDeviceId: id }, command);
  return output.map((o) => o.text).join('\n');
}

function applySolution(ls: LabSession): LabSession {
  let cur = runOn(ls, 'SW1', ['enable', 'show etherchannel summary']);
  cur = runOn(cur, 'SW2', [
    'enable',
    'show etherchannel summary',
    'configure terminal',
    'interface fa0/23',
    'no channel-group',
    'channel-group 1 mode active',
    'interface fa0/24',
    'no channel-group',
    'channel-group 1 mode active',
    'interface port-channel 1',
    'switchport mode trunk',
    'end',
    'show etherchannel summary',
  ]);
  return cur;
}

describe('Lab 37 - Troubleshoot EtherChannel LACP mode mismatch', () => {
  it('starts with matching channel-group numbers but an unbundled mode mismatch', () => {
    const ls = initLabSession(lab37TshootEtherchannelLacpMode);
    const sw1 = ls.devices.SW1;
    const sw2 = ls.devices.SW2;
    if (sw1.kind !== 'switch' || sw2.kind !== 'switch') throw new Error('shape');

    for (const iface of ['Fa0/23', 'Fa0/24'] as const) {
      expect(sw1.device.switchports[iface]).toMatchObject({ channelGroup: 1, lacpMode: 'active', bundled: false });
      expect(sw2.device.switchports[iface]).toMatchObject({ channelGroup: 1, lacpMode: 'on', bundled: false });
    }
    expect(sw1.device.portChannels.get(1)?.bundled).toBe(false);
    expect(sw2.device.portChannels.get(1)?.bundled).toBe(false);
    expect(outputOn(ls, 'SW1', 'show etherchannel summary')).toMatch(/Po1\(SD\).*Fa0\/23\(I\).*Fa0\/24\(I\)/);
    expect(grade(lab37TshootEtherchannelLacpMode, ls).allMet).toBe(false);
  });

  it('requires diagnosis, repairing SW2 to LACP active, and post-fix verification', () => {
    const ls = applySolution(initLabSession(lab37TshootEtherchannelLacpMode));
    const sw1 = ls.devices.SW1;
    const sw2 = ls.devices.SW2;
    if (sw1.kind !== 'switch' || sw2.kind !== 'switch') throw new Error('shape');

    for (const sw of [sw1, sw2]) {
      for (const iface of ['Fa0/23', 'Fa0/24'] as const) {
        expect(sw.device.switchports[iface]).toMatchObject({ channelGroup: 1, lacpMode: 'active', bundled: true });
      }
      expect(sw.device.portChannels.get(1)).toMatchObject({ mode: 'trunk', bundled: true });
    }
    expect(outputOn(ls, 'SW2', 'show etherchannel summary')).toMatch(/Po1\(SU\).*Fa0\/23\(P\).*Fa0\/24\(P\)/);

    const g = grade(lab37TshootEtherchannelLacpMode, ls);
    expect(g.allMet).toBe(true);
    expect(g.objectives.map((o) => [o.id, o.met])).toEqual([
      ['diagnose-unbundled-channel', true],
      ['repair-sw2-lacp-mode', true],
      ['verify-portchannel-bundled', true],
    ]);
  });
});
