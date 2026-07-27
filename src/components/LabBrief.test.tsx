import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LabBrief } from './LabBrief';

const baseProps = {
  title: 'Configure Interface IP & Bring Link Up',
  examLabel: 'CCNA 200-301',
  difficulty: 1,
  estimatedMinutes: 5,
  scenario: 'Configure the interface.\n\nVerify the link.',
  objectives: [{ id: 'ip', text: 'Assign the interface IP' }],
  onStart: vi.fn(),
};

describe('LabBrief free starter path selector', () => {
  it('renders the 10-lab starter path with active lab state and direct try links', () => {
    render(
      <LabBrief
        {...baseProps}
        starterLabs={[
          {
            id: 'ccna-starter-01-interface-ip',
            title: 'Configure Interface IP & Bring Link Up',
            estimatedMinutes: 5,
            difficulty: 1,
            href: '/try?lab=ccna-starter-01-interface-ip',
            isActive: true,
            sequenceNumber: 1,
          },
          {
            id: 'ccna-starter-06-vlan-access-port',
            title: 'VLANs: Segment Two Teams onto Access Ports',
            estimatedMinutes: 8,
            difficulty: 1,
            href: '/try?lab=ccna-starter-06-vlan-access-port',
            isActive: false,
            sequenceNumber: 7,
          },
        ]}
      />,
    );

    expect(screen.getByRole('heading', { name: '10 Free CCNA Starter Labs' })).toBeInTheDocument();
    expect(screen.getByText('Pick any starter lab. No login required.')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();

    const vlanLink = screen.getByRole('link', {
      name: /Starter 7 VLANs: Segment Two Teams onto Access Ports/i,
    });
    expect(vlanLink).toHaveAttribute('href', '/try?lab=ccna-starter-06-vlan-access-port');
  });
});
