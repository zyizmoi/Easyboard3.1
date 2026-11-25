'use client'

import { useRouter } from 'expo-router'
import { useEffect, useRef } from 'react'
import { View } from 'react-native'
import { ActionButton, AppFrame } from '@/components/ui'
import { LocationInput, type LocationInputRef } from '@/components/LocationInput'
import { Text } from '@/components/Text'
import type { MarkerData } from '@/stores/onboardingStore'
import { colors, font, radius, space } from '@/theme/tokens'
import { usePreferences } from '@/contexts/PreferencesContext'

export default function PlaceSearchPage() {
  const router = useRouter()
  const { scale, bodyLine } = usePreferences()
  const inputRef = useRef<LocationInputRef>(null)

  useEffect(() => {
    inputRef.current?.open()
  }, [])

  const choose = (marker: MarkerData) => {
    const params = new URLSearchParams({
      lat: String(marker.latlng.latitude),
      lng: String(marker.latlng.longitude),
      name: marker.description || 'Place',
      description: marker.description || 'Place'
    })
    router.replace(`/transit-options?${params.toString()}`)
  }

  return (
    <AppFrame statusAction='none'>
      <View
        style={{
          maxWidth: 640,
          marginHorizontal: 'auto',
          gap: space.lg,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: radius.xl,
          padding: 24
        }}
      >
        <Text style={{ fontFamily: font.display, fontSize: scale(36), color: colors.ink }}>
          Find another place.
        </Text>
        <Text style={{ fontSize: scale(16), lineHeight: bodyLine(16), color: colors.muted }}>
          Search for a place, then choose the real bus or train directions. A caregiver can turn this into a guided trip later.
        </Text>
        <ActionButton label='Search for a place' icon='search-outline' onPress={() => inputRef.current?.open()} />
        <LocationInput ref={inputRef} value={null} onLocationSelect={choose} locationType='Home' />
      </View>
    </AppFrame>
  )
}
