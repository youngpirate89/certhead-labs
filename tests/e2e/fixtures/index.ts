import { batchDOspfLabs } from './batch-d';
import { batchELabs22To28 } from './batch-e';
import type { LabSmokeCase } from './batch-d';

export type LabSmokeBatch = {
  id: string;
  name: string;
  labs: LabSmokeCase[];
};

const batches: Record<string, LabSmokeBatch> = {
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
};

export function getSelectedLabSmokeBatch(batchId = process.env.LAB_SMOKE_BATCH ?? 'd'): LabSmokeBatch {
  const normalized = batchId.toLowerCase();
  const batch = batches[normalized];
  if (!batch) {
    throw new Error(`Unknown lab smoke batch: ${batchId}. Available batches: ${Object.keys(batches).join(', ')}`);
  }
  return batch;
}
