import { create } from 'zustand';
import { SafetyStatus } from '@/types';

export interface IncidentReport {
  incidentType: string;
  description: string;
  location?: string;
  date: Date;
  photos?: string[];
  witnesses?: string[];
  status: SafetyStatus;
}

interface IncidentState {
  currentStep: number;
  incidentReport: Partial<IncidentReport>;
  setCurrentStep: (step: number) => void;
  updateIncidentReport: (data: Partial<IncidentReport>) => void;
  resetIncidentReport: () => void;
}

export const useIncidentStore = create<IncidentState>((set) => ({
  currentStep: 1,
  incidentReport: {
    date: new Date(),
    status: 'danger',
  },
  setCurrentStep: (step) => set({ currentStep: step }),
  updateIncidentReport: (data) => 
    set((state) => ({
      incidentReport: {
        ...state.incidentReport,
        ...data,
      },
    })),
  resetIncidentReport: () => 
    set({
      currentStep: 1,
      incidentReport: {
        date: new Date(),
        status: 'danger',
      },
    }),
}));