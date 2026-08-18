import { Text, TextInput } from 'react-native';

import { fontFamilies } from './tokens';

type TextLikeComponent = typeof Text & {
  defaultProps?: {
    allowFontScaling?: boolean;
    style?: unknown;
  };
};

let typographyConfigured = false;

function applyDefaultTextStyle(Component: TextLikeComponent, style: object) {
  const existing = Component.defaultProps ?? {};

  Component.defaultProps = {
    ...existing,
    allowFontScaling: existing.allowFontScaling ?? true,
    style: existing.style ? [style, existing.style] : style,
  };
}

export function configureAppTypography() {
  if (typographyConfigured) {
    return;
  }

  const baseTextStyle = {
    fontFamily: fontFamilies.text,
    letterSpacing: 0,
  };

  applyDefaultTextStyle(Text as TextLikeComponent, baseTextStyle);
  applyDefaultTextStyle(TextInput as TextLikeComponent, baseTextStyle);
  typographyConfigured = true;
}
