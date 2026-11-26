import * as Location from 'expo-location'
import * as TaskManager from 'expo-task-manager'
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Alert, AppState } from 'react-native'
import notificationService from '../services/notificationService'
import { usePreferences } from './PreferencesContext'
import { getUserStorage } from '../services/storageService'
import { subscribeSessionChanged } from '../services/sessionEvents'
import { getActiveTrip, initTripStore, subscribeToTrip, type ActiveTrip } from '../services/tripStore'
import {
  clearLocationAutoStop,
  markLocationAutoStop,
  readLocationAutoStop
} from '../services/locationAutoStop'
import {
  getUserData,
  stopPWIDLocationSharing,
  updatePWIDLocation
} from '../services/userService'
import type { PWIDUser } from '../types'

type LocationSharingContextType = {
  isLocationSharing: boolean
  setIsLocationSharing: (share: boolean) => void
  setDestination: (dest: { lat: number; lng: number } | null) => void
  destination: { lat: number; lng: number } | null
  permissionDenied: boolean
  sharingError: string | null
  autoStopped: boolean
  retrySharing: () => void
  resetAutoStop: (clearSharingError?: boolean) => void
}

const LocationSharingContext = createContext<LocationSharingContextType | undefined>(undefined)
const BACKGROUND_TASK = 'background_location'

const backgroundState: {
  phone: string | null
  destination: { lat: number; lng: number } | null
  privacyMode: string | null
  stoppedPhone: string | null
} = {
  phone: null,
  destination: null,
  // Null means this is a fresh process. The active trip's saved privacy mode
  // is the only reliable copy after an OS relaunch.
  privacyMode: null,
  stoppedPhone: null
}

function getDistanceFromLatLonInMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371e3
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

// Expo requires this at module scope. If the OS relaunches the app in the
// background after it was killed, this file runs and the task is available.
if (!TaskManager.isTaskDefined(BACKGROUND_TASK)) {
  TaskManager.defineTask(BACKGROUND_TASK, async ({ data, error }) => {
    if (error) {
      console.error('Background location error:', error.message)
      return
    }
    const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations
    const loc = locations?.[0]
    if (!loc) return
    try {
      await initTripStore()
      const stored = backgroundState.phone ? null : await getUserStorage()
      const phone = backgroundState.phone || stored?.phoneNumber || getActiveTrip()?.travellerPhone || null
      if (!phone) return
      const trip = getActiveTrip()
      await updatePWIDLocation(phone, {
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        updatedAt: Date.now(),
        isSharing: true
      })
      const target = backgroundState.destination || trip?.destinationLatLng || null
      const privacyMode = backgroundState.privacyMode || trip?.privacyMode || 'trip-only'
      if (target && privacyMode !== 'always') {
        const distance = getDistanceFromLatLonInMeters(
          loc.coords.latitude,
          loc.coords.longitude,
          target.lat,
          target.lng
        )
        if (distance < 20) {
          const reason = 'Arrived at destination'
          await stopPWIDLocationSharing(phone)
          // Write the marker before unregistering the task. The foreground
          // poll can otherwise see "task gone, marker absent" in the gap and
          // report a lost connection instead of an arrival.
          await markLocationAutoStop(phone, reason)
          backgroundState.destination = null
          backgroundState.stoppedPhone = phone
          if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK)) {
            await Location.stopLocationUpdatesAsync(BACKGROUND_TASK)
          }
          try {
            const pwidUser = await getUserData(phone)
            if (pwidUser && pwidUser.userType === 'PWID') {
              const pwid = pwidUser as PWIDUser
              if (pwid.caregiverPhone) {
                await notificationService.sendLocationStopNotification(
                  phone,
                  pwid.caregiverPhone,
                  reason
                )
              }
            }
          } catch (notificationError) {
            console.error('Error sending arrival notification:', notificationError)
          }
        }
      }
    } catch (updateError) {
      console.error('Error updating background location:', updateError)
    }
  })
}

export const LocationSharingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { preferences, ready } = usePreferences()
  const [isLocationSharing, setIsLocationSharingState] = useState(false)
  const [pwidPhoneNumber, setPwidPhoneNumber] = useState<string | null>(null)
  const [userType, setUserType] = useState<string | undefined>()
  const [preview, setPreview] = useState(false)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [sharingError, setSharingError] = useState<string | null>(null)
  const [autoStopped, setAutoStopped] = useState(false)
  const [activeTrip, setActiveTrip] = useState<ActiveTrip | null>(getActiveTrip)
  const [destination, setDestinationState] = useState<{ lat: number; lng: number } | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [tripHydrated, setTripHydrated] = useState(false)

  const permissionDeniedRef = useRef(false)
  const shouldShareRef = useRef(false)
  const notifiedShareRef = useRef(false)
  const hasStartedSharingRef = useRef(false)
  const startAttemptRef = useRef(0)
  const startedAtRef = useRef(0)
  const stopReasonRef = useRef<string | undefined>(undefined)
  const pwidPhoneRef = useRef<string | null>(null)

  useEffect(() => {
    backgroundState.destination = destination
  }, [destination])

  useEffect(() => {
    // Do not publish the default mode while preferences are still loading.
    // A task firing in that window would treat an Always traveller as
    // trip-only and stop sharing at the destination.
    if (!ready) return
    backgroundState.privacyMode = preferences.privacyMode
  }, [preferences.privacyMode, ready])

  useEffect(() => {
    const phone = pwidPhoneNumber
    pwidPhoneRef.current = phone
    backgroundState.phone = phone
  }, [pwidPhoneNumber])

  useEffect(() => {
    let active = true
    initTripStore()
      .catch(error => console.error('Error loading trip state:', error))
      .finally(() => {
        if (!active) return
        setActiveTrip(getActiveTrip())
        setTripHydrated(true)
      })
    const unsubscribe = subscribeToTrip(setActiveTrip)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setSessionReady(false)
      setIsLocationSharingState(false)
      setPermissionDenied(false)
      permissionDeniedRef.current = false
      setSharingError(null)
      setAutoStopped(false)
      try {
        const stored = await getUserStorage()
        if (cancelled) return
        setPwidPhoneNumber(stored?.phoneNumber || null)
        setUserType(stored?.userType)
        setPreview(Boolean(stored?.preview))
        if (stored?.userType !== 'PWID') {
          setIsLocationSharingState(false)
          setPermissionDenied(false)
          permissionDeniedRef.current = false
          setSharingError(null)
          return
        }
        if (stored.phoneNumber) {
          const autoStop = await readLocationAutoStop(stored.phoneNumber)
          if (cancelled) return
          if (autoStop) {
            // The background task already stopped at the destination. Do not
            // start sharing again when the same trip is reopened.
            setDestinationState(null)
            setAutoStopped(true)
          }
        }
      } finally {
        if (!cancelled) setSessionReady(true)
      }
    }
    load().catch(error => console.error('Error loading location session:', error))
    const unsubscribe = subscribeSessionChanged(load)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const reconcileAutoStop = useCallback(async () => {
    const phone = pwidPhoneRef.current
    if (!phone) return
    backgroundState.stoppedPhone = null
    setDestinationState(null)
    setAutoStopped(true)
    // The background task already wrote isSharing: false and sent the
    // arrival notification. Suppress a second generic stop notification.
    hasStartedSharingRef.current = false
    notifiedShareRef.current = false
    stopReasonRef.current = undefined
    // Keep the durable marker until the trip ends or starts again. Clearing
    // it here would let a relaunch start sharing after the traveller is
    // already at the destination.
    setIsLocationSharingState(false)
  }, [])

  // A background auto-stop cannot call React state setters from a headless
  // context. The marker is visible across runtimes; reconcile on resume.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') return
      const phone = pwidPhoneRef.current
      if (!phone) return
      void (async () => {
        const marker = await readLocationAutoStop(phone)
        if (marker || backgroundState.stoppedPhone === phone) {
          await reconcileAutoStop()
        }
      })()
    })
    return () => subscription.remove()
  }, [reconcileAutoStop])

  const sendShareNotificationToCaregiver = useCallback(async () => {
    try {
      if (!pwidPhoneNumber) return
      const pwidUser = await getUserData(pwidPhoneNumber)
      if (pwidUser && pwidUser.userType === 'PWID') {
        const pwid = pwidUser as PWIDUser
        if (pwid.caregiverPhone) {
          await notificationService.sendLocationShareNotification(pwidPhoneNumber, pwid.caregiverPhone)
        }
      }
    } catch (error) {
      console.error('Error sending location share notification:', error)
    }
  }, [pwidPhoneNumber])

  const sendStopNotificationToCaregiver = useCallback(async () => {
    try {
      if (!pwidPhoneNumber) return
      const pwidUser = await getUserData(pwidPhoneNumber)
      if (pwidUser && pwidUser.userType === 'PWID') {
        const pwid = pwidUser as PWIDUser
        if (pwid.caregiverPhone) {
          await notificationService.sendLocationStopNotification(
            pwidPhoneNumber,
            pwid.caregiverPhone,
            stopReasonRef.current || 'Location sharing stopped'
          )
        }
      }
    } catch (error) {
      console.error('Error sending stop notification to caregiver:', error)
    } finally {
      stopReasonRef.current = undefined
    }
  }, [pwidPhoneNumber])

  const reconcileLostTracking = useCallback(() => {
    const phone = pwidPhoneRef.current
    if (!phone) return
    backgroundState.stoppedPhone = null
    const shouldNotify = notifiedShareRef.current
    hasStartedSharingRef.current = false
    notifiedShareRef.current = false
    stopReasonRef.current = 'Location sharing stopped on the traveller’s phone'
    // This is a lost connection, not an arrival. Keep autoStopped false so the
    // error banner and retry path own the decision to start again.
    setSharingError('Location sharing stopped. Tap Try location again.')
    setIsLocationSharingState(false)
    stopPWIDLocationSharing(phone).catch(error =>
      console.error('Error clearing location sharing:', error)
    )
    if (shouldNotify) {
      void sendStopNotificationToCaregiver()
    } else {
      stopReasonRef.current = undefined
    }
  }, [sendStopNotificationToCaregiver])

  // Only a PWID account starts sharing automatically. Caregivers never share.
  useEffect(() => {
    if (!ready || !sessionReady || !tripHydrated) return
    if (preview || userType !== 'PWID' || preferences.privacyMode === 'paused') {
      shouldShareRef.current = false
      setIsLocationSharingState(false)
      return
    }
    const tripIsActive = Boolean(activeTrip && activeTrip.stage !== 'arrived')
    const shouldShare =
      preferences.privacyMode === 'always' ||
      (preferences.privacyMode === 'trip-only' && tripIsActive)
    if (!shouldShare) {
      shouldShareRef.current = false
      setIsLocationSharingState(false)
      return
    }
    const canShare =
      !permissionDeniedRef.current &&
      !sharingError &&
      (preferences.privacyMode === 'always' || !autoStopped)
    shouldShareRef.current = canShare
    if (canShare) {
      if (preferences.privacyMode === 'always' && pwidPhoneNumber) {
        void clearLocationAutoStop(pwidPhoneNumber)
      }
      setIsLocationSharingState(true)
    }
  }, [
    activeTrip,
    autoStopped,
    preferences.privacyMode,
    preview,
    pwidPhoneNumber,
    ready,
    sessionReady,
    sharingError,
    tripHydrated,
    userType
  ])

  useEffect(() => {
    const stopLocationUpdates = async () => {
      try {
        if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK)) {
          await Location.stopLocationUpdatesAsync(BACKGROUND_TASK)
        }
      } catch (error) {
        console.error('Error stopping background location:', error)
      }
    }

    const stopSharing = async () => {
      await stopLocationUpdates()
      if (!hasStartedSharingRef.current || !pwidPhoneNumber) return
      // The background task handles the arrival stop itself. If its marker is
      // present, it already cleared the remote flag and sent the reason.
      const autoStop = await readLocationAutoStop(pwidPhoneNumber)
      hasStartedSharingRef.current = false
      if (autoStop) {
        notifiedShareRef.current = false
        return
      }
      stopPWIDLocationSharing(pwidPhoneNumber).catch(() => {})
      if (notifiedShareRef.current) {
        void sendStopNotificationToCaregiver()
        notifiedShareRef.current = false
      }
    }

    // Wait for the session and saved trip before deciding to stop. On a cold
    // start the first render is always false, and stopping there would kill
    // the task left running by the previous session.
    if (!ready || !sessionReady || !tripHydrated) return

    const attempt = ++startAttemptRef.current

    if (!isLocationSharing || !pwidPhoneNumber || userType !== 'PWID' || preview) {
      // The auto-share effect runs in the same commit and may just have set
      // isLocationSharing true. Do not stop the task left running by the
      // previous session in that window.
      if (shouldShareRef.current) return
      void stopSharing()
      return
    }

    const startSharing = async () => {
      // A background relaunch may already have the task running. Do not start
      // a second one or send a duplicate share notification.
      if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK)) {
        if (attempt === startAttemptRef.current) {
          hasStartedSharingRef.current = true
          notifiedShareRef.current = true
          startedAtRef.current = Date.now()
        }
        return
      }

      const foreground = await Location.getForegroundPermissionsAsync()
      const background = await Location.getBackgroundPermissionsAsync()
      if (attempt !== startAttemptRef.current) return
      const foregroundGranted = foreground.granted
        ? true
        : (await Location.requestForegroundPermissionsAsync()).granted
      if (attempt !== startAttemptRef.current) return
      const backgroundGranted = background.granted
        ? true
        : (await Location.requestBackgroundPermissionsAsync()).granted
      if (attempt !== startAttemptRef.current) return

      if (!foregroundGranted || !backgroundGranted) {
        permissionDeniedRef.current = true
        setPermissionDenied(true)
        setSharingError('Allow location for this app to share your trip.')
        setIsLocationSharingState(false)
        Alert.alert('Location is off', 'Allow location for EasyBoard to share your trip. You can turn it on in phone Settings.')
        return
      }

      try {
        await Location.startLocationUpdatesAsync(BACKGROUND_TASK, {
          accuracy: Location.Accuracy.High,
          timeInterval: 1000,
          distanceInterval: 10,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: 'Location sharing active',
            notificationBody: 'You are sharing this trip with your caregiver.',
            notificationColor: '#1D5BB8'
          }
        })
        hasStartedSharingRef.current = true
        startedAtRef.current = Date.now()

        // The trip may have ended while the permission prompts were open.
        if (attempt !== startAttemptRef.current) {
          await stopSharing()
          return
        }

        await sendShareNotificationToCaregiver()
        if (attempt === startAttemptRef.current) {
          notifiedShareRef.current = true
        }
      } catch (error) {
        console.error('Error starting location sharing:', error)
        hasStartedSharingRef.current = false
        setSharingError('Could not start location sharing. Check your phone settings.')
        setIsLocationSharingState(false)
      }
    }

    void startSharing()

    return () => {
      startAttemptRef.current += 1
      void stopSharing()
    }
  }, [
    isLocationSharing,
    pwidPhoneNumber,
    sendShareNotificationToCaregiver,
    sendStopNotificationToCaregiver,
    preview,
    ready,
    sessionReady,
    tripHydrated,
    userType
  ])

  // The app can stay in the foreground while the background task stops at the
  // destination. Poll the durable marker and task registration so the screen
  // does not keep saying "Sharing" after updates have stopped.
  useEffect(() => {
    if (!sessionReady || !isLocationSharing || !pwidPhoneNumber) return
    let active = true
    const check = async () => {
      const marker = await readLocationAutoStop(pwidPhoneNumber)
      if (!active) return
      if (marker || backgroundState.stoppedPhone === pwidPhoneNumber) {
        await reconcileAutoStop()
        return
      }
      if (!hasStartedSharingRef.current) return
      if (Date.now() - startedAtRef.current < 5000) return
      const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK)
      if (!active) return
      if (!registered) {
        const lateMarker = await readLocationAutoStop(pwidPhoneNumber)
        if (!active) return
        if (lateMarker || backgroundState.stoppedPhone === pwidPhoneNumber) {
          await reconcileAutoStop()
        } else {
          reconcileLostTracking()
        }
      }
    }
    void check()
    const timer = setInterval(() => void check(), 2500)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [
    isLocationSharing,
    pwidPhoneNumber,
    reconcileAutoStop,
    reconcileLostTracking,
    sessionReady
  ])

  const setIsLocationSharing = useCallback((share: boolean) => {
    if (share && permissionDeniedRef.current) return
    setIsLocationSharingState(share)
  }, [])

  const resetAutoStop = useCallback((clearSharingError = false) => {
    setAutoStopped(false)
    // Starting a live trip is a new attempt. Ending one is not, so the home
    // retry banner can stay until the traveller chooses to try again.
    if (clearSharingError) {
      setSharingError(null)
      setPermissionDenied(false)
      permissionDeniedRef.current = false
    }
    const phone = pwidPhoneRef.current
    if (phone) void clearLocationAutoStop(phone)
  }, [])

  const retrySharing = useCallback(() => {
    setAutoStopped(false)
    const phone = pwidPhoneRef.current
    if (phone) void clearLocationAutoStop(phone)
    permissionDeniedRef.current = false
    setPermissionDenied(false)
    setSharingError(null)
    setIsLocationSharingState(true)
  }, [])

  const setDestination = useCallback((dest: { lat: number; lng: number } | null) => {
    setDestinationState(dest)
  }, [])

  return (
    <LocationSharingContext.Provider
      value={{
        isLocationSharing,
        setIsLocationSharing,
        destination,
        setDestination,
        permissionDenied,
        sharingError,
        autoStopped,
        resetAutoStop,
        retrySharing
      }}
    >
      {children}
    </LocationSharingContext.Provider>
  )
}

export const useLocationSharing = () => {
  const context = useContext(LocationSharingContext)
  if (!context) {
    throw new Error('useLocationSharing must be used within a LocationSharingProvider')
  }
  return context
}
