import { batchALabs01To06 } from './batch-a';
import { batchBLabs07To11 } from './batch-b';
import { batchCLabs12To17 } from './batch-c';
import { batchDOspfLabs } from './batch-d';
import { batchELabs22To28 } from './batch-e';
import { batchFLabs29To30AndTickets } from './batch-f';
import { batchGTicketLabs } from './batch-g';
import { batchHTicketLabs } from './batch-h';
import { batchITicketLabs } from './batch-i';
import { batchJTicketLabs } from './batch-j';
import type { LabSmokeCase } from './batch-d';

export type LabSmokeBatch = {
  id: string;
  name: string;
  labs: LabSmokeCase[];
};

const batches: Record<string, LabSmokeBatch> = {
  a: {
    id: 'a',
    name: 'Batch A labs 01–06',
    labs: batchALabs01To06,
  },
  b: {
    id: 'b',
    name: 'Batch B labs 07–11',
    labs: batchBLabs07To11,
  },
  c: {
    id: 'c',
    name: 'Batch C labs 12–17',
    labs: batchCLabs12To17,
  },
  d: {
    id: 'd',
    name: 'Batch D OSPF labs',
    labs: batchDOspfLabs,
  },
  e: {
    id: 'e',
    name: 'Batch E labs 22–28',
    labs: batchELabs22To28,
  },
  f: {
    id: 'f',
    name: 'Batch F labs 29–30 and ticket scenarios',
    labs: batchFLabs29To30AndTickets,
  },
  g: {
    id: 'g',
    name: 'Batch G ticket scenarios',
    labs: batchGTicketLabs,
  },
  h: {
    id: 'h',
    name: 'Batch H ticket scenarios',
    labs: batchHTicketLabs,
  },
  i: {
    id: 'i',
    name: 'Batch I ticket scenarios',
    labs: batchITicketLabs,
  },
  j: {
    id: 'j',
    name: 'Batch J ticket scenarios',
    labs: batchJTicketLabs,
  },
};

export function getAllLabSmokeBatches(): LabSmokeBatch[] {
  return Object.values(batches);
}

export function getSelectedLabSmokeBatch(batchId = process.env.LAB_SMOKE_BATCH ?? 'd'): LabSmokeBatch {
  const normalized = batchId.toLowerCase();
  const batch = batches[normalized];
  if (!batch) {
    throw new Error(`Unknown lab smoke batch: ${batchId}. Available batches: ${Object.keys(batches).join(', ')}`);
  }

  const selectedLabId = process.env.LAB_SMOKE_LAB;
  if (!selectedLabId) return batch;

  const selectedLab = Object.values(batches)
    .flatMap((candidateBatch) => candidateBatch.labs)
    .find((lab) => lab.id === selectedLabId);
  if (!selectedLab) {
    throw new Error(`Unknown lab smoke case: ${selectedLabId}`);
  }

  return {
    id: `${batch.id}:${selectedLab.id}`,
    name: `Single lab ${selectedLab.id}`,
    labs: [selectedLab],
  };
}
