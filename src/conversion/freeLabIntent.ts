const MAIN_APP_ORIGIN = 'https://certhead.com';
const FREE_LAB_SOURCE = 'free-lab';

export function buildFreeLabRegisterUrl(labId: string): string {
  const upgradeParams = new URLSearchParams({
    source: FREE_LAB_SOURCE,
    redirect: '/labs',
  });
  const registerParams = new URLSearchParams({
    source: FREE_LAB_SOURCE,
    lab: labId,
    redirect: `/upgrade?${upgradeParams.toString()}`,
  });

  return `${MAIN_APP_ORIGIN}/register?${registerParams.toString()}`;
}