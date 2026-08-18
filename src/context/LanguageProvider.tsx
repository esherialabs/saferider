import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  DEFAULT_LANGUAGE_CODE,
  getLanguageByCode,
  isLanguageSelectable,
  normalizeSelectableLanguageCode,
  type SelectableAppLanguageCode,
} from '../config/languageAvailability';

const LANGUAGE_STORAGE_KEY = 'safe_ride_language_preference';

type LanguageContextValue = {
  languageCode: SelectableAppLanguageCode;
  isHydrated: boolean;
  setLanguage: (languageCode: string) => Promise<boolean>;
};

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

export function LanguageProvider({ children }: PropsWithChildren<{}>) {
  const [languageCode, setLanguageCode] = useState<SelectableAppLanguageCode>(DEFAULT_LANGUAGE_CODE);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const hydrate = async () => {
      try {
        const storedLanguageCode = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
        if (!isMounted) return;
        setLanguageCode(normalizeSelectableLanguageCode(storedLanguageCode));
      } catch (error) {
        console.warn('Failed to load language preference', error);
        if (isMounted) {
          setLanguageCode(DEFAULT_LANGUAGE_CODE);
        }
      } finally {
        if (isMounted) {
          setIsHydrated(true);
        }
      }
    };

    hydrate();

    return () => {
      isMounted = false;
    };
  }, []);

  const setLanguage = useCallback(async (nextLanguageCode: string) => {
    const language = getLanguageByCode(nextLanguageCode);
    if (!language || !isLanguageSelectable(nextLanguageCode)) {
      return false;
    }

    const normalizedLanguageCode = normalizeSelectableLanguageCode(nextLanguageCode);
    setLanguageCode(normalizedLanguageCode);

    try {
      await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, normalizedLanguageCode);
    } catch (error) {
      console.warn('Failed to persist language preference', error);
    }

    return true;
  }, []);

  const value = useMemo<LanguageContextValue>(() => ({
    languageCode,
    isHydrated,
    setLanguage,
  }), [isHydrated, languageCode, setLanguage]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }

  return context;
}
