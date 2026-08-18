import React from 'react';
import { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/SimpleThemeProvider';

export interface DropdownMenuItem {
  id: string;
  label: string;
  icon?: string;
  disabled?: boolean;
  destructive?: boolean;
}

export interface DropdownMenuProps {
  trigger: React.ReactNode;
  items: DropdownMenuItem[];
  onSelect: (itemId: string) => void;
  placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';
  disabled?: boolean;
}

export default function DropdownMenu({ 
  trigger, 
  items, 
  onSelect, 
  placement = 'bottom-start',
  disabled = false 
}: DropdownMenuProps) {
  const { colors } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [triggerLayout, setTriggerLayout] = useState({ x: 0, y: 0, width: 0, height: 0 });

  const screenWidth = Dimensions.get('window').width;
  const menuWidth = 200;

  const getMenuPosition = () => {
    const { x, y, width, height } = triggerLayout;
    
    switch (placement) {
      case 'bottom-end':
        return {
          top: y + height + 4,
          left: Math.max(8, x + width - menuWidth),
        };
      case 'top-start':
        return {
          top: y - 120, // Approximate menu height
          left: Math.max(8, x),
        };
      case 'top-end':
        return {
          top: y - 120,
          left: Math.max(8, x + width - menuWidth),
        };
      default: // bottom-start
        return {
          top: y + height + 4,
          left: Math.max(8, x),
        };
    }
  };

  const handleTriggerLayout = (event: any) => {
    const { x, y, width, height } = event.nativeEvent.layout;
    // Convert relative coordinates to absolute
    event.target.measure((fx: number, fy: number, w: number, h: number, px: number, py: number) => {
      setTriggerLayout({ x: px, y: py, width: w, height: h });
    });
  };

  const handleSelect = (itemId: string) => {
    setIsOpen(false);
    onSelect(itemId);
  };

  const styles = StyleSheet.create({
    triggerWrapper: {
      opacity: disabled ? 0.5 : 1,
    },
    overlay: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    menu: {
      position: 'absolute',
      backgroundColor: colors.background,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 8,
      elevation: 4,
      minWidth: menuWidth,
      maxWidth: screenWidth - 16,
    },
    menuItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 8,
    },
    menuItemFirst: {
      borderTopLeftRadius: 8,
      borderTopRightRadius: 8,
    },
    menuItemLast: {
      borderBottomLeftRadius: 8,
      borderBottomRightRadius: 8,
    },
    menuItemDisabled: {
      opacity: 0.5,
    },
    menuItemText: {
      fontSize: 14,
      flex: 1,
    },
    separator: {
      height: 1,
      backgroundColor: colors.border,
      marginHorizontal: 0,
    },
  });

  return (
    <>
      <TouchableOpacity
        style={styles.triggerWrapper}
        onPress={() => !disabled && setIsOpen(true)}
        onLayout={handleTriggerLayout}
        disabled={disabled}
      >
        {trigger}
      </TouchableOpacity>

      <Modal
        visible={isOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsOpen(false)}
      >
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => setIsOpen(false)}
        >
          <View style={[styles.menu, getMenuPosition()]}>
            {items.map((item, index) => (
              <React.Fragment key={item.id}>
                {index > 0 && <View style={styles.separator} />}
                <TouchableOpacity
                  style={[
                    styles.menuItem,
                    index === 0 && styles.menuItemFirst,
                    index === items.length - 1 && styles.menuItemLast,
                    item.disabled && styles.menuItemDisabled,
                  ]}
                  onPress={() => !item.disabled && handleSelect(item.id)}
                  disabled={item.disabled}
                >
                  {item.icon && (
                    <Ionicons
                      name={item.icon as any}
                      size={16}
                      color={
                        item.disabled
                          ? colors.mutedForeground
                          : item.destructive
                          ? colors.destructive
                          : colors.foreground
                      }
                    />
                  )}
                  <Text
                    style={[
                      styles.menuItemText,
                      {
                        color: item.disabled
                          ? colors.mutedForeground
                          : item.destructive
                          ? colors.destructive
                          : colors.foreground,
                      },
                    ]}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
              </React.Fragment>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

// Convenience components for common use cases
export function DropdownMenuTrigger({ children, ...props }: { children: React.ReactNode } & Partial<DropdownMenuProps>) {
  return (
    <TouchableOpacity {...props}>
      {children}
    </TouchableOpacity>
  );
}

export function SimpleDropdown({
  label,
  items,
  onSelect,
  variant = 'outline',
  icon = 'chevron-down',
  disabled = false,
}: {
  label: string;
  items: DropdownMenuItem[];
  onSelect: (itemId: string) => void;
  variant?: 'outline' | 'ghost';
  icon?: string;
  disabled?: boolean;
}) {
  const { colors } = useTheme();

  const triggerStyles = StyleSheet.create({
    trigger: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 6,
      borderWidth: variant === 'outline' ? 1 : 0,
      borderColor: variant === 'outline' ? colors.border : 'transparent',
      backgroundColor: variant === 'outline' ? colors.background : 'transparent',
      minHeight: 36,
    },
    label: {
      fontSize: 14,
      color: disabled ? colors.mutedForeground : colors.foreground,
      flex: 1,
    },
  });

  return (
    <DropdownMenu
      trigger={
        <View style={triggerStyles.trigger}>
          <Text style={triggerStyles.label}>{label}</Text>
          <Ionicons
            name={icon as any}
            size={16}
            color={disabled ? colors.mutedForeground : colors.mutedForeground}
          />
        </View>
      }
      items={items}
      onSelect={onSelect}
      disabled={disabled}
    />
  );
}