import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { conflict, invalidState, notFound } from "../domain/errors.js";
import type {
  CyclingEvent,
  Difficulty,
  EventStatus,
  Registration,
  RegistrationResult,
  Roadbook,
  RoadbookWaypoint,
  UserRegistrationItem,
} from "../domain/models.js";
import type { EventListQuery, Page, RegisterCommand, Repository } from "../domain/repository.js";

type EventRow = QueryResultRow & {
  id: string;
  organizer_id: string;
  roadbook_id: string | null;
  title: string;
  summary: string;
  start_at: Date;
  registration_deadline: Date;
  meeting_point: string;
  difficulty: Difficulty;
  distance_km: string;
  elevation_gain_m: number;
  speed_min_kph: string;
  speed_max_kph: string;
  capacity: number;
  registration_count: number;
  equipment_requirements: string[];
  ability_requirements: string[];
  safety_notice: string;
  status: EventStatus;
  created_at: Date;
  updated_at: Date;
  version: number;
};

type RoadbookRow = QueryResultRow & {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  distance_km: string;
  elevation_gain_m: number;
  estimated_minutes: number;
  difficulty: Difficulty;
  region: string;
  coordinate_system: "WGS84";
  track_geojson: { coordinates: [number, number][] } | null;
  elevation_profile: number[];
  max_gradient: string;
  created_at: Date;
  updated_at: Date;
};

type WaypointRow = QueryResultRow & {
  roadbook_id: string;
  name: string;
  waypoint_type: RoadbookWaypoint["type"];
  longitude: number;
  latitude: number;
  distance_km: string;
  sort_order: number;
};

type RegistrationRow = QueryResultRow & {
  id: string;
  event_id: string;
  user_id: string;
  status: Registration["status"];
  ability_confirmed: boolean;
  equipment_confirmed: boolean;
  waiver_version: string;
  waiver_accepted_at: Date;
  created_at: Date;
  updated_at: Date;
  cancelled_at: Date | null;
};

type UserRegistrationRow = EventRow & {
  registration_id: string;
  registration_event_id: string;
  registration_user_id: string;
  registration_status: Registration["status"];
  registration_ability_confirmed: boolean;
  registration_equipment_confirmed: boolean;
  registration_waiver_version: string;
  registration_waiver_accepted_at: Date;
  registration_created_at: Date;
  registration_updated_at: Date;
  registration_cancelled_at: Date | null;
};

const eventColumns = `
  id, organizer_id, roadbook_id, title, summary, start_at, registration_deadline,
  meeting_point, difficulty, distance_km, elevation_gain_m, speed_min_kph,
  speed_max_kph, capacity, registration_count, equipment_requirements,
  ability_requirements, safety_notice, status, created_at, updated_at, version
`;

const roadbookColumns = `
  id, owner_id, name, description, distance_km, elevation_gain_m,
  estimated_minutes, difficulty, region, coordinate_system,
  ST_AsGeoJSON(track::geometry)::jsonb AS track_geojson,
  elevation_profile, max_gradient, created_at, updated_at
`;

const registrationColumns = `
  id, event_id, user_id, status, ability_confirmed, equipment_confirmed,
  waiver_version, waiver_accepted_at, created_at, updated_at, cancelled_at
`;

function toEvent(row: EventRow): CyclingEvent {
  return {
    id: row.id,
    organizerId: row.organizer_id,
    routeId: row.roadbook_id,
    title: row.title,
    summary: row.summary,
    startAt: row.start_at.toISOString(),
    registrationDeadline: row.registration_deadline.toISOString(),
    meetingPoint: row.meeting_point,
    difficulty: row.difficulty,
    distanceKm: Number(row.distance_km),
    elevationGainM: row.elevation_gain_m,
    speedMinKph: Number(row.speed_min_kph),
    speedMaxKph: Number(row.speed_max_kph),
    capacity: row.capacity,
    registrationCount: row.registration_count,
    equipmentRequirements: row.equipment_requirements,
    abilityRequirements: row.ability_requirements,
    safetyNotice: row.safety_notice,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    version: row.version,
  };
}

function toRoadbook(row: RoadbookRow, waypoints: RoadbookWaypoint[]): Roadbook {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    description: row.description,
    distanceKm: Number(row.distance_km),
    elevationGainM: row.elevation_gain_m,
    estimatedMinutes: row.estimated_minutes,
    difficulty: row.difficulty,
    region: row.region,
    coordinateSystem: row.coordinate_system,
    track: (row.track_geojson?.coordinates ?? []).map(([longitude, latitude]) => ({
      longitude,
      latitude,
    })),
    elevationProfile: row.elevation_profile,
    maxGradient: Number(row.max_gradient),
    waypoints,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toWaypoint(row: WaypointRow): RoadbookWaypoint {
  return {
    name: row.name,
    type: row.waypoint_type,
    longitude: Number(row.longitude),
    latitude: Number(row.latitude),
    distanceKm: Number(row.distance_km),
  };
}

function toRegistration(row: RegistrationRow): Registration {
  return {
    id: row.id,
    eventId: row.event_id,
    userId: row.user_id,
    status: row.status,
    abilityConfirmed: row.ability_confirmed,
    equipmentConfirmed: row.equipment_confirmed,
    waiverVersion: row.waiver_version,
    waiverAcceptedAt: row.waiver_accepted_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    cancelledAt: row.cancelled_at?.toISOString() ?? null,
  };
}

function toUserRegistration(row: UserRegistrationRow): UserRegistrationItem {
  return {
    event: toEvent(row),
    registration: {
      id: row.registration_id,
      eventId: row.registration_event_id,
      userId: row.registration_user_id,
      status: row.registration_status,
      abilityConfirmed: row.registration_ability_confirmed,
      equipmentConfirmed: row.registration_equipment_confirmed,
      waiverVersion: row.registration_waiver_version,
      waiverAcceptedAt: row.registration_waiver_accepted_at.toISOString(),
      createdAt: row.registration_created_at.toISOString(),
      updatedAt: row.registration_updated_at.toISOString(),
      cancelledAt: row.registration_cancelled_at?.toISOString() ?? null,
    },
  };
}

export class PostgresRepository implements Repository {
  constructor(private readonly pool: Pool) {}

  async createEvent(event: CyclingEvent): Promise<CyclingEvent> {
    const result = await this.pool.query<EventRow>(
      `INSERT INTO events (
        id, organizer_id, roadbook_id, title, summary, start_at, registration_deadline,
        meeting_point, difficulty, distance_km, elevation_gain_m, speed_min_kph,
        speed_max_kph, capacity, registration_count, equipment_requirements,
        ability_requirements, safety_notice, status, created_at, updated_at, version
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,
        $17::jsonb,$18,$19,$20,$21,$22
      ) RETURNING ${eventColumns}`,
      [
        event.id, event.organizerId, event.routeId, event.title, event.summary, event.startAt,
        event.registrationDeadline, event.meetingPoint, event.difficulty, event.distanceKm,
        event.elevationGainM, event.speedMinKph, event.speedMaxKph, event.capacity,
        event.registrationCount, JSON.stringify(event.equipmentRequirements),
        JSON.stringify(event.abilityRequirements), event.safetyNotice, event.status,
        event.createdAt, event.updatedAt, event.version,
      ],
    );
    return toEvent(result.rows[0]!);
  }

  async updateEvent(event: CyclingEvent): Promise<CyclingEvent> {
    const result = await this.pool.query<EventRow>(
      `UPDATE events SET
        roadbook_id=$2, title=$3, summary=$4, start_at=$5, registration_deadline=$6,
        meeting_point=$7, difficulty=$8, distance_km=$9, elevation_gain_m=$10,
        speed_min_kph=$11, speed_max_kph=$12, capacity=$13, registration_count=$14,
        equipment_requirements=$15::jsonb, ability_requirements=$16::jsonb,
        safety_notice=$17, status=$18, updated_at=$19, version=$20
      WHERE id=$1 RETURNING ${eventColumns}`,
      [
        event.id, event.routeId, event.title, event.summary, event.startAt,
        event.registrationDeadline, event.meetingPoint, event.difficulty, event.distanceKm,
        event.elevationGainM, event.speedMinKph, event.speedMaxKph, event.capacity,
        event.registrationCount, JSON.stringify(event.equipmentRequirements),
        JSON.stringify(event.abilityRequirements), event.safetyNotice, event.status,
        event.updatedAt, event.version,
      ],
    );
    if (!result.rows[0]) throw notFound("活动");
    return toEvent(result.rows[0]);
  }

  async getEvent(id: string): Promise<CyclingEvent | null> {
    const result = await this.pool.query<EventRow>(`SELECT ${eventColumns} FROM events WHERE id=$1`, [id]);
    return result.rows[0] ? toEvent(result.rows[0]) : null;
  }

  async listEvents(query: EventListQuery): Promise<Page<CyclingEvent>> {
    const statuses = query.status ? [query.status] : ["published", "full"];
    const values: unknown[] = [statuses, query.limit + 1];
    const where = ["status = ANY($1::event_status[])"];
    if (query.difficulty) {
      values.push(query.difficulty);
      where.push(`difficulty = $${values.length}::difficulty_level`);
    }
    if (query.cursor) {
      const cursor = await this.getEvent(query.cursor);
      if (cursor) {
        values.push(cursor.startAt, cursor.id);
        where.push(`(start_at, id) > ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
      }
    }
    const result = await this.pool.query<EventRow>(
      `SELECT ${eventColumns} FROM events WHERE ${where.join(" AND ")}
       ORDER BY start_at ASC, id ASC LIMIT $2`,
      values,
    );
    const hasNext = result.rows.length > query.limit;
    const rows = result.rows.slice(0, query.limit);
    return { items: rows.map(toEvent), nextCursor: hasNext ? rows.at(-1)?.id ?? null : null };
  }

  async createRoadbook(roadbook: Roadbook): Promise<Roadbook> {
    return this.transaction(async (client) => {
      const result = await client.query<RoadbookRow>(
        `INSERT INTO roadbooks (
          id, owner_id, name, description, distance_km, elevation_gain_m,
          estimated_minutes, difficulty, region, coordinate_system, track,
          elevation_profile, max_gradient, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          ST_SetSRID(ST_GeomFromGeoJSON($11),4326)::geography,$12::jsonb,$13,$14,$15
        ) RETURNING ${roadbookColumns}`,
        [roadbook.id, roadbook.ownerId, roadbook.name, roadbook.description, roadbook.distanceKm,
          roadbook.elevationGainM, roadbook.estimatedMinutes, roadbook.difficulty,
          roadbook.region, roadbook.coordinateSystem,
          JSON.stringify({
            type: "LineString",
            coordinates: roadbook.track.map((point) => [point.longitude, point.latitude]),
          }),
          JSON.stringify(roadbook.elevationProfile), roadbook.maxGradient,
          roadbook.createdAt, roadbook.updatedAt],
      );
      for (const [index, waypoint] of roadbook.waypoints.entries()) {
        await client.query(
          `INSERT INTO roadbook_waypoints (
            roadbook_id, name, waypoint_type, location, distance_km, sort_order
          ) VALUES ($1,$2,$3,ST_SetSRID(ST_MakePoint($4,$5),4326)::geography,$6,$7)`,
          [roadbook.id, waypoint.name, waypoint.type, waypoint.longitude, waypoint.latitude, waypoint.distanceKm, index],
        );
      }
      return toRoadbook(result.rows[0]!, roadbook.waypoints);
    });
  }

  async getRoadbook(id: string): Promise<Roadbook | null> {
    const result = await this.pool.query<RoadbookRow>(`SELECT ${roadbookColumns} FROM roadbooks WHERE id=$1`, [id]);
    if (!result.rows[0]) return null;
    const waypoints = await this.loadWaypoints([id]);
    return toRoadbook(result.rows[0], waypoints.get(id) ?? []);
  }

  async listRoadbooks(limit: number, cursor?: string): Promise<Page<Roadbook>> {
    const values: unknown[] = [limit + 1];
    let cursorClause = "";
    if (cursor) {
      const cursorBook = await this.getRoadbook(cursor);
      if (cursorBook) {
        values.push(cursorBook.createdAt, cursorBook.id);
        cursorClause = `WHERE created_at < $2::timestamptz OR (created_at = $2::timestamptz AND id > $3::uuid)`;
      }
    }
    const result = await this.pool.query<RoadbookRow>(
      `SELECT ${roadbookColumns} FROM roadbooks ${cursorClause} ORDER BY created_at DESC, id ASC LIMIT $1`,
      values,
    );
    const hasNext = result.rows.length > limit;
    const rows = result.rows.slice(0, limit);
    const waypoints = await this.loadWaypoints(rows.map((row) => row.id));
    return {
      items: rows.map((row) => toRoadbook(row, waypoints.get(row.id) ?? [])),
      nextCursor: hasNext ? rows.at(-1)?.id ?? null : null,
    };
  }

  async registerAtomically(command: RegisterCommand): Promise<RegistrationResult> {
    return this.transaction(async (client) => {
      const eventResult = await client.query<EventRow>(
        `SELECT ${eventColumns} FROM events WHERE id=$1 FOR UPDATE`,
        [command.eventId],
      );
      if (!eventResult.rows[0]) throw notFound("活动");
      const event = toEvent(eventResult.rows[0]);

      const replay = await client.query<{ response_body: RegistrationResult }>(
        `SELECT response_body FROM registration_idempotency
         WHERE user_id=$1 AND event_id=$2 AND idempotency_key=$3`,
        [command.userId, command.eventId, command.idempotencyKey],
      );
      if (replay.rows[0]) return { ...replay.rows[0].response_body, replayed: true };

      if (event.status !== "published" && event.status !== "full") {
        throw invalidState("当前活动状态不可报名");
      }
      if (command.now.getTime() >= Date.parse(event.registrationDeadline)) {
        throw conflict("REGISTRATION_CLOSED", "报名已截止");
      }

      const existingResult = await client.query<RegistrationRow>(
        `SELECT ${registrationColumns} FROM registrations WHERE event_id=$1 AND user_id=$2 FOR UPDATE`,
        [command.eventId, command.userId],
      );
      const existing = existingResult.rows[0] ? toRegistration(existingResult.rows[0]) : null;
      if (existing?.status === "active") throw conflict("ALREADY_REGISTERED", "请勿重复报名");
      if (event.registrationCount >= event.capacity) throw conflict("EVENT_FULL", "活动名额已满");

      const id = existing?.id ?? randomUUID();
      const registrationResult = await client.query<RegistrationRow>(
        `INSERT INTO registrations (
          id,event_id,user_id,status,ability_confirmed,equipment_confirmed,
          waiver_version,waiver_accepted_at,phone_encrypted,emergency_contact_encrypted,
          bike_type,cancelled_at,created_at,updated_at
        ) VALUES ($1,$2,$3,'active',$4,$5,$6,$7,$8,$9,$10,NULL,$7,$7)
        ON CONFLICT (event_id,user_id) DO UPDATE SET
          status='active', ability_confirmed=EXCLUDED.ability_confirmed,
          equipment_confirmed=EXCLUDED.equipment_confirmed,
          waiver_version=EXCLUDED.waiver_version, waiver_accepted_at=EXCLUDED.waiver_accepted_at,
          phone_encrypted=EXCLUDED.phone_encrypted,
          emergency_contact_encrypted=EXCLUDED.emergency_contact_encrypted,
          bike_type=EXCLUDED.bike_type,
          cancelled_at=NULL, updated_at=EXCLUDED.updated_at
        RETURNING ${registrationColumns}`,
        [id, command.eventId, command.userId, command.abilityConfirmed,
          command.equipmentConfirmed, command.waiverVersion, command.now,
          command.phoneEncrypted, command.emergencyContactEncrypted, command.bikeType],
      );
      const eventUpdate = await client.query<EventRow>(
        `UPDATE events SET registration_count=registration_count+1,
          status=CASE WHEN registration_count+1=capacity THEN 'full'::event_status ELSE 'published'::event_status END,
          updated_at=$2, version=version+1 WHERE id=$1 RETURNING ${eventColumns}`,
        [command.eventId, command.now],
      );
      const result: RegistrationResult = {
        registration: toRegistration(registrationResult.rows[0]!),
        event: toEvent(eventUpdate.rows[0]!),
        replayed: false,
      };
      await client.query(
        `INSERT INTO registration_idempotency
          (user_id,event_id,idempotency_key,response_status,response_body)
         VALUES ($1,$2,$3,201,$4::jsonb)`,
        [command.userId, command.eventId, command.idempotencyKey, JSON.stringify(result)],
      );
      return result;
    });
  }

  async cancelRegistrationAtomically(eventId: string, userId: string, now: Date): Promise<RegistrationResult> {
    return this.transaction(async (client) => {
      const eventResult = await client.query<EventRow>(
        `SELECT ${eventColumns} FROM events WHERE id=$1 FOR UPDATE`,
        [eventId],
      );
      if (!eventResult.rows[0]) throw notFound("活动");
      const event = toEvent(eventResult.rows[0]);
      const registrationResult = await client.query<RegistrationRow>(
        `SELECT ${registrationColumns} FROM registrations WHERE event_id=$1 AND user_id=$2 FOR UPDATE`,
        [eventId, userId],
      );
      if (!registrationResult.rows[0]) throw notFound("报名记录");
      const registration = toRegistration(registrationResult.rows[0]);
      if (registration.status === "cancelled") return { registration, event, replayed: true };
      if (event.status === "completed" || event.status === "cancelled") {
        throw invalidState("当前活动状态不可取消报名");
      }
      const cancelledResult = await client.query<RegistrationRow>(
        `UPDATE registrations SET status='cancelled',cancelled_at=$3,updated_at=$3
         WHERE event_id=$1 AND user_id=$2 RETURNING ${registrationColumns}`,
        [eventId, userId, now],
      );
      const eventUpdate = await client.query<EventRow>(
        `UPDATE events SET registration_count=GREATEST(0,registration_count-1),
          status=CASE WHEN status='full' THEN 'published'::event_status ELSE status END,
          updated_at=$2,version=version+1 WHERE id=$1 RETURNING ${eventColumns}`,
        [eventId, now],
      );
      return {
        registration: toRegistration(cancelledResult.rows[0]!),
        event: toEvent(eventUpdate.rows[0]!),
        replayed: false,
      };
    });
  }

  async getRegistration(eventId: string, userId: string): Promise<Registration | null> {
    const result = await this.pool.query<RegistrationRow>(
      `SELECT ${registrationColumns} FROM registrations WHERE event_id=$1 AND user_id=$2`,
      [eventId, userId],
    );
    return result.rows[0] ? toRegistration(result.rows[0]) : null;
  }

  async listRegistrationsByUser(userId: string): Promise<UserRegistrationItem[]> {
    const result = await this.pool.query<UserRegistrationRow>(
      `SELECT
        r.id AS registration_id,
        r.event_id AS registration_event_id,
        r.user_id AS registration_user_id,
        r.status AS registration_status,
        r.ability_confirmed AS registration_ability_confirmed,
        r.equipment_confirmed AS registration_equipment_confirmed,
        r.waiver_version AS registration_waiver_version,
        r.waiver_accepted_at AS registration_waiver_accepted_at,
        r.created_at AS registration_created_at,
        r.updated_at AS registration_updated_at,
        r.cancelled_at AS registration_cancelled_at,
        e.*
       FROM registrations r
       JOIN events e ON e.id = r.event_id
       WHERE r.user_id=$1
       ORDER BY e.start_at DESC, r.updated_at DESC`,
      [userId],
    );
    return result.rows.map(toUserRegistration);
  }

  private async loadWaypoints(ids: string[]): Promise<Map<string, RoadbookWaypoint[]>> {
    const result = ids.length
      ? await this.pool.query<WaypointRow>(
          `SELECT roadbook_id,name,waypoint_type,
            ST_X(location::geometry) AS longitude,ST_Y(location::geometry) AS latitude,
            distance_km,sort_order FROM roadbook_waypoints
           WHERE roadbook_id=ANY($1::uuid[]) ORDER BY roadbook_id,sort_order`,
          [ids],
        )
      : { rows: [] as WaypointRow[] };
    const grouped = new Map<string, RoadbookWaypoint[]>();
    for (const row of result.rows) grouped.set(row.roadbook_id, [...(grouped.get(row.roadbook_id) ?? []), toWaypoint(row)]);
    return grouped;
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
