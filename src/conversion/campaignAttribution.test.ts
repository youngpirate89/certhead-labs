import { describe, expect, it } from 'vitest';

import {
  appendCampaignAttribution,
  parseCampaignAttribution,
} from './campaignAttribution';

const VALID_ATTRIBUTION = {
  utm_source: 'youtube',
  utm_medium: 'organic-social',
  utm_campaign: 'ccna-starter-launch',
  utm_content: 'routing-demo-1',
} as const;

describe('campaign attribution', () => {
  it('accepts only a complete bounded allowlisted campaign', () => {
    expect(parseCampaignAttribution(
      '?utm_source=youtube&utm_medium=organic-social&utm_campaign=ccna-starter-launch&utm_content=routing-demo-1',
    )).toEqual(VALID_ATTRIBUTION);
  });

  it.each([
    ['missing content', '?utm_source=x&utm_medium=paid-social&utm_campaign=launch'],
    ['unknown source', '?utm_source=facebook&utm_medium=paid-social&utm_campaign=launch&utm_content=hero'],
    ['unknown medium', '?utm_source=x&utm_medium=social&utm_campaign=launch&utm_content=hero'],
    ['uppercase slug', '?utm_source=x&utm_medium=paid-social&utm_campaign=Launch&utm_content=hero'],
    ['PII-shaped content', '?utm_source=email&utm_medium=email&utm_campaign=launch&utm_content=learner%40example.com'],
    ['overlong campaign', `?utm_source=partner&utm_medium=referral&utm_campaign=${'a'.repeat(65)}&utm_content=hero`],
    ['duplicate source', '?utm_source=x&utm_source=email&utm_medium=cpc&utm_campaign=launch&utm_content=hero'],
  ])('treats %s as direct attribution', (_case, search) => {
    expect(parseCampaignAttribution(search)).toBeNull();
  });

  it('appends only a complete sanitized campaign while retaining existing parameters', () => {
    expect(appendCampaignAttribution('/try?lab=ccna-starter-02-network-discovery', VALID_ATTRIBUTION)).toBe(
      '/try?lab=ccna-starter-02-network-discovery&utm_source=youtube&utm_medium=organic-social&utm_campaign=ccna-starter-launch&utm_content=routing-demo-1',
    );
    expect(appendCampaignAttribution('/try?lab=ccna-starter-02-network-discovery', null)).toBe(
      '/try?lab=ccna-starter-02-network-discovery',
    );
    expect(appendCampaignAttribution('https://evil.example/try', VALID_ATTRIBUTION)).toBe(
      'https://evil.example/try',
    );
    expect(appendCampaignAttribution('https://certhead.com:8443/try', VALID_ATTRIBUTION)).toBe(
      'https://certhead.com:8443/try',
    );
    expect(appendCampaignAttribution('https://user:pass@certhead.com/try', VALID_ATTRIBUTION)).toBe(
      'https://user:pass@certhead.com/try',
    );
  });
});
