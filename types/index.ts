export type SafetyStatus = 'safe' | 'warning' | 'danger';

export interface HistoryItem {
  id: string;
  date: Date;
  status: SafetyStatus;
  description: string;
  location?: string;
}

export interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  isPrimary: boolean;
}

export interface UserSettings {
  name: string;
  phone: string;
  shareLocation: boolean;
  autoCheckIn: boolean;
  checkInInterval: number; // in minutes
}