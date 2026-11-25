import { getApp } from '@react-native-firebase/app'
import {
  equalTo,
  get,
  getDatabase,
  onValue,
  orderByChild,
  query,
  ref,
  runTransaction,
  set,
  update,
  type DataSnapshot
} from '@react-native-firebase/database'
import { getDeviceName } from 'react-native-device-info'
import type { ActiveTrip } from './tripStore'
import type {
  CaregiverUser,
  Journey,
  PWIDUser,
  UserData,
  UserLocation,
  UserType
} from '../types'
import type { IUserService } from './userService'
function cleanFirebaseValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(item => cleanFirebaseValue(item)) as T
  }
  if (value && typeof value === 'object') {
    const clean: Record<string, unknown> = {}
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
      if (item !== undefined) clean[key] = cleanFirebaseValue(item)
    })
    return clean as T
  }
  return value
}


/**
 * Ensure Firebase is initialized before using Database
 */
function ensureFirebaseInitialized(): void {
  try {
    const app = getApp()
    if (!app) {
      throw new Error('Firebase app is not initialized')
    }
  } catch (error) {
    console.error('Firebase initialization error:', error)
    throw new Error(
      'Firebase is not initialized. Make sure @react-native-firebase/app plugin is configured in app.config.ts and google-services.json is present.'
    )
  }
}

export const userService: IUserService = {
  createUser: async (
    phoneNumber: string,
    userType: UserType,
    uid: string,
    initialData: Partial<UserData> = {}
  ): Promise<UserData> => {
    ensureFirebaseInitialized()
    try {
      const deviceName = await getDeviceName()
      const timestamp = Date.now()
      if (userType === 'PWID') {
        const pwidData: PWIDUser = {
          uid,
          name: initialData.name || '',
          phoneNumber,
          userType: 'PWID',
          deviceName,
          createdAt: timestamp,
          updatedAt: timestamp,
          ...(initialData as Partial<PWIDUser>)
        }
        await set(ref(getDatabase(), `users/${phoneNumber}`), pwidData)
        return pwidData
      } else {
        const caregiverData: CaregiverUser = {
          uid,
          name: initialData.name || '',
          phoneNumber,
          userType: 'CAREGIVER',
          deviceName,
          createdAt: timestamp,
          updatedAt: timestamp,
          ...(initialData as Partial<CaregiverUser>)
        }
        await set(ref(getDatabase(), `users/${phoneNumber}`), caregiverData)
        return caregiverData
      }
    } catch (error) {
      console.error('Error creating user in database:', error)
      throw error
    }
  },

  updatePWIDLocation: async (phoneNumber: string, location: UserLocation) => {
    try {
      await set(ref(getDatabase(), `users/${phoneNumber}/location`), location)
      await set(
        ref(getDatabase(), `users/${phoneNumber}/updatedAt`),
        Date.now()
      )
    } catch (error) {
      console.error('Error updating PWID location:', error)
      throw error
    }
  },

  stopPWIDLocationSharing: async (phoneNumber: string) => {
    try {
      await update(ref(getDatabase(), `users/${phoneNumber}/location`), {
        isSharing: false
      })
      await set(
        ref(getDatabase(), `users/${phoneNumber}/updatedAt`),
        Date.now()
      )
    } catch (error) {
      console.error('Error stopping PWID location sharing:', error)
      throw error
    }
  },

  getUserData: async (phoneNumber: string) => {
    try {
      const snapshot = await get(ref(getDatabase(), `users/${phoneNumber}`))
      return snapshot.val()
    } catch (error) {
      console.error('Error getting user data:', error)
      throw error
    }
  },

  updatePWIDCaregiver: async (pwidPhone: string, caregiverPhone: string) => {
    try {
      await set(
        ref(getDatabase(), `users/${pwidPhone}/caregiverPhone`),
        caregiverPhone
      )
      await set(ref(getDatabase(), `users/${pwidPhone}/updatedAt`), Date.now())
    } catch (error) {
      console.error('Error updating PWID caregiver:', error)
      throw error
    }
  },

  storeFCMToken: async (phoneNumber: string, fcmToken: string) => {
    try {
      await set(ref(getDatabase(), `users/${phoneNumber}/fcmToken`), fcmToken)
      await set(
        ref(getDatabase(), `users/${phoneNumber}/updatedAt`),
        Date.now()
      )
    } catch (error) {
      console.error('Error storing FCM token:', error)
      throw error
    }
  },

  getFCMToken: async (phoneNumber: string) => {
    try {
      const snapshot = await get(
        ref(getDatabase(), `users/${phoneNumber}/fcmToken`)
      )
      return snapshot.val()
    } catch (error) {
      console.error('Error getting FCM token for user:', error)
      throw error
    }
  },

  listenToPWIDLocation: (phoneNumber, callback) => {
    const locationRef = ref(getDatabase(), `users/${phoneNumber}/location`)
    return onValue(locationRef, (snapshot) => callback(snapshot.val()))
  },

  setPWIDActiveTrip: async (phoneNumber, trip) => {
    try {
      const db = getDatabase()
      await update(ref(db, `users/${phoneNumber}`), {
        activeTrip: trip,
        updatedAt: Date.now()
      })
    } catch (error) {
      console.error('Error updating active trip:', error)
      throw error
    }
  },

  subscribeToActiveTrip: (phoneNumber, callback) => {
    const db = getDatabase()
    const tripRef = ref(db, `users/${phoneNumber}/activeTrip`)
    return onValue(tripRef, (snapshot: DataSnapshot) => {
      callback(snapshot.exists() ? (snapshot.val() as ActiveTrip) : null)
    })
  },

  getPWIDsByCaregiverPhone: async (caregiverPhone: string) => {
    const snapshot = await get(
      query(
        ref(getDatabase(), 'users'),
        orderByChild('caregiverPhone'),
        equalTo(caregiverPhone)
      )
    )

    const pwidUsers: PWIDUser[] = []
    snapshot.forEach((child) => {
      const val = child.val()
      if (val && val.userType === 'PWID') {
        pwidUsers.push(val as PWIDUser)
      }
      return undefined
    })
    return pwidUsers
  },

  savePWIDJourney: async (phoneNumber: string, journey: Journey) => {
    const journeysRef = ref(getDatabase(), `users/${phoneNumber}/journeys`)
    const result = await runTransaction(journeysRef, current => {
      const list: Journey[] = Array.isArray(current)
        ? current
        : current && typeof current === 'object'
          ? Object.values(current as Record<string, Journey>)
          : []
      return [journey, ...list.filter(item => item.id !== journey.id)].sort(
        (a, b) => b.updatedAt - a.updatedAt
      )
    })
    const value = result.snapshot.val()
    return Array.isArray(value) ? value : value ? Object.values(value as Record<string, Journey>) : []
  },

  deletePWIDJourney: async (phoneNumber: string, journeyId: string) => {
    const journeysRef = ref(getDatabase(), `users/${phoneNumber}/journeys`)
    const result = await runTransaction(journeysRef, current => {
      const list: Journey[] = Array.isArray(current)
        ? current
        : current && typeof current === 'object'
          ? Object.values(current as Record<string, Journey>)
          : []
      return list.filter(item => item.id !== journeyId)
    })
    const value = result.snapshot.val()
    return Array.isArray(value) ? value : value ? Object.values(value as Record<string, Journey>) : []
  },

  updateUserData: async (phoneNumber: string, updates: Partial<UserData>) => {
    try {
      const userRef = ref(getDatabase(), `users/${phoneNumber}`)
      // Only write the fields the caller changed. A read-modify-write here
      // would overwrite a fresher location or active trip from another device.
      await update(userRef, cleanFirebaseValue({
        ...updates,
        updatedAt: Date.now()
      }))
    } catch (error) {
      console.error('Error updating user data:', error)
      throw error
    }
  }
} satisfies IUserService

// Export individual functions for backward compatibility
export const createUser = userService.createUser
export const updatePWIDLocation = userService.updatePWIDLocation
export const stopPWIDLocationSharing = userService.stopPWIDLocationSharing
export const getUserData = userService.getUserData
export const updatePWIDCaregiver = userService.updatePWIDCaregiver
export const storeFCMToken = userService.storeFCMToken
export const getFCMToken = userService.getFCMToken
export const listenToPWIDLocation = userService.listenToPWIDLocation
export const getPWIDsByCaregiverPhone = userService.getPWIDsByCaregiverPhone
export const updateUserData = userService.updateUserData
export const savePWIDJourney = userService.savePWIDJourney
export const deletePWIDJourney = userService.deletePWIDJourney
export const setPWIDActiveTrip = userService.setPWIDActiveTrip
export const subscribeToActiveTrip = userService.subscribeToActiveTrip
