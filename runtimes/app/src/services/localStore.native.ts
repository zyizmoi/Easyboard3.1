import AsyncStorage from '@react-native-async-storage/async-storage'
import type { ILocalStore } from './localStore'

export const localStore: ILocalStore = {
  getItem: key => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: key => AsyncStorage.removeItem(key),
  removeItems: keys => AsyncStorage.multiRemove(keys),
  getAllKeys: async () => Array.from(await AsyncStorage.getAllKeys())
}

export const getStoredItem = localStore.getItem
export const setStoredItem = localStore.setItem
export const removeStoredItem = localStore.removeItem
export const removeStoredItems = localStore.removeItems
