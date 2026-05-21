import { useEffect, useState } from 'react';
import { Layout } from '@/components/Layout';
import { Terminal } from '@/components/Terminal';
import { TopologyPanel } from '@/components/TopologyPanel';
import { ObjectivesPanel } from '@/components/ObjectivesPanel';
import { useLabSession } from '@/engine/terminal/useLabSession';
import { lab01InterfaceIp } from '@/labs/ccna/lab-01-interface-ip';

const REGISTER_URL = 'https://certhead.com/register?source=free-lab';

/**
 * Public free-lab route (`/try`). No auth, hardcoded to the single free lab.
 * On completion, shows the upgrade CTA — AFTER completion, never during
 * (CLAUDE.md free-lab design principle). No CertHead API calls.
 */
export function TryMode() {
  const lab = lab01InterfaceIp;
  const session = useLabSession(lab);

  // Latch completion so the CTA persists even if the learner keeps typing.
  const [completed, setCompleted] = useState(false);
  useEffect(() => {
    if (session.allMet) setCompleted(true);
  }, [session.allMet]);

  return (
    <Layout
      examLabel={lab.exam}
      labTitle={lab.title}
      topology={<TopologyPanel deviceLabel={lab.topology.devices[0].id} />}
      objectives={<ObjectivesPanel title="Objectives" objectives={session.objectives} />}
      terminal={
        <div className="relative h-full">
          <Terminal term={session} />
          {completed && <CompletionCard />}
        </div>
      }
    />
  );
}

function CompletionCard() {
  return (
    <div className="absolute inset-x-0 bottom-0 border-t border-terminal-prompt/30 bg-panel-header/95 p-5 backdrop-blur">
      <div className="mx-auto flex max-w-2xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-sans text-sm font-semibold text-terminal-prompt">
            Lab complete — interface is up. 🎉
          </p>
          <p className="mt-1 font-sans text-sm text-terminal-fg/80">
            Next: <span className="text-terminal-fg">Lab 04 — Static Routing</span>{' '}
            <span className="text-terminal-dim">(Pro)</span>, plus 20+ more CCNA labs.
          </p>
        </div>
        <a
          href={REGISTER_URL}
          className="shrink-0 rounded-md bg-terminal-prompt px-4 py-2 text-center font-sans text-sm font-semibold text-[#06231d] transition hover:brightness-110"
        >
          Unlock with CertHead Pro
        </a>
      </div>
    </div>
  );
}
