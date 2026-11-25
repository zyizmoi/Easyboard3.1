'use client'

import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, useWindowDimensions, View } from 'react-native'
import { Text } from '../../components'
import {
  ActionButton,
  AppFrame,
  ProgressBar,
  ReadAloudButton,
  ScenePanel,
  Toast
} from '../../components/ui'
import { usePreferences } from '../../contexts/PreferencesContext'
import { useLocationSharing } from '../../contexts/LocationSharingContext'
import { useCallCaregiver } from '../../hooks/useCallCaregiver'
import { useToast } from '../../hooks/useToast'
import {
  createTripId,
  getActiveTrip,
  initTripStore,
  setActiveTrip,
  type ActiveTrip,
  type TripStage
} from '../../services/tripStore'
import { getUserStorage } from '../../services/storageService'
import { cacheJourneys, getCachedJourneys } from '../../services/journeyCache'
import { getUserData, setPWIDActiveTrip } from '../../services/userService'
import { colors, font, radius, shadow, space } from '../../theme/tokens'
import type { Journey, PWIDUser } from '../../types'
import {
  busLabel,
  getStoryStepIcon,
  locationForStep,
  primaryLabelForStep,
  sceneForStep,
  stageForStep,
  type StoryStep
} from './tripData'

interface Profile {
  name: string
  phoneNumber: string
  caregiverName: string
  caregiverPhone: string
  savedPlaces: PWIDUser['savedPlaces']
}

interface LatLng {
  lat: number
  lng: number
}

export function TripPage() {
  const router = useRouter()
  const { width } = useWindowDimensions()
  const { preferences, scale, bodyLine } = usePreferences()
  const {
    isLocationSharing,
    setIsLocationSharing,
    setDestination,
    permissionDenied,
    sharingError,
    autoStopped,
    resetAutoStop,
    retrySharing
  } = useLocationSharing()
  const { showToast, message } = useToast()
  const callCaregiver = useCallCaregiver()

  const params = useLocalSearchParams<{
    destinationName?: string
    journeyId?: string
    practice?: string
    lat?: string
    lng?: string
  }>()
  const requestedJourneyId = params.journeyId || ''
  const routeDestinationName = params.destinationName || ''
  const initialPractice = params.practice === '1'
  const isWide = width >= 960

  const [existingTrip, setExistingTrip] = useState<ActiveTrip | null>(getActiveTrip)
  const [hydrated, setHydrated] = useState(false)
  const [profile, setProfile] = useState<Profile>({
    name: '',
    phoneNumber: '',
    caregiverName: 'your caregiver',
    caregiverPhone: '',
    savedPlaces: []
  })
  const [journey, setJourney] = useState<Journey | null>(null)
  const [journeyLoaded, setJourneyLoaded] = useState(false)
  const [stepIndex, setStepIndex] = useState(-1)
  const [isPractice, setIsPractice] = useState(initialPractice)
  const [preview, setPreview] = useState(false)
  const [checks, setChecks] = useState({ card: false, battery: false, headphones: false })
  const [scriptOpen, setScriptOpen] = useState(false)
  const [missedStop, setMissedStop] = useState(false)
  const [busMissed, setBusMissed] = useState(false)
  const [destinationCoords, setDestinationCoords] = useState<LatLng | null>(null)
  const resumed = useRef(false)
  const startedAt = useRef(existingTrip?.startedAt || 0)
  const tripId = useRef(
    existingTrip?.id && existingTrip.id !== 'local-trip' ? existingTrip.id : createTripId()
  )

  useEffect(() => {
    void initTripStore().then(() => {
      setExistingTrip(getActiveTrip())
      setHydrated(true)
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const stored = await getUserStorage()
      if (cancelled) return
      if (!stored) {
        setJourneyLoaded(true)
        return
      }
      const pwid = stored as unknown as PWIDUser
      const isPreview = Boolean((stored as { preview?: boolean }).preview)
      setPreview(isPreview)
      // Set the saved profile immediately. The caregiver name is a nice-to-have
      // and must not delay the trip or the help flow in a dead zone.
      setProfile({
        name: pwid.name?.trim() || '',
        phoneNumber: pwid.phoneNumber || '',
        caregiverName: 'your caregiver',
        caregiverPhone: pwid.caregiverPhone || '',
        savedPlaces: pwid.savedPlaces ?? []
      })

      if (!pwid.caregiverPhone || isPreview) return
      try {
        const caregiver = await getUserData(pwid.caregiverPhone)
        if (!cancelled && caregiver?.name) {
          setProfile(current => ({ ...current, caregiverName: caregiver.name }))
        }
      } catch (error) {
        console.error('Could not load caregiver name for trip:', error)
      }
    }
    load().catch(error => console.error('Error loading trip profile:', error))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!hydrated) return
    if (!profile.phoneNumber || preview) {
      setJourneyLoaded(true)
      return
    }
    let active = true
    let hadCachedMatch = false

    const apply = (match: Journey | null, savedPlaces: PWIDUser['savedPlaces']) => {
      setJourney(match)
      setJourneyLoaded(true)
      const coords =
        params.lat && params.lng
          ? { lat: Number(params.lat), lng: Number(params.lng) }
          : match
            ? match.destinationLatLng
              ? { lat: match.destinationLatLng.latitude, lng: match.destinationLatLng.longitude }
              : coordsForDestination(savedPlaces, match.destinationName)
            : null
      setDestinationCoords(
        coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng) ? coords : null
      )
    }

    const load = async () => {
      // Read the cached copy first. This is what makes a trip startable when
      // the phone has no signal at the bus stop.
      const cached = await getCachedJourneys(profile.phoneNumber)
      const cachedMatch = requestedJourneyId
        ? cached.find(item => item.id === requestedJourneyId) ?? null
        : null
      if (active && cachedMatch) {
        hadCachedMatch = true
        apply(cachedMatch, profile.savedPlaces)
      }

      // Do not leave "Loading this trip…" forever when Firebase is unreachable.
      const fallbackTimer = setTimeout(() => {
        if (active && !hadCachedMatch) setJourneyLoaded(true)
      }, 5000)

      try {
        const data = await getUserData(profile.phoneNumber)
        if (!active) return
        const pwid = data as PWIDUser | null
        const journeys = pwid?.journeys ?? []
        void cacheJourneys(profile.phoneNumber, journeys)
        const match = requestedJourneyId
          ? journeys.find(item => item.id === requestedJourneyId) ?? null
          : null
        apply(match, pwid?.savedPlaces ?? profile.savedPlaces)
      } catch (error) {
        console.error('Error loading journey:', error)
        if (active) setJourneyLoaded(true)
      } finally {
        clearTimeout(fallbackTimer)
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [hydrated, params.lat, params.lng, preview, profile.phoneNumber, profile.savedPlaces, requestedJourneyId])

  useEffect(() => {
    if (!journey || resumed.current) return
    resumed.current = true
    if (!existingTrip || existingTrip.journeyId !== journey.id) {
      // A saved trip for a different journey must not donate its id or start
      // time to this trip.
      tripId.current = createTripId()
      startedAt.current = 0
    }
    if (existingTrip && existingTrip.journeyId === journey.id && !existingTrip.practice) {
      if (existingTrip.stage === 'arrived') {
        setStepIndex(journey.steps.length)
        return
      }
      const index = existingTrip.stepId
        ? journey.steps.findIndex(step => step.id === existingTrip.stepId)
        : -1
      if (index >= 0) setStepIndex(index)
    }
  }, [existingTrip, journey])

  const steps: StoryStep[] = useMemo(
    () => (journey?.steps ?? []).map(step => ({ ...step, icon: getStoryStepIcon(step.id) })),
    [journey]
  )
  const currentStep = stepIndex >= 0 && stepIndex < steps.length ? steps[stepIndex] : null
  const arrived = stepIndex >= steps.length && stepIndex >= 0
  const stage: TripStage = arrived
    ? 'arrived'
    : currentStep
      ? stageForStep(steps, currentStep.id)
      : 'story'
  const destinationName =
    journey?.destinationName || routeDestinationName || 'your destination'
  const originName = journey?.originName || (destinationName === 'Home' ? 'Here' : 'Home')
  const tripTitle =
    destinationName === 'Home' ? 'Going home' : originName ? `${originName} to ${destinationName}` : `To ${destinationName}`

  useEffect(() => {
    if (stepIndex === -1 || isPractice) {
      setDestination(null)
      return
    }
    setDestination(stepIndex >= steps.length ? null : destinationCoords)
  }, [destinationCoords, isPractice, setDestination, stepIndex, steps.length])

  // Publish the shared trip only when the person is on a real trip and has not
  // chosen Paused. Practice never publishes. Back-to-story clears the trip.
  useEffect(() => {
    if (!journey || !profile.phoneNumber || stepIndex === -1 || isPractice || preview) {
      return
    }
    if (preferences.privacyMode === 'paused') {
      if (profile.phoneNumber && !preview) {
        setPWIDActiveTrip(profile.phoneNumber, null).catch(error =>
          console.error('Error clearing paused trip:', error)
        )
      }
      return
    }
    if (!startedAt.current) startedAt.current = Date.now()
    const trip: ActiveTrip = {
      id: tripId.current,
      travellerName: profile.name || 'Your person',
      travellerPhone: profile.phoneNumber,
      journeyId: journey.id,
      destination: journey.destinationName,
      origin: journey.originName,
      stage,
      stepId: arrived ? 'arrived' : currentStep?.id,
      busNumber: journey.busNumber?.trim() || '',
      startedAt: startedAt.current,
      updatedAt: Date.now(),
      caregiverName: profile.caregiverName,
      caregiverPhone: profile.caregiverPhone,
      practice: false,
      privacyMode: preferences.privacyMode,
      ...(destinationCoords ? { destinationLatLng: destinationCoords } : {})
    }
    setActiveTrip(trip)
    setPWIDActiveTrip(profile.phoneNumber, trip).catch(error =>
      console.error('Error syncing active trip:', error)
    )
  }, [
    arrived,
    currentStep?.id,
    destinationCoords,
    isPractice,
    journey,
    preferences.privacyMode,
    preview,
    profile,
    stage,
    stepIndex
  ])

  // Sharing is driven by the privacy mode and trip position, not by the
  // provider's current boolean. A permission failure must not be mistaken for
  // "not sharing yet" and retried forever.
  useEffect(() => {
    if (preferences.privacyMode === 'paused') {
      if (isLocationSharing) setIsLocationSharing(false)
      return
    }
    // Always is owned by the location provider, including after a trip ends.
    if (preferences.privacyMode === 'always') return
    const shouldShare = stepIndex >= 0 && !arrived && !isPractice
    if (!shouldShare) {
      if (isLocationSharing) setIsLocationSharing(false)
      return
    }
    if (!isLocationSharing && !permissionDenied && !sharingError && !autoStopped) {
      setIsLocationSharing(true)
    }
  }, [
    arrived,
    autoStopped,
    isLocationSharing,
    isPractice,
    permissionDenied,
    preferences.privacyMode,
    setIsLocationSharing,
    sharingError,
    stepIndex
  ])

  const handleCall = useCallback(async () => {
    if (!profile.caregiverPhone) {
      showToast('No caregiver number saved.')
      return
    }
    await callCaregiver()
  }, [callCaregiver, profile.caregiverPhone, showToast])

  const openHelp = useCallback(() => {
    const search = new URLSearchParams({
      destination: destinationName,
      location: currentStep ? locationForStep(currentStep.id) : ''
    })
    router.navigate(`/help-card?${search.toString()}`)
  }, [currentStep, destinationName, router])

  const startTrip = (practiceMode = isPractice) => {
    if (!journey) return
    resetAutoStop()
    setIsPractice(practiceMode)
    startedAt.current = Date.now()
    setStepIndex(0)
    setScriptOpen(false)
    setMissedStop(false)
    setBusMissed(false)
  }

  const endTrip = useCallback(() => {
    setStepIndex(-1)
    setActiveTrip(null)
    setDestination(null)
    if (preferences.privacyMode !== 'always') setIsLocationSharing(false)
    setIsPractice(false)
    if (profile.phoneNumber && !preview) {
      setPWIDActiveTrip(profile.phoneNumber, null).catch(error =>
        console.error('Error clearing active trip:', error)
      )
    }
  }, [preferences.privacyMode, preview, profile.phoneNumber, setDestination, setIsLocationSharing])

  const nextStep = () => {
    if (stepIndex < 0) return
    if (stepIndex + 1 >= steps.length) {
      setStepIndex(steps.length)
    } else {
      setStepIndex(stepIndex + 1)
    }
    setScriptOpen(false)
    setMissedStop(false)
    setBusMissed(false)
  }

  const currentStepNumber = arrived ? steps.length : Math.max(1, stepIndex + 1)
  const readText = currentStep ? `${currentStep.title}. ${currentStep.detail}` : ''

  if (!journeyLoaded) {
    return (
      <AppFrame>
        <View style={{ minHeight: 320, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: scale(16), color: colors.muted }}>Loading this trip…</Text>
        </View>
      </AppFrame>
    )
  }

  if (!journey) {
    return (
      <AppFrame>
        <View
          style={{
            maxWidth: 640,
            marginHorizontal: 'auto',
            gap: 16,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radius.xl,
            padding: 24,
            boxShadow: shadow.card
          }}
        >
          <Ionicons name='map-outline' size={scale(34)} color={colors.brand} />
          <Text style={{ fontFamily: font.display, fontSize: scale(32), color: colors.ink }}>
            This trip is not set up.
          </Text>
          <Text style={{ fontSize: scale(16), lineHeight: bodyLine(16), color: colors.muted }}>
            Ask your caregiver to add this place and the steps you take. Then come back here.
          </Text>
          <ActionButton label='Call caregiver' icon='call-outline' onPress={handleCall} />
          <ActionButton label='Go home' variant='ghost' onPress={() => router.navigate('/home')} />
        </View>
      </AppFrame>
    )
  }

  return (
    <AppFrame statusLabel={preferences.privacyMode === 'paused' ? 'Paused' : isLocationSharing ? 'Sharing this trip' : 'Sharing off'}>
      <View style={{ gap: space.lg }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap'
          }}
        >
          <Pressable
            accessibilityRole='button'
            accessibilityLabel={stepIndex === -1 ? 'Back to home' : 'End trip and return to trip story'}
            onPress={() => (stepIndex === -1 ? router.navigate('/home') : endTrip())}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }}
          >
            <Ionicons name='arrow-back' size={scale(20)} color={colors.brand} />
            <Text style={{ fontSize: scale(14), fontWeight: '700', color: colors.brand }}>
              {stepIndex === -1 ? 'Home' : 'End trip'}
            </Text>
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <View
              style={{
                backgroundColor: isPractice ? colors.warningSoft : colors.brandSoft,
                borderRadius: radius.pill,
                paddingHorizontal: 11,
                paddingVertical: 5
              }}
            >
              <Text
                style={{
                  fontSize: scale(12),
                  fontWeight: '800',
                  color: isPractice ? colors.warning : colors.brand,
                  textTransform: 'uppercase',
                  letterSpacing: 0.4
                }}
              >
                {isPractice ? 'Practice route' : 'Your trip'}
              </Text>
            </View>
            <ReadAloudButton
              text={stepIndex === -1 ? `${tripTitle}. ${steps.length} steps.` : readText}
            />
          </View>
        </View>

        {preferences.privacyMode === 'paused' ? (
          <View
            style={{
              backgroundColor: colors.warningSoft,
              borderRadius: radius.md,
              padding: 14,
              gap: 6
            }}
          >
            <Text style={{ fontSize: scale(14), fontWeight: '800', color: colors.warning }}>
              Sharing is paused.
            </Text>
            <Text style={{ fontSize: scale(13), lineHeight: bodyLine(13), color: colors.inkSoft }}>
              Your caregiver cannot see this trip. Your route still works on this phone.
            </Text>
          </View>
        ) : null}

        {permissionDenied || sharingError ? (
          <View
            style={{
              backgroundColor: colors.warningSoft,
              borderRadius: radius.md,
              padding: 14,
              gap: 8
            }}
          >
            <Text style={{ fontSize: scale(14), lineHeight: bodyLine(14), color: colors.inkSoft }}>
              Location is off. {sharingError || 'Allow location to share this trip.'}
            </Text>
            <ActionButton label='Try location again' variant='secondary' size='sm' onPress={retrySharing} />
          </View>
        ) : null}

        {stepIndex === -1 ? (
          <StoryView
            title={tripTitle}
            steps={steps}
            busNumber={journey.busNumber}
            isWide={isWide}
            checks={checks}
            onToggleCheck={key => setChecks(current => ({ ...current, [key]: !current[key] }))}
            onStart={() => startTrip(false)}
            onPractice={() => startTrip(true)}
            onCall={handleCall}
            scale={scale}
            bodyLine={bodyLine}
          />
        ) : arrived ? (
          <ArrivedView
            destinationName={destinationName}
            scale={scale}
            bodyLine={bodyLine}
            onDone={() => {
              endTrip()
              router.navigate('/home')
            }}
            onHelp={openHelp}
          />
        ) : currentStep ? (
          <View style={{ flexDirection: isWide ? 'row' : 'column', gap: space.lg, alignItems: 'stretch' }}>
            <View
              style={{
                flex: isWide ? 1.4 : undefined,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.line,
                borderRadius: radius.xl,
                padding: isWide ? 28 : 20,
                gap: 18,
                boxShadow: shadow.card,
                minWidth: 0
              }}
            >
              <ProgressBar
                current={currentStepNumber}
                total={steps.length}
                label={`Step ${currentStepNumber} of ${steps.length} · ${destinationName}`}
              />
              <ScenePanel
                kind={sceneForStep(currentStep.id)}
                caption={
                  currentStep.id === 'board'
                    ? `The open door on ${busLabel(journey.busNumber)}`
                    : currentStep.id === 'tap'
                      ? 'The card reader by the door'
                      : currentStep.id === 'ride'
                        ? 'A seat near the driver'
                        : currentStep.id === 'alight' || currentStep.id === 'arrive'
                          ? destinationName
                          : 'The bus stop'
                }
              />
              <View style={{ gap: 6 }}>
                <Text
                  style={{
                    fontFamily: font.display,
                    fontSize: scale(isWide ? 38 : 30),
                    lineHeight: scale(isWide ? 42 : 34),
                    fontWeight: '400',
                    letterSpacing: -0.4,
                    color: colors.ink
                  }}
                >
                  {currentStep.title}
                </Text>
                <Text
                  style={{
                    fontSize: scale(17),
                    lineHeight: bodyLine(17),
                    color: colors.muted,
                    maxWidth: 560
                  }}
                >
                  {currentStep.detail}
                </Text>
              </View>

              {scriptOpen ? (
                <View style={{ backgroundColor: colors.brandSoft, borderRadius: radius.md, padding: 16, gap: 8 }}>
                  <Text style={{ fontSize: scale(13), fontWeight: '800', color: colors.brand }}>
                    Ask the driver
                  </Text>
                  <Text style={{ fontSize: scale(19), lineHeight: bodyLine(19), fontWeight: '700', color: colors.ink }}>
                    “Does this bus go to {destinationName}?”
                  </Text>
                  <Pressable
                    accessibilityRole='button'
                    accessibilityLabel='Close driver script'
                    onPress={() => setScriptOpen(false)}
                    style={{ minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center' }}
                  >
                    <Text style={{ fontSize: scale(14), fontWeight: '700', color: colors.brand }}>Close</Text>
                  </Pressable>
                </View>
              ) : null}

              {busMissed ? (
                <AlertCard
                  tone='warning'
                  title='The bus did not stop'
                  detail={`Wait for the next ${busLabel(journey.busNumber)}. You are still in the right place.`}
                  primaryLabel='I am still waiting'
                  onPrimary={() => setBusMissed(false)}
                  scale={scale}
                  bodyLine={bodyLine}
                />
              ) : null}

              {missedStop ? (
                <AlertCard
                  tone='danger'
                  title='Stay on the bus'
                  detail='Call your caregiver now. Stay on the bus until you can get off safely.'
                  primaryLabel='Call caregiver'
                  onPrimary={handleCall}
                  secondaryLabel='I am okay'
                  onSecondary={() => setMissedStop(false)}
                  scale={scale}
                  bodyLine={bodyLine}
                />
              ) : null}

              <View style={{ gap: 10 }}>
                <ActionButton label={primaryLabelForStep(currentStep.id)} onPress={nextStep} fullWidth />
                <ActionButton
                  label='I’m not sure'
                  variant='ghost'
                  icon='help-circle-outline'
                  onPress={openHelp}
                  fullWidth
                />
                {currentStep.id === 'wait' ? (
                  <Pressable
                    accessibilityRole='button'
                    accessibilityLabel='The bus did not stop'
                    onPress={() => setBusMissed(true)}
                    style={{ minHeight: 44, alignSelf: 'center', justifyContent: 'center' }}
                  >
                    <Text style={{ fontSize: scale(13), fontWeight: '600', color: colors.muted }}>
                      The bus did not stop
                    </Text>
                  </Pressable>
                ) : null}
                {currentStep.id === 'board' ? (
                  <Pressable
                    accessibilityRole='button'
                    accessibilityLabel='Is this my bus?'
                    onPress={() => setScriptOpen(true)}
                    style={{ minHeight: 44, alignSelf: 'center', justifyContent: 'center' }}
                  >
                    <Text style={{ fontSize: scale(13), fontWeight: '600', color: colors.muted }}>
                      Is this my bus?
                    </Text>
                  </Pressable>
                ) : null}
                {currentStep.id === 'ride' ? (
                  <Pressable
                    accessibilityRole='button'
                    accessibilityLabel='I missed my stop'
                    onPress={() => setMissedStop(true)}
                    style={{ minHeight: 44, alignSelf: 'center', justifyContent: 'center' }}
                  >
                    <Text style={{ fontSize: scale(13), fontWeight: '600', color: colors.muted }}>
                      I missed my stop
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            <View style={{ flex: isWide ? 0.75 : undefined, gap: 14, minWidth: 0 }}>
              <TripStatusCard
                destinationName={destinationName}
                stage={stage}
                stepId={currentStep.id}
                isPractice={isPractice}
                busNumber={journey.busNumber}
                scale={scale}
                bodyLine={bodyLine}
              />
              <View
                style={{
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.line,
                  borderRadius: radius.lg,
                  padding: 18,
                  gap: 10
                }}
              >
                <Text style={{ fontSize: scale(12), fontWeight: '800', letterSpacing: 0.7, textTransform: 'uppercase', color: colors.muted }}>
                  If something changes
                </Text>
                <Text style={{ fontSize: scale(15), lineHeight: bodyLine(15), color: colors.ink }}>
                  {currentStep.id === 'wait'
                    ? 'If the bus is late, wait where you are. If you need help, call your caregiver.'
                    : currentStep.id === 'ride'
                      ? 'If you miss your stop, stay on the bus and call your caregiver.'
                      : 'If you are not sure, ask the driver or press I’m not sure.'}
                </Text>
                <Text style={{ fontSize: scale(14), lineHeight: bodyLine(14), color: colors.muted }}>
                  You can press “I’m not sure” at any time. It is not a failure.
                </Text>
              </View>
              <ActionButton label='Call caregiver' icon='call-outline' variant='ghost' onPress={handleCall} fullWidth />
            </View>
          </View>
        ) : null}
      </View>
      <Toast message={message} />
    </AppFrame>
  )
}

function coordsForDestination(
  savedPlaces: PWIDUser['savedPlaces'],
  destinationName: string
): LatLng | null {
  const match = (savedPlaces ?? []).find(
    place => place.locationName.trim().toLowerCase() === destinationName.trim().toLowerCase()
  )
  if (!match?.address?.latlng) return null
  return {
    lat: match.address.latlng.latitude,
    lng: match.address.latlng.longitude
  }
}

function StoryView({
  title,
  steps,
  busNumber,
  isWide,
  checks,
  onToggleCheck,
  onStart,
  onPractice,
  onCall,
  scale,
  bodyLine
}: {
  title: string
  steps: StoryStep[]
  busNumber: string
  isWide: boolean
  checks: { card: boolean; battery: boolean; headphones: boolean }
  onToggleCheck: (key: 'card' | 'battery' | 'headphones') => void
  onStart: () => void
  onPractice: () => void
  onCall: () => void
  scale: (n: number) => number
  bodyLine: (n: number) => number
}) {
  return (
    <View style={{ flexDirection: isWide ? 'row' : 'column', gap: space.lg, alignItems: 'stretch' }}>
      <View
        style={{
          flex: isWide ? 1.45 : undefined,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: radius.xl,
          padding: isWide ? 28 : 20,
          gap: 22,
          boxShadow: shadow.card,
          minWidth: 0
        }}
      >
        <View style={{ gap: 4 }}>
          <Text
            style={{
              fontFamily: font.display,
              fontSize: scale(isWide ? 44 : 34),
              lineHeight: scale(isWide ? 48 : 38),
              fontWeight: '400',
              letterSpacing: -0.5,
              color: colors.ink
            }}
          >
            {title}
          </Text>
          <Text style={{ fontSize: scale(15), lineHeight: bodyLine(15), color: colors.muted }}>
            {steps.length} steps{busNumber.trim() ? ` · bus ${busNumber.trim()}` : ''}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
            <ActionButton label='Start trip' onPress={onStart} />
            <ActionButton label='Practice this trip' variant='secondary' onPress={onPractice} />
          </View>
        </View>

        <View style={{ paddingLeft: 18, borderLeftWidth: 2, borderLeftColor: colors.line, gap: 18, marginLeft: 16 }}>
          {steps.map((step, index) => (
            <View key={step.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14, marginLeft: -34 }}>
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 17,
                  backgroundColor: colors.surface,
                  borderWidth: 2,
                  borderColor: colors.brand,
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <Ionicons name={step.icon} size={scale(17)} color={colors.brand} />
              </View>
              <View style={{ flex: 1, gap: 2, paddingTop: 2 }}>
                <Text style={{ fontSize: scale(16), fontWeight: '700', color: colors.ink }}>{step.title}</Text>
                <Text style={{ fontSize: scale(14), lineHeight: bodyLine(14), color: colors.muted }}>{step.detail}</Text>
                {step.photoUrl ? (
                  <Image
                    source={{ uri: step.photoUrl }}
                    style={{ width: '100%', height: 150, borderRadius: radius.md, marginTop: 8 }}
                    contentFit='cover'
                    accessibilityLabel={`Photo for ${step.title}`}
                  />
                ) : null}
              </View>
              <Text style={{ fontSize: scale(12), fontVariant: ['tabular-nums'], color: colors.faint, paddingTop: 5 }}>
                {String(index + 1).padStart(2, '0')}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View style={{ flex: isWide ? 0.8 : undefined, gap: 14, minWidth: 0 }}>
        <View
          style={{
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radius.lg,
            padding: 18,
            gap: 10,
            boxShadow: shadow.card
          }}
        >
          <Text style={{ fontSize: scale(12), fontWeight: '800', letterSpacing: 0.7, textTransform: 'uppercase', color: colors.muted }}>
            Before you go
          </Text>
          {[
            { key: 'card' as const, label: 'Fare card in your pocket' },
            { key: 'battery' as const, label: 'Phone has enough battery' },
            { key: 'headphones' as const, label: 'Headphones or sound on' }
          ].map(item => (
            <Pressable
              key={item.key}
              accessibilityRole='checkbox'
              accessibilityState={{ checked: checks[item.key] }}
              accessibilityLabel={item.label}
              onPress={() => onToggleCheck(item.key)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}
            >
              <Ionicons
                name={checks[item.key] ? 'checkbox' : 'square-outline'}
                size={scale(22)}
                color={checks[item.key] ? colors.success : colors.lineStrong}
              />
              <Text style={{ fontSize: scale(15), lineHeight: bodyLine(15), color: colors.ink }}>{item.label}</Text>
            </Pressable>
          ))}
          <Text style={{ fontSize: scale(13), lineHeight: bodyLine(13), color: colors.muted }}>
            You can start even if a box is empty.
          </Text>
        </View>

        <View
          style={{
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radius.lg,
            padding: 18,
            gap: 8
          }}
        >
          <Text style={{ fontSize: scale(12), fontWeight: '800', letterSpacing: 0.7, textTransform: 'uppercase', color: colors.muted }}>
            Caregiver
          </Text>
          <Text style={{ fontSize: scale(17), fontWeight: '700', color: colors.ink }}>Call your caregiver</Text>
          <Text style={{ fontSize: scale(14), lineHeight: bodyLine(14), color: colors.muted }}>
            They can stay on the phone until you arrive.
          </Text>
          <ActionButton label='Call now' icon='call-outline' variant='secondary' onPress={onCall} fullWidth />
        </View>
      </View>
    </View>
  )
}

function TripStatusCard({
  destinationName,
  stage,
  stepId,
  isPractice,
  busNumber,
  scale,
  bodyLine
}: {
  destinationName: string
  stage: TripStage
  stepId: string
  isPractice: boolean
  busNumber: string
  scale: (n: number) => number
  bodyLine: (n: number) => number
}) {
  return (
    <View style={{ backgroundColor: colors.brandSoft, borderRadius: radius.lg, padding: 18, gap: 8 }}>
      <Text style={{ fontSize: scale(12), fontWeight: '800', letterSpacing: 0.7, textTransform: 'uppercase', color: colors.brand }}>
        {isPractice ? 'Practice trip' : 'On this trip'}
      </Text>
      <Text style={{ fontSize: scale(19), fontWeight: '800', color: colors.ink }}>{destinationName}</Text>
      <Text style={{ fontSize: scale(14), lineHeight: bodyLine(14), color: colors.inkSoft }}>
        {tripStatusText(stage, isPractice, busNumber, stepId)}
      </Text>
    </View>
  )
}

function tripStatusText(stage: TripStage, isPractice: boolean, busNumber: string, stepId: string) {
  if (isPractice) return 'Practice route. This does not publish a trip.'
  if (stepId === 'arrive') return 'Almost there. Walk to your destination.'
  switch (stage) {
    case 'waiting':
      return 'Waiting at the bus stop.'
    case 'boarding':
      return `Get on ${busLabel(busNumber)}.`
    case 'on-bus':
      return `On ${busLabel(busNumber)}. Watch for your stop.`
    case 'arriving':
      return 'Get ready to get off.'
    case 'arrived':
      return 'You have arrived.'
    default:
      return 'Getting ready to go.'
  }
}

function AlertCard({
  tone,
  title,
  detail,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  scale,
  bodyLine
}: {
  tone: 'warning' | 'danger'
  title: string
  detail: string
  primaryLabel: string
  onPrimary: () => void
  secondaryLabel?: string
  onSecondary?: () => void
  scale: (n: number) => number
  bodyLine: (n: number) => number
}) {
  const palette =
    tone === 'danger'
      ? { bg: colors.dangerSoft, ink: colors.danger }
      : { bg: colors.warningSoft, ink: colors.warning }

  return (
    <View style={{ backgroundColor: palette.bg, borderRadius: radius.md, padding: 16, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name='alert-circle-outline' size={scale(20)} color={palette.ink} />
        <Text style={{ fontSize: scale(16), fontWeight: '800', color: palette.ink }}>{title}</Text>
      </View>
      <Text style={{ fontSize: scale(14), lineHeight: bodyLine(14), color: colors.inkSoft }}>{detail}</Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
        <ActionButton label={primaryLabel} variant='secondary' onPress={onPrimary} />
        {secondaryLabel && onSecondary ? (
          <ActionButton label={secondaryLabel} variant='ghost' onPress={onSecondary} />
        ) : null}
      </View>
    </View>
  )
}

function ArrivedView({
  destinationName,
  scale,
  bodyLine,
  onDone,
  onHelp
}: {
  destinationName: string
  scale: (n: number) => number
  bodyLine: (n: number) => number
  onDone: () => void
  onHelp: () => void
}) {
  return (
    <View
      style={{
        maxWidth: 720,
        marginHorizontal: 'auto',
        width: '100%',
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.xl,
        padding: 32,
        gap: 18,
        alignItems: 'center',
        boxShadow: shadow.card
      }}
    >
      <View
        style={{
          width: 76,
          height: 76,
          borderRadius: 38,
          backgroundColor: colors.successSoft,
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <Ionicons name='checkmark-circle' size={scale(44)} color={colors.success} />
      </View>
      <Text
        style={{
          fontFamily: font.display,
          fontSize: scale(42),
          lineHeight: scale(46),
          color: colors.ink,
          textAlign: 'center'
        }}
      >
        You are here.
      </Text>
      <Text style={{ fontSize: scale(18), lineHeight: bodyLine(18), color: colors.muted, textAlign: 'center' }}>
        {destinationName}. Your trip is finished.
      </Text>
      <View style={{ width: '100%', gap: 10, maxWidth: 420 }}>
        <ActionButton label='Done' onPress={onDone} fullWidth />
        <ActionButton label='I need help' variant='ghost' onPress={onHelp} fullWidth />
      </View>
    </View>
  )
}
