import type { TripStage } from '../../services/tripStore'

export interface StoryStep {
  id: string
  title: string
  detail: string
  photoUrl?: string
  icon:
    | 'walk-outline'
    | 'time-outline'
    | 'bus-outline'
    | 'card-outline'
    | 'person-outline'
    | 'navigate-outline'
    | 'exit-outline'
    | 'flag-outline'
}

/**
 * Generic starting point for a new caregiver journey.
 * It deliberately contains no bus number, stop count, or travel time.
 * Those facts must come from the caregiver.
 */
export function getDefaultJourneySteps(destinationName: string): StoryStep[] {
  return [
    { id: 'walk', title: 'Walk to the bus stop', detail: 'Follow the way you practised.', icon: 'walk-outline' },
    { id: 'wait', title: 'Wait for the bus', detail: 'Stand where you can see the bus.', icon: 'time-outline' },
    { id: 'board', title: 'Get on the bus', detail: 'Check the bus number before you get on.', icon: 'bus-outline' },
    { id: 'tap', title: 'Tap your card', detail: 'The reader is near the door.', icon: 'card-outline' },
    { id: 'sit', title: 'Sit near the driver', detail: 'The driver can see you.', icon: 'person-outline' },
    { id: 'ride', title: 'Ride to your stop', detail: 'Watch for your stop.', icon: 'navigate-outline' },
    { id: 'alight', title: `Get off at ${destinationName}`, detail: 'Press the bell when you see your stop.', icon: 'exit-outline' },
    { id: 'arrive', title: `Walk to ${destinationName}`, detail: 'Follow the last part of the route.', icon: 'flag-outline' }
  ]
}

const STORY_STEP_ICONS: Record<string, StoryStep['icon']> = {
  walk: 'walk-outline',
  wait: 'time-outline',
  board: 'bus-outline',
  tap: 'card-outline',
  sit: 'person-outline',
  ride: 'navigate-outline',
  alight: 'exit-outline',
  arrive: 'flag-outline'
}

export function getStoryStepIcon(stepId: string): StoryStep['icon'] {
  return STORY_STEP_ICONS[stepId] ?? 'navigate-outline'
}

const STEP_STAGE: Record<string, TripStage> = {
  walk: 'waiting',
  wait: 'waiting',
  board: 'boarding',
  tap: 'on-bus',
  sit: 'on-bus',
  ride: 'on-bus',
  alight: 'arriving',
  arrive: 'arrived'
}

/**
 * Find the trip stage for a step. Custom steps inherit the last core stage.
 * This keeps the caregiver status meaningful without inventing a new schema.
 */
export function stageForStep(steps: StoryStep[], stepId: string): TripStage {
  let stage: TripStage = 'waiting'
  for (const step of steps) {
    const mapped = STEP_STAGE[step.id]
    if (mapped) stage = mapped
    if (step.id === stepId) return stage
  }
  return stage
}

export function sceneForStep(stepId: string): 'stop' | 'door' | 'card' | 'seat' | 'destination' {
  switch (stepId) {
    case 'board':
      return 'door'
    case 'tap':
      return 'card'
    case 'sit':
    case 'ride':
      return 'seat'
    case 'alight':
    case 'arrive':
      return 'destination'
    default:
      return 'stop'
  }
}

export function primaryLabelForStep(stepId: string): string {
  switch (stepId) {
    case 'wait':
      return 'The bus has stopped'
    case 'board':
      return 'I am on the bus'
    case 'tap':
      return 'My card is tapped'
    case 'ride':
      return 'I see my stop'
    case 'alight':
      return 'I am off the bus'
    case 'arrive':
      return 'I have arrived'
    default:
      return 'I did it'
  }
}

export function locationForStep(stepId: string): string {
  switch (stepId) {
    case 'walk':
    case 'wait':
      return 'the bus stop'
    case 'board':
      return 'the bus door'
    case 'tap':
    case 'sit':
    case 'ride':
      return 'the bus'
    case 'alight':
      return 'the bus stop'
    default:
      return 'the way to your destination'
  }
}

export function busLabel(busNumber?: string): string {
  const value = busNumber?.trim()
  return value ? `bus ${value}` : 'the bus'
}
