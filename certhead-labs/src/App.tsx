import { useCallback } from 'react';
import { Layout } from '@/components/Layout';
import { Terminal } from '@/components/Terminal';
import { TopologyPanel } from '@/components/TopologyPanel';
import { ObjectivesPanel, type ObjectiveView } from '@/components/ObjectivesPanel';
import { useTerminal, type ExecResult } from '@/engine/terminal/useTerminal';
import { tokenize, resolve, type CommandNode } from '@/engine/parser';

/**
 * FOUNDATION SCAFFOLD — not the Cisco IOS adapter.
 *
 * A minimal generic command tree that exercises the parser primitive
 * (prefix abbreviation, ambiguity, argument capture) end-to-end through the
 * terminal. The IOS adapter, mode stack, device state machine, grading engine,
 * and the free lab definition are Weekend 3-4 work and replace this stub.
 */
const foundationTree: CommandNode = {
  children: {
    help: {
      run: () => [
        'Available commands (foundation scaffold):',
        '  help            Show this help',
        '  version         Show engine version',
        '  echo <text>     Print text back',
        '  exit            Placeholder',
        '  clear           Clear the screen',
        '',
        'Try abbreviations (e.g. "ver"), or "e" to see an ambiguous match.',
      ],
    },
    version: { run: () => 'CertHead Labs engine — foundation build (parser primitive online)' },
    echo: {
      argument: { name: 'text', node: { run: ({ args }) => args.text } },
    },
    exit: { run: () => 'exit: nothing to leave yet — this is the foundation shell.' },
    clear: { run: () => '' }, // handled as a clear directive in execute()
  },
};

const placeholderObjectives: ObjectiveView[] = [
  { id: 'scaffold', text: 'Engine foundation scaffolded (Weekend 1-2)', met: true },
  { id: 'parser', text: 'Parser primitive: tokenizer + prefix resolution', met: true },
  { id: 'terminal', text: 'Terminal primitive: input, history, prompt', met: true },
  { id: 'ios', text: 'Cisco IOS adapter + free lab (Weekend 3-4)', met: false },
];

export default function App() {
  const execute = useCallback((raw: string): ExecResult => {
    const { tokens, raw: trimmed } = tokenize(raw);
    if (tokens.length === 0) return { lines: [] };

    const result = resolve(tokens, foundationTree);
    switch (result.kind) {
      case 'complete': {
        if (result.command[0] === 'clear') return { lines: [], clear: true };
        const out = result.run({ args: result.args, command: result.command, raw: trimmed });
        const lines = Array.isArray(out) ? out : [out];
        return { lines: lines.map((text) => ({ kind: 'output' as const, text })) };
      }
      case 'incomplete':
        return { lines: [{ kind: 'error', text: '% Incomplete command.' }] };
      case 'ambiguous':
        return {
          lines: [{ kind: 'error', text: `% Ambiguous command: "${result.token}"` }],
        };
      case 'invalid':
        return {
          lines: [{ kind: 'error', text: `% Invalid input detected at "${result.token}".` }],
        };
      case 'empty':
        return { lines: [] };
    }
  }, []);

  const term = useTerminal({
    execute,
    prompt: 'labs>',
    banner: [
      { kind: 'system', text: 'CertHead Labs — engine foundation' },
      { kind: 'system', text: 'Type "help" to begin. This is the Weekend 1-2 scaffold.' },
      { kind: 'system', text: '' },
    ],
  });

  return (
    <Layout
      examLabel="CCNA 200-301"
      labTitle="Foundation Scaffold"
      topology={<TopologyPanel deviceLabel="R1" />}
      objectives={<ObjectivesPanel title="Build Progress" objectives={placeholderObjectives} />}
      terminal={<Terminal term={term} />}
    />
  );
}
