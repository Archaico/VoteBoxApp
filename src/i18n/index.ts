// src/i18n/index.ts
//
// i18next setup. Language = the user's saved choice, else the phone's
// language if we have it, else English. Import this module once (App.tsx)
// before any screen renders. Components use `useTranslation('<namespace>')`;
// services outside React use `i18n.t('<namespace>:<key>')`.

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { resources, NAMESPACES, LANGUAGES } from './locales';

const LANGUAGE_KEY = '@app_language';

const isSupported = (code: string | null | undefined): code is string =>
  !!code && LANGUAGES.some(l => l.code === code);

function deviceLanguage(): string {
  const code = Localization.getLocales()[0]?.languageCode;
  return isSupported(code) ? code : 'en';
}

i18n.use(initReactI18next).init({
  resources,
  ns: [...NAMESPACES],
  defaultNS: 'common',
  lng: deviceLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React already escapes
  returnNull: false,
});

// Applies a previously saved manual choice (async, so it runs just after start-up).
export async function loadSavedLanguage(): Promise<void> {
  try {
    const saved = await AsyncStorage.getItem(LANGUAGE_KEY);
    if (isSupported(saved) && saved !== i18n.language) await i18n.changeLanguage(saved);
  } catch {
    // keep the device/default language
  }
}

export async function setLanguage(code: string): Promise<void> {
  if (!isSupported(code)) return;
  await i18n.changeLanguage(code);
  await AsyncStorage.setItem(LANGUAGE_KEY, code).catch(() => {});
}

export { LANGUAGES };
export default i18n;
