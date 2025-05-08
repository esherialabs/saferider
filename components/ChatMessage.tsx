import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ChatMessage as ChatMessageType } from '@/types/chat';
import Colors from '@/constants/colors';

interface ChatMessageProps {
  message: ChatMessageType;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.isUser;
  
  return (
    <View style={[
      styles.container,
      isUser ? styles.userContainer : styles.botContainer
    ]}>
      <View style={[
        styles.bubble,
        isUser ? styles.userBubble : styles.botBubble
      ]}>
        <Text style={styles.messageText}>{message.text}</Text>
      </View>
      <Text style={styles.timestamp}>
        {formatTime(message.timestamp)}
      </Text>
    </View>
  );
}

const formatTime = (date: Date) => {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 8,
    maxWidth: '80%',
  },
  userContainer: {
    alignSelf: 'flex-end',
    marginRight: 16,
  },
  botContainer: {
    alignSelf: 'flex-start',
    marginLeft: 16,
  },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  userBubble: {
    backgroundColor: Colors.dark.accent,
  },
  botBubble: {
    backgroundColor: '#1E3A6E', // Slightly lighter than background
  },
  messageText: {
    color: Colors.dark.text,
    fontSize: 16,
  },
  timestamp: {
    fontSize: 12,
    color: Colors.dark.tabIconDefault,
    marginTop: 4,
    marginHorizontal: 8,
  },
});