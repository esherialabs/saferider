import {
  semanticStates,
  type SemanticStateName,
  type ThemeColors,
} from '../../theme/tokens';

export type ComponentTone = 'neutral' | 'primary' | SemanticStateName;

export interface ComponentTonePalette {
  color: string;
  foreground: string;
  muted: string;
  border: string;
}

export function getTonePalette(colors: ThemeColors, tone: ComponentTone = 'neutral'): ComponentTonePalette {
  if (tone === 'primary') {
    return {
      color: colors.primary,
      foreground: colors.primaryForeground,
      muted: colors.primaryMuted,
      border: colors.primary,
    };
  }

  if (tone === 'neutral') {
    return {
      color: colors.textSecondary,
      foreground: colors.foreground,
      muted: colors.surfaceAlt,
      border: colors.divider,
    };
  }

  const state = semanticStates[tone];

  return {
    color: colors[state.color],
    foreground: colors[state.foreground],
    muted: colors[state.muted],
    border: colors[state.color],
  };
}
