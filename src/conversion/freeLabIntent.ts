import {
  sanitizeOptionalCampaignAttribution,
  type CampaignAttribution,
} from './campaignAttribution';

const MAIN_APP_ORIGIN = 'https://certhead.com';
const FREE_LAB_SOURCE = 'free-lab';

export function buildFreeLabRegisterUrl(
  labId: string,
  campaign?: CampaignAttribution | null,
): string {
  const upgradeParams = new URLSearchParams({
    source: FREE_LAB_SOURCE,
    redirect: '/labs',
  });
  const registerParams = new URLSearchParams({
    source: FREE_LAB_SOURCE,
    lab: labId,
    redirect: `/upgrade?${upgradeParams.toString()}`,
  });
  const sanitizedCampaign = sanitizeOptionalCampaignAttribution(campaign);
  if (sanitizedCampaign) {
    registerParams.set('utm_source', sanitizedCampaign.utm_source);
    registerParams.set('utm_medium', sanitizedCampaign.utm_medium);
    registerParams.set('utm_campaign', sanitizedCampaign.utm_campaign);
    registerParams.set('utm_content', sanitizedCampaign.utm_content);
  }

  return `${MAIN_APP_ORIGIN}/register?${registerParams.toString()}`;
}