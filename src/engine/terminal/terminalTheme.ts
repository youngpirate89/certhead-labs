export interface TerminalTheme {
  fontSize: number;
  bgColor: string;
  textColor: string;
}

export const FONT_SIZES = { min: 12, max: 18, default: 14 } as const;

export const BG_OPTIONS: Array<{ label: string; value: string }> = [
  { label: 'CertHead',       value: '#0d1117' },
  { label: 'PuTTY Default',  value: '#000000' },
  { label: 'Solarized Dark', value: '#002b36' },
  { label: 'Tomorrow Night', value: '#1d1f21' },
  { label: 'Monokai',        value: '#272822' },
  { label: 'Zenburn',        value: '#3f3f3f' },
  { label: 'Gruvbox',        value: '#282828' },
];

export const TEXT_OPTIONS: Array<{ label: string; value: string }> = [
  { label: 'CertHead',       value: '#94a3b8' },
  { label: 'PuTTY Default',  value: '#bbbbbb' },
  { label: 'Solarized',      value: '#839496' },
  { label: 'Tomorrow',       value: '#c5c8c6' },
  { label: 'Monokai',        value: '#f8f8f2' },
  { label: 'Zenburn',        value: '#dcdccc' },
  { label: 'Gruvbox',        value: '#ebdbb2' },
  { label: 'Matrix',         value: '#00ff41' },
];

export const DEFAULT_THEME: TerminalTheme = {
  fontSize: 14,
  bgColor: '#0d1117',
  textColor: '#94a3b8',
};

const STORAGE_KEY = 'cl-term-theme';

export function loadTheme(): TerminalTheme {
  if (typeof localStorage === 'undefined') return DEFAULT_THEME;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_THEME;
    const parsed = JSON.parse(raw) as Partial<TerminalTheme>;
    if (
      typeof parsed.fontSize !== 'number' ||
      typeof parsed.bgColor !== 'string' ||
      typeof parsed.textColor !== 'string'
    ) {
      return DEFAULT_THEME;
    }
    return {
      fontSize: parsed.fontSize,
      bgColor: parsed.bgColor,
      textColor: parsed.textColor,
    };
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveTheme(theme: TerminalTheme): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
  } catch {
    // localStorage may be full or unavailable (private browsing) — fail
    // silently rather than break the terminal.
  }
}
