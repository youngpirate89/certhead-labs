import { useEffect, useMemo, useState } from 'react';
import { getLabById } from '@/labs/catalog';
import { PilotMode } from '@/modes/PilotMode';
import type { Lab } from '@/engine/types';

type EmbedState =
  | { status: 'loading' }
  | { status: 'ready'; lab: Lab; session: VerifiedEmbedSession }
  | { status: 'error'; message: string };

interface VerifiedEmbedSession {
  userId: string;
  labId: string;
  tier: 'PRO' | 'ENTERPRISE';
  parentOrigin: string;
  postMessageTargetOrigin: string;
}

interface ApiEnvelope<T> {
  data?: T;
  error?: { message?: string };
}

export function EmbedMode() {
  const embedRequest = useMemo(() => parseEmbedRequest(window.location.pathname, window.location.search), []);
  const [state, setState] = useState<EmbedState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    async function verify() {
      if (!embedRequest.labId) {
        setState({ status: 'error', message: 'Missing lab id.' });
        return;
      }
      if (!embedRequest.token) {
        setState({ status: 'error', message: 'Missing embed token.' });
        return;
      }

      try {
        const session = await verifyEmbedToken(embedRequest.labId, embedRequest.token);
        if (session.labId !== embedRequest.labId) {
          throw new Error('Labs embed token does not match the requested lab.');
        }
        if (session.postMessageTargetOrigin === '*') {
          throw new Error('Labs embed postMessage target origin is not allowed.');
        }

        const lab = getLabById(session.labId);
        if (!lab) {
          throw new Error('This lab is not available in the static catalog.');
        }

        if (!cancelled) setState({ status: 'ready', lab, session });
      } catch (err) {
        if (!cancelled) setState({ status: 'error', message: errorMessage(err) });
      }
    }

    verify();
    return () => {
      cancelled = true;
    };
  }, [embedRequest]);

  if (state.status === 'loading') {
    return <EmbedShell message="Verifying secure lab session…" />;
  }

  if (state.status === 'error') {
    return <EmbedShell message={state.message} error />;
  }

  return (
    <PilotMode
      lab={state.lab}
      onCompleted={() => {
        window.parent.postMessage(
          {
            type: 'lab.completed',
            labId: state.session.labId,
            userId: state.session.userId,
          },
          state.session.postMessageTargetOrigin,
        );
      }}
    />
  );
}

function parseEmbedRequest(pathname: string, search: string): { labId: string | null; token: string | null } {
  const match = pathname.match(/^\/embed\/([^/]+)\/?$/);
  const labId = match?.[1] ? decodeURIComponent(match[1]) : null;
  const token = new URLSearchParams(search).get('token');
  return { labId, token };
}

async function verifyEmbedToken(labId: string, token: string): Promise<VerifiedEmbedSession> {
  const res = await fetch(`${apiBaseUrl()}/labs/embed/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ labId, token }),
  });
  const body = (await res.json().catch(() => ({}))) as ApiEnvelope<VerifiedEmbedSession>;

  if (!res.ok || !body.data) {
    throw new Error(body.error?.message ?? 'Labs embed token is invalid or expired.');
  }

  return body.data;
}

function apiBaseUrl(): string {
  return (import.meta.env.VITE_CERTHEAD_API_BASE_URL ?? 'https://certhead.com/api').replace(/\/$/, '');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Could not start this lab.';
}

function EmbedShell({ message, error = false }: { message: string; error?: boolean }) {
  return (
    <main className="grid min-h-screen place-items-center bg-bg text-terminal-fg">
      <section className="max-w-md rounded-lg border border-panel-border bg-panel p-6 shadow-xl">
        <p className="mb-2 font-sans text-xs font-semibold uppercase tracking-wide text-terminal-dim">
          Secure lab session
        </p>
        <p role={error ? 'alert' : undefined} className="font-sans text-sm text-terminal-fg">
          {message}
        </p>
      </section>
    </main>
  );
}
