import { randomUUID } from "node:crypto";
import { conflict, invalidState, notFound } from "../domain/errors.js";
import type {
  CyclingEvent,
  Registration,
  RegistrationResult,
  Roadbook,
  UserRegistrationItem,
} from "../domain/models.js";
import type { EventListQuery, Page, RegisterCommand, Repository } from "../domain/repository.js";
import { Mutex } from "./mutex.js";

const copy = <T>(value: T): T => structuredClone(value);

export class InMemoryRepository implements Repository {
  private readonly events = new Map<string, CyclingEvent>();
  private readonly roadbooks = new Map<string, Roadbook>();
  private readonly registrations = new Map<string, Registration>();
  private readonly idempotencyResults = new Map<string, RegistrationResult>();
  private readonly transaction = new Mutex();

  constructor(seed?: { events?: CyclingEvent[]; roadbooks?: Roadbook[] }) {
    for (const event of seed?.events ?? []) this.events.set(event.id, copy(event));
    for (const roadbook of seed?.roadbooks ?? []) this.roadbooks.set(roadbook.id, copy(roadbook));
  }

  async createEvent(event: CyclingEvent): Promise<CyclingEvent> {
    if (this.events.has(event.id)) throw conflict("EVENT_EXISTS", "活动已存在");
    this.events.set(event.id, copy(event));
    return copy(event);
  }

  async updateEvent(event: CyclingEvent): Promise<CyclingEvent> {
    if (!this.events.has(event.id)) throw notFound("活动");
    this.events.set(event.id, copy(event));
    return copy(event);
  }

  async getEvent(id: string): Promise<CyclingEvent | null> {
    const event = this.events.get(id);
    return event ? copy(event) : null;
  }

  async listEvents(query: EventListQuery): Promise<Page<CyclingEvent>> {
    const all = [...this.events.values()]
      .filter((event) =>
        query.status
          ? event.status === query.status
          : event.status === "published" || event.status === "full",
      )
      .filter((event) => !query.difficulty || event.difficulty === query.difficulty)
      .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id));
    return this.page(all, query.limit, query.cursor);
  }

  async createRoadbook(roadbook: Roadbook): Promise<Roadbook> {
    if (this.roadbooks.has(roadbook.id)) throw conflict("ROADBOOK_EXISTS", "路书已存在");
    this.roadbooks.set(roadbook.id, copy(roadbook));
    return copy(roadbook);
  }

  async getRoadbook(id: string): Promise<Roadbook | null> {
    const roadbook = this.roadbooks.get(id);
    return roadbook ? copy(roadbook) : null;
  }

  async listRoadbooks(limit: number, cursor?: string): Promise<Page<Roadbook>> {
    const all = [...this.roadbooks.values()].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
    );
    return this.page(all, limit, cursor);
  }

  async registerAtomically(command: RegisterCommand): Promise<RegistrationResult> {
    return this.transaction.runExclusive(() => {
      const idempotencyScope = `${command.userId}:${command.eventId}:${command.idempotencyKey}`;
      const replay = this.idempotencyResults.get(idempotencyScope);
      if (replay) return { ...copy(replay), replayed: true };

      const event = this.events.get(command.eventId);
      if (!event) throw notFound("活动");
      if (event.status !== "published" && event.status !== "full") {
        throw invalidState("当前活动状态不可报名");
      }
      if (command.now.getTime() >= Date.parse(event.registrationDeadline)) {
        throw conflict("REGISTRATION_CLOSED", "报名已截止");
      }

      const registrationKey = `${command.eventId}:${command.userId}`;
      const existing = this.registrations.get(registrationKey);
      if (existing?.status === "active") {
        throw conflict("ALREADY_REGISTERED", "请勿重复报名");
      }
      if (event.registrationCount >= event.capacity) {
        throw conflict("EVENT_FULL", "活动名额已满");
      }

      const now = command.now.toISOString();
      const registration: Registration = existing
        ? {
            ...existing,
            status: "active",
            abilityConfirmed: command.abilityConfirmed,
            equipmentConfirmed: command.equipmentConfirmed,
            waiverVersion: command.waiverVersion,
            waiverAcceptedAt: now,
            updatedAt: now,
            cancelledAt: null,
          }
        : {
            id: randomUUID(),
            eventId: command.eventId,
            userId: command.userId,
            status: "active",
            abilityConfirmed: command.abilityConfirmed,
            equipmentConfirmed: command.equipmentConfirmed,
            waiverVersion: command.waiverVersion,
            waiverAcceptedAt: now,
            createdAt: now,
            updatedAt: now,
            cancelledAt: null,
          };
      const nextCount = event.registrationCount + 1;
      const updatedEvent: CyclingEvent = {
        ...event,
        registrationCount: nextCount,
        status: nextCount === event.capacity ? "full" : "published",
        updatedAt: now,
        version: event.version + 1,
      };
      this.registrations.set(registrationKey, registration);
      this.events.set(event.id, updatedEvent);
      const result = { registration, event: updatedEvent, replayed: false };
      this.idempotencyResults.set(idempotencyScope, copy(result));
      return copy(result);
    });
  }

  async cancelRegistrationAtomically(
    eventId: string,
    userId: string,
    nowDate: Date,
  ): Promise<RegistrationResult> {
    return this.transaction.runExclusive(() => {
      const event = this.events.get(eventId);
      if (!event) throw notFound("活动");
      const key = `${eventId}:${userId}`;
      const registration = this.registrations.get(key);
      if (!registration) throw notFound("报名记录");
      if (registration.status === "cancelled") {
        return { registration: copy(registration), event: copy(event), replayed: true };
      }
      if (event.status === "completed" || event.status === "cancelled") {
        throw invalidState("当前活动状态不可取消报名");
      }
      const now = nowDate.toISOString();
      const cancelled: Registration = {
        ...registration,
        status: "cancelled",
        cancelledAt: now,
        updatedAt: now,
      };
      const updatedEvent: CyclingEvent = {
        ...event,
        registrationCount: Math.max(0, event.registrationCount - 1),
        status: event.status === "full" ? "published" : event.status,
        updatedAt: now,
        version: event.version + 1,
      };
      this.registrations.set(key, cancelled);
      this.events.set(event.id, updatedEvent);
      return { registration: copy(cancelled), event: copy(updatedEvent), replayed: false };
    });
  }

  async getRegistration(eventId: string, userId: string): Promise<Registration | null> {
    const registration = this.registrations.get(`${eventId}:${userId}`);
    return registration ? copy(registration) : null;
  }

  async listRegistrationsByUser(userId: string): Promise<UserRegistrationItem[]> {
    return [...this.registrations.values()]
      .filter((registration) => registration.userId === userId)
      .flatMap((registration) => {
        const event = this.events.get(registration.eventId);
        return event ? [{ registration: copy(registration), event: copy(event) }] : [];
      })
      .sort(
        (a, b) =>
          b.event.startAt.localeCompare(a.event.startAt) ||
          b.registration.updatedAt.localeCompare(a.registration.updatedAt),
      );
  }

  private page<T extends { id: string }>(items: T[], limit: number, cursor?: string): Page<T> {
    const start = cursor ? Math.max(0, items.findIndex((item) => item.id === cursor) + 1) : 0;
    const pageItems = items.slice(start, start + limit);
    const hasNext = start + limit < items.length;
    return {
      items: copy(pageItems),
      nextCursor: hasNext ? (pageItems.at(-1)?.id ?? null) : null,
    };
  }
}
