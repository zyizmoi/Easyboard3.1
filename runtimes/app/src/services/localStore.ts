export interface ILocalStore {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
  removeItems(keys: string[]): Promise<void>
  getAllKeys(): Promise<string[]>
}

export * from './localStore.native'
