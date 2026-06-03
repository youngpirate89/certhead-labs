import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EmbedMode } from '@/modes/EmbedMode';

vi.mock('@/modes/PilotMode', () => ({
  PilotMode: ({ lab, onCompleted }: { lab: { id: string; title: string }; onCompleted?: () => void }) => (
    <div data-testid="embedded-lab">
      {lab.id}
      <button type="button" onClick={onCompleted}>
        Complete
      </button>
    </div>
  ),
}));

const mockFetch = vi.fn();

function renderAt(path: string) {
  window.history.pushState({}, '', path);
  return render(<EmbedMode />);
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('EmbedMode', () => {
  it('verifies the explicit /embed/:labId token with the CertHead API before loading a catalog lab', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          userId: 'user-pro-1',
          labId: 'ccna-lab30-vlan-dhcp-ticket',
          tier: 'PRO',
          parentOrigin: 'https://certhead.com',
          postMessageTargetOrigin: 'https://certhead.com',
        },
      }),
    });

    renderAt('/embed/ccna-lab30-vlan-dhcp-ticket?token=embed.jwt.with.length');

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        'https://certhead.com/api/labs/embed/verify',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            labId: 'ccna-lab30-vlan-dhcp-ticket',
            token: 'embed.jwt.with.length',
          }),
        }),
      );
    });
    expect(await screen.findByTestId('embedded-lab')).toHaveTextContent(
      'ccna-lab30-vlan-dhcp-ticket',
    );
  });

  it('fails closed when the token is missing and never falls back to /try or a default lab', async () => {
    renderAt('/embed/ccna-lab30-vlan-dhcp-ticket');

    expect(await screen.findByRole('alert')).toHaveTextContent(/missing embed token/i);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(screen.queryByTestId('embedded-lab')).toBeNull();
  });

  it('fails closed when the API rejects the token', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'Labs embed token is invalid or expired' } }),
    });

    renderAt('/embed/ccna-lab30-vlan-dhcp-ticket?token=expired.jwt.with.length');

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid or expired/i);
    expect(screen.queryByTestId('embedded-lab')).toBeNull();
  });

  it('fails closed when the verified lab is not in the static catalog', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          userId: 'user-pro-1',
          labId: 'unknown-private-lab',
          tier: 'PRO',
          parentOrigin: 'https://certhead.com',
          postMessageTargetOrigin: 'https://certhead.com',
        },
      }),
    });

    renderAt('/embed/unknown-private-lab?token=embed.jwt.with.length');

    expect(await screen.findByRole('alert')).toHaveTextContent(/lab is not available/i);
    expect(screen.queryByTestId('embedded-lab')).toBeNull();
  });

  it('posts completion to the verified parent origin and never uses a wildcard target', async () => {
    const postMessage = vi.fn();
    vi.stubGlobal('parent', { postMessage });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          userId: 'user-pro-1',
          labId: 'ccna-lab30-vlan-dhcp-ticket',
          tier: 'PRO',
          parentOrigin: 'https://certhead.com',
          postMessageTargetOrigin: 'https://certhead.com',
        },
      }),
    });

    renderAt('/embed/ccna-lab30-vlan-dhcp-ticket?token=embed.jwt.with.length');
    (await screen.findByRole('button', { name: /complete/i })).click();

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'lab.completed',
        labId: 'ccna-lab30-vlan-dhcp-ticket',
        userId: 'user-pro-1',
      },
      'https://certhead.com',
    );
  });
});
