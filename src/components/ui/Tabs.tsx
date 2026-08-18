import React from 'react';
import { createContext, useContext, useRef, useEffect } from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  StyleSheet, 
  ScrollView,
  Animated,
  Dimensions,
} from 'react-native';
import { useTheme } from '../../theme/SimpleThemeProvider';
import { spacing, radii, typography, shadows, fontFamilies } from '../../theme/tokens';

interface TabsContextType {
  value: string;
  onValueChange: (value: string) => void;
  orientation: 'horizontal' | 'vertical';
  variant: 'default' | 'pills' | 'underline';
  size: 'sm' | 'md' | 'lg';
}

const TabsContext = createContext<TabsContextType | null>(null);

export interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
  orientation?: 'horizontal' | 'vertical';
  variant?: 'default' | 'pills' | 'underline';
  size?: 'sm' | 'md' | 'lg';
  style?: any;
}

export interface TabsListProps {
  children: React.ReactNode;
  style?: any;
}

export interface TabsTriggerProps {
  value: string;
  children: React.ReactNode;
  disabled?: boolean;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  style?: any;
}

export interface TabsContentProps {
  value: string;
  children: React.ReactNode;
  style?: any;
}

export function Tabs({
  value,
  onValueChange,
  children,
  orientation = 'horizontal',
  variant = 'default',
  size = 'md',
  style,
}: TabsProps) {
  return (
    <TabsContext.Provider value={{ value, onValueChange, orientation, variant, size }}>
      <View style={style}>
        {children}
      </View>
    </TabsContext.Provider>
  );
}

export function TabsList({ children, style }: TabsListProps) {
  const context = useContext(TabsContext);
  const { colors } = useTheme();
  
  if (!context) {
    throw new Error('TabsList must be used within a Tabs component');
  }

  const { orientation, variant } = context;

  const getVariantStyles = () => {
    switch (variant) {
      case 'pills':
        return {
          backgroundColor: colors.primaryMuted,
          borderRadius: radii.chip,
          padding: spacing.xs,
        };
      case 'underline':
        return {
          borderBottomWidth: 1,
          borderBottomColor: colors.divider,
        };
      default:
        return {
          backgroundColor: colors.surface,
          borderRadius: radii.input,
          borderWidth: 1,
          borderColor: colors.divider,
          padding: spacing.xs / 2,
        };
    }
  };

  const styles = StyleSheet.create({
    container: {
      flexDirection: orientation === 'horizontal' ? 'row' : 'column',
      ...getVariantStyles(),
    },
    scrollView: {
      flexGrow: 0,
    },
  });

  if (orientation === 'horizontal') {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.scrollView, style]}
        contentContainerStyle={styles.container}
      >
        {children}
      </ScrollView>
    );
  }

  return (
    <View style={[styles.container, style]}>
      {children}
    </View>
  );
}

export function TabsTrigger({ 
  value, 
  children, 
  disabled = false, 
  icon, 
  badge,
  style 
}: TabsTriggerProps) {
  const context = useContext(TabsContext);
  const { colors } = useTheme();
  const animatedValue = useRef(new Animated.Value(0)).current;
  
  if (!context) {
    throw new Error('TabsTrigger must be used within a Tabs component');
  }

  const { value: selectedValue, onValueChange, orientation, variant, size } = context;
  const isSelected = selectedValue === value;

  useEffect(() => {
    Animated.timing(animatedValue, {
      toValue: isSelected ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [isSelected, animatedValue]);

  const getSizeStyles = () => {
    switch (size) {
      case 'sm':
        return {
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.xs,
          fontSize: typography.bodyS.fontSize,
          borderRadius: radii.chip,
          minHeight: 48,
          gap: spacing.xs,
        };
      case 'lg':
        return {
          paddingHorizontal: spacing.xl,
          paddingVertical: spacing.sm,
          fontSize: typography.bodyM.fontSize,
          borderRadius: radii.button,
          minHeight: 48,
          gap: spacing.sm,
        };
      default:
        return {
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.sm,
          fontSize: typography.bodyS.fontSize,
          borderRadius: radii.chip,
          minHeight: 48,
          gap: spacing.xs,
        };
    }
  };

  const getVariantStyles = () => {
    const sizeStyles = getSizeStyles();
    
    switch (variant) {
      case 'pills':
        const pillsBackgroundColor = animatedValue.interpolate({
          inputRange: [0, 1],
          outputRange: ['transparent', colors.surface],
        });
        
        return {
          backgroundColor: pillsBackgroundColor,
          borderRadius: sizeStyles.borderRadius,
          ...(isSelected ? shadows.card : {}),
        };
        
      case 'underline':
        const underlineColor = animatedValue.interpolate({
          inputRange: [0, 1],
          outputRange: ['transparent', colors.primary],
        });
        
        return {
          borderBottomWidth: 2,
          borderBottomColor: underlineColor,
          borderRadius: 0,
          backgroundColor: 'transparent',
        };
        
      default:
        const defaultBackgroundColor = animatedValue.interpolate({
          inputRange: [0, 1],
          outputRange: ['transparent', colors.primaryMuted],
        });
        
        return {
          backgroundColor: defaultBackgroundColor,
          borderRadius: sizeStyles.borderRadius,
        };
    }
  };

  const getTextColor = () => {
    if (disabled) return colors.textTertiary;
    
    switch (variant) {
      case 'pills':
        return isSelected ? colors.foreground : colors.textSecondary;
      case 'underline':
        return isSelected ? colors.primary : colors.textSecondary;
      default:
        return isSelected ? colors.primary : colors.textSecondary;
    }
  };

  const sizeStyles = getSizeStyles();
  const variantStyles = getVariantStyles();

  const styles = StyleSheet.create({
    trigger: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      ...sizeStyles,
      borderRadius: sizeStyles.borderRadius,
      opacity: disabled ? 0.5 : 1,
      flex: orientation === 'horizontal' ? 0 : 1,
    },
    content: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: sizeStyles.gap,
    },
    text: {
      fontSize: sizeStyles.fontSize,
      fontWeight: isSelected ? '600' : '500',
      lineHeight: size === 'lg' ? typography.bodyM.lineHeight : typography.bodyS.lineHeight,
      color: getTextColor(),
      fontFamily: fontFamilies.text,
      textAlign: 'center' as const,
    },
    badge: {
      marginLeft: 4,
    },
  });

  const handlePress = () => {
    if (!disabled) {
      onValueChange(value);
    }
  };

  return (
    <TouchableOpacity
      style={[styles.trigger, style]}
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole="tab"
      accessibilityState={{ selected: isSelected, disabled }}
    >
      <Animated.View style={[StyleSheet.absoluteFill, variantStyles]} />
      <View style={styles.content}>
        {icon}
        <Text style={styles.text}>{children}</Text>
        {badge && <View style={styles.badge}>{badge}</View>}
      </View>
    </TouchableOpacity>
  );
}

export function TabsContent({ value, children, style }: TabsContentProps) {
  const context = useContext(TabsContext);
  
  if (!context) {
    throw new Error('TabsContent must be used within a Tabs component');
  }

  const { value: selectedValue } = context;
  const isVisible = selectedValue === value;

  if (!isVisible) {
    return null;
  }

  return (
    <View style={style}>
      {children}
    </View>
  );
}

// Utility component for controlled tabs
export function ControlledTabs({
  defaultValue,
  onValueChange,
  children,
  ...props
}: Omit<TabsProps, 'value' | 'onValueChange'> & {
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
}) {
  const [value, setValue] = React.useState(defaultValue || '');

  const handleValueChange = (newValue: string) => {
    setValue(newValue);
    onValueChange?.(newValue);
  };

  return (
    <Tabs
      {...props}
      value={value}
      onValueChange={handleValueChange}
    >
      {children}
    </Tabs>
  );
}

// Utility component for simple tab interfaces
export interface SimpleTabsProps {
  tabs: Array<{
    label: string;
    value: string;
    content: React.ReactNode;
    icon?: React.ReactNode;
    badge?: React.ReactNode;
    disabled?: boolean;
  }>;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  variant?: 'default' | 'pills' | 'underline';
  size?: 'sm' | 'md' | 'lg';
  orientation?: 'horizontal' | 'vertical';
  style?: any;
  listStyle?: any;
  contentStyle?: any;
}

export function SimpleTabs({
  tabs,
  defaultValue,
  onValueChange,
  variant = 'default',
  size = 'md',
  orientation = 'horizontal',
  style,
  listStyle,
  contentStyle,
}: SimpleTabsProps) {
  const [value, setValue] = React.useState(defaultValue || tabs[0]?.value || '');

  const handleValueChange = (newValue: string) => {
    setValue(newValue);
    onValueChange?.(newValue);
  };

  return (
    <Tabs
      value={value}
      onValueChange={handleValueChange}
      variant={variant}
      size={size}
      orientation={orientation}
      style={style}
    >
      <TabsList style={listStyle}>
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            disabled={tab.disabled}
            icon={tab.icon}
            badge={tab.badge}
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} style={contentStyle}>
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
