import '../../global.css'

import { Stack, useRouter } from 'expo-router'
import React, { useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import { AuthRouteGuard } from '@/components'
import {
  AuthProvider,
  LocationSharingProvider,
  NavigationProvider,
  PreferencesProvider,
  useAuth
} from '@/contexts'
import { Provider } from '@/provider'
import notificationService, { setNavigationCallback } from '@/services'
import { initTripStore } from '@/services/tripStore'

function RootLayoutNav() {
  const { hasAuthen, userType } = useAuth()

  const router = useRouter()
  // Keep the latest router without re-running notification setup on every
  // render (re-running would add duplicate listeners)
  const routerRef = useRef(router)
  useEffect(() => {
    routerRef.current = router
  }, [router])

  // Set navigation callbacks and foreground listeners. Permission is requested
  // only from an explicit button, never during sign-in.
  useEffect(() => {
    setNavigationCallback((screen, params) =>
      routerRef.current.navigate({ pathname: screen, params })
    )

    let unsubscribe: (() => void) | undefined
    try {
      unsubscribe = notificationService.setupNotificationListeners()
    } catch (error) {
      console.error('Failed to set up notification listeners:', error)
    }

    if (hasAuthen) {
      notificationService
        .checkPermissions()
        .then(granted => {
          // Local web development has no push service. Production web and
          // native builds register silently after permission is granted.
          if (granted && (Platform.OS !== 'web' || !__DEV__)) {
            return notificationService.initialize()
          }
          return null
        })
        .catch(error => console.error('Failed to initialize notifications:', error))
    }

    return () => unsubscribe?.()
  }, [hasAuthen, userType])

  // Use Stack to enable animations between top-level routes
  const stack = (
    <Stack
      screenOptions={{
        headerShown: false,
        presentation: 'card', // Card presentation with default slide animation
        gestureEnabled: true, // Enable swipe back gesture on native
        gestureDirection: 'horizontal'
      }}
    />
  )

  // Web needs the route guard (deep links and reloads land on any URL);
  // native navigation is driven by the screens themselves.
  if (Platform.OS === 'web') {
    return <AuthRouteGuard>{stack}</AuthRouteGuard>
  }

  return stack
}

export default function RootLayout() {
  useEffect(() => {
    void initTripStore()
  }, [])

  return (
    <Provider>
      <PreferencesProvider>
        <AuthProvider>
          <NavigationProvider>
            <LocationSharingProvider>
              <RootLayoutNav />
            </LocationSharingProvider>
          </NavigationProvider>
        </AuthProvider>
      </PreferencesProvider>
    </Provider>
  )
}
