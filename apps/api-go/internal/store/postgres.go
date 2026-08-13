package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"cyclewhere/api-go/internal/domain"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const eventColumns = `
  id, organizer_id, roadbook_id, title, summary, cover_url, start_at, registration_deadline,
  meeting_point, meeting_latitude, meeting_longitude, difficulty, distance_km, elevation_gain_m, speed_min_kph,
  speed_max_kph, capacity, registration_count, equipment_requirements,
  ability_requirements, safety_notice, status, created_at, updated_at, version, change_count`

const roadbookColumns = `
  id, owner_id, name, description, distance_km, elevation_gain_m,
  estimated_minutes, difficulty, region, coordinate_system,
  ST_AsGeoJSON(track::geometry)::jsonb, elevation_profile, max_gradient,
  created_at, updated_at`

const registrationColumns = `
  id, event_id, user_id, status, ability_confirmed, equipment_confirmed,
  waiver_version, waiver_accepted_at, created_at, updated_at, cancelled_at`

type Postgres struct{ pool *pgxpool.Pool }

func NewPostgres(pool *pgxpool.Pool) *Postgres { return &Postgres{pool: pool} }

func Open(ctx context.Context, databaseURL string, maxConnections int32) (*Postgres, error) {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database config: %w", err)
	}
	if maxConnections > 0 {
		config.MaxConns = maxConnections
	}
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}
	return NewPostgres(pool), nil
}

func (p *Postgres) Close() { p.pool.Close() }

func (p *Postgres) GetUserProfile(ctx context.Context, userID string) (*domain.UserProfile, error) {
	profile, err := scanUserProfile(p.pool.QueryRow(ctx, `SELECT p.id,p.nickname,p.avatar_url,b.phone_masked,p.gender,p.country,p.province,p.city,p.updated_at
    FROM user_profiles p LEFT JOIN user_phone_bindings b ON b.user_id=p.id WHERE p.id=$1`, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &profile, nil
}

func (p *Postgres) UpsertUserProfile(ctx context.Context, profile domain.UserProfile) (domain.UserProfile, error) {
	_, err := p.pool.Exec(ctx, `INSERT INTO user_profiles
    (id,nickname,avatar_url,gender,country,province,city,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (id) DO UPDATE SET nickname=EXCLUDED.nickname,avatar_url=EXCLUDED.avatar_url,
      gender=EXCLUDED.gender,country=EXCLUDED.country,province=EXCLUDED.province,
      city=EXCLUDED.city,updated_at=EXCLUDED.updated_at`,
		profile.ID, profile.Nickname, profile.AvatarURL, profile.Gender, profile.Country,
		profile.Province, profile.City, profile.UpdatedAt)
	if err != nil {
		return domain.UserProfile{}, err
	}
	updated, err := p.GetUserProfile(ctx, profile.ID)
	if err != nil || updated == nil {
		return domain.UserProfile{}, err
	}
	return *updated, nil
}

func (p *Postgres) GetUserIDByPhoneHash(ctx context.Context, phoneHash string) (*string, error) {
	var userID string
	err := p.pool.QueryRow(ctx, `SELECT user_id FROM user_phone_bindings WHERE phone_hash=$1`, phoneHash).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &userID, nil
}

func (p *Postgres) BindUserPhone(ctx context.Context, userID, phoneHash, phoneEncrypted, phoneMasked string, now time.Time) error {
	_, err := p.pool.Exec(ctx, `INSERT INTO user_phone_bindings
    (user_id,phone_hash,phone_encrypted,phone_masked,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$5)
    ON CONFLICT (user_id) DO UPDATE SET phone_hash=EXCLUDED.phone_hash,
      phone_encrypted=EXCLUDED.phone_encrypted,phone_masked=EXCLUDED.phone_masked,updated_at=EXCLUDED.updated_at`,
		userID, phoneHash, phoneEncrypted, phoneMasked, now)
	return translateWriteError(err, "PHONE_ALREADY_BOUND", "该手机号已绑定其他账号")
}

func (p *Postgres) CreateEvent(ctx context.Context, event domain.Event) (domain.Event, error) {
	equipment, _ := json.Marshal(event.EquipmentRequirements)
	ability, _ := json.Marshal(event.AbilityRequirements)
	row := p.pool.QueryRow(ctx, `INSERT INTO events (
    id, organizer_id, roadbook_id, title, summary, cover_url, start_at, registration_deadline,
    meeting_point, meeting_latitude, meeting_longitude, difficulty, distance_km, elevation_gain_m, speed_min_kph,
    speed_max_kph, capacity, registration_count, equipment_requirements,
    ability_requirements, safety_notice, status, created_at, updated_at, version, change_count
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20::jsonb,$21,$22,$23,$24,$25,$26)
  RETURNING `+eventColumns,
		event.ID, event.OrganizerID, event.RouteID, event.Title, event.Summary, event.CoverURL, event.StartAt,
		event.RegistrationDeadline, event.MeetingPoint, event.MeetingLatitude, event.MeetingLongitude,
		event.Difficulty, event.DistanceKM, event.ElevationGainM, event.SpeedMinKPH, event.SpeedMaxKPH, event.Capacity,
		event.RegistrationCount, string(equipment), string(ability), event.SafetyNotice, event.Status,
		event.CreatedAt, event.UpdatedAt, event.Version, event.ChangeCount)
	created, err := scanEvent(row)
	return created, translateWriteError(err, "EVENT_EXISTS", "活动已存在")
}

func (p *Postgres) UpdateEvent(ctx context.Context, event domain.Event) (domain.Event, error) {
	equipment, _ := json.Marshal(event.EquipmentRequirements)
	ability, _ := json.Marshal(event.AbilityRequirements)
	updated, err := scanEvent(p.pool.QueryRow(ctx, `UPDATE events SET
	    roadbook_id=$2,title=$3,summary=$4,cover_url=$5,start_at=$6,registration_deadline=$7,
	    meeting_point=$8,meeting_latitude=$9,meeting_longitude=$10,difficulty=$11,distance_km=$12,elevation_gain_m=$13,
	    speed_min_kph=$14,speed_max_kph=$15,capacity=$16,registration_count=$17,
	    equipment_requirements=$18::jsonb,ability_requirements=$19::jsonb,
	    safety_notice=$20,status=$21,updated_at=$22,version=$23
	WHERE id=$1 AND version=$24 RETURNING `+eventColumns,
		event.ID, event.RouteID, event.Title, event.Summary, event.CoverURL, event.StartAt,
		event.RegistrationDeadline, event.MeetingPoint, event.MeetingLatitude, event.MeetingLongitude,
		event.Difficulty, event.DistanceKM, event.ElevationGainM, event.SpeedMinKPH, event.SpeedMaxKPH, event.Capacity,
		event.RegistrationCount, string(equipment), string(ability), event.SafetyNotice, event.Status,
		event.UpdatedAt, event.Version, event.Version-1))
	if errors.Is(err, pgx.ErrNoRows) {
		current, lookupErr := p.GetEvent(ctx, event.ID)
		if lookupErr != nil {
			return domain.Event{}, lookupErr
		}
		if current == nil {
			return domain.Event{}, domain.NotFound("活动")
		}
		return domain.Event{}, domain.Conflict("EVENT_VERSION_CONFLICT", "活动已被其他操作更新，请刷新后重试")
	}
	return updated, err
}

func (p *Postgres) UpdateEventWithChange(ctx context.Context, event domain.Event, change domain.EventChange) (domain.Event, error) {
	var updated domain.Event
	err := p.withTransaction(ctx, func(tx pgx.Tx) error {
		var currentVersion, currentCount int
		err := tx.QueryRow(ctx, `SELECT version,change_count FROM events WHERE id=$1 FOR UPDATE`, event.ID).Scan(&currentVersion, &currentCount)
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.NotFound("活动")
		}
		if err != nil {
			return err
		}
		if currentVersion != event.Version-1 {
			return domain.Conflict("EVENT_VERSION_CONFLICT", "活动已被其他操作更新，请刷新后重试")
		}
		if currentCount >= domain.EventChangeLimit {
			return domain.Conflict("EVENT_CHANGE_LIMIT_REACHED", "活动信息最多只能修改 3 次")
		}
		equipment, _ := json.Marshal(event.EquipmentRequirements)
		ability, _ := json.Marshal(event.AbilityRequirements)
		updated, err = scanEvent(tx.QueryRow(ctx, `UPDATE events SET
		    roadbook_id=$2,title=$3,summary=$4,cover_url=$5,start_at=$6,registration_deadline=$7,
		    meeting_point=$8,meeting_latitude=$9,meeting_longitude=$10,difficulty=$11,distance_km=$12,elevation_gain_m=$13,
		    speed_min_kph=$14,speed_max_kph=$15,capacity=$16,equipment_requirements=$17::jsonb,
		    ability_requirements=$18::jsonb,safety_notice=$19,updated_at=$20,version=$21,change_count=change_count+1
		  WHERE id=$1 AND change_count<$22 RETURNING `+eventColumns,
			event.ID, event.RouteID, event.Title, event.Summary, event.CoverURL, event.StartAt,
			event.RegistrationDeadline, event.MeetingPoint, event.MeetingLatitude, event.MeetingLongitude,
			event.Difficulty, event.DistanceKM, event.ElevationGainM, event.SpeedMinKPH, event.SpeedMaxKPH,
			event.Capacity, string(equipment), string(ability), event.SafetyNotice, event.UpdatedAt,
			event.Version, domain.EventChangeLimit))
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Conflict("EVENT_CHANGE_LIMIT_REACHED", "活动信息最多只能修改 3 次")
		}
		if err != nil {
			return err
		}
		change.ChangeNumber = updated.ChangeCount
		fields, err := json.Marshal(change.ChangedFields)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO event_changes
		  (id,event_id,summary,change_number,changed_fields,created_at)
		  VALUES ($1,$2,$3,$4,$5::jsonb,$6)`, change.ID, event.ID, change.Summary,
			change.ChangeNumber, string(fields), change.CreatedAt)
		if err != nil {
			return err
		}
		updated.LatestChange = &change
		return nil
	})
	return updated, err
}

func (p *Postgres) GetEvent(ctx context.Context, id string) (*domain.Event, error) {
	event, err := scanEvent(p.pool.QueryRow(ctx, `SELECT `+eventColumns+` FROM events WHERE id=$1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	changes, err := p.ListEventChanges(ctx, id)
	if err != nil {
		return nil, err
	}
	if len(changes) > 0 {
		latest := changes[0]
		event.LatestChange = &latest
	}
	return &event, nil
}

func (p *Postgres) ListEventChanges(ctx context.Context, eventID string) ([]domain.EventChange, error) {
	rows, err := p.pool.Query(ctx, `SELECT id,event_id,summary,change_number,changed_fields,created_at
	  FROM event_changes WHERE event_id=$1 ORDER BY change_number DESC`, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	changes := make([]domain.EventChange, 0)
	for rows.Next() {
		change, err := scanEventChange(rows)
		if err != nil {
			return nil, err
		}
		changes = append(changes, change)
	}
	return changes, rows.Err()
}

func (p *Postgres) ListEvents(ctx context.Context, query domain.EventListQuery) (domain.Page[domain.Event], error) {
	statuses := []string{string(domain.EventPublished), string(domain.EventFull)}
	if query.Status != nil {
		statuses = []string{string(*query.Status)}
	}
	args := []any{statuses, query.Limit + 1}
	where := `status = ANY($1::event_status[])`
	if query.Difficulty != nil {
		args = append(args, *query.Difficulty)
		where += fmt.Sprintf(` AND difficulty=$%d::difficulty_level`, len(args))
	}
	if query.Cursor != nil {
		cursor, err := p.GetEvent(ctx, *query.Cursor)
		if err != nil {
			return domain.Page[domain.Event]{}, err
		}
		if cursor != nil {
			args = append(args, cursor.StartAt, cursor.ID)
			where += fmt.Sprintf(` AND (start_at,id)>($%d::timestamptz,$%d::uuid)`, len(args)-1, len(args))
		}
	}
	rows, err := p.pool.Query(ctx, `SELECT `+eventColumns+` FROM events WHERE `+where+` ORDER BY start_at ASC,id ASC LIMIT $2`, args...)
	if err != nil {
		return domain.Page[domain.Event]{}, err
	}
	defer rows.Close()
	items := make([]domain.Event, 0, query.Limit+1)
	for rows.Next() {
		event, err := scanEvent(rows)
		if err != nil {
			return domain.Page[domain.Event]{}, err
		}
		items = append(items, event)
	}
	if err := rows.Err(); err != nil {
		return domain.Page[domain.Event]{}, err
	}
	if err := p.hydrateLatestEventChanges(ctx, items); err != nil {
		return domain.Page[domain.Event]{}, err
	}
	return pageEvents(items, query.Limit), nil
}

func (p *Postgres) ListEventsByOrganizer(ctx context.Context, organizerID string) ([]domain.Event, error) {
	rows, err := p.pool.Query(ctx, `SELECT `+eventColumns+` FROM events WHERE organizer_id=$1 ORDER BY created_at DESC,id ASC`, organizerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.Event, 0)
	for rows.Next() {
		event, err := scanEvent(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, event)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := p.hydrateLatestEventChanges(ctx, items); err != nil {
		return nil, err
	}
	return items, nil
}

func (p *Postgres) hydrateLatestEventChanges(ctx context.Context, events []domain.Event) error {
	ids := make([]string, 0, len(events))
	for _, event := range events {
		if event.ChangeCount > 0 {
			ids = append(ids, event.ID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	rows, err := p.pool.Query(ctx, `SELECT DISTINCT ON (event_id)
	  id,event_id,summary,change_number,changed_fields,created_at
	  FROM event_changes WHERE event_id=ANY($1::uuid[])
	  ORDER BY event_id,change_number DESC`, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	latest := make(map[string]domain.EventChange, len(ids))
	for rows.Next() {
		change, err := scanEventChange(rows)
		if err != nil {
			return err
		}
		latest[change.EventID] = change
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for index := range events {
		if change, ok := latest[events[index].ID]; ok {
			copy := change
			events[index].LatestChange = &copy
		}
	}
	return nil
}

func (p *Postgres) CreateRoadbook(ctx context.Context, roadbook domain.Roadbook) (domain.Roadbook, error) {
	var created domain.Roadbook
	err := p.withTransaction(ctx, func(tx pgx.Tx) error {
		coordinates := make([][2]float64, len(roadbook.Track))
		for index, point := range roadbook.Track {
			coordinates[index] = [2]float64{point.Longitude, point.Latitude}
		}
		geoJSON, _ := json.Marshal(map[string]any{"type": "LineString", "coordinates": coordinates})
		elevation, _ := json.Marshal(roadbook.ElevationProfile)
		stored, err := scanRoadbook(tx.QueryRow(ctx, `INSERT INTO roadbooks (
      id,owner_id,name,description,distance_km,elevation_gain_m,estimated_minutes,
      difficulty,region,coordinate_system,track,elevation_profile,max_gradient,created_at,updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,ST_SetSRID(ST_GeomFromGeoJSON($11),4326)::geography,$12::jsonb,$13,$14,$15)
    RETURNING `+roadbookColumns,
			roadbook.ID, roadbook.OwnerID, roadbook.Name, roadbook.Description, roadbook.DistanceKM,
			roadbook.ElevationGainM, roadbook.EstimatedMinutes, roadbook.Difficulty, roadbook.Region,
			roadbook.CoordinateSystem, string(geoJSON), string(elevation), roadbook.MaxGradient, roadbook.CreatedAt, roadbook.UpdatedAt))
		if err != nil {
			return err
		}
		for index, waypoint := range roadbook.Waypoints {
			_, err = tx.Exec(ctx, `INSERT INTO roadbook_waypoints
        (roadbook_id,name,waypoint_type,location,distance_km,sort_order)
        VALUES ($1,$2,$3,ST_SetSRID(ST_MakePoint($4,$5),4326)::geography,$6,$7)`,
				roadbook.ID, waypoint.Name, waypoint.Type, waypoint.Longitude, waypoint.Latitude, waypoint.DistanceKM, index)
			if err != nil {
				return err
			}
		}
		stored.Waypoints = append([]domain.Waypoint(nil), roadbook.Waypoints...)
		created = stored
		return nil
	})
	return created, translateWriteError(err, "ROADBOOK_EXISTS", "路书已存在")
}

func (p *Postgres) GetRoadbook(ctx context.Context, id string) (*domain.Roadbook, error) {
	roadbook, err := scanRoadbook(p.pool.QueryRow(ctx, `SELECT `+roadbookColumns+` FROM roadbooks WHERE id=$1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	waypoints, err := p.loadWaypoints(ctx, []string{id})
	if err != nil {
		return nil, err
	}
	roadbook.Waypoints = waypoints[id]
	return &roadbook, nil
}

func (p *Postgres) ListRoadbooks(ctx context.Context, limit int, cursor *string) (domain.Page[domain.Roadbook], error) {
	args := []any{limit + 1}
	where := ""
	if cursor != nil {
		book, err := p.GetRoadbook(ctx, *cursor)
		if err != nil {
			return domain.Page[domain.Roadbook]{}, err
		}
		if book != nil {
			args = append(args, book.CreatedAt, book.ID)
			where = `WHERE created_at<$2::timestamptz OR (created_at=$2::timestamptz AND id>$3::uuid)`
		}
	}
	rows, err := p.pool.Query(ctx, `SELECT `+roadbookColumns+` FROM roadbooks `+where+` ORDER BY created_at DESC,id ASC LIMIT $1`, args...)
	if err != nil {
		return domain.Page[domain.Roadbook]{}, err
	}
	defer rows.Close()
	items := make([]domain.Roadbook, 0, limit+1)
	ids := make([]string, 0, limit+1)
	for rows.Next() {
		item, err := scanRoadbook(rows)
		if err != nil {
			return domain.Page[domain.Roadbook]{}, err
		}
		items = append(items, item)
		ids = append(ids, item.ID)
	}
	if err := rows.Err(); err != nil {
		return domain.Page[domain.Roadbook]{}, err
	}
	waypoints, err := p.loadWaypoints(ctx, ids)
	if err != nil {
		return domain.Page[domain.Roadbook]{}, err
	}
	for index := range items {
		items[index].Waypoints = waypoints[items[index].ID]
	}
	return pageRoadbooks(items, limit), nil
}

func (p *Postgres) RegisterAtomically(ctx context.Context, command domain.RegisterCommand) (domain.RegistrationResult, error) {
	var result domain.RegistrationResult
	err := p.withTransaction(ctx, func(tx pgx.Tx) error {
		event, err := scanEvent(tx.QueryRow(ctx, `SELECT `+eventColumns+` FROM events WHERE id=$1 FOR UPDATE`, command.EventID))
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.NotFound("活动")
		}
		if err != nil {
			return err
		}
		var replayJSON []byte
		err = tx.QueryRow(ctx, `SELECT response_body FROM registration_idempotency WHERE user_id=$1 AND event_id=$2 AND idempotency_key=$3`, command.UserID, command.EventID, command.IdempotencyKey).Scan(&replayJSON)
		if err == nil {
			if err := json.Unmarshal(replayJSON, &result); err != nil {
				return fmt.Errorf("decode idempotency response: %w", err)
			}
			result.Replayed = true
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if event.Status != domain.EventPublished && event.Status != domain.EventFull {
			return domain.InvalidState("当前活动状态不可报名")
		}
		if !command.Now.Before(event.RegistrationDeadline) {
			return domain.Conflict("REGISTRATION_CLOSED", "报名已截止")
		}
		existing, err := scanRegistration(tx.QueryRow(ctx, `SELECT `+registrationColumns+` FROM registrations WHERE event_id=$1 AND user_id=$2 FOR UPDATE`, command.EventID, command.UserID))
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if err == nil && existing.Status == domain.RegistrationActive {
			return domain.Conflict("ALREADY_REGISTERED", "请勿重复报名")
		}
		if event.RegistrationCount >= event.Capacity {
			return domain.Conflict("EVENT_FULL", "活动名额已满")
		}
		registrationID := uuid.NewString()
		if err == nil {
			registrationID = existing.ID
		}
		registration, err := scanRegistration(tx.QueryRow(ctx, `INSERT INTO registrations (
      id,event_id,user_id,status,ability_confirmed,equipment_confirmed,waiver_version,
      waiver_accepted_at,phone_encrypted,emergency_contact_encrypted,bike_type,cancelled_at,created_at,updated_at
    ) VALUES ($1,$2,$3,'active',$4,$5,$6,$7,$8,$9,$10,NULL,$7,$7)
    ON CONFLICT (event_id,user_id) DO UPDATE SET status='active',ability_confirmed=EXCLUDED.ability_confirmed,
      equipment_confirmed=EXCLUDED.equipment_confirmed,waiver_version=EXCLUDED.waiver_version,
      waiver_accepted_at=EXCLUDED.waiver_accepted_at,phone_encrypted=EXCLUDED.phone_encrypted,
      emergency_contact_encrypted=EXCLUDED.emergency_contact_encrypted,bike_type=EXCLUDED.bike_type,
      cancelled_at=NULL,updated_at=EXCLUDED.updated_at RETURNING `+registrationColumns,
			registrationID, command.EventID, command.UserID, command.AbilityConfirmed,
			command.EquipmentConfirmed, command.WaiverVersion, command.Now, command.PhoneEncrypted,
			command.EmergencyContactEncrypted, command.BikeType))
		if err != nil {
			return err
		}
		updatedEvent, err := scanEvent(tx.QueryRow(ctx, `UPDATE events SET
      registration_count=registration_count+1,
      status=CASE WHEN registration_count+1=capacity THEN 'full'::event_status ELSE 'published'::event_status END,
      updated_at=$2,version=version+1 WHERE id=$1 RETURNING `+eventColumns, command.EventID, command.Now))
		if err != nil {
			return err
		}
		result = domain.RegistrationResult{Registration: registration, Event: updatedEvent, Replayed: false}
		encoded, err := json.Marshal(result)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO registration_idempotency (user_id,event_id,idempotency_key,response_status,response_body) VALUES ($1,$2,$3,201,$4::jsonb)`, command.UserID, command.EventID, command.IdempotencyKey, string(encoded))
		return err
	})
	return result, err
}

func (p *Postgres) CancelRegistrationAtomically(ctx context.Context, eventID, userID string, now time.Time) (domain.RegistrationResult, error) {
	var result domain.RegistrationResult
	err := p.withTransaction(ctx, func(tx pgx.Tx) error {
		event, err := scanEvent(tx.QueryRow(ctx, `SELECT `+eventColumns+` FROM events WHERE id=$1 FOR UPDATE`, eventID))
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.NotFound("活动")
		}
		if err != nil {
			return err
		}
		registration, err := scanRegistration(tx.QueryRow(ctx, `SELECT `+registrationColumns+` FROM registrations WHERE event_id=$1 AND user_id=$2 FOR UPDATE`, eventID, userID))
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.NotFound("报名记录")
		}
		if err != nil {
			return err
		}
		if registration.Status == domain.RegistrationCancelled {
			result = domain.RegistrationResult{Registration: registration, Event: event, Replayed: true}
			return nil
		}
		if event.Status == domain.EventCompleted || event.Status == domain.EventCancelled {
			return domain.InvalidState("当前活动状态不可取消报名")
		}
		registration, err = scanRegistration(tx.QueryRow(ctx, `UPDATE registrations SET status='cancelled',cancelled_at=$3,updated_at=$3 WHERE event_id=$1 AND user_id=$2 RETURNING `+registrationColumns, eventID, userID, now))
		if err != nil {
			return err
		}
		event, err = scanEvent(tx.QueryRow(ctx, `UPDATE events SET registration_count=GREATEST(0,registration_count-1),status=CASE WHEN status='full' THEN 'published'::event_status ELSE status END,updated_at=$2,version=version+1 WHERE id=$1 RETURNING `+eventColumns, eventID, now))
		if err != nil {
			return err
		}
		result = domain.RegistrationResult{Registration: registration, Event: event, Replayed: false}
		return nil
	})
	return result, err
}

func (p *Postgres) GetRegistration(ctx context.Context, eventID, userID string) (*domain.Registration, error) {
	registration, err := scanRegistration(p.pool.QueryRow(ctx, `SELECT `+registrationColumns+` FROM registrations WHERE event_id=$1 AND user_id=$2`, eventID, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &registration, nil
}

func (p *Postgres) ListRegistrationsByUser(ctx context.Context, userID string) ([]domain.UserRegistration, error) {
	rows, err := p.pool.Query(ctx, `SELECT
    r.id,r.event_id,r.user_id,r.status,r.ability_confirmed,r.equipment_confirmed,
    r.waiver_version,r.waiver_accepted_at,r.created_at,r.updated_at,r.cancelled_at,
    e.*
    FROM registrations r JOIN (SELECT `+eventColumns+` FROM events) e ON e.id=r.event_id WHERE r.user_id=$1
    ORDER BY e.start_at DESC,r.updated_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.UserRegistration, 0)
	for rows.Next() {
		registration, event, err := scanUserRegistration(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, domain.UserRegistration{Registration: registration, Event: event})
	}
	return items, rows.Err()
}

func (p *Postgres) ListEventParticipants(ctx context.Context, eventID string) ([]domain.EventParticipant, error) {
	rows, err := p.pool.Query(ctx, `SELECT participant_id,nickname,avatar_url,is_organizer
  FROM (
    SELECT e.organizer_id AS participant_id,p.nickname,p.avatar_url,true AS is_organizer,e.created_at,e.organizer_id AS sort_id
    FROM events e
    LEFT JOIN user_profiles p ON p.id=e.organizer_id
    WHERE e.id=$1
    UNION ALL
    SELECT r.id AS participant_id,p.nickname,p.avatar_url,false AS is_organizer,r.created_at,r.id AS sort_id
    FROM registrations r
    LEFT JOIN user_profiles p ON p.id=r.user_id
    WHERE r.event_id=$1 AND r.status='active' AND r.user_id <> (SELECT organizer_id FROM events WHERE id=$1)
  ) participants
  ORDER BY is_organizer DESC, created_at ASC, sort_id ASC`, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.EventParticipant, 0)
	for rows.Next() {
		var participant domain.EventParticipant
		if err := rows.Scan(&participant.ID, &participant.Nickname, &participant.AvatarURL, &participant.IsOrganizer); err != nil {
			return nil, err
		}
		items = append(items, participant)
	}
	return items, rows.Err()
}

func (p *Postgres) GetEventParticipantContact(ctx context.Context, eventID, participantID string) (*domain.EventParticipantContact, error) {
	var contact domain.EventParticipantContact
	err := p.pool.QueryRow(ctx, `SELECT r.id,p.nickname,p.avatar_url,r.phone_encrypted,
    r.emergency_contact_encrypted,r.bike_type
    FROM registrations r
    LEFT JOIN user_profiles p ON p.id=r.user_id
    WHERE r.event_id=$1 AND r.id=$2 AND r.status='active'`, eventID, participantID).Scan(
		&contact.ID, &contact.Nickname, &contact.AvatarURL, &contact.PhoneEncrypted,
		&contact.EmergencyContactEncrypted, &contact.BikeType)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &contact, nil
}

type scanner interface{ Scan(...any) error }

func scanEvent(row scanner) (domain.Event, error) {
	var event domain.Event
	var routeID *string
	var equipment, ability []byte
	err := row.Scan(&event.ID, &event.OrganizerID, &routeID, &event.Title, &event.Summary, &event.CoverURL,
		&event.StartAt, &event.RegistrationDeadline, &event.MeetingPoint, &event.MeetingLatitude, &event.MeetingLongitude, &event.Difficulty,
		&event.DistanceKM, &event.ElevationGainM, &event.SpeedMinKPH, &event.SpeedMaxKPH,
		&event.Capacity, &event.RegistrationCount, &equipment, &ability, &event.SafetyNotice,
		&event.Status, &event.CreatedAt, &event.UpdatedAt, &event.Version, &event.ChangeCount)
	if err != nil {
		return domain.Event{}, err
	}
	event.RouteID = routeID
	if err := json.Unmarshal(equipment, &event.EquipmentRequirements); err != nil {
		return domain.Event{}, err
	}
	if err := json.Unmarshal(ability, &event.AbilityRequirements); err != nil {
		return domain.Event{}, err
	}
	return event, nil
}

func scanEventChange(row scanner) (domain.EventChange, error) {
	var change domain.EventChange
	var fields []byte
	err := row.Scan(&change.ID, &change.EventID, &change.Summary, &change.ChangeNumber, &fields, &change.CreatedAt)
	if err != nil {
		return domain.EventChange{}, err
	}
	if err := json.Unmarshal(fields, &change.ChangedFields); err != nil {
		return domain.EventChange{}, err
	}
	if change.ChangedFields == nil {
		change.ChangedFields = []domain.EventChangedField{}
	}
	return change, nil
}

func scanRoadbook(row scanner) (domain.Roadbook, error) {
	var book domain.Roadbook
	var trackJSON, elevationJSON []byte
	err := row.Scan(&book.ID, &book.OwnerID, &book.Name, &book.Description, &book.DistanceKM,
		&book.ElevationGainM, &book.EstimatedMinutes, &book.Difficulty, &book.Region,
		&book.CoordinateSystem, &trackJSON, &elevationJSON, &book.MaxGradient, &book.CreatedAt, &book.UpdatedAt)
	if err != nil {
		return domain.Roadbook{}, err
	}
	var geometry struct {
		Coordinates [][2]float64 `json:"coordinates"`
	}
	if err := json.Unmarshal(trackJSON, &geometry); err != nil {
		return domain.Roadbook{}, err
	}
	book.Track = make([]domain.TrackPoint, len(geometry.Coordinates))
	for index, point := range geometry.Coordinates {
		book.Track[index] = domain.TrackPoint{Longitude: point[0], Latitude: point[1]}
	}
	if err := json.Unmarshal(elevationJSON, &book.ElevationProfile); err != nil {
		return domain.Roadbook{}, err
	}
	return book, nil
}

func scanRegistration(row scanner) (domain.Registration, error) {
	var registration domain.Registration
	err := row.Scan(&registration.ID, &registration.EventID, &registration.UserID,
		&registration.Status, &registration.AbilityConfirmed, &registration.EquipmentConfirmed,
		&registration.WaiverVersion, &registration.WaiverAcceptedAt, &registration.CreatedAt,
		&registration.UpdatedAt, &registration.CancelledAt)
	return registration, err
}

func scanUserProfile(row scanner) (domain.UserProfile, error) {
	var profile domain.UserProfile
	err := row.Scan(&profile.ID, &profile.Nickname, &profile.AvatarURL, &profile.PhoneMasked, &profile.Gender,
		&profile.Country, &profile.Province, &profile.City, &profile.UpdatedAt)
	return profile, err
}

func scanUserRegistration(row scanner) (domain.Registration, domain.Event, error) {
	var registration domain.Registration
	var event domain.Event
	var routeID *string
	var equipment, ability []byte
	err := row.Scan(&registration.ID, &registration.EventID, &registration.UserID,
		&registration.Status, &registration.AbilityConfirmed, &registration.EquipmentConfirmed,
		&registration.WaiverVersion, &registration.WaiverAcceptedAt, &registration.CreatedAt,
		&registration.UpdatedAt, &registration.CancelledAt,
		&event.ID, &event.OrganizerID, &routeID, &event.Title, &event.Summary, &event.CoverURL,
		&event.StartAt, &event.RegistrationDeadline, &event.MeetingPoint, &event.MeetingLatitude, &event.MeetingLongitude, &event.Difficulty,
		&event.DistanceKM, &event.ElevationGainM, &event.SpeedMinKPH, &event.SpeedMaxKPH,
		&event.Capacity, &event.RegistrationCount, &equipment, &ability, &event.SafetyNotice,
		&event.Status, &event.CreatedAt, &event.UpdatedAt, &event.Version, &event.ChangeCount)
	if err != nil {
		return domain.Registration{}, domain.Event{}, err
	}
	event.RouteID = routeID
	if err := json.Unmarshal(equipment, &event.EquipmentRequirements); err != nil {
		return domain.Registration{}, domain.Event{}, err
	}
	if err := json.Unmarshal(ability, &event.AbilityRequirements); err != nil {
		return domain.Registration{}, domain.Event{}, err
	}
	return registration, event, nil
}

func (p *Postgres) loadWaypoints(ctx context.Context, ids []string) (map[string][]domain.Waypoint, error) {
	result := make(map[string][]domain.Waypoint, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	rows, err := p.pool.Query(ctx, `SELECT roadbook_id,name,waypoint_type,ST_X(location::geometry),ST_Y(location::geometry),distance_km FROM roadbook_waypoints WHERE roadbook_id=ANY($1::uuid[]) ORDER BY roadbook_id,sort_order`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var waypoint domain.Waypoint
		if err := rows.Scan(&id, &waypoint.Name, &waypoint.Type, &waypoint.Longitude, &waypoint.Latitude, &waypoint.DistanceKM); err != nil {
			return nil, err
		}
		result[id] = append(result[id], waypoint)
	}
	return result, rows.Err()
}

func (p *Postgres) withTransaction(ctx context.Context, action func(pgx.Tx) error) error {
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	if err := action(tx); err != nil {
		_ = tx.Rollback(ctx)
		return err
	}
	return tx.Commit(ctx)
}

func translateWriteError(err error, code, message string) error {
	if err == nil {
		return nil
	}
	var pgError *pgconn.PgError
	if errors.As(err, &pgError) && pgError.Code == "23505" {
		return domain.Conflict(code, message)
	}
	return err
}

func pageEvents(items []domain.Event, limit int) domain.Page[domain.Event] {
	result := domain.Page[domain.Event]{Items: items}
	if len(items) > limit {
		result.Items = items[:limit]
		cursor := result.Items[len(result.Items)-1].ID
		result.NextCursor = &cursor
	}
	return result
}

func pageRoadbooks(items []domain.Roadbook, limit int) domain.Page[domain.Roadbook] {
	result := domain.Page[domain.Roadbook]{Items: items}
	if len(items) > limit {
		result.Items = items[:limit]
		cursor := result.Items[len(result.Items)-1].ID
		result.NextCursor = &cursor
	}
	return result
}
