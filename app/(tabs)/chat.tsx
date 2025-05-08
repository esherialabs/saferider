import React, { useRef, useEffect } from 'react';
import { 
  StyleSheet, 
  View, 
  FlatList, 
  KeyboardAvoidingView, 
  Platform,
  TouchableOpacity
} from 'react-native';
import { useChatStore } from '@/store/chatStore';
import ChatMessage from '@/components/ChatMessage';
import ChatInput from '@/components/ChatInput';
import Colors from '@/constants/colors';
import { MoreVertical } from 'lucide-react-native';

export default function ChatScreen() {
  const { messages, addMessage } = useChatStore();
  const flatListRef = useRef<FlatList>(null);
  
  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messages.length > 0 && flatListRef.current) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);
  
  const handleSend = (text: string) => {
    // Add user message
    addMessage(text, true);
    
    // Simulate bot response after a short delay
    setTimeout(() => {
      let response = "I understand. Can you provide more details?";
      
      // Simple keyword matching for demo purposes
      if (text.toLowerCase().includes('harassment')) {
        response = "I'm sorry to hear about the harassment. Let me help you file a report. Would you like to proceed with an incident report?";
      } else if (text.toLowerCase().includes('assault')) {
        response = "I'm very sorry to hear about the assault. This is a serious matter. Would you like me to help you contact emergency services or file a police report?";
      } else if (text.toLowerCase().includes('help')) {
        response = "I can help you with legal advice, filing reports, or connecting you with support services. What specifically do you need assistance with?";
      } else if (text.toLowerCase().includes('report')) {
        response = "To file a report, I'll need some details about the incident. When and where did it occur?";
      }
      
      addMessage(response, false);
    }, 1000);
  };
  
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <View style={styles.headerRight}>
        <TouchableOpacity style={styles.headerButton}>
          <MoreVertical size={24} color={Colors.dark.text} />
        </TouchableOpacity>
      </View>
      
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={({ item }) => <ChatMessage message={item} />}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.messageList}
        showsVerticalScrollIndicator={false}
      />
      
      <ChatInput onSend={handleSend} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  messageList: {
    paddingVertical: 16,
  },
  headerRight: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 10,
  },
  headerButton: {
    padding: 8,
  },
});