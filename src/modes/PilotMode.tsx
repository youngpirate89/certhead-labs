import { Layout } from '@/components/Layout';
import { Terminal } from '@/components/Terminal';
import { TopologyPanel } from '@/components/TopologyPanel';
import { ObjectivesPanel } from '@/components/ObjectivesPanel';
import { useLabSession } from '@/engine/terminal/useLabSession';
import type { Lab } from '@/engine/types';

/**
 * Minimal pilot/dev view for a lab that isn't the deployed free lab.
 *
 * No analytics, no marketing CTA, no pre-terminal brief — just the lab UI
 * (topology + objectives + terminal). Used for the 3a multi-device pilot lab
 * accessed via the URL param `?pilot=2-router`. Public users never land here.
 */
export function PilotMode({ lab }: { lab: Lab }) {
  const session = useLabSession(lab);

  return (
    <Layout
      examLabel={lab.exam}
      labTitle={lab.title}
      topology={
        <TopologyPanel
          devices={session.devices}
          activeDeviceId={session.activeDeviceId}
          activePrompt={session.prompt}
          onSelectDevice={session.setActiveDevice}
          links={lab.topology.links}
        />
      }
      objectives={
        <ObjectivesPanel
          title="Objectives"
          objectives={session.objectives}
          onReset={session.reset}
        />
      }
      terminal={<Terminal term={session} />}
    />
  );
}
