import React from 'react';
import { View, Text, StyleSheet, DimensionValue } from 'react-native';
import { useTheme } from '../../theme/SimpleThemeProvider';
import { typography, fontFamilies } from '../../theme/tokens';

export interface SeparatorProps {
  orientation?: 'horizontal' | 'vertical';
  thickness?: number;
  length?: DimensionValue;
  color?: string;
  variant?: 'solid' | 'dashed' | 'dotted';
  spacing?: number;
  style?: any;
}

export interface SeparatorWithTextProps extends SeparatorProps {
  children: React.ReactNode;
  textPosition?: 'center' | 'left' | 'right';
  textStyle?: any;
}

export function Separator({
  orientation = 'horizontal',
  thickness = 1,
  length = '100%',
  color,
  variant = 'solid',
  spacing = 0,
  style,
}: SeparatorProps) {
  const { colors } = useTheme();
  
  const separatorColor = color || colors.divider;
  
  const getVariantStyle = () => {
    switch (variant) {
      case 'dashed':
        return {
          borderStyle: 'dashed' as const,
        };
      case 'dotted':
        return {
          borderStyle: 'dotted' as const,
        };
      default:
        return {
          borderStyle: 'solid' as const,
        };
    }
  };

  const styles = StyleSheet.create({
    horizontal: {
      width: length,
      height: thickness,
      backgroundColor: variant === 'solid' ? separatorColor : 'transparent',
      borderTopWidth: variant !== 'solid' ? thickness : 0,
      borderTopColor: separatorColor,
      marginVertical: spacing,
      ...getVariantStyle(),
    },
    vertical: {
      height: length,
      width: thickness,
      backgroundColor: variant === 'solid' ? separatorColor : 'transparent',
      borderLeftWidth: variant !== 'solid' ? thickness : 0,
      borderLeftColor: separatorColor,
      marginHorizontal: spacing,
      ...getVariantStyle(),
    },
  });

  return (
    <View
      style={[
        orientation === 'horizontal' ? styles.horizontal : styles.vertical,
        style,
      ]}
    />
  );
}

export function SeparatorWithText({
  children,
  textPosition = 'center',
  textStyle,
  orientation = 'horizontal',
  thickness = 1,
  color,
  variant = 'solid',
  spacing = 16,
  style,
}: SeparatorWithTextProps) {
  const { colors } = useTheme();
  
  const separatorColor = color || colors.border;

  const getFlexValues = () => {
    switch (textPosition) {
      case 'left':
        return { left: 0, center: 1, right: 3 };
      case 'right':
        return { left: 3, center: 1, right: 0 };
      default: // center
        return { left: 1, center: 0, right: 1 };
    }
  };

  const flexValues = getFlexValues();

  const styles = StyleSheet.create({
    container: {
      flexDirection: orientation === 'horizontal' ? 'row' : 'column',
      alignItems: 'center',
      marginVertical: orientation === 'horizontal' ? spacing : 0,
      marginHorizontal: orientation === 'vertical' ? spacing : 0,
    },
    text: {
      paddingHorizontal: orientation === 'horizontal' ? 12 : 0,
      paddingVertical: orientation === 'vertical' ? 12 : 0,
      fontSize: typography.bodyS.fontSize,
      color: colors.textSecondary,
      fontWeight: '500',
      backgroundColor: colors.canvas,
      fontFamily: fontFamilies.text,
    },
    leftSeparator: {
      flex: flexValues.left,
    },
    rightSeparator: {
      flex: flexValues.right,
    },
  });

  return (
    <View style={[styles.container, style]}>
      {flexValues.left > 0 && (
        <Separator
          orientation={orientation}
          thickness={thickness}
          color={separatorColor}
          variant={variant}
          style={styles.leftSeparator}
        />
      )}
      
      <Text style={[styles.text, textStyle]}>
        {children}
      </Text>
      
      {flexValues.right > 0 && (
        <Separator
          orientation={orientation}
          thickness={thickness}
          color={separatorColor}
          variant={variant}
          style={styles.rightSeparator}
        />
      )}
    </View>
  );
}

// Utility components for common separator patterns
export function HorizontalSeparator(props: Omit<SeparatorProps, 'orientation'>) {
  return <Separator {...props} orientation="horizontal" />;
}

export function VerticalSeparator(props: Omit<SeparatorProps, 'orientation'>) {
  return <Separator {...props} orientation="vertical" />;
}

export function DividerWithText({ 
  children, 
  ...props 
}: Omit<SeparatorWithTextProps, 'orientation'>) {
  return (
    <SeparatorWithText {...props} orientation="horizontal">
      {children}
    </SeparatorWithText>
  );
}

// Spacer component for adding space between elements
export interface SpacerProps {
  size?: number;
  orientation?: 'horizontal' | 'vertical';
  style?: any;
}

export function Spacer({ 
  size = 16, 
  orientation = 'vertical',
  style 
}: SpacerProps) {
  const styles = StyleSheet.create({
    horizontal: {
      width: size,
      height: 1,
    },
    vertical: {
      width: 1,
      height: size,
    },
  });

  return (
    <View
      style={[
        orientation === 'horizontal' ? styles.horizontal : styles.vertical,
        style,
      ]}
    />
  );
}

// Section separator for grouping content
export interface SectionSeparatorProps {
  title?: string;
  subtitle?: string;
  spacing?: number;
  showLine?: boolean;
  lineProps?: SeparatorProps;
  style?: any;
  titleStyle?: any;
  subtitleStyle?: any;
}

export function SectionSeparator({
  title,
  subtitle,
  spacing = 24,
  showLine = true,
  lineProps,
  style,
  titleStyle,
  subtitleStyle,
}: SectionSeparatorProps) {
  const { colors } = useTheme();

  const styles = StyleSheet.create({
    container: {
      marginVertical: spacing,
    },
    header: {
      marginBottom: showLine ? 12 : 0,
    },
    title: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.foreground,
      marginBottom: subtitle ? 4 : 0,
    },
    subtitle: {
      fontSize: 14,
      color: colors.mutedForeground,
      lineHeight: 20,
    },
  });

  return (
    <View style={[styles.container, style]}>
      {(title || subtitle) && (
        <View style={styles.header}>
          {title && <Text style={[styles.title, titleStyle]}>{title}</Text>}
          {subtitle && <Text style={[styles.subtitle, subtitleStyle]}>{subtitle}</Text>}
        </View>
      )}
      
      {showLine && (
        <Separator
          orientation="horizontal"
          color={colors.border}
          {...lineProps}
        />
      )}
    </View>
  );
}

// Card separator for use within cards
export function CardSeparator(props: Omit<SeparatorProps, 'spacing'>) {
  return (
    <Separator
      {...props}
      spacing={16}
      orientation="horizontal"
    />
  );
}

// List separator for use in lists
export function ListSeparator(props: Omit<SeparatorProps, 'spacing'>) {
  return (
    <Separator
      {...props}
      spacing={8}
      orientation="horizontal"
      thickness={0.5}
    />
  );
}
