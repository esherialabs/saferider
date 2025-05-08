import { SafetyStatus, HistoryItem, EmergencyContact } from '@/types';

export const historyItems: HistoryItem[] = [
  {
    id: '1',
    date: new Date(Date.now() - 86400000 * 2), // 2 days ago
    status: 'safe',
    description: 'Regular check-in',
  },
  {
    id: '2',
    date: new Date(Date.now() - 86400000 * 5), // 5 days ago
    status: 'danger',
    description: 'Emergency reported',
    location: 'Downtown, Main Street',
  },
  {
    id: '3',
    date: new Date(Date.now() - 86400000 * 7), // 7 days ago
    status: 'warning',
    description: 'Feeling unsafe',
    location: 'Central Park',
  },
  {
    id: '4',
    date: new Date(Date.now() - 86400000 * 10), // 10 days ago
    status: 'safe',
    description: 'Regular check-in',
  },
];

export const emergencyContacts: EmergencyContact[] = [
  {
    id: '1',
    name: 'Emergency Services',
    phone: '911',
    isPrimary: true,
  },
  {
    id: '2',
    name: 'John Doe',
    phone: '555-123-4567',
    isPrimary: false,
  },
  {
    id: '3',
    name: 'Jane Smith',
    phone: '555-987-6543',
    isPrimary: false,
  },
];