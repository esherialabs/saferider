import React, { useState } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { ArrowUp } from 'lucide-react-native';
import Colors from '@/constants/colors';
import * as Haptics from 'expo-haptics';

interface ChatInputProps {
  onSend: (text: string) => void;
}

export default function ChatInput({ onSend }: ChatInputProps) {
  const [message, setMessage] = useState('');
  
  const handleSend = () => {
    if (message.trim()) {
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      
      onSend(message.trim());
      setMessage('');
    }
  };
  
  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        placeholder="Type a message..."
        placeholderTextColor="#8E9AAF"
        value={message}
        onChangeText={setMessage}
        multiline
        maxLength={500}
        returnKeyType="send"
        onSubmitEditing={handleSend}
      />
      <TouchableOpacity 
        style={styles.sendButton} 
        onPress={handleSend}
        disabled={!message.trim()}
      >
        <ArrowUp size={20} color={Colors.dark.text} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#061530', // Darker than background
    borderTopWidth: 1,
    borderTopColor: '#1E3A6E',
  },
  input: {
    flex: 1,
    backgroundColor: '#1E3A6E',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginRight: 8,
    color: Colors.dark.text,
    maxHeight: 100,
  },
  sendButton: {
    backgroundColor: Colors.dark.accent,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});