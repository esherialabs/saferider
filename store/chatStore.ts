import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChatMessage, ChatState } from '@/types/chat';

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      messages: [
        {
          id: '1',
          text: 'Hello, how can I help you?',
          isUser: false,
          timestamp: new Date(Date.now() - 1000 * 60 * 5), // 5 minutes ago
        },
        {
          id: '2',
          text: 'I can assist you in filing an incident report.',
          isUser: false,
          timestamp: new Date(Date.now() - 1000 * 60 * 4), // 4 minutes ago
        },
        {
          id: '3',
          text: 'Please describe what happened.',
          isUser: false,
          timestamp: new Date(Date.now() - 1000 * 60 * 3), // 3 minutes ago
        },
      ],
      addMessage: (text, isUser) => 
        set((state) => ({
          messages: [
            ...state.messages,
            {
              id: Date.now().toString(),
              text,
              isUser,
              timestamp: new Date(),
            },
          ],
        })),
    }),
    {
      name: 'chat-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);