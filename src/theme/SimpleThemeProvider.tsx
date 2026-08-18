import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, ColorSchemeName } from 'react-native';
import { MD3DarkTheme, MD3LightTheme, PaperProvider, type MD3Theme } from 'react-native-paper';
import {
  radii,
  safeRideTokens,
  semanticStates,
  themeColors,
  type SafeRideTokens,
  type ThemeColors,
  type ThemeMode,
  type ThemePreference,
} from './tokens';
import { Storage } from '../lib/storage';

export type Theme = ThemePreference;
export type ResolvedColorScheme = 'light' | 'dark';

export interface ThemeContextType {
  theme: ThemePreference;
  mode: ThemeMode;
  colorScheme: ResolvedColorScheme;
  colors: ThemeColors;
  tokens: SafeRideTokens;
  semanticStates: typeof semanticStates;
  paperTheme: MD3Theme;
  isHighContrast: boolean;
  setTheme: (theme: ThemePreference) => void;
}

function toResolvedColorScheme(colorScheme: ColorSchemeName | null | undefined): ResolvedColorScheme {
  return colorScheme === 'dark' ? 'dark' : 'light';
}

function resolveThemeMode(theme: ThemePreference, systemColorScheme: ResolvedColorScheme): ThemeMode {
  if (theme === 'system') {
    return systemColorScheme;
  }

  return theme;
}

function buildPaperTheme(mode: ThemeMode): MD3Theme {
  const baseTheme = mode === 'dark' ? MD3DarkTheme : MD3LightTheme;
  const colors = themeColors[mode];
  const isDark = mode === 'dark';

  return {
    ...baseTheme,
    dark: isDark,
    roundness: radii.md,
    colors: {
      ...baseTheme.colors,
      primary: colors.primary,
      onPrimary: colors.primaryForeground,
      primaryContainer: colors.primaryMuted,
      onPrimaryContainer: colors.primary,
      secondary: colors.evidence,
      onSecondary: colors.evidenceForeground,
      secondaryContainer: colors.evidenceMuted,
      onSecondaryContainer: colors.evidence,
      tertiary: colors.privacy,
      onTertiary: colors.privacyForeground,
      tertiaryContainer: colors.privacyMuted,
      onTertiaryContainer: colors.privacy,
      error: colors.destructive,
      onError: colors.destructiveForeground,
      errorContainer: colors.dangerMuted,
      onErrorContainer: colors.destructive,
      background: colors.background,
      onBackground: colors.foreground,
      surface: colors.surface,
      onSurface: colors.foreground,
      surfaceVariant: colors.surfaceAlt,
      onSurfaceVariant: colors.textSecondary,
      outline: colors.border,
      outlineVariant: colors.divider,
      shadow: isDark ? 'rgba(0,0,0,0.64)' : 'rgba(17,24,39,0.24)',
      scrim: colors.scrim,
      inverseSurface: colors.foreground,
      inverseOnSurface: colors.textInverse,
      inversePrimary: colors.primaryForeground,
      backdrop: colors.scrim,
      elevation: {
        ...baseTheme.colors.elevation,
        level0: 'transparent',
        level1: colors.surface,
        level2: colors.surfaceAlt,
        level3: colors.surfaceAlt,
        level4: colors.surfaceAlt,
        level5: colors.surfaceAlt,
      },
    },
  };
}

export const safeRidePaperThemes: Record<ThemeMode, MD3Theme> = {
  light: buildPaperTheme('light'),
  dark: buildPaperTheme('dark'),
  highContrast: buildPaperTheme('highContrast'),
};

const defaultMode: ThemeMode = 'light';
const defaultPaperTheme = safeRidePaperThemes[defaultMode];

const defaultThemeContext: ThemeContextType = {
  theme: 'light',
  mode: defaultMode,
  colorScheme: 'light',
  colors: themeColors[defaultMode],
  tokens: safeRideTokens,
  semanticStates,
  paperTheme: defaultPaperTheme,
  isHighContrast: false,
  setTheme: () => {},
};

const ThemeContext = createContext<ThemeContextType>(defaultThemeContext);

export function SimpleThemeProvider({
  children,
  initialTheme = 'system',
}: {
  children: React.ReactNode;
  initialTheme?: ThemePreference;
}) {
  const [theme, setThemeState] = useState<ThemePreference>(initialTheme);
  const [systemColorScheme, setSystemColorScheme] = useState<ResolvedColorScheme>(() =>
    toResolvedColorScheme(Appearance.getColorScheme()),
  );

  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemColorScheme(toResolvedColorScheme(colorScheme));
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let mounted = true;

    Storage.getSettings()
      .then(settings => {
        if (mounted) {
          setThemeState(settings.theme);
        }
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, []);

  const setTheme = useCallback((nextTheme: ThemePreference) => {
    setThemeState(nextTheme);
    void Storage.saveSettings({ theme: nextTheme }).catch(() => undefined);
  }, []);

  const mode = useMemo(() => resolveThemeMode(theme, systemColorScheme), [theme, systemColorScheme]);
  const colorScheme: ResolvedColorScheme = mode === 'dark' ? 'dark' : 'light';
  const colors = themeColors[mode];
  const paperTheme = safeRidePaperThemes[mode];

  const contextValue = useMemo<ThemeContextType>(
    () => ({
      theme,
      mode,
      colorScheme,
      colors,
      tokens: safeRideTokens,
      semanticStates,
      paperTheme,
      isHighContrast: mode === 'highContrast',
      setTheme,
    }),
    [colorScheme, colors, mode, paperTheme, theme],
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      <PaperProvider theme={paperTheme}>{children}</PaperProvider>
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
