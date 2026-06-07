export interface DevLabSelection {
  readonly pilotSlug: string | null;
  readonly labId: string | null;
}

export function resolveDevLabSelection(search: string, isDev: boolean): DevLabSelection | null {
  if (!isDev) return null;

  const params = new URLSearchParams(search);
  const pilotSlug = params.get('pilot');
  const labId = params.get('lab');

  if (!pilotSlug && !labId) return null;
  return { pilotSlug, labId };
}
