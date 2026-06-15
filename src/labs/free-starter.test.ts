import { describe, expect, it } from 'vitest';
import { grade } from '@/engine/grading';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { getCatalogLabs, getLabById } from './catalog';
import {
  FREE_CCNA_STARTER_LAB_IDS,
  FREE_CCNA_STARTER_SOURCE_LAB_IDS,
  getFreeCcnaStarterLabs,
  getFreeCcnaStarterLabById,
} from './free-starter';

describe('free CCNA starter labs', () => {
  it('exposes exactly ten public starter labs in learner order with dedicated public ids', () => {
    expect(FREE_CCNA_STARTER_LAB_IDS).toEqual([
      'ccna-starter-01-interface-ip',
      'ccna-starter-02-network-discovery',
      'ccna-starter-03-subnetting-routed-interfaces',
      'ccna-starter-04-static-route',
      'ccna-starter-05-ospf-neighbor',
      'ccna-starter-06-vlan-access-port',
      'ccna-starter-07-vlan-trunk',
      'ccna-starter-08-intervlan-routing',
      'ccna-starter-09-dhcp-server',
      'ccna-starter-10-default-route',
    ]);

    const labs = getFreeCcnaStarterLabs();
    expect(labs).toHaveLength(10);
    expect(labs.map((lab) => lab.id)).toEqual(FREE_CCNA_STARTER_LAB_IDS);
    expect(labs.every((lab) => lab.isFree)).toBe(true);
    expect(labs.every((lab) => lab.id.startsWith('ccna-starter-'))).toBe(true);
  });

  it('does not expose paid catalog lab ids through the public starter resolver', () => {
    expect(getFreeCcnaStarterLabById('ccna-starter-01-interface-ip')?.title).toContain('Starter 1');
    expect(getFreeCcnaStarterLabById('ccna-l01-interface-ip')).toBeNull();
    expect(getFreeCcnaStarterLabById('ccna-lab07-vlan-access-ports')).toBeNull();
    expect(getFreeCcnaStarterLabById('ccna-lab11-nat-pat')).toBeNull();
    expect(getFreeCcnaStarterLabById('definitely-not-real')).toBeNull();
  });

  it('keeps source catalog labs as Pro-only even when they inspire starter labs', () => {
    const catalogLabs = getCatalogLabs();
    expect(catalogLabs.filter((lab) => lab.isFree)).toHaveLength(0);
    expect(FREE_CCNA_STARTER_SOURCE_LAB_IDS).toHaveLength(10);

    for (const sourceId of FREE_CCNA_STARTER_SOURCE_LAB_IDS) {
      expect(getLabById(sourceId)?.isFree).toBe(false);
    }
  });

  it('keeps each starter scenario distinct from the source paid lab scenario', () => {
    const starterLabs = getFreeCcnaStarterLabs();

    for (let index = 0; index < starterLabs.length; index += 1) {
      const starterLab = starterLabs[index];
      const sourceLab = getLabById(FREE_CCNA_STARTER_SOURCE_LAB_IDS[index]);
      expect(sourceLab).not.toBeNull();
      expect(starterLab.id).not.toBe(sourceLab?.id);
      expect(starterLab.title).not.toBe(sourceLab?.title);
      expect(starterLab.scenario).not.toBe(sourceLab?.scenario);
    }
  });

  it.each(getFreeCcnaStarterLabs())('published starter solution for %s completes all objectives', (lab) => {
    let session: LabSession = initLabSession(lab);
    for (const step of lab.solution!.steps) {
      session = { ...session, activeDeviceId: step.device };
      for (const command of step.commands) session = applyToActive(session, command).session;
    }

    const result = grade(lab, session);
    expect(result.objectives.map((objective) => [objective.id, objective.met])).toEqual(
      result.objectives.map((objective) => [objective.id, true]),
    );
    expect(result.allMet).toBe(true);
  });
});
