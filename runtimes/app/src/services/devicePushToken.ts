import { getStoredItem, removeStoredItem, setStoredItem } from './localStore'

const key = (phoneNumber: string) => `eb-device-fcm-token:${phoneNumber}`

/**
 * The account stores one FCM token, so a caregiver with several devices
 * overwrites it every time another device registers. Keep this device's token
 * locally as well to distinguish "this phone registered" from "some phone
 * registered for this account".
 */
export async function setDevicePushToken(
  phoneNumber: string,
  token: string
): Promise<void> {
  if (!phoneNumber || !token) return
  try {
    await setStoredItem(key(phoneNumber), token)
  } catch (error) {
    console.error('Error saving device push token:', error)
  }
}

export async function getDevicePushToken(
  phoneNumber: string
): Promise<string | null> {
  if (!phoneNumber) return null
  try {
    return await getStoredItem(key(phoneNumber))
  } catch (error) {
    console.error('Error reading device push token:', error)
    return null
  }
}

export async function clearDevicePushToken(phoneNumber: string): Promise<void> {
  if (!phoneNumber) return
  try {
    await removeStoredItem(key(phoneNumber))
  } catch (error) {
    console.error('Error clearing device push token:', error)
  }
}
