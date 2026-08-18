import React from 'react';
import { RadioGroupItem, RadioGroupItemProps } from './RadioGroup';

// RadioButton is an alias for RadioGroupItem to maintain compatibility
export interface RadioButtonProps extends Omit<RadioGroupItemProps, 'value'> {
  value?: string;
  selected?: boolean;
  onSelect?: () => void;
  onPress?: () => void;
}

export function RadioButton({ onPress, onSelect, value = 'radio-button', ...props }: RadioButtonProps) {
  const handleSelect = onSelect ?? onPress;
  return <RadioGroupItem {...props} value={value} onSelect={handleSelect} />;
}

// Also export as default for convenience
export default RadioButton;
