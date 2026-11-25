import type { ILocalStore } from './localStore'

function storage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export const localStore: ILocalStore = {
  getItem: async key => storage()?.getItem(key) ?? null,
  setItem: async (key, value) => {
    storage()?.setItem(key, value)
  },
  removeItem: async key => {
    storage()?.removeItem(key)
  },
  removeItems: async keys => {
    const store = storage()
    if (!store) return
    keys.forEach(key => store.removeItem(key))
  },
  getAllKeys: async () => {
    const store = storage()
    if (!store) return []
    return Object.keys(store)
  }
}

export const getStoredItem = localStore.getItem
export const setStoredItem = localStore.setItem
export const removeStoredItem = localStore.removeItem
export const removeStoredItems = localStore.removeItems
