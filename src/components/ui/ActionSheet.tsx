import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
  Dimensions,
  SafeAreaView,
  TouchableWithoutFeedback,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/SimpleThemeProvider';

const { height: screenHeight } = Dimensions.get('window');

export interface ActionSheetAction {
  title: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  destructive?: boolean;
  disabled?: boolean;
}

export interface ActionSheetProps {
  visible: boolean;
  onClose: () => void;
  actions: ActionSheetAction[];
  title?: string;
  message?: string;
  cancelText?: string;
}

export function ActionSheet({
  visible,
  onClose,
  actions,
  title,
  message,
  cancelText = 'Cancel',
}: ActionSheetProps) {
  const { colors } = useTheme();
  const [slideAnim] = React.useState(new Animated.Value(screenHeight));

  React.useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 100,
        friction: 8,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: screenHeight,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, slideAnim]);

  const handleActionPress = (action: ActionSheetAction) => {
    if (!action.disabled) {
      onClose();
      // Small delay to allow modal to close smoothly
      setTimeout(() => {
        action.onPress();
      }, 100);
    }
  };

  const styles = StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'flex-end',
    },
    container: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingBottom: 20,
      maxHeight: screenHeight * 0.8,
    },
    header: {
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    title: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.foreground,
      textAlign: 'center',
      marginBottom: 4,
    },
    message: {
      fontSize: 14,
      color: colors.mutedForeground,
      textAlign: 'center',
      lineHeight: 20,
    },
    actionsContainer: {
      paddingTop: 8,
    },
    actionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingVertical: 16,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    actionIcon: {
      marginRight: 12,
      width: 24,
      alignItems: 'center',
    },
    actionText: {
      flex: 1,
      fontSize: 16,
      fontWeight: '500',
    },
    actionTextNormal: {
      color: colors.foreground,
    },
    actionTextDestructive: {
      color: colors.destructive,
    },
    actionTextDisabled: {
      color: colors.mutedForeground,
    },
    actionButtonDisabled: {
      opacity: 0.5,
    },
    cancelSection: {
      marginTop: 8,
      paddingTop: 8,
      borderTopWidth: 6,
      borderTopColor: colors.muted,
    },
    cancelButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 20,
      paddingVertical: 16,
    },
    cancelText: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.foreground,
    },
    handle: {
      width: 36,
      height: 4,
      backgroundColor: colors.muted,
      borderRadius: 2,
      alignSelf: 'center',
      marginTop: 8,
      marginBottom: 12,
    },
  });

  if (!visible) {
    return null;
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <Animated.View
              style={[
                styles.container,
                {
                  transform: [{ translateY: slideAnim }],
                },
              ]}
            >
              <SafeAreaView>
                <View style={styles.handle} />
                
                {(title || message) && (
                  <View style={styles.header}>
                    {title && <Text style={styles.title}>{title}</Text>}
                    {message && <Text style={styles.message}>{message}</Text>}
                  </View>
                )}

                <View style={styles.actionsContainer}>
                  {actions.map((action, index) => (
                    <TouchableOpacity
                      key={index}
                      style={[
                        styles.actionButton,
                        action.disabled && styles.actionButtonDisabled,
                        index === actions.length - 1 && { borderBottomWidth: 0 },
                      ]}
                      onPress={() => handleActionPress(action)}
                      disabled={action.disabled}
                      activeOpacity={action.disabled ? 1 : 0.7}
                    >
                      <View style={styles.actionIcon}>
                        {action.icon && (
                          <Ionicons
                            name={action.icon}
                            size={20}
                            color={
                              action.disabled
                                ? colors.mutedForeground
                                : action.destructive
                                ? colors.destructive
                                : colors.foreground
                            }
                          />
                        )}
                      </View>
                      <Text
                        style={[
                          styles.actionText,
                          action.destructive
                            ? styles.actionTextDestructive
                            : action.disabled
                            ? styles.actionTextDisabled
                            : styles.actionTextNormal,
                        ]}
                      >
                        {action.title}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={styles.cancelSection}>
                  <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
                    <Text style={styles.cancelText}>{cancelText}</Text>
                  </TouchableOpacity>
                </View>
              </SafeAreaView>
            </Animated.View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

// Export default for convenience
export default ActionSheet;