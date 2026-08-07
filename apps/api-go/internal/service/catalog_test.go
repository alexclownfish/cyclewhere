package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"cyclewhere/api-go/internal/domain"
)

var fixedNow = time.Date(2026, 8, 6, 3, 0, 0, 0, time.UTC)

type testRepository struct {
	events          map[string]domain.Event
	roadbooks       map[string]domain.Roadbook
	profiles        map[string]domain.UserProfile
	registration    *domain.Registration
	registerCommand *domain.RegisterCommand
}

func newTestRepository() *testRepository {
	return &testRepository{events: map[string]domain.Event{}, roadbooks: map[string]domain.Roadbook{}, profiles: map[string]domain.UserProfile{}}
}

func (r *testRepository) GetUserProfile(_ context.Context, id string) (*domain.UserProfile, error) {
	value, ok := r.profiles[id]
	if !ok {
		return nil, nil
	}
	return &value, nil
}
func (r *testRepository) UpsertUserProfile(_ context.Context, value domain.UserProfile) (domain.UserProfile, error) {
	r.profiles[value.ID] = value
	return value, nil
}
func (r *testRepository) CreateEvent(_ context.Context, value domain.Event) (domain.Event, error) {
	r.events[value.ID] = value
	return value, nil
}
func (r *testRepository) UpdateEvent(_ context.Context, value domain.Event) (domain.Event, error) {
	r.events[value.ID] = value
	return value, nil
}
func (r *testRepository) GetEvent(_ context.Context, id string) (*domain.Event, error) {
	value, ok := r.events[id]
	if !ok {
		return nil, nil
	}
	return &value, nil
}
func (r *testRepository) ListEvents(_ context.Context, _ domain.EventListQuery) (domain.Page[domain.Event], error) {
	return domain.Page[domain.Event]{Items: []domain.Event{}}, nil
}
func (r *testRepository) ListEventsByOrganizer(_ context.Context, organizerID string) ([]domain.Event, error) {
	values := []domain.Event{}
	for _, value := range r.events {
		if value.OrganizerID == organizerID {
			values = append(values, value)
		}
	}
	return values, nil
}
func (r *testRepository) CreateRoadbook(_ context.Context, value domain.Roadbook) (domain.Roadbook, error) {
	r.roadbooks[value.ID] = value
	return value, nil
}
func (r *testRepository) GetRoadbook(_ context.Context, id string) (*domain.Roadbook, error) {
	value, ok := r.roadbooks[id]
	if !ok {
		return nil, nil
	}
	return &value, nil
}
func (r *testRepository) ListRoadbooks(_ context.Context, _ int, _ *string) (domain.Page[domain.Roadbook], error) {
	return domain.Page[domain.Roadbook]{Items: []domain.Roadbook{}}, nil
}
func (r *testRepository) RegisterAtomically(_ context.Context, command domain.RegisterCommand) (domain.RegistrationResult, error) {
	r.registerCommand = &command
	return domain.RegistrationResult{}, nil
}
func (r *testRepository) CancelRegistrationAtomically(_ context.Context, _, _ string, _ time.Time) (domain.RegistrationResult, error) {
	return domain.RegistrationResult{}, nil
}
func (r *testRepository) GetRegistration(_ context.Context, _, _ string) (*domain.Registration, error) {
	return r.registration, nil
}
func (r *testRepository) ListRegistrationsByUser(_ context.Context, _ string) ([]domain.UserRegistration, error) {
	return []domain.UserRegistration{}, nil
}

func fixtureEvent() domain.Event {
	return domain.Event{
		ID: "event-1", OrganizerID: "organizer-1", Title: "周末耐力骑行", Summary: "全程设置等候点，适合有中长距离经验的骑友。",
		StartAt: fixedNow.Add(48 * time.Hour), RegistrationDeadline: fixedNow.Add(24 * time.Hour), MeetingPoint: "城市广场北门",
		Difficulty: domain.DifficultyModerate, DistanceKM: 82, ElevationGainM: 900, SpeedMinKPH: 23, SpeedMaxKPH: 28,
		Capacity: 10, EquipmentRequirements: []string{"头盔"}, AbilityRequirements: []string{"完成过60公里骑行"},
		SafetyNotice: "请遵守交通规则，遇恶劣天气活动可能取消。", Status: domain.EventPublished,
		CreatedAt: fixedNow, UpdatedAt: fixedNow, Version: 1,
	}
}

func TestUpdateEventEnforcesOwnershipAndRegistrationRestrictions(t *testing.T) {
	repository := newTestRepository()
	event := fixtureEvent()
	event.RegistrationCount = 1
	repository.events[event.ID] = event
	catalog := NewCatalog(repository, func() time.Time { return fixedNow })
	capacity := 20
	_, err := catalog.UpdateEvent(context.Background(), event.ID, event.OrganizerID, EventPatch{Capacity: &capacity})
	var domainError *domain.Error
	if !errors.As(err, &domainError) || domainError.Code != "INVALID_STATE" {
		t.Fatalf("expected INVALID_STATE, got %v", err)
	}
	title := "更新后的活动标题"
	updated, err := catalog.UpdateEvent(context.Background(), event.ID, event.OrganizerID, EventPatch{Title: &title})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Title != title || updated.Version != 2 {
		t.Fatalf("unexpected update: %+v", updated)
	}
	_, err = catalog.UpdateEvent(context.Background(), event.ID, "other-user", EventPatch{Title: &title})
	if !errors.As(err, &domainError) || domainError.Code != "FORBIDDEN" {
		t.Fatalf("expected FORBIDDEN, got %v", err)
	}
}

func TestRegisterValidatesIdempotencyAndConfirmations(t *testing.T) {
	repository := newTestRepository()
	catalog := NewCatalog(repository, func() time.Time { return fixedNow })
	_, err := catalog.Register(context.Background(), domain.RegisterCommand{IdempotencyKey: "short"})
	var domainError *domain.Error
	if !errors.As(err, &domainError) || domainError.Code != "INVALID_IDEMPOTENCY_KEY" {
		t.Fatalf("expected INVALID_IDEMPOTENCY_KEY, got %v", err)
	}
	command := domain.RegisterCommand{EventID: "event-1", UserID: "user-1", IdempotencyKey: "register-123", AbilityConfirmed: true, EquipmentConfirmed: true}
	if _, err := catalog.Register(context.Background(), command); err != nil {
		t.Fatal(err)
	}
	if repository.registerCommand == nil || !repository.registerCommand.Now.Equal(fixedNow) {
		t.Fatalf("clock was not applied: %+v", repository.registerCommand)
	}
}

func TestParseGPXRejectsUnsafeAndOutOfSegmentPoints(t *testing.T) {
	unsafe := []byte(`<!DOCTYPE gpx [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><gpx>&xxe;</gpx>`)
	_, err := parseGPX(unsafe, "fallback")
	var domainError *domain.Error
	if !errors.As(err, &domainError) || domainError.Code != "GPX_UNSAFE_XML" {
		t.Fatalf("expected GPX_UNSAFE_XML, got %v", err)
	}
	outside := []byte(`<gpx><trk><trkpt lat="30" lon="120"/><trkseg><trkpt lat="30" lon="120"/><trkpt lat="30.01" lon="120.01"/></trkseg></trk></gpx>`)
	parsed, err := parseGPX(outside, "fallback")
	if err != nil {
		t.Fatal(err)
	}
	if len(parsed.Track) != 2 {
		t.Fatalf("expected only trkseg points, got %d", len(parsed.Track))
	}
	missingCoordinate := []byte(`<gpx><trk><trkseg><trkpt lon="120"/><trkpt lat="30" lon="120"/></trkseg></trk></gpx>`)
	_, err = parseGPX(missingCoordinate, "fallback")
	if !errors.As(err, &domainError) || domainError.Code != "GPX_INVALID_POINT" {
		t.Fatalf("expected GPX_INVALID_POINT, got %v", err)
	}
}

func TestImportGPXCreatesCompatibleRoadbook(t *testing.T) {
	repository := newTestRepository()
	catalog := NewCatalog(repository, func() time.Time { return fixedNow })
	xml := []byte(`<?xml version="1.0"?><gpx><trk><name>西湖环线</name><trkseg><trkpt lat="30.20" lon="120.10"><ele>20</ele></trkpt><trkpt lat="30.21" lon="120.11"><ele>80</ele></trkpt><trkpt lat="30.22" lon="120.12"><ele>30</ele></trkpt></trkseg></trk></gpx>`)
	roadbook, err := catalog.ImportGPX(context.Background(), "owner-1", xml, GPXMetadata{})
	if err != nil {
		t.Fatal(err)
	}
	if roadbook.Name != "西湖环线" || len(roadbook.Track) != 3 || len(roadbook.Waypoints) != 2 {
		t.Fatalf("unexpected roadbook: %+v", roadbook)
	}
	if !strings.Contains(roadbook.Description, "GPX") {
		t.Fatalf("unexpected description: %s", roadbook.Description)
	}
}

func TestImportGPXRejectsZeroDistanceBeforeRepositoryWrite(t *testing.T) {
	repository := newTestRepository()
	catalog := NewCatalog(repository, func() time.Time { return fixedNow })
	xml := []byte(`<gpx><trk><trkseg><trkpt lat="30" lon="120"/><trkpt lat="30" lon="120"/></trkseg></trk></gpx>`)
	_, err := catalog.ImportGPX(context.Background(), "owner-1", xml, GPXMetadata{})
	var domainError *domain.Error
	if !errors.As(err, &domainError) || domainError.Code != "GPX_INVALID" || domainError.StatusCode != 400 {
		t.Fatalf("expected GPX_INVALID 400, got %v", err)
	}
	if len(repository.roadbooks) != 0 {
		t.Fatal("invalid GPX reached the repository")
	}
}

func TestImportGPXRejectsUnsupportedGradientBeforeRepositoryWrite(t *testing.T) {
	repository := newTestRepository()
	catalog := NewCatalog(repository, func() time.Time { return fixedNow })
	xml := []byte(`<gpx><trk><trkseg><trkpt lat="30" lon="120"><ele>0</ele></trkpt><trkpt lat="30.0001" lon="120"><ele>20</ele></trkpt></trkseg></trk></gpx>`)
	_, err := catalog.ImportGPX(context.Background(), "owner-1", xml, GPXMetadata{})
	var domainError *domain.Error
	if !errors.As(err, &domainError) || domainError.Code != "GPX_INVALID" || domainError.StatusCode != 400 {
		t.Fatalf("expected GPX_INVALID 400, got %v", err)
	}
	if len(repository.roadbooks) != 0 {
		t.Fatal("invalid GPX reached the repository")
	}
}
