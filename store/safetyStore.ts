import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafetyStatus, HistoryItem, EmergencyContact, UserSettings } from '@/types';
import { historyItems, emergencyContacts } from '@/constants/mockData';

interface SafetyState {
  status: SafetyStatus;
  history: HistoryItem[];
  contacts: EmergencyContact[];
  settings: UserSettings;
  setStatus: (status: SafetyStatus) => void;
  addHistoryItem: (item: Omit<HistoryItem, 'id' | 'date'>) => void;
  addContact: (contact: Omit<EmergencyContact, 'id'>) => void;
  removeContact: (id: string) => void;
  updateSettings: (settings: Partial<UserSettings>) => void;
}

export const useSafetyStore = create<SafetyState>()(
  persist(
    (set) => ({
      status: 'safe',
      history: historyItems,
      contacts: emergencyContacts,
      settings: {
        name: 'User',
        phone: '',
        shareLocation: true,
        autoCheckIn: false,
        checkInInterval: 60,
      },
      setStatus: (status) => set({ status }),
      addHistoryItem: (item) => 
        set((state) => ({
          history: [
            {
              id: Date.now().toString(),
              date: new Date(),
              ...item,
            },
            ...state.history,
          ],
        })),
      addContact: (contact) =>
        set((state) => ({
          contacts: [
            ...state.contacts,
            {
              id: Date.now().toString(),
              ...contact,
            },
          ],
        })),
      removeContact: (id) =>
        set((state) => ({
          contacts: state.contacts.filter((contact) => contact.id !== id),
        })),
      updateSettings: (newSettings) =>
        set((state) => ({
          settings: {
            ...state.settings,
            ...newSettings,
          },
        })),
    }),
    {
      name: 'safety-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);