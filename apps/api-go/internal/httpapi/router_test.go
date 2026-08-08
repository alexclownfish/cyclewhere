package httpapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"cyclewhere/api-go/internal/auth"
	"cyclewhere/api-go/internal/domain"
	"cyclewhere/api-go/internal/security"
	"cyclewhere/api-go/internal/service"
	"github.com/gin-gonic/gin"
)

const (
	testJWTSecret   = "http-contract-test-jwt-secret-123456789"
	testFieldSecret = "http-contract-test-field-secret-123456"
)

var contractNow = time.Date(2026, time.August, 7, 10, 11, 12, 123456789, time.UTC)

type fakeWeChat struct {
	session auth.WeChatSession
	err     error
}

type fakeWeChatPhone struct {
	phone string
	err   error
}

func (f fakeWeChatPhone) ExchangePhone(context.Context, string) (string, error) {
	return f.phone, f.err
}

func (f fakeWeChat) Exchange(context.Context, string) (auth.WeChatSession, error) {
	return f.session, f.err
}

type fakeRepository struct {
	mu sync.Mutex

	profile        *domain.UserProfile
	events         []domain.Event
	registerCalls  []domain.RegisterCommand
	registrations  map[string]domain.RegistrationResult
	profileUpserts int
	phoneUsers     map[string]string
	phoneMasked    string
	participants   map[string][]domain.EventParticipant
	contacts       map[string]*domain.EventParticipantContact
}

func (f *fakeRepository) GetUserIDByPhoneHash(_ context.Context, phoneHash string) (*string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	userID, ok := f.phoneUsers[phoneHash]
	if !ok {
		return nil, nil
	}
	return &userID, nil
}

func (f *fakeRepository) BindUserPhone(_ context.Context, userID, phoneHash, _ string, phoneMasked string, _ time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.phoneUsers == nil {
		f.phoneUsers = make(map[string]string)
	}
	if existing, ok := f.phoneUsers[phoneHash]; ok && existing != userID {
		return domain.Conflict("PHONE_ALREADY_BOUND", "phone already bound")
	}
	f.phoneUsers[phoneHash] = userID
	f.phoneMasked = phoneMasked
	if f.profile != nil && f.profile.ID == userID {
		f.profile.PhoneMasked = &f.phoneMasked
	}
	return nil
}

func (f *fakeRepository) GetUserProfile(_ context.Context, userID string) (*domain.UserProfile, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.profile == nil || f.profile.ID != userID {
		return nil, nil
	}
	copy := *f.profile
	return &copy, nil
}

func (f *fakeRepository) UpsertUserProfile(_ context.Context, profile domain.UserProfile) (domain.UserProfile, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	copy := profile
	f.profile = &copy
	f.profileUpserts++
	return copy, nil
}

func (f *fakeRepository) CreateEvent(_ context.Context, event domain.Event) (domain.Event, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.events = append(f.events, event)
	return event, nil
}

func (f *fakeRepository) UpdateEvent(_ context.Context, event domain.Event) (domain.Event, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for index := range f.events {
		if f.events[index].ID == event.ID {
			f.events[index] = event
			return event, nil
		}
	}
	f.events = append(f.events, event)
	return event, nil
}

func (f *fakeRepository) GetEvent(_ context.Context, id string) (*domain.Event, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, event := range f.events {
		if event.ID == id {
			copy := event
			return &copy, nil
		}
	}
	return nil, nil
}

func (f *fakeRepository) ListEvents(_ context.Context, query domain.EventListQuery) (domain.Page[domain.Event], error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	items := make([]domain.Event, 0, len(f.events))
	for _, event := range f.events {
		if query.Status != nil && event.Status != *query.Status {
			continue
		}
		if query.Difficulty != nil && event.Difficulty != *query.Difficulty {
			continue
		}
		items = append(items, event)
	}
	return domain.Page[domain.Event]{Items: items}, nil
}

func (f *fakeRepository) ListEventsByOrganizer(_ context.Context, organizerID string) ([]domain.Event, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	items := make([]domain.Event, 0)
	for _, event := range f.events {
		if event.OrganizerID == organizerID {
			items = append(items, event)
		}
	}
	return items, nil
}

func (*fakeRepository) CreateRoadbook(_ context.Context, roadbook domain.Roadbook) (domain.Roadbook, error) {
	return roadbook, nil
}

func (*fakeRepository) GetRoadbook(context.Context, string) (*domain.Roadbook, error) {
	return nil, nil
}

func (*fakeRepository) ListRoadbooks(context.Context, int, *string) (domain.Page[domain.Roadbook], error) {
	return domain.Page[domain.Roadbook]{Items: []domain.Roadbook{}}, nil
}

func (f *fakeRepository) RegisterAtomically(_ context.Context, command domain.RegisterCommand) (domain.RegistrationResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.registrations == nil {
		f.registrations = make(map[string]domain.RegistrationResult)
	}
	f.registerCalls = append(f.registerCalls, command)
	key := command.UserID + "\x00" + command.EventID + "\x00" + command.IdempotencyKey
	if prior, exists := f.registrations[key]; exists {
		prior.Replayed = true
		return prior, nil
	}
	event := contractEvent()
	event.ID = command.EventID
	event.RegistrationCount = 1
	registration := domain.Registration{
		ID: "registration-1", EventID: command.EventID, UserID: command.UserID,
		Status: domain.RegistrationActive, AbilityConfirmed: command.AbilityConfirmed,
		EquipmentConfirmed: command.EquipmentConfirmed, WaiverVersion: command.WaiverVersion,
		WaiverAcceptedAt: command.Now, CreatedAt: command.Now, UpdatedAt: command.Now,
	}
	result := domain.RegistrationResult{Registration: registration, Event: event}
	f.registrations[key] = result
	return result, nil
}

func (*fakeRepository) CancelRegistrationAtomically(context.Context, string, string, time.Time) (domain.RegistrationResult, error) {
	return domain.RegistrationResult{}, domain.NotFound("registration")
}

func (*fakeRepository) GetRegistration(context.Context, string, string) (*domain.Registration, error) {
	return nil, nil
}

func (*fakeRepository) ListRegistrationsByUser(context.Context, string) ([]domain.UserRegistration, error) {
	return []domain.UserRegistration{}, nil
}

func (f *fakeRepository) ListEventParticipants(_ context.Context, eventID string) ([]domain.EventParticipant, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	items := f.participants[eventID]
	return append([]domain.EventParticipant(nil), items...), nil
}

func (f *fakeRepository) GetEventParticipantContact(_ context.Context, eventID, participantID string) (*domain.EventParticipantContact, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	contact := f.contacts[eventID+"\x00"+participantID]
	if contact == nil {
		return nil, nil
	}
	copy := *contact
	return &copy, nil
}

func newContractRouter(t *testing.T, repository *fakeRepository, avatarDir string) (*gin.Engine, *auth.Issuer, *auth.Verifier, *security.FieldEncryptor) {
	t.Helper()
	issuer, err := auth.NewIssuer(testJWTSecret)
	if err != nil {
		t.Fatalf("create issuer: %v", err)
	}
	verifier, err := auth.NewVerifier(testJWTSecret)
	if err != nil {
		t.Fatalf("create verifier: %v", err)
	}
	encryptor, err := security.NewFieldEncryptor(testFieldSecret)
	if err != nil {
		t.Fatalf("create encryptor: %v", err)
	}
	router, err := NewRouter(Dependencies{
		Repository:      repository,
		Catalog:         service.NewCatalog(repository, func() time.Time { return contractNow }),
		Issuer:          issuer,
		Verifier:        verifier,
		WeChat:          fakeWeChat{session: auth.WeChatSession{OpenID: "openid-contract-user"}},
		WeChatPhone:     fakeWeChatPhone{phone: "13800138000"},
		Encryptor:       encryptor,
		AvatarUploadDir: avatarDir,
		Now:             func() time.Time { return contractNow },
	})
	if err != nil {
		t.Fatalf("create router: %v", err)
	}
	return router, issuer, verifier, encryptor
}

func contractEvent() domain.Event {
	return domain.Event{
		ID: "event-1", OrganizerID: "organizer-1", Title: "Weekend endurance ride",
		Summary:              "A steady group ride with regroup and supply points.",
		StartAt:              time.Date(2026, time.August, 29, 23, 0, 0, 123456789, time.UTC),
		RegistrationDeadline: time.Date(2026, time.August, 28, 12, 0, 0, 987654321, time.UTC),
		MeetingPoint:         "Riverside plaza", Difficulty: domain.DifficultyModerate,
		DistanceKM: 92, ElevationGainM: 450, SpeedMinKPH: 24, SpeedMaxKPH: 29,
		Capacity: 30, EquipmentRequirements: nil, AbilityRequirements: nil,
		SafetyNotice: "Follow traffic rules and the ride leader's safety directions.",
		Status:       domain.EventPublished,
		CreatedAt:    time.Date(2026, time.August, 1, 8, 9, 10, 111999999, time.UTC),
		UpdatedAt:    time.Date(2026, time.August, 2, 9, 10, 11, 222999999, time.UTC), Version: 1,
	}
}

func authHeader(t *testing.T, issuer *auth.Issuer, userID string) string {
	t.Helper()
	token, err := issuer.Issue(userID)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	return "Bearer " + token
}

func perform(router http.Handler, method, path, body, authorization string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if authorization != "" {
		request.Header.Set("Authorization", authorization)
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}

func decodeObject(t *testing.T, response *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response %q: %v", response.Body.String(), err)
	}
	return body
}

func nestedObject(t *testing.T, value any, field string) map[string]any {
	t.Helper()
	object, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("%s is %T, want object", field, value)
	}
	return object
}

func TestHealthContract(t *testing.T) {
	router, _, _, _ := newContractRouter(t, &fakeRepository{}, t.TempDir())
	response := perform(router, http.MethodGet, "/health", "", "")

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if got := decodeObject(t, response)["status"]; got != "ok" {
		t.Fatalf("status body = %v, want ok", got)
	}
}

func TestLoginCreatesJWTEnvelopeAndDefaultProfile(t *testing.T) {
	repository := &fakeRepository{}
	router, _, verifier, _ := newContractRouter(t, repository, t.TempDir())
	response := perform(router, http.MethodPost, "/api/v1/auth/wechat/login", `{"code":"valid-login-code"}`, "")

	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	body := decodeObject(t, response)
	data := nestedObject(t, body["data"], "data")
	if data["tokenType"] != "Bearer" || data["expiresIn"] != float64(auth.TokenExpiresInSec) {
		t.Fatalf("unexpected token metadata: %#v", data)
	}
	token, ok := data["accessToken"].(string)
	if !ok || token == "" {
		t.Fatalf("accessToken = %#v", data["accessToken"])
	}
	user := nestedObject(t, data["user"], "data.user")
	wantUserID := auth.StableUserID("openid-contract-user")
	profile := nestedObject(t, user["profile"], "data.user.profile")
	if user["id"] != wantUserID || profile["nickname"] != "微信骑友" {
		t.Fatalf("user = %#v, want id %q and default profile", user, wantUserID)
	}
	verified, err := verifier.Verify("Bearer " + token)
	if err != nil || verified.ID != wantUserID {
		t.Fatalf("verify login JWT: user=%#v err=%v", verified, err)
	}
}

func TestPhoneLoginCreatesAccountAndStoresMaskedPhone(t *testing.T) {
	repository := &fakeRepository{}
	router, _, verifier, _ := newContractRouter(t, repository, t.TempDir())
	response := perform(router, http.MethodPost, "/api/v1/auth/wechat/phone-login", `{"loginCode":"valid-login-code","phoneCode":"valid-phone-code"}`, "")

	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	data := nestedObject(t, decodeObject(t, response)["data"], "data")
	user := nestedObject(t, data["user"], "data.user")
	profile := nestedObject(t, user["profile"], "data.user.profile")
	if profile["phoneMasked"] != "138****8000" {
		t.Fatalf("profile = %#v", profile)
	}
	token := data["accessToken"].(string)
	verified, err := verifier.Verify("Bearer " + token)
	if err != nil || verified.ID != auth.StableUserID("openid-contract-user") {
		t.Fatalf("verify phone login token: user=%#v err=%v", verified, err)
	}
}

func TestAuthenticatedUserCanBindPhone(t *testing.T) {
	nickname := "Rider"
	repository := &fakeRepository{profile: &domain.UserProfile{ID: "profile-user", Nickname: &nickname, UpdatedAt: contractNow}}
	router, issuer, _, _ := newContractRouter(t, repository, t.TempDir())
	response := perform(router, http.MethodPost, "/api/v1/me/phone", `{"code":"valid-phone-code"}`, authHeader(t, issuer, "profile-user"))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	profile := nestedObject(t, nestedObject(t, decodeObject(t, response)["data"], "data")["profile"], "data.profile")
	if profile["phoneMasked"] != "138****8000" {
		t.Fatalf("profile = %#v", profile)
	}
}

func TestProtectedEndpointRejectsMissingTokenWithErrorEnvelope(t *testing.T) {
	router, _, _, _ := newContractRouter(t, &fakeRepository{}, t.TempDir())
	response := perform(router, http.MethodGet, "/api/v1/me/profile", "", "")

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	errorBody := nestedObject(t, decodeObject(t, response)["error"], "error")
	if errorBody["code"] != "UNAUTHORIZED" || errorBody["details"] != nil {
		t.Fatalf("error envelope = %#v", errorBody)
	}
}

func TestEventListUsesEmptyArraysAndMillisecondTimestamps(t *testing.T) {
	t.Run("empty page", func(t *testing.T) {
		router, _, _, _ := newContractRouter(t, &fakeRepository{}, t.TempDir())
		response := perform(router, http.MethodGet, "/api/v1/events", "", "")
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
		}
		data := nestedObject(t, decodeObject(t, response)["data"], "data")
		items, ok := data["items"].([]any)
		if !ok || len(items) != 0 || data["nextCursor"] != nil {
			t.Fatalf("page = %#v, want empty JSON array and null cursor", data)
		}
	})

	t.Run("event presentation", func(t *testing.T) {
		repository := &fakeRepository{events: []domain.Event{contractEvent()}}
		router, _, _, _ := newContractRouter(t, repository, t.TempDir())
		response := perform(router, http.MethodGet, "/api/v1/events", "", "")
		data := nestedObject(t, decodeObject(t, response)["data"], "data")
		items := data["items"].([]any)
		event := nestedObject(t, items[0], "data.items[0]")
		if event["startAt"] != "2026-08-29T23:00:00.123Z" || event["registrationDeadline"] != "2026-08-28T12:00:00.987Z" {
			t.Fatalf("event timestamps = start %v deadline %v", event["startAt"], event["registrationDeadline"])
		}
		if event["createdAt"] != "2026-08-01T08:09:10.111Z" || event["updatedAt"] != "2026-08-02T09:10:11.222Z" {
			t.Fatalf("audit timestamps = created %v updated %v", event["createdAt"], event["updatedAt"])
		}
		if equipment, ok := event["equipmentRequirements"].([]any); !ok || len(equipment) != 0 {
			t.Fatalf("equipmentRequirements = %#v, want []", event["equipmentRequirements"])
		}
		if ability, ok := event["abilityRequirements"].([]any); !ok || len(ability) != 0 {
			t.Fatalf("abilityRequirements = %#v, want []", event["abilityRequirements"])
		}
	})
}

func TestEventParticipantsExposeOnlyPublicProfileFields(t *testing.T) {
	const eventID = "11111111-1111-4111-8111-111111111111"
	nickname := "Rider"
	avatarURL := "https://api.example.test/api/v1/avatars/rider.jpg"
	event := contractEvent()
	event.ID = eventID
	repository := &fakeRepository{
		events: []domain.Event{event},
		participants: map[string][]domain.EventParticipant{
			eventID: {
				{Nickname: &nickname, AvatarURL: &avatarURL, IsOrganizer: true},
				{},
			},
		},
	}
	router, _, _, _ := newContractRouter(t, repository, t.TempDir())
	response := perform(router, http.MethodGet, "/api/v1/events/"+eventID+"/participants", "", "")
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	data := nestedObject(t, decodeObject(t, response)["data"], "data")
	items, ok := data["items"].([]any)
	if !ok || len(items) != 2 {
		t.Fatalf("items = %#v", data["items"])
	}
	first := nestedObject(t, items[0], "data.items[0]")
	if len(first) != 3 || first["nickname"] != nickname || first["avatarUrl"] != avatarURL || first["isOrganizer"] != true {
		t.Fatalf("first participant = %#v", first)
	}
	second := nestedObject(t, items[1], "data.items[1]")
	if len(second) != 3 || second["nickname"] != nil || second["avatarUrl"] != nil || second["isOrganizer"] != false {
		t.Fatalf("second participant = %#v", second)
	}
}

func TestEventDetailUsesOrganizerProfileWithoutExposingOrganizerID(t *testing.T) {
	nickname := "Ride captain"
	avatarURL := "https://api.example.test/api/v1/avatars/captain.jpg"
	event := contractEvent()
	event.OrganizerID = "organizer-1"
	repository := &fakeRepository{
		events:  []domain.Event{event},
		profile: &domain.UserProfile{ID: event.OrganizerID, Nickname: &nickname, AvatarURL: &avatarURL, UpdatedAt: contractNow},
	}
	router, _, _, _ := newContractRouter(t, repository, t.TempDir())
	response := perform(router, http.MethodGet, "/api/v1/events/"+event.ID, "", "")
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	eventBody := nestedObject(t, decodeObject(t, response)["data"], "data")
	if _, exists := eventBody["organizerId"]; exists {
		t.Fatalf("detail leaks organizer ID: %#v", eventBody)
	}
	organizer := nestedObject(t, eventBody["organizerProfile"], "data.organizerProfile")
	if len(organizer) != 2 || organizer["nickname"] != nickname || organizer["avatarUrl"] != avatarURL {
		t.Fatalf("organizer profile = %#v", organizer)
	}
}

func TestOrganizerCanCancelPublishedEvent(t *testing.T) {
	const eventID = "55555555-5555-4555-8555-555555555555"
	event := contractEvent()
	event.ID = eventID
	repository := &fakeRepository{events: []domain.Event{event}}
	router, issuer, _, _ := newContractRouter(t, repository, t.TempDir())
	path := "/api/v1/events/" + eventID + "/cancel"

	unauthorized := perform(router, http.MethodPost, path, "", "")
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized status = %d, body = %s", unauthorized.Code, unauthorized.Body.String())
	}
	forbidden := perform(router, http.MethodPost, path, "", authHeader(t, issuer, "other-user"))
	if forbidden.Code != http.StatusForbidden {
		t.Fatalf("non-organizer status = %d, body = %s", forbidden.Code, forbidden.Body.String())
	}

	response := perform(router, http.MethodPost, path, "", authHeader(t, issuer, event.OrganizerID))
	if response.Code != http.StatusOK {
		t.Fatalf("organizer status = %d, body = %s", response.Code, response.Body.String())
	}
	cancelled := nestedObject(t, decodeObject(t, response)["data"], "data")
	if cancelled["status"] != string(domain.EventCancelled) || cancelled["version"] != float64(event.Version+1) {
		t.Fatalf("cancelled event = %#v", cancelled)
	}
}

func TestOrganizerCanReadRegistrantContactButOtherUsersCannot(t *testing.T) {
	eventID := "33333333-3333-4333-8333-333333333333"
	participantID := "44444444-4444-4444-8444-444444444444"
	event := contractEvent()
	event.ID = eventID
	event.OrganizerID = "organizer-1"
	nickname := "Rider"
	avatarURL := "https://api.example.test/api/v1/avatars/rider.jpg"
	repository := &fakeRepository{
		events: []domain.Event{event},
		participants: map[string][]domain.EventParticipant{
			eventID: {
				{ID: event.OrganizerID, Nickname: &nickname, IsOrganizer: true},
				{ID: participantID, Nickname: &nickname, AvatarURL: &avatarURL},
			},
		},
		contacts: map[string]*domain.EventParticipantContact{
			eventID + "\x00" + participantID: {EventParticipant: domain.EventParticipant{ID: participantID, Nickname: &nickname, AvatarURL: &avatarURL}, PhoneEncrypted: "", EmergencyContactEncrypted: "", BikeType: "road"},
		},
	}
	router, issuer, _, encryptor := newContractRouter(t, repository, t.TempDir())
	phone, err := encryptor.Encrypt("13800138000")
	if err != nil {
		t.Fatal(err)
	}
	emergency, err := encryptor.Encrypt("Li 13900139000")
	if err != nil {
		t.Fatal(err)
	}
	repository.contacts[eventID+"\x00"+participantID].PhoneEncrypted = phone
	repository.contacts[eventID+"\x00"+participantID].EmergencyContactEncrypted = emergency
	participantList := perform(router, http.MethodGet, "/api/v1/events/"+eventID+"/participants", "", authHeader(t, issuer, event.OrganizerID))
	if participantList.Code != http.StatusOK {
		t.Fatalf("participant list status = %d, body = %s", participantList.Code, participantList.Body.String())
	}
	participantItems := nestedObject(t, decodeObject(t, participantList)["data"], "data")["items"].([]any)
	registrant := nestedObject(t, participantItems[1], "data.items[1]")
	if registrant["contactId"] != participantID {
		t.Fatalf("organizer participant contact id = %#v", registrant)
	}
	nonOrganizerList := perform(router, http.MethodGet, "/api/v1/events/"+eventID+"/participants", "", authHeader(t, issuer, "rider-2"))
	if nonOrganizerList.Code != http.StatusOK {
		t.Fatalf("non-organizer participant list status = %d, body = %s", nonOrganizerList.Code, nonOrganizerList.Body.String())
	}
	nonOrganizerItems := nestedObject(t, decodeObject(t, nonOrganizerList)["data"], "data")["items"].([]any)
	for index, item := range nonOrganizerItems {
		participant := nestedObject(t, item, fmt.Sprintf("data.items[%d]", index))
		if _, exists := participant["contactId"]; exists {
			t.Fatalf("non-organizer participant list leaks contact id: %#v", participant)
		}
	}

	path := "/api/v1/events/" + eventID + "/participants/" + participantID + "/contact"
	response := perform(router, http.MethodGet, path, "", authHeader(t, issuer, event.OrganizerID))
	if response.Code != http.StatusOK {
		t.Fatalf("organizer status = %d, body = %s", response.Code, response.Body.String())
	}
	contact := nestedObject(t, decodeObject(t, response)["data"], "data")
	if contact["phone"] != "13800138000" || contact["emergencyContact"] != "Li 13900139000" || contact["bikeType"] != "road" || contact["nickname"] != nickname || contact["avatarUrl"] != avatarURL {
		t.Fatalf("contact = %#v", contact)
	}
	if _, exists := contact["id"]; exists || strings.Contains(response.Body.String(), participantID) {
		t.Fatalf("contact response leaks internal ID: %s", response.Body.String())
	}
	forbidden := perform(router, http.MethodGet, path, "", authHeader(t, issuer, "rider-2"))
	if forbidden.Code != http.StatusForbidden {
		t.Fatalf("non-organizer status = %d, body = %s", forbidden.Code, forbidden.Body.String())
	}
}

func TestEventParticipantsHideNonPublicEvents(t *testing.T) {
	const eventID = "22222222-2222-4222-8222-222222222222"
	draft := contractEvent()
	draft.ID = eventID
	draft.Status = domain.EventDraft
	repository := &fakeRepository{
		events:       []domain.Event{draft},
		participants: map[string][]domain.EventParticipant{eventID: {{}}},
	}
	router, _, _, _ := newContractRouter(t, repository, t.TempDir())
	response := perform(router, http.MethodGet, "/api/v1/events/"+eventID+"/participants", "", "")
	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
}

func TestEventParticipantsRejectInvalidEventID(t *testing.T) {
	repository := &fakeRepository{}
	router, _, _, _ := newContractRouter(t, repository, t.TempDir())
	response := perform(router, http.MethodGet, "/api/v1/events/not-a-uuid/participants", "", "")
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
}

func TestOptionalAuthRejectsInvalidToken(t *testing.T) {
	repository := &fakeRepository{events: []domain.Event{contractEvent()}}
	router, _, _, _ := newContractRouter(t, repository, t.TempDir())
	response := perform(router, http.MethodGet, "/api/v1/events/event-1", "", "Bearer forged-token")

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	errorBody := nestedObject(t, decodeObject(t, response)["error"], "error")
	if errorBody["code"] != "UNAUTHORIZED" {
		t.Fatalf("error = %#v", errorBody)
	}
}

func TestProfileUpdateRequiresExactStrictShape(t *testing.T) {
	repository := &fakeRepository{}
	router, issuer, _, _ := newContractRouter(t, repository, t.TempDir())
	authorization := authHeader(t, issuer, "profile-user")

	invalidBodies := []string{
		`{"nickname":"Rider","avatarUrl":null,"gender":null,"country":null,"province":null}`,
		`{"nickname":"Rider","avatarUrl":null,"gender":null,"country":null,"province":null,"city":null,"extra":true}`,
	}
	for _, body := range invalidBodies {
		response := perform(router, http.MethodPut, "/api/v1/me/profile", body, authorization)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("body %s: status = %d, response = %s", body, response.Code, response.Body.String())
		}
		if code := nestedObject(t, decodeObject(t, response)["error"], "error")["code"]; code != "VALIDATION_ERROR" {
			t.Fatalf("body %s: error code = %v", body, code)
		}
	}
	valid := `{"nickname":" Rider ","avatarUrl":null,"gender":null,"country":null,"province":null,"city":null}`
	response := perform(router, http.MethodPut, "/api/v1/me/profile", valid, authorization)
	if response.Code != http.StatusOK {
		t.Fatalf("valid status = %d, body = %s", response.Code, response.Body.String())
	}
	profile := nestedObject(t, nestedObject(t, decodeObject(t, response)["data"], "data")["profile"], "data.profile")
	if profile["nickname"] != "Rider" || profile["updatedAt"] != "2026-08-07T10:11:12.123Z" {
		t.Fatalf("profile = %#v", profile)
	}
	if repository.profileUpserts != 1 {
		t.Fatalf("profile upserts = %d, want 1", repository.profileUpserts)
	}
}

func TestAvatarUploadUsesMagicBytesAndCreatedStatus(t *testing.T) {
	const userID = "0f2f4ec8-3d61-52e9-85d8-e5f770c7cbed"
	nickname := "Rider"
	repository := &fakeRepository{profile: &domain.UserProfile{ID: userID, Nickname: &nickname, UpdatedAt: contractNow}}
	avatarDir := t.TempDir()
	router, issuer, _, _ := newContractRouter(t, repository, avatarDir)
	authorization := authHeader(t, issuer, userID)

	upload := func(fileName string, content []byte) *httptest.ResponseRecorder {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		part, err := writer.CreateFormFile("file", fileName)
		if err != nil {
			t.Fatalf("create form file: %v", err)
		}
		if _, err = part.Write(content); err != nil {
			t.Fatalf("write form file: %v", err)
		}
		if err = writer.Close(); err != nil {
			t.Fatalf("close multipart writer: %v", err)
		}
		request := httptest.NewRequest(http.MethodPost, "/api/v1/me/avatar", &body)
		request.Header.Set("Content-Type", writer.FormDataContentType())
		request.Header.Set("Authorization", authorization)
		request.Host = "api.example.test"
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		return response
	}

	invalid := upload("avatar.png", []byte("this is not an image"))
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid status = %d, body = %s", invalid.Code, invalid.Body.String())
	}
	if code := nestedObject(t, decodeObject(t, invalid)["error"], "error")["code"]; code != "AVATAR_INVALID" {
		t.Fatalf("invalid avatar error code = %v", code)
	}

	jpeg := []byte{0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 'J', 'F', 'I', 'F'}
	created := upload("avatar.txt", jpeg)
	if created.Code != http.StatusCreated {
		t.Fatalf("created status = %d, body = %s", created.Code, created.Body.String())
	}
	profile := nestedObject(t, nestedObject(t, decodeObject(t, created)["data"], "data")["profile"], "data.profile")
	wantURL := "https://api.example.test/api/v1/avatars/" + userID + ".jpg?v=1786097472123"
	if profile["avatarUrl"] != wantURL {
		t.Fatalf("avatarUrl = %v, want %s", profile["avatarUrl"], wantURL)
	}

	fetched := perform(router, http.MethodGet, "/api/v1/avatars/"+userID+".jpg", "", "")
	if fetched.Code != http.StatusOK || fetched.Header().Get("Content-Type") != "image/jpeg" || !bytes.Equal(fetched.Body.Bytes(), jpeg) {
		t.Fatalf("fetched avatar: status=%d content-type=%q body=%x", fetched.Code, fetched.Header().Get("Content-Type"), fetched.Body.Bytes())
	}
}

func TestAvatarBase64UploadUsesRequestDomain(t *testing.T) {
	const userID = "0f2f4ec8-3d61-52e9-85d8-e5f770c7cbed"
	nickname := "Rider"
	repository := &fakeRepository{profile: &domain.UserProfile{ID: userID, Nickname: &nickname, UpdatedAt: contractNow}}
	router, issuer, _, _ := newContractRouter(t, repository, t.TempDir())
	jpeg := []byte{0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 'J', 'F', 'I', 'F'}
	body := `{"data":"data:image/jpeg;base64,` + base64.StdEncoding.EncodeToString(jpeg) + `"}`
	request := httptest.NewRequest(http.MethodPost, "/api/v1/me/avatar/base64", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", authHeader(t, issuer, userID))
	request.Host = "api.example.test"
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("base64 upload status = %d, body = %s", response.Code, response.Body.String())
	}
	profile := nestedObject(t, nestedObject(t, decodeObject(t, response)["data"], "data")["profile"], "data.profile")
	wantURL := "https://api.example.test/api/v1/avatars/" + userID + ".jpg?v=1786097472123"
	if profile["avatarUrl"] != wantURL {
		t.Fatalf("avatarUrl = %v, want %s", profile["avatarUrl"], wantURL)
	}
	fetched := perform(router, http.MethodGet, "/api/v1/avatars/"+userID+".jpg", "", "")
	if fetched.Code != http.StatusOK || fetched.Header().Get("Content-Type") != "image/jpeg" || !bytes.Equal(fetched.Body.Bytes(), jpeg) {
		t.Fatalf("fetched base64 avatar: status=%d content-type=%q body=%x", fetched.Code, fetched.Header().Get("Content-Type"), fetched.Body.Bytes())
	}
}

func TestAvatarBase64UploadValidatesPayloadSizeAndEncoding(t *testing.T) {
	const userID = "0f2f4ec8-3d61-52e9-85d8-e5f770c7cbed"
	nickname := "Rider"
	repository := &fakeRepository{profile: &domain.UserProfile{ID: userID, Nickname: &nickname, UpdatedAt: contractNow}}
	router, issuer, _, _ := newContractRouter(t, repository, t.TempDir())
	authorization := authHeader(t, issuer, userID)
	post := func(value string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodPost, "/api/v1/me/avatar/base64", strings.NewReader(`{"data":`+value+`}`))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Authorization", authorization)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		return response
	}
	missing := post(`""`)
	if missing.Code != http.StatusBadRequest || nestedObject(t, decodeObject(t, missing)["error"], "error")["code"] != "AVATAR_MISSING" {
		t.Fatalf("missing payload: status=%d body=%s", missing.Code, missing.Body.String())
	}
	invalid := post(`"data:image/jpeg,not-base64"`)
	if invalid.Code != http.StatusBadRequest || nestedObject(t, decodeObject(t, invalid)["error"], "error")["code"] != "AVATAR_INVALID" {
		t.Fatalf("invalid payload: status=%d body=%s", invalid.Code, invalid.Body.String())
	}
	oversized := make([]byte, avatarLimit+1)
	oversized[0], oversized[1], oversized[2] = 0xff, 0xd8, 0xff
	tooLarge := post(`"` + base64.StdEncoding.EncodeToString(oversized) + `"`)
	if tooLarge.Code != http.StatusRequestEntityTooLarge || nestedObject(t, decodeObject(t, tooLarge)["error"], "error")["code"] != "AVATAR_TOO_LARGE" {
		t.Fatalf("oversized payload: status=%d body=%s", tooLarge.Code, tooLarge.Body.String())
	}
}

func TestRegistrationReturns201Then200ForIdempotentReplay(t *testing.T) {
	repository := &fakeRepository{}
	router, issuer, _, encryptor := newContractRouter(t, repository, t.TempDir())
	authorization := authHeader(t, issuer, "rider-1")
	body := `{"phone":"13800138000","emergencyContact":"Li 13900139000","bikeType":"road bike","abilityConfirmed":true,"equipmentConfirmed":true,"waiverVersion":"v1.0"}`

	register := func() *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodPost, "/api/v1/events/event-1/registrations", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Authorization", authorization)
		request.Header.Set("Idempotency-Key", "registration-key-001")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		return response
	}

	first := register()
	replay := register()
	if first.Code != http.StatusCreated || replay.Code != http.StatusOK {
		t.Fatalf("statuses = %d then %d; first=%s replay=%s", first.Code, replay.Code, first.Body.String(), replay.Body.String())
	}
	firstData := nestedObject(t, decodeObject(t, first)["data"], "first.data")
	replayData := nestedObject(t, decodeObject(t, replay)["data"], "replay.data")
	if firstData["replayed"] != false || replayData["replayed"] != true {
		t.Fatalf("replayed flags = %v then %v", firstData["replayed"], replayData["replayed"])
	}
	firstRegistration := nestedObject(t, firstData["registration"], "first.data.registration")
	replayRegistration := nestedObject(t, replayData["registration"], "replay.data.registration")
	if firstRegistration["id"] != replayRegistration["id"] {
		t.Fatalf("registration IDs differ: %v and %v", firstRegistration["id"], replayRegistration["id"])
	}
	if strings.Contains(first.Body.String(), "13800138000") || strings.Contains(first.Body.String(), "13900139000") {
		t.Fatalf("response leaks plaintext contact fields: %s", first.Body.String())
	}
	if len(repository.registerCalls) != 2 {
		t.Fatalf("register calls = %d, want 2", len(repository.registerCalls))
	}
	command := repository.registerCalls[0]
	phone, err := encryptor.Decrypt(command.PhoneEncrypted)
	if err != nil || phone != "13800138000" {
		t.Fatalf("encrypted phone does not round trip: phone=%q err=%v", phone, err)
	}
	emergency, err := encryptor.Decrypt(command.EmergencyContactEncrypted)
	if err != nil || emergency != "Li 13900139000" {
		t.Fatalf("encrypted emergency contact does not round trip: contact=%q err=%v", emergency, err)
	}
}

func TestRequestBodyLimitCannotBeBypassedWithContentType(t *testing.T) {
	router, _, _, _ := newContractRouter(t, &fakeRepository{registrations: make(map[string]domain.RegistrationResult)}, t.TempDir())
	body := `{"code":"` + strings.Repeat("x", jsonBodyLimit+1) + `"}`
	for _, contentType := range []string{"", "text/plain", "Application/JSON"} {
		request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/wechat/login", strings.NewReader(body))
		if contentType != "" {
			request.Header.Set("Content-Type", contentType)
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != http.StatusRequestEntityTooLarge {
			t.Fatalf("content-type %q status = %d, body=%s", contentType, response.Code, response.Body.String())
		}
		payload := decodeObject(t, response)
		errorBody := nestedObject(t, payload["error"], "error")
		if errorBody["code"] != "PAYLOAD_TOO_LARGE" {
			t.Fatalf("content-type %q code = %v", contentType, errorBody["code"])
		}
	}
}
