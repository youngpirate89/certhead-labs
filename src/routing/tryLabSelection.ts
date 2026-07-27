import { getFreeCcnaStarterLabById } from '@/labs/free-starter';

export const DEFAULT_FREE_CCNA_STARTER_LAB_ID = 'ccna-starter-01-interface-ip';

export function resolveTryModeLabId(search: string): string {
  const params = new URLSearchParams(search);
  const requested = params.get('lab')?.trim() ?? '';
  if (requested && getFreeCcnaStarterLabById(requested)) return requested;
  return DEFAULT_FREE_CCNA_STARTER_LAB_ID;
}
