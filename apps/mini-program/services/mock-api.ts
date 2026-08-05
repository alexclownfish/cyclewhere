import type { MyRegistrationRecord, PublishEventInput, Registration, RegistrationInput, RideEvent, RideRoute } from '../types/domain.ts';
import { canRegister } from '../utils/domain.ts';
import { events as seedEvents, initialRegistrations, routes } from './mock-data.ts';

const EVENT_KEY = 'ride_demo_events_v1';
const REGISTRATION_KEY = 'ride_demo_registrations_v1';

function clone<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
function loadEvents(): RideEvent[] { return wx.getStorageSync(EVENT_KEY) || clone(seedEvents); }
function saveEvents(items: RideEvent[]) { wx.setStorageSync(EVENT_KEY, items); }
function loadRegistrations(): Registration[] { return wx.getStorageSync(REGISTRATION_KEY) || clone(initialRegistrations); }
function saveRegistrations(items: Registration[]) { wx.setStorageSync(REGISTRATION_KEY, items); }

const delay = <T>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(clone(value)), 180));

export const mockApi = {
  async listEvents(): Promise<RideEvent[]> { return delay(loadEvents()); },
  async getEvent(id: string): Promise<RideEvent> {
    const item = loadEvents().find((event) => event.id === id);
    if (!item) throw new Error('活动不存在或已下架');
    return delay(item);
  },
  async listRoutes(): Promise<RideRoute[]> { return delay(routes); },
  async getRoute(id: string): Promise<RideRoute> {
    const item = routes.find((route) => route.id === id);
    if (!item) throw new Error('路书不存在');
    return delay(item);
  },
  async getMyRegistrations(): Promise<Registration[]> { return delay(loadRegistrations()); },
  async getRegistrationStatus(eventId: string): Promise<Registration | null> {
    return delay(loadRegistrations().find((item) => item.eventId === eventId && item.status !== 'cancelled') || null);
  },
  async getMyRegistrationRecords(): Promise<MyRegistrationRecord[]> {
    const eventById = new Map(loadEvents().map((item) => [item.id, item]));
    const records = loadRegistrations().map((registration) => {
      const event = eventById.get(registration.eventId);
      return event ? { registration, event } : null;
    }).filter(Boolean) as MyRegistrationRecord[];
    return delay(records.sort((a, b) => b.event.startAt.localeCompare(a.event.startAt)));
  },
  async register(eventId: string, input: RegistrationInput): Promise<Registration> {
    const registrations = loadRegistrations();
    const existing = registrations.find((item) => item.eventId === eventId && item.status !== 'cancelled');
    if (existing) return delay(existing);
    const allEvents = loadEvents();
    const event = allEvents.find((item) => item.id === eventId);
    if (!event || !canRegister(event)) throw new Error('活动名额已满或不可报名');
    const registration: Registration = {
      id: `reg-${Date.now()}`, eventId, status: event.approvalRequired ? 'pending' : 'approved',
      phoneMasked: `${input.phone.slice(0, 3)}****${input.phone.slice(-4)}`, bikeType: input.bikeType,
      createdAt: new Date().toISOString(),
    };
    registrations.unshift(registration);
    event.registeredCount += 1;
    if (event.registeredCount >= event.capacity) event.status = 'full';
    saveRegistrations(registrations);
    saveEvents(allEvents);
    return delay(registration);
  },
  async cancelRegistration(eventId: string): Promise<void> {
    const registrations = loadRegistrations();
    const registration = registrations.find((item) => item.eventId === eventId && item.status !== 'cancelled');
    if (!registration) return;
    registration.status = 'cancelled';
    const allEvents = loadEvents();
    const event = allEvents.find((item) => item.id === eventId);
    if (event) {
      event.registeredCount = Math.max(0, event.registeredCount - 1);
      if (event.status === 'full' && event.registeredCount < event.capacity) event.status = 'published';
    }
    saveRegistrations(registrations);
    saveEvents(allEvents);
    await delay(undefined);
  },
  async publish(input: PublishEventInput): Promise<RideEvent> {
    const route = routes.find((item) => item.id === input.routeId) || routes[1];
    const event: RideEvent = {
      id: `event-${Date.now()}`, title: input.title, organizer: '林峥', startAt: `${input.date}T${input.time}:00+08:00`,
      registrationDeadline: new Date(new Date(`${input.date}T${input.time}:00+08:00`).getTime() - 12 * 60 * 60 * 1000).toISOString(),
      meetingPoint: input.meetingPoint, routeId: route.id, route, capacity: input.capacity, registeredCount: 1,
      speedRange: input.speedRange, status: 'published', approvalRequired: true, description: input.description,
      requirements: input.requirements, ownedByMe: true,
    };
    const allEvents = loadEvents();
    allEvents.unshift(event);
    saveEvents(allEvents);
    return delay(event);
  },
};
