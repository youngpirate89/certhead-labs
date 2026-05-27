import { describe, it, expect } from 'vitest';
import { applyCommand, contextHelp, tabComplete } from './interpret';
import { createSession, buildDevice, prompt, routingTable, type Session } from './state';
import { grade } from '@/engine/grading';
import { lab01InterfaceIp } from '@/labs/ccna/lab-01-interface-ip';

function fresh(): Session {
  return createSession(buildDevice({ id: 'R1', platform: 'ISR4321', interfaces: ['Gi0/0', 'Gi0/1'] }));
}

/** Run a sequence of lines, threading the session. */
function run(start: Session, lines: string[]): Session {
  return lines.reduce((s, line) => applyCommand(s, line).session, start);
}

describe('IOS interpreter — mode stack', () => {
  it('moves user -> priv on enable', () => {
    const { session } = applyCommand(fresh(), 'enable');
    expect(session.mode).toBe('priv');
    expect(prompt(session)).toBe('R1#');
  });

  it('enters config then config-if and back out', () => {
    const s = run(fresh(), ['enable', 'configure terminal', 'interface gi0/0']);
    expect(s.mode).toBe('config-if');
    expect(s.currentInterface).toBe('Gi0/0');
    expect(prompt(s)).toBe('R1(config-if)#');

    const exited = applyCommand(s, 'exit').session;
    expect(exited.mode).toBe('config');
    expect(exited.currentInterface).toBeNull();

    expect(applyCommand(s, 'end').session.mode).toBe('priv');
  });

  it('accepts abbreviated keywords (conf t, int gi0/0, no shut)', () => {
    const s = run(fresh(), ['en', 'conf t', 'int gi0/0', 'no shut']);
    expect(s.mode).toBe('config-if');
    expect(s.device.interfaces['Gi0/0'].adminUp).toBe(true);
  });

  it('hops directly between interfaces from config-if without an intermediate exit', () => {
    // Real IOS lets you type `interface <new>` from inside another interface's
    // config-if context — no `exit` back to (config)# required. Configure Gi0/0,
    // then hop straight to Gi0/1 and configure it too.
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
      // Direct hop — no `exit` between the two interface lines.
      'interface gi0/1',
    ]);
    expect(s.mode).toBe('config-if');
    expect(s.currentInterface).toBe('Gi0/1');
    expect(prompt(s)).toBe('R1(config-if)#');
    // Commands after the hop must apply to the new interface, not the old one.
    const after = applyCommand(s, 'ip address 192.168.2.1 255.255.255.0').session;
    expect(after.device.interfaces['Gi0/1'].ip).toBe('192.168.2.1');
    expect(after.device.interfaces['Gi0/0'].ip).toBe('192.168.1.1');
  });

  it('after an interface hop, `exit` lands at (config)# — engine has no nested interface stack', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'interface gi0/1',
      'exit',
    ]);
    expect(s.mode).toBe('config');
    expect(s.currentInterface).toBeNull();
    expect(prompt(s)).toBe('R1(config)#');
  });
});

describe('IOS interpreter — interface configuration', () => {
  it('assigns IP and mask', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface GigabitEthernet0/0',
      'ip address 192.168.1.1 255.255.255.0',
    ]);
    expect(s.device.interfaces['Gi0/0'].ip).toBe('192.168.1.1');
    expect(s.device.interfaces['Gi0/0'].mask).toBe('255.255.255.0');
  });

  it('emits a link-up message on no shutdown only when state changes', () => {
    const s = run(fresh(), ['enable', 'configure terminal', 'interface gi0/0']);
    const first = applyCommand(s, 'no shutdown');
    expect(first.output.some((o) => /changed state to up/.test(o.text))).toBe(true);
    const second = applyCommand(first.session, 'no shutdown');
    expect(second.output).toHaveLength(0);
  });

  it('clears IP with no ip address and brings down with shutdown', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 10.0.0.1 255.0.0.0',
      'no shutdown',
      'shutdown',
      'no ip address',
    ]);
    expect(s.device.interfaces['Gi0/0'].adminUp).toBe(false);
    expect(s.device.interfaces['Gi0/0'].ip).toBeNull();
  });

  it('rejects an invalid mask and a bad interface', () => {
    const cfg = run(fresh(), ['enable', 'configure terminal', 'interface gi0/0']);
    expect(applyCommand(cfg, 'ip address 192.168.1.1 255.255.0.255').output[0].kind).toBe('error');

    const bad = applyCommand(run(fresh(), ['enable', 'configure terminal']), 'interface gi9/9');
    expect(bad.output[0].kind).toBe('error');
    expect(bad.session.mode).toBe('config'); // did not enter
  });
});

describe('IOS interpreter — resolution errors and show', () => {
  it('reports ambiguous, invalid, and incomplete', () => {
    const priv = applyCommand(fresh(), 'enable').session;
    expect(applyCommand(priv, 'show i').output[0].text).toMatch(/Ambiguous/);
    // Invalid input now renders as a caret line + message; the message lives on the second line.
    const invalid = applyCommand(priv, 'frobnicate').output;
    expect(invalid[0].text).toMatch(/^\s+\^$/);
    expect(invalid[1].text).toMatch(/Invalid input/);
    expect(applyCommand(priv, 'show').output[0].text).toMatch(/Incomplete/);
  });

  it('renders show ip interface brief with configured state', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
      'end',
    ]);
    const text = applyCommand(s, 'show ip interface brief')
      .output.map((o) => o.text)
      .join('\n');
    expect(text).toMatch(/GigabitEthernet0\/0\s+192\.168\.1\.1/);
    expect(text).toMatch(/Gi0\/0|GigabitEthernet0\/0/);
  });

  it('does not mutate the input session', () => {
    const s = applyCommand(fresh(), 'enable').session;
    const before = structuredClone(s);
    applyCommand(s, 'configure terminal');
    expect(s).toEqual(before);
  });
});

describe('IOS interpreter — `show interfaces <iface>`', () => {
  function priv(): Session {
    return applyCommand(fresh(), 'enable').session;
  }

  function configured(): Session {
    return run(fresh(), [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
      'end',
    ]);
  }

  it('renders the per-interface block in admin-down state', () => {
    const text = applyCommand(priv(), 'show interfaces gi0/0')
      .output.map((o) => o.text)
      .join('\n');
    expect(text).toMatch(
      /GigabitEthernet0\/0 is administratively down, line protocol is down/,
    );
    expect(text).toMatch(/Hardware is ISR4321, address is 0000\.0000\.0000/);
    expect(text).toMatch(/Internet protocol processing disabled/);
    expect(text).toMatch(/MTU 1500 bytes/);
  });

  it('renders the per-interface block in admin-up state with IP', () => {
    const text = applyCommand(configured(), 'show interfaces gi0/0')
      .output.map((o) => o.text)
      .join('\n');
    expect(text).toMatch(/GigabitEthernet0\/0 is up, line protocol is up/);
    expect(text).toMatch(/Internet address is 192\.168\.1\.1\/24/);
    expect(text).not.toMatch(/administratively down/);
  });

  it('accepts the full name and abbreviated forms via prefix-match', () => {
    const full = applyCommand(priv(), 'show interfaces GigabitEthernet0/0')
      .output.map((o) => o.text)
      .join('\n');
    expect(full).toMatch(/GigabitEthernet0\/0 is administratively down/);

    const abbrev = applyCommand(priv(), 'show int gi0/0')
      .output.map((o) => o.text)
      .join('\n');
    expect(abbrev).toMatch(/GigabitEthernet0\/0 is administratively down/);
  });

  it('returns an error on an unknown interface', () => {
    const out = applyCommand(priv(), 'show interfaces gi9/9').output;
    expect(out[0].kind).toBe('error');
    expect(out[0].text).toMatch(/Invalid interface/);
  });

  it('bare `show interfaces` still lists every interface', () => {
    const text = applyCommand(priv(), 'show interfaces')
      .output.map((o) => o.text)
      .join('\n');
    expect(text).toMatch(/GigabitEthernet0\/0/);
    expect(text).toMatch(/GigabitEthernet0\/1/);
  });
});

describe('IOS interpreter — `show running-config interface <iface>`', () => {
  function priv(): Session {
    return applyCommand(fresh(), 'enable').session;
  }

  function configured(): Session {
    return run(fresh(), [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
      'end',
    ]);
  }

  it('renders the interface stanza with `shutdown` when admin-down', () => {
    const text = applyCommand(priv(), 'show running-config interface gi0/0')
      .output.map((o) => o.text)
      .join('\n');
    expect(text).toMatch(/^interface GigabitEthernet0\/0$/m);
    expect(text).toMatch(/^ no ip address$/m);
    expect(text).toMatch(/^ shutdown$/m);
    expect(text).toMatch(/^!$/m);
  });

  it('omits `shutdown` and emits the IP line when admin-up with address', () => {
    const text = applyCommand(configured(), 'show running-config interface gi0/0')
      .output.map((o) => o.text)
      .join('\n');
    expect(text).toMatch(/^interface GigabitEthernet0\/0$/m);
    expect(text).toMatch(/^ ip address 192\.168\.1\.1 255\.255\.255\.0$/m);
    expect(text).not.toMatch(/shutdown/);
  });

  it('accepts the full name and abbreviated forms via prefix-match', () => {
    const full = applyCommand(
      priv(),
      'show running-config interface GigabitEthernet0/0',
    )
      .output.map((o) => o.text)
      .join('\n');
    expect(full).toMatch(/interface GigabitEthernet0\/0/);

    const abbrev = applyCommand(priv(), 'show run int gi0/0')
      .output.map((o) => o.text)
      .join('\n');
    expect(abbrev).toMatch(/interface GigabitEthernet0\/0/);
  });

  it('returns an error on an unknown interface', () => {
    const out = applyCommand(priv(), 'show running-config interface gi9/9').output;
    expect(out[0].kind).toBe('error');
    expect(out[0].text).toMatch(/Invalid interface/);
  });

  it('bare `show running-config` still dumps the full configuration', () => {
    const text = applyCommand(configured(), 'show running-config')
      .output.map((o) => o.text)
      .join('\n');
    expect(text).toMatch(/Building configuration/);
    expect(text).toMatch(/hostname R1/);
    expect(text).toMatch(/interface GigabitEthernet0\/0/);
    expect(text).toMatch(/interface GigabitEthernet0\/1/);
    expect(text).toMatch(/^end$/m);
  });
});

describe('IOS interpreter — `ip route` static routes', () => {
  function configMode(): Session {
    return run(fresh(), ['enable', 'configure terminal']);
  }

  it('parses `ip route <prefix> <mask> <next-hop>` and adds a static route', () => {
    const s = applyCommand(configMode(), 'ip route 10.0.0.0 255.255.255.0 192.168.1.2').session;
    expect(s.staticRoutes).toEqual([
      {
        prefix: '10.0.0.0',
        mask: '255.255.255.0',
        nextHop: '192.168.1.2',
        source: 'static',
        adminDistance: 1,
      },
    ]);
  });

  it('parses `ip route <prefix> <mask> <egress-iface>` and stores the canonical iface id', () => {
    const s = applyCommand(configMode(), 'ip route 10.0.0.0 255.255.255.0 gi0/1').session;
    expect(s.staticRoutes).toEqual([
      {
        prefix: '10.0.0.0',
        mask: '255.255.255.0',
        egressIface: 'Gi0/1',
        source: 'static',
        adminDistance: 1,
      },
    ]);
  });

  it('normalizes the prefix to the network address (host bits cleared)', () => {
    const s = applyCommand(configMode(), 'ip route 10.0.0.42 255.255.255.0 192.168.1.2').session;
    expect(s.staticRoutes[0].prefix).toBe('10.0.0.0');
  });

  it('rejects an invalid prefix / mask / target with a clear error', () => {
    const cfg = configMode();
    expect(applyCommand(cfg, 'ip route bogus 255.255.255.0 192.168.1.2').output[0].kind).toBe('error');
    expect(applyCommand(cfg, 'ip route 10.0.0.0 255.255.0.255 192.168.1.2').output[0].kind).toBe('error');
    expect(applyCommand(cfg, 'ip route 10.0.0.0 255.255.255.0 nonsense').output[0].kind).toBe('error');
  });

  it('`no ip route ...` removes the matching entry', () => {
    let s = configMode();
    s = applyCommand(s, 'ip route 10.0.0.0 255.255.255.0 192.168.1.2').session;
    s = applyCommand(s, 'ip route 10.1.0.0 255.255.255.0 192.168.1.3').session;
    expect(s.staticRoutes).toHaveLength(2);
    s = applyCommand(s, 'no ip route 10.0.0.0 255.255.255.0 192.168.1.2').session;
    expect(s.staticRoutes).toHaveLength(1);
    expect(s.staticRoutes[0].prefix).toBe('10.1.0.0');
  });

  it('deduplicates identical static-route entries (re-entering does not stack)', () => {
    let s = configMode();
    s = applyCommand(s, 'ip route 10.0.0.0 255.255.255.0 192.168.1.2').session;
    s = applyCommand(s, 'ip route 10.0.0.0 255.255.255.0 192.168.1.2').session;
    expect(s.staticRoutes).toHaveLength(1);
  });

  it('routingTable merges derived connecteds with stored statics', () => {
    let s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
      'exit',
    ]);
    s = applyCommand(s, 'ip route 10.0.0.0 255.255.255.0 192.168.1.2').session;
    const table = routingTable(s);
    expect(table).toHaveLength(2);
    expect(table[0].source).toBe('connected');
    expect(table[0].prefix).toBe('192.168.1.0');
    expect(table[1].source).toBe('static');
    expect(table[1].prefix).toBe('10.0.0.0');
  });

  it('`show ip route` lists connected + static routes IOS-style', () => {
    let s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
      'exit',
    ]);
    s = applyCommand(s, 'ip route 10.0.0.0 255.255.255.0 192.168.1.2').session;
    const text = applyCommand(s, 'do show ip route')
      .output.map((o) => o.text)
      .join('\n');
    expect(text).toMatch(/Codes:.*C - connected.*S - static/);
    expect(text).toMatch(/C\s+192\.168\.1\.0\/24 is directly connected, GigabitEthernet0\/0/);
    expect(text).toMatch(/S\s+10\.0\.0\.0\/24 \[1\/0\] via 192\.168\.1\.2/);
  });
});

describe('IOS interpreter — `do` exec shortcut in config modes', () => {
  function configIf(): Session {
    return run(fresh(), ['enable', 'configure terminal', 'interface gi0/0']);
  }

  it('runs `do show ip interface brief` and stays in config-if', () => {
    const s = configIf();
    const { session: after, output } = applyCommand(s, 'do show ip interface brief');
    expect(after.mode).toBe('config-if');
    expect(after.currentInterface).toBe('Gi0/0');
    expect(prompt(after)).toBe('R1(config-if)#');
    const text = output.map((o) => o.text).join('\n');
    expect(text).toMatch(/Interface\s+IP-Address/);
    expect(text).toMatch(/GigabitEthernet0\/0/);
  });

  it('records `do` in raw + resolved history (canonical form preserves the prefix)', () => {
    const s = configIf();
    const after = applyCommand(s, 'do sh ip int br').session;
    expect(after.history[after.history.length - 1]).toBe('do sh ip int br');
    expect(after.resolvedHistory[after.resolvedHistory.length - 1]).toBe(
      'do show ip interface brief',
    );
  });

  it('credits the verify objective when run via `do` from config-if', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
      'do show ip int brief',
    ]);
    const verify = grade(lab01InterfaceIp, s).objectives.find((o) => o.id === 'verify');
    expect(verify?.met).toBe(true);
  });

  it('rejects `do` alone with caret just past the token', () => {
    const s = configIf();
    const out = applyCommand(s, 'do').output;
    expect(out).toHaveLength(2);
    // promptLen = 'R1(config-if)#'.length + 1 (trailing space) = 15
    // caret just past 'do' → spaces = 15 + 2 = 17
    const expectedPromptLen = prompt(s).length + 1;
    expect(out[0].text).toBe(' '.repeat(expectedPromptLen + 2) + '^');
    expect(out[1].text).toBe("% Invalid input detected at '^' marker.");
  });

  it('positions caret under the failing token after `do <bad>`', () => {
    const s = configIf();
    const out = applyCommand(s, 'do frobnicate').output;
    const promptLen = prompt(s).length + 1;
    // 'frobnicate' starts at char-offset 3 in the typed line.
    expect(out[0].text).toBe(' '.repeat(promptLen + 3) + '^');
    expect(out[1].text).toBe("% Invalid input detected at '^' marker.");
  });

  it('positions caret deep on `do sh ip xyz` (no `ip` argument slot)', () => {
    const s = configIf();
    const out = applyCommand(s, 'do sh ip xyz').output;
    const promptLen = prompt(s).length + 1;
    // 'xyz' starts at offset 9: 'do '(3) + 'sh '(3) + 'ip '(3)
    // `show ip` has no argument slot, so an unrecognized token at this
    // position triggers the parser-level caret line.
    expect(out[0].text).toBe(' '.repeat(promptLen + 9) + '^');
  });

  it('does NOT treat `do` as a keyword in user / priv modes', () => {
    const user = fresh();
    const userOut = applyCommand(user, 'do show version').output;
    expect(userOut[1].text).toBe("% Invalid input detected at '^' marker.");

    const priv = applyCommand(user, 'enable').session;
    const privOut = applyCommand(priv, 'do show version').output;
    expect(privOut[1].text).toBe("% Invalid input detected at '^' marker.");
  });
});

describe('IOS interpreter — invalid-input `^` caret rendering', () => {
  it('places the caret under the first failing token at column 0 of the input', () => {
    const cfg = run(fresh(), ['enable', 'configure terminal']);
    const out = applyCommand(cfg, 'frob').output;
    const promptLen = prompt(cfg).length + 1;
    // 'frob' starts at offset 0
    expect(out[0].text).toBe(' '.repeat(promptLen + 0) + '^');
    expect(out[1].text).toBe("% Invalid input detected at '^' marker.");
  });

  it('places the caret under the bad token when it follows valid keywords', () => {
    const priv = applyCommand(fresh(), 'enable').session;
    const out = applyCommand(priv, 'show frobnicate').output;
    const promptLen = prompt(priv).length + 1;
    // 'frobnicate' starts at offset 5: 'show '
    expect(out[0].text).toBe(' '.repeat(promptLen + 5) + '^');
  });
});

describe('IOS interpreter — prompt accuracy across all modes', () => {
  it('renders the canonical IOS prompt for each mode', () => {
    const user = fresh();
    expect(prompt(user)).toBe('R1>');

    const priv = applyCommand(user, 'enable').session;
    expect(prompt(priv)).toBe('R1#');

    const cfg = applyCommand(priv, 'configure terminal').session;
    expect(prompt(cfg)).toBe('R1(config)#');

    const cfgIf = applyCommand(cfg, 'interface gi0/0').session;
    expect(prompt(cfgIf)).toBe('R1(config-if)#');
  });

  it('updates the prompt hostname when `hostname` is applied', () => {
    const cfg = run(fresh(), ['enable', 'configure terminal']);
    const renamed = applyCommand(cfg, 'hostname EDGE-R1').session;
    expect(prompt(renamed)).toBe('EDGE-R1(config)#');
  });
});

describe('IOS interpreter — Tab completion', () => {
  it('completes a unique prefix and appends a space', () => {
    expect(tabComplete(fresh(), 'en')).toBe('enable ');
  });

  it('returns null on an ambiguous prefix (Tab does NOT dump candidates)', () => {
    // user mode children include both `enable` and `exit` — `e` is ambiguous.
    expect(tabComplete(fresh(), 'e')).toBeNull();
  });

  it('returns null when there is no partial (empty / trailing whitespace)', () => {
    expect(tabComplete(fresh(), '')).toBeNull();
    expect(tabComplete(fresh(), 'show ')).toBeNull();
  });

  it('completes deeper in the tree without expanding earlier tokens', () => {
    const priv = applyCommand(fresh(), 'enable').session;
    // `sh ip i` — last token `i` resolves uniquely to `interface` under `ip`.
    // Earlier `sh` is left as the user typed it (not expanded to `show`).
    expect(tabComplete(priv, 'sh ip i')).toBe('sh ip interface ');
  });

  it('appends a space when the partial is already the full keyword', () => {
    const priv = applyCommand(fresh(), 'enable').session;
    expect(tabComplete(priv, 'show')).toBe('show ');
  });

  it('returns null at an argument position (no keyword to complete)', () => {
    const cfg = applyCommand(
      applyCommand(fresh(), 'enable').session,
      'configure terminal',
    ).session;
    // `interface ` would be at the arg slot; trailing space already handled.
    // `interface g` — `g` is a partial in an arg slot, not a keyword.
    expect(tabComplete(cfg, 'interface g')).toBeNull();
  });
});

describe('IOS interpreter — resolvedHistory regression', () => {
  it('records canonical command form in resolvedHistory while keeping raw', () => {
    const s = run(fresh(), ['en', 'conf t', 'int gi0/0']);
    // Raw history preserves what the user typed.
    expect(s.history).toEqual(['en', 'conf t', 'int gi0/0']);
    // Resolved history has abbreviations expanded — interface arg keeps its
    // raw token (it's an argument value, not a keyword).
    expect(s.resolvedHistory).toEqual([
      'enable',
      'configure terminal',
      'interface gi0/0',
    ]);
  });
});

describe('IOS interpreter — ? context help', () => {
  it('lists user-mode commands for `?` at the prompt', () => {
    const lines = contextHelp(fresh(), '').map((o) => o.text);
    const text = lines.join('\n');
    expect(text).toMatch(/enable\s+Turn on privileged commands/);
    expect(text).toMatch(/show\s+Display running system information/);
    expect(text).toMatch(/exit\s+Exit from the EXEC/);
  });

  it('lists priv-mode commands including configure, show, write', () => {
    const priv = applyCommand(fresh(), 'enable').session;
    const text = contextHelp(priv, '').map((o) => o.text).join('\n');
    expect(text).toMatch(/configure/);
    expect(text).toMatch(/disable/);
    expect(text).toMatch(/write/);
  });

  it('lists children of a partial line (`show ` with trailing space)', () => {
    const priv = applyCommand(fresh(), 'enable').session;
    const text = contextHelp(priv, 'show ').map((o) => o.text).join('\n');
    expect(text).toMatch(/interfaces\s+Interface status and configuration/);
    expect(text).toMatch(/ip/);
    expect(text).toMatch(/running-config\s+Current operating configuration/);
    expect(text).toMatch(/version\s+System hardware and software status/);
  });

  it('filters children by partial token (no trailing space)', () => {
    const priv = applyCommand(fresh(), 'enable').session;
    const text = contextHelp(priv, 'show i').map((o) => o.text).join('\n');
    expect(text).toMatch(/interfaces/);
    expect(text).toMatch(/ip/);
    expect(text).not.toMatch(/version/);
    expect(text).not.toMatch(/running-config/);
  });

  it('resolves abbreviated tokens before listing children (`sh ?` -> show children)', () => {
    const priv = applyCommand(fresh(), 'enable').session;
    const text = contextHelp(priv, 'sh ').map((o) => o.text).join('\n');
    expect(text).toMatch(/interfaces/);
    expect(text).toMatch(/running-config/);
  });

  it('shows <iface> when an argument is expected', () => {
    const cfg = applyCommand(
      applyCommand(fresh(), 'enable').session,
      'configure terminal',
    ).session;
    const text = contextHelp(cfg, 'interface ').map((o) => o.text).join('\n');
    expect(text).toMatch(/<iface>/);
  });

  it('shows <cr> when the line is a complete runnable command followed by a space', () => {
    const priv = applyCommand(fresh(), 'enable').session;
    const text = contextHelp(priv, 'show version ').map((o) => o.text).join('\n');
    expect(text).toMatch(/<cr>/);
  });

  it('treats a no-space partial that matches a keyword exactly as a candidate, not <cr>', () => {
    const priv = applyCommand(fresh(), 'enable').session;
    const text = contextHelp(priv, 'show version').map((o) => o.text).join('\n');
    expect(text).toMatch(/version\s+System hardware/);
    expect(text).not.toMatch(/<cr>/);
  });

  it('rejects an unrecognized token with an error line', () => {
    const out = contextHelp(fresh(), 'frobnicate ');
    expect(out[0].kind).toBe('error');
    expect(out[0].text).toMatch(/Unrecognized/);
  });

  it('does not mutate the session', () => {
    const s = applyCommand(fresh(), 'enable').session;
    const before = structuredClone(s);
    contextHelp(s, 'show ');
    expect(s).toEqual(before);
  });
});

describe('config-subif — dot1Q subinterface mode', () => {
  /** Helper: arrive at config-subif on Gi0/0.10 from a freshly-booted router.
   *  The parent Gi0/0 is admin-up so the subif's protocolUp resolves true
   *  immediately on `no shutdown` (no lab-session refresh needed in unit tests). */
  function intoSubif10(): Session {
    return run(fresh(), [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'no shutdown',
      'exit',
      'interface gi0/0.10',
    ]);
  }

  it('interface gi0/0.10 from config enters config-subif and creates the subif', () => {
    const s = intoSubif10();
    expect(s.mode).toBe('config-subif');
    expect(s.activeSubIfId).toBe('Gi0/0.10');
    expect(prompt(s)).toBe('R1(config-subif)#');
    expect(s.device.subInterfaces['Gi0/0.10']).toMatchObject({
      id: 'Gi0/0.10',
      parentId: 'Gi0/0',
      dot1qVlan: null,
      ip: null,
      adminUp: false,
    });
  });

  it('interface <subif> with non-existent parent stays in config and prints an error', () => {
    const s = run(fresh(), ['enable', 'configure terminal']);
    const { session, output } = applyCommand(s, 'interface gi9/9.10');
    expect(session.mode).toBe('config');
    expect(session.activeSubIfId).toBeNull();
    expect(session.device.subInterfaces['Gi9/9.10']).toBeUndefined();
    expect(output.some((o) => /Parent interface GigabitEthernet9\/9 not found/.test(o.text))).toBe(
      true,
    );
  });

  it('encapsulation dot1q 10 sets dot1qVlan on the active subif', () => {
    const s = applyCommand(intoSubif10(), 'encapsulation dot1q 10').session;
    expect(s.device.subInterfaces['Gi0/0.10'].dot1qVlan).toBe(10);
  });

  it('encapsulation dot1q 0 / 4095 → range error', () => {
    const lo = applyCommand(intoSubif10(), 'encapsulation dot1q 0');
    expect(lo.output[0].text).toMatch(/out of range/);
    expect(lo.session.device.subInterfaces['Gi0/0.10'].dot1qVlan).toBeNull();
    const hi = applyCommand(intoSubif10(), 'encapsulation dot1q 4095');
    expect(hi.output[0].text).toMatch(/out of range/);
  });

  it('ip address sets ip/mask on the active subif (not on the parent)', () => {
    const s = applyCommand(
      intoSubif10(),
      'ip address 192.168.10.1 255.255.255.0',
    ).session;
    expect(s.device.subInterfaces['Gi0/0.10'].ip).toBe('192.168.10.1');
    expect(s.device.subInterfaces['Gi0/0.10'].mask).toBe('255.255.255.0');
    expect(s.device.interfaces['Gi0/0'].ip).toBeNull();
  });

  it('no shutdown sets adminUp true, protocolUp tracks parent', () => {
    const s = applyCommand(intoSubif10(), 'no shutdown').session;
    const sub = s.device.subInterfaces['Gi0/0.10'];
    expect(sub.adminUp).toBe(true);
    // Parent Gi0/0 is adminUp + protocolUp (default true) in unit tests, so
    // the subif's protocolUp resolves true immediately.
    expect(sub.protocolUp).toBe(true);
    expect(s.subIfConfiguredAt['Gi0/0.10']).toBeGreaterThan(0);
  });

  it('shutdown sets adminUp/protocolUp false and clears the configured-at stamp', () => {
    const up = applyCommand(intoSubif10(), 'no shutdown').session;
    const down = applyCommand(up, 'shutdown').session;
    expect(down.device.subInterfaces['Gi0/0.10'].adminUp).toBe(false);
    expect(down.device.subInterfaces['Gi0/0.10'].protocolUp).toBe(false);
    expect(down.subIfConfiguredAt['Gi0/0.10']).toBeUndefined();
  });

  it('exit returns to config mode and clears activeSubIfId', () => {
    const s = applyCommand(intoSubif10(), 'exit').session;
    expect(s.mode).toBe('config');
    expect(s.activeSubIfId).toBeNull();
  });

  it('end returns to priv mode', () => {
    const s = applyCommand(intoSubif10(), 'end').session;
    expect(s.mode).toBe('priv');
    expect(s.activeSubIfId).toBeNull();
  });

  it('show ip interface brief lists physical and subinterface rows together', () => {
    const s = run(intoSubif10(), [
      'encapsulation dot1q 10',
      'ip address 192.168.10.1 255.255.255.0',
      'no shutdown',
      'end',
      'show ip interface brief',
    ]);
    // lastShowIpIntBrief is set to a monotonically-increasing seq AFTER the
    // subif's configured-at stamp — verify-style objectives compare them.
    expect(s.lastShowIpIntBrief).toBeGreaterThan(s.subIfConfiguredAt['Gi0/0.10']);
    const briefOut = applyCommand(s, 'show ip interface brief').output;
    const text = briefOut.map((o) => o.text).join('\n');
    expect(text).toMatch(/GigabitEthernet0\/0\b/);
    expect(text).toMatch(/GigabitEthernet0\/0\.10\s+192\.168\.10\.1\s+YES\s+manual\s+up\s+up/);
  });

  it('show running-config interface gi0/0.10 renders the subif stanza', () => {
    const s = run(intoSubif10(), [
      'encapsulation dot1q 10',
      'ip address 192.168.10.1 255.255.255.0',
      'no shutdown',
      'end',
    ]);
    const text = applyCommand(s, 'show running-config interface gi0/0.10')
      .output.map((o) => o.text)
      .join('\n');
    expect(text).toMatch(/interface GigabitEthernet0\/0\.10/);
    expect(text).toMatch(/encapsulation dot1Q 10/);
    expect(text).toMatch(/ip address 192\.168\.10\.1 255\.255\.255\.0/);
    expect(text).not.toMatch(/ shutdown/);
  });

  it('show running-config interface gi0/0.10 with partial state omits encap/ip', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'no shutdown',
      'exit',
      'interface gi0/0.10',
      'end',
    ]);
    const text = applyCommand(s, 'show running-config interface gi0/0.10')
      .output.map((o) => o.text)
      .join('\n');
    expect(text).toMatch(/interface GigabitEthernet0\/0\.10/);
    expect(text).not.toMatch(/encapsulation/);
    expect(text).toMatch(/no ip address/);
    expect(text).toMatch(/ shutdown/);
  });

  it('no encapsulation dot1q clears the tag', () => {
    const s = run(intoSubif10(), [
      'encapsulation dot1q 10',
      'no encapsulation dot1q 10',
    ]);
    expect(s.device.subInterfaces['Gi0/0.10'].dot1qVlan).toBeNull();
  });

  it('no ip address in config-subif clears just the subif ip', () => {
    const s = run(intoSubif10(), [
      'ip address 192.168.10.1 255.255.255.0',
      'no ip address',
    ]);
    expect(s.device.subInterfaces['Gi0/0.10'].ip).toBeNull();
    expect(s.device.subInterfaces['Gi0/0.10'].mask).toBeNull();
  });
});
