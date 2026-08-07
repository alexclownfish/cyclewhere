package service

import (
	"context"
	"strings"
	"time"

	"cyclewhere/api-go/internal/domain"
	"github.com/google/uuid"
)

type Clock func() time.Time

type Catalog struct {
	repository domain.Repository
	clock      Clock
}

func NewCatalog(repository domain.Repository, clock Clock) *Catalog {
	if clock == nil {
		clock = time.Now
	}
	return &Catalog{repository: repository, clock: clock}
}

type EventInput struct {
	RouteID               *string           `json:"routeId"`
	Title                 string            `json:"title"`
	Summary               string            `json:"summary"`
	StartAt               time.Time         `json:"startAt"`
	RegistrationDeadline  time.Time         `json:"registrationDeadline"`
	MeetingPoint          string            `json:"meetingPoint"`
	Difficulty            domain.Difficulty `json:"difficulty"`
	DistanceKM            float64           `json:"distanceKm"`
	ElevationGainM        int               `json:"elevationGainM"`
	SpeedMinKPH           float64           `json:"speedMinKph"`
	SpeedMaxKPH           float64           `json:"speedMaxKph"`
	Capacity              int               `json:"capacity"`
	EquipmentRequirements []string          `json:"equipmentRequirements"`
	AbilityRequirements   []string          `json:"abilityRequirements"`
	SafetyNotice          string            `json:"safetyNotice"`
}

type EventPatch struct {
	RouteID               **string           `json:"routeId"`
	Title                 *string            `json:"title"`
	Summary               *string            `json:"summary"`
	StartAt               *time.Time         `json:"startAt"`
	RegistrationDeadline  *time.Time         `json:"registrationDeadline"`
	MeetingPoint          *string            `json:"meetingPoint"`
	Difficulty            *domain.Difficulty `json:"difficulty"`
	DistanceKM            *float64           `json:"distanceKm"`
	ElevationGainM        *int               `json:"elevationGainM"`
	SpeedMinKPH           *float64           `json:"speedMinKph"`
	SpeedMaxKPH           *float64           `json:"speedMaxKph"`
	Capacity              *int               `json:"capacity"`
	EquipmentRequirements *[]string          `json:"equipmentRequirements"`
	AbilityRequirements   *[]string          `json:"abilityRequirements"`
	SafetyNotice          *string            `json:"safetyNotice"`
}

type RoadbookInput struct {
	Name             string              `json:"name"`
	Description      string              `json:"description"`
	DistanceKM       float64             `json:"distanceKm"`
	ElevationGainM   int                 `json:"elevationGainM"`
	EstimatedMinutes int                 `json:"estimatedMinutes"`
	Difficulty       domain.Difficulty   `json:"difficulty"`
	Region           string              `json:"region"`
	Track            []domain.TrackPoint `json:"track"`
	ElevationProfile []float64           `json:"elevationProfile"`
	MaxGradient      float64             `json:"maxGradient"`
	Waypoints        []domain.Waypoint   `json:"waypoints"`
}

func (s *Catalog) ListEvents(ctx context.Context, query domain.EventListQuery) (domain.Page[domain.Event], error) {
	if query.Limit == 0 {
		query.Limit = 20
	}
	if query.Limit < 1 || query.Limit > 100 {
		return domain.Page[domain.Event]{}, invalid("limit", "must be between 1 and 100")
	}
	return s.repository.ListEvents(ctx, query)
}

func (s *Catalog) ListOwnedEvents(ctx context.Context, organizerID string) ([]domain.Event, error) {
	return s.repository.ListEventsByOrganizer(ctx, organizerID)
}

func (s *Catalog) GetEvent(ctx context.Context, id string) (*domain.Event, error) {
	event, err := s.repository.GetEvent(ctx, id)
	if err != nil {
		return nil, err
	}
	if event == nil {
		return nil, domain.NotFound("活动")
	}
	return event, nil
}

func (s *Catalog) GetPublicEvent(ctx context.Context, id, viewerID string) (*domain.Event, error) {
	event, err := s.GetEvent(ctx, id)
	if err != nil {
		return nil, err
	}
	public := event.Status == domain.EventPublished || event.Status == domain.EventFull || event.Status == domain.EventCompleted
	if !public && event.OrganizerID != viewerID {
		return nil, domain.NotFound("活动")
	}
	return event, nil
}

func (s *Catalog) CreateEvent(ctx context.Context, organizerID string, input EventInput) (domain.Event, error) {
	if err := validateEventInput(input); err != nil {
		return domain.Event{}, err
	}
	if input.RouteID != nil {
		roadbook, err := s.repository.GetRoadbook(ctx, *input.RouteID)
		if err != nil {
			return domain.Event{}, err
		}
		if roadbook == nil {
			return domain.Event{}, domain.NotFound("路书")
		}
	}
	now := s.clock().UTC()
	event := domain.Event{
		ID: uuid.NewString(), OrganizerID: organizerID, RouteID: input.RouteID,
		Title: strings.TrimSpace(input.Title), Summary: strings.TrimSpace(input.Summary),
		StartAt: input.StartAt, RegistrationDeadline: input.RegistrationDeadline,
		MeetingPoint: strings.TrimSpace(input.MeetingPoint), Difficulty: input.Difficulty,
		DistanceKM: input.DistanceKM, ElevationGainM: input.ElevationGainM,
		SpeedMinKPH: input.SpeedMinKPH, SpeedMaxKPH: input.SpeedMaxKPH,
		Capacity: input.Capacity, EquipmentRequirements: cleanStrings(input.EquipmentRequirements),
		AbilityRequirements: cleanStrings(input.AbilityRequirements), SafetyNotice: strings.TrimSpace(input.SafetyNotice),
		Status: domain.EventDraft, CreatedAt: now, UpdatedAt: now, Version: 1,
	}
	return s.repository.CreateEvent(ctx, event)
}

func (s *Catalog) PublishEvent(ctx context.Context, id, organizerID string) (domain.Event, error) {
	event, err := s.GetEvent(ctx, id)
	if err != nil {
		return domain.Event{}, err
	}
	if event.OrganizerID != organizerID {
		return domain.Event{}, domain.Forbidden("仅活动组织者可以发布活动")
	}
	if event.Status != domain.EventDraft {
		return domain.Event{}, domain.InvalidState("只有草稿活动可以发布")
	}
	if !s.clock().Before(event.RegistrationDeadline) {
		return domain.Event{}, domain.InvalidState("报名截止时间已过，无法发布")
	}
	event.Status = domain.EventPublished
	event.UpdatedAt = s.clock().UTC()
	event.Version++
	return s.repository.UpdateEvent(ctx, *event)
}

func (s *Catalog) UpdateEvent(ctx context.Context, id, organizerID string, patch EventPatch) (domain.Event, error) {
	event, err := s.GetEvent(ctx, id)
	if err != nil {
		return domain.Event{}, err
	}
	if event.OrganizerID != organizerID {
		return domain.Event{}, domain.Forbidden("仅活动组织者可以编辑活动")
	}
	if event.Status == domain.EventCompleted || event.Status == domain.EventCancelled {
		return domain.Event{}, domain.InvalidState("已结束或已取消的活动不可编辑")
	}
	if event.RegistrationCount > 0 && restrictedChange(*event, patch) {
		return domain.Event{}, domain.InvalidState("已有报名后不可修改路线、出发时间、报名截止时间或人数上限")
	}
	applyEventPatch(event, patch)
	if event.Capacity < event.RegistrationCount {
		return domain.Event{}, domain.InvalidState("人数上限不能低于已报名人数")
	}
	if err := validateEvent(*event); err != nil {
		return domain.Event{}, err
	}
	if event.RouteID != nil {
		roadbook, err := s.repository.GetRoadbook(ctx, *event.RouteID)
		if err != nil {
			return domain.Event{}, err
		}
		if roadbook == nil {
			return domain.Event{}, domain.NotFound("路书")
		}
	}
	event.UpdatedAt = s.clock().UTC()
	event.Version++
	return s.repository.UpdateEvent(ctx, *event)
}

func (s *Catalog) ListRoadbooks(ctx context.Context, limit int, cursor *string) (domain.Page[domain.Roadbook], error) {
	if limit == 0 {
		limit = 20
	}
	if limit < 1 || limit > 100 {
		return domain.Page[domain.Roadbook]{}, invalid("limit", "must be between 1 and 100")
	}
	return s.repository.ListRoadbooks(ctx, limit, cursor)
}

func (s *Catalog) GetRoadbook(ctx context.Context, id string) (*domain.Roadbook, error) {
	roadbook, err := s.repository.GetRoadbook(ctx, id)
	if err != nil {
		return nil, err
	}
	if roadbook == nil {
		return nil, domain.NotFound("路书")
	}
	return roadbook, nil
}

func (s *Catalog) CreateRoadbook(ctx context.Context, ownerID string, input RoadbookInput) (domain.Roadbook, error) {
	if err := validateRoadbookInput(input); err != nil {
		return domain.Roadbook{}, err
	}
	now := s.clock().UTC()
	return s.repository.CreateRoadbook(ctx, domain.Roadbook{
		ID: uuid.NewString(), OwnerID: ownerID, Name: strings.TrimSpace(input.Name),
		Description: strings.TrimSpace(input.Description), DistanceKM: input.DistanceKM,
		ElevationGainM: input.ElevationGainM, EstimatedMinutes: input.EstimatedMinutes,
		Difficulty: input.Difficulty, Region: strings.TrimSpace(input.Region), CoordinateSystem: "WGS84",
		Track: input.Track, ElevationProfile: input.ElevationProfile, MaxGradient: input.MaxGradient,
		Waypoints: input.Waypoints, CreatedAt: now, UpdatedAt: now,
	})
}

func (s *Catalog) Register(ctx context.Context, command domain.RegisterCommand) (domain.RegistrationResult, error) {
	if len(strings.TrimSpace(command.IdempotencyKey)) < 8 || len(command.IdempotencyKey) > 128 {
		return domain.RegistrationResult{}, domain.NewError("INVALID_IDEMPOTENCY_KEY", "Idempotency-Key 长度应为 8 至 128", 400)
	}
	if !command.AbilityConfirmed || !command.EquipmentConfirmed {
		return domain.RegistrationResult{}, invalid("confirmation", "ability and equipment confirmations are required")
	}
	if command.Now.IsZero() {
		command.Now = s.clock()
	}
	return s.repository.RegisterAtomically(ctx, command)
}

func (s *Catalog) CancelRegistration(ctx context.Context, eventID, userID string) (domain.RegistrationResult, error) {
	return s.repository.CancelRegistrationAtomically(ctx, eventID, userID, s.clock())
}

func (s *Catalog) RegistrationStatus(ctx context.Context, eventID, userID string) (*domain.Registration, error) {
	return s.repository.GetRegistration(ctx, eventID, userID)
}

func (s *Catalog) ListMyRegistrations(ctx context.Context, userID string) ([]domain.UserRegistration, error) {
	return s.repository.ListRegistrationsByUser(ctx, userID)
}

func applyEventPatch(event *domain.Event, patch EventPatch) {
	if patch.RouteID != nil {
		event.RouteID = *patch.RouteID
	}
	if patch.Title != nil {
		event.Title = strings.TrimSpace(*patch.Title)
	}
	if patch.Summary != nil {
		event.Summary = strings.TrimSpace(*patch.Summary)
	}
	if patch.StartAt != nil {
		event.StartAt = *patch.StartAt
	}
	if patch.RegistrationDeadline != nil {
		event.RegistrationDeadline = *patch.RegistrationDeadline
	}
	if patch.MeetingPoint != nil {
		event.MeetingPoint = strings.TrimSpace(*patch.MeetingPoint)
	}
	if patch.Difficulty != nil {
		event.Difficulty = *patch.Difficulty
	}
	if patch.DistanceKM != nil {
		event.DistanceKM = *patch.DistanceKM
	}
	if patch.ElevationGainM != nil {
		event.ElevationGainM = *patch.ElevationGainM
	}
	if patch.SpeedMinKPH != nil {
		event.SpeedMinKPH = *patch.SpeedMinKPH
	}
	if patch.SpeedMaxKPH != nil {
		event.SpeedMaxKPH = *patch.SpeedMaxKPH
	}
	if patch.Capacity != nil {
		event.Capacity = *patch.Capacity
	}
	if patch.EquipmentRequirements != nil {
		event.EquipmentRequirements = cleanStrings(*patch.EquipmentRequirements)
	}
	if patch.AbilityRequirements != nil {
		event.AbilityRequirements = cleanStrings(*patch.AbilityRequirements)
	}
	if patch.SafetyNotice != nil {
		event.SafetyNotice = strings.TrimSpace(*patch.SafetyNotice)
	}
}

func restrictedChange(event domain.Event, patch EventPatch) bool {
	if patch.RouteID != nil && !sameStringPointer(event.RouteID, *patch.RouteID) {
		return true
	}
	if patch.StartAt != nil && !patch.StartAt.Equal(event.StartAt) {
		return true
	}
	if patch.RegistrationDeadline != nil && !patch.RegistrationDeadline.Equal(event.RegistrationDeadline) {
		return true
	}
	return patch.Capacity != nil && *patch.Capacity != event.Capacity
}

func sameStringPointer(left, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func validateEventInput(input EventInput) error {
	event := domain.Event{
		RouteID: input.RouteID, Title: strings.TrimSpace(input.Title), Summary: strings.TrimSpace(input.Summary),
		StartAt: input.StartAt, RegistrationDeadline: input.RegistrationDeadline,
		MeetingPoint: strings.TrimSpace(input.MeetingPoint), Difficulty: input.Difficulty,
		DistanceKM: input.DistanceKM, ElevationGainM: input.ElevationGainM,
		SpeedMinKPH: input.SpeedMinKPH, SpeedMaxKPH: input.SpeedMaxKPH, Capacity: input.Capacity,
		EquipmentRequirements: cleanStrings(input.EquipmentRequirements), AbilityRequirements: cleanStrings(input.AbilityRequirements),
		SafetyNotice: strings.TrimSpace(input.SafetyNotice),
	}
	return validateEvent(event)
}

func validateEvent(event domain.Event) error {
	if length := len([]rune(event.Title)); length < 2 || length > 80 {
		return invalid("title", "length must be between 2 and 80")
	}
	if length := len([]rune(event.Summary)); length < 10 || length > 1000 {
		return invalid("summary", "length must be between 10 and 1000")
	}
	if event.StartAt.IsZero() || event.RegistrationDeadline.IsZero() || !event.RegistrationDeadline.Before(event.StartAt) {
		return invalid("registrationDeadline", "must be before startAt")
	}
	if length := len([]rune(event.MeetingPoint)); length < 2 || length > 200 {
		return invalid("meetingPoint", "length must be between 2 and 200")
	}
	if !validDifficulty(event.Difficulty) {
		return invalid("difficulty", "unsupported value")
	}
	if event.DistanceKM <= 0 || event.DistanceKM > 1000 {
		return invalid("distanceKm", "must be greater than 0 and at most 1000")
	}
	if event.ElevationGainM < 0 || event.ElevationGainM > 30000 {
		return invalid("elevationGainM", "must be between 0 and 30000")
	}
	if event.SpeedMinKPH <= 0 || event.SpeedMinKPH > 100 || event.SpeedMaxKPH <= 0 || event.SpeedMaxKPH > 100 || event.SpeedMinKPH > event.SpeedMaxKPH {
		return invalid("speedMinKph", "invalid speed range")
	}
	if event.Capacity < 1 || event.Capacity > 1000 {
		return invalid("capacity", "must be between 1 and 1000")
	}
	if len(event.EquipmentRequirements) < 1 || len(event.EquipmentRequirements) > 30 {
		return invalid("equipmentRequirements", "must contain 1 to 30 items")
	}
	for _, item := range event.EquipmentRequirements {
		if length := len([]rune(item)); length < 1 || length > 100 {
			return invalid("equipmentRequirements", "each item length must be between 1 and 100")
		}
	}
	if len(event.AbilityRequirements) < 1 || len(event.AbilityRequirements) > 30 {
		return invalid("abilityRequirements", "must contain 1 to 30 items")
	}
	for _, item := range event.AbilityRequirements {
		if length := len([]rune(item)); length < 1 || length > 200 {
			return invalid("abilityRequirements", "each item length must be between 1 and 200")
		}
	}
	if length := len([]rune(event.SafetyNotice)); length < 10 || length > 2000 {
		return invalid("safetyNotice", "length must be between 10 and 2000")
	}
	return nil
}

func validateRoadbookInput(input RoadbookInput) error {
	if length := len([]rune(strings.TrimSpace(input.Name))); length < 2 || length > 100 {
		return invalid("name", "length must be between 2 and 100")
	}
	if length := len([]rune(strings.TrimSpace(input.Description))); length < 10 || length > 1000 {
		return invalid("description", "length must be between 10 and 1000")
	}
	if input.DistanceKM <= 0 || input.DistanceKM > 1000 {
		return invalid("distanceKm", "must be greater than 0 and at most 1000")
	}
	if input.ElevationGainM < 0 || input.ElevationGainM > 30000 {
		return invalid("elevationGainM", "must be between 0 and 30000")
	}
	if input.EstimatedMinutes < 1 || input.EstimatedMinutes > 10080 {
		return invalid("estimatedMinutes", "must be between 1 and 10080")
	}
	if !validDifficulty(input.Difficulty) {
		return invalid("difficulty", "unsupported value")
	}
	if length := len([]rune(strings.TrimSpace(input.Region))); length < 2 || length > 100 {
		return invalid("region", "length must be between 2 and 100")
	}
	if len(input.Track) < 2 || len(input.Track) > 5000 || len(input.Track) != len(input.ElevationProfile) {
		return invalid("track", "track and elevationProfile must contain the same 2 to 5000 points")
	}
	if len(input.Waypoints) < 2 || len(input.Waypoints) > 500 {
		return invalid("waypoints", "must contain 2 to 500 items")
	}
	for _, point := range input.Track {
		if point.Longitude < -180 || point.Longitude > 180 || point.Latitude < -90 || point.Latitude > 90 {
			return invalid("track", "contains invalid coordinates")
		}
	}
	for _, elevation := range input.ElevationProfile {
		if elevation < 0 || elevation > 10000 {
			return invalid("elevationProfile", "each value must be between 0 and 10000")
		}
	}
	if input.MaxGradient < 0 || input.MaxGradient > 100 {
		return invalid("maxGradient", "must be between 0 and 100")
	}
	validWaypointTypes := map[string]bool{"start": true, "finish": true, "water": true, "supply": true, "danger": true, "viewpoint": true}
	for _, waypoint := range input.Waypoints {
		if length := len([]rune(strings.TrimSpace(waypoint.Name))); length < 1 || length > 100 {
			return invalid("waypoints", "waypoint name length must be between 1 and 100")
		}
		if !validWaypointTypes[waypoint.Type] || waypoint.Longitude < -180 || waypoint.Longitude > 180 || waypoint.Latitude < -90 || waypoint.Latitude > 90 || waypoint.DistanceKM < 0 || waypoint.DistanceKM > 1000 {
			return invalid("waypoints", "contains an invalid waypoint")
		}
	}
	return nil
}

func cleanStrings(values []string) []string {
	result := make([]string, len(values))
	for index, value := range values {
		result[index] = strings.TrimSpace(value)
	}
	return result
}

func validDifficulty(value domain.Difficulty) bool {
	return value == domain.DifficultyEasy || value == domain.DifficultyModerate || value == domain.DifficultyChallenging || value == domain.DifficultyExpert
}

func invalid(field, message string) *domain.Error {
	err := domain.NewError("VALIDATION_ERROR", "请求参数不合法", 400)
	err.Details = map[string]string{"field": field, "message": message}
	return err
}
