package store

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"cyclewhere/api-go/internal/domain"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPostgresRegistrationIsIdempotentAndDoesNotOversell(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	repository := NewPostgres(pool)
	eventID := uuid.NewString()
	organizerID := uuid.NewString()
	firstUserID := uuid.NewString()
	cancelledUserID := uuid.NewString()
	coverURL := "https://example.com/event-cover.jpg"
	now := time.Date(2026, 8, 6, 3, 0, 0, 0, time.UTC)
	event := domain.Event{
		ID: eventID, OrganizerID: organizerID, Title: "PostgreSQL capacity integration", CoverURL: &coverURL,
		Summary: "Exercises durable row locking with competing registration requests.",
		StartAt: now.Add(72 * time.Hour), RegistrationDeadline: now.Add(48 * time.Hour),
		MeetingPoint: "Integration test start", Difficulty: domain.DifficultyModerate,
		DistanceKM: 80, ElevationGainM: 900, SpeedMinKPH: 23, SpeedMaxKPH: 28,
		Capacity: 3, EquipmentRequirements: []string{"helmet"}, AbilityRequirements: []string{"recent 60km ride"},
		SafetyNotice: "Integration test record; never expose this event to users.",
		Status:       domain.EventPublished, CreatedAt: now, UpdatedAt: now, Version: 1,
	}
	if _, err := repository.CreateEvent(ctx, event); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM registration_idempotency WHERE event_id=$1`, eventID)
		_, _ = pool.Exec(ctx, `DELETE FROM registrations WHERE event_id=$1`, eventID)
		_, _ = pool.Exec(ctx, `DELETE FROM events WHERE id=$1`, eventID)
		_, _ = pool.Exec(ctx, `DELETE FROM user_profiles WHERE id=ANY($1::uuid[])`, []string{organizerID, firstUserID, cancelledUserID})
	})

	organizerNickname := "Ride organizer"
	organizerAvatarURL := "https://example.com/organizer.jpg"
	if _, err := repository.UpsertUserProfile(ctx, domain.UserProfile{
		ID: organizerID, Nickname: &organizerNickname, AvatarURL: &organizerAvatarURL, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create organizer profile: %v", err)
	}
	firstNickname := "Active rider"
	firstAvatarURL := "https://example.com/active-rider.jpg"
	if _, err := repository.UpsertUserProfile(ctx, domain.UserProfile{
		ID: firstUserID, Nickname: &firstNickname, AvatarURL: &firstAvatarURL, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create active participant profile: %v", err)
	}
	cancelledNickname := "Cancelled rider"
	if _, err := repository.UpsertUserProfile(ctx, domain.UserProfile{
		ID: cancelledUserID, Nickname: &cancelledNickname, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create cancelled participant profile: %v", err)
	}

	firstCommand := integrationCommand(eventID, firstUserID, "integration-idempotent", now)
	first, err := repository.RegisterAtomically(ctx, firstCommand)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := repository.RegisterAtomically(ctx, firstCommand)
	if err != nil {
		t.Fatal(err)
	}
	if first.Replayed || !replay.Replayed || replay.Registration.ID != first.Registration.ID {
		t.Fatalf("unexpected idempotency results: first=%+v replay=%+v", first, replay)
	}
	cancelledCommand := integrationCommand(eventID, cancelledUserID, "integration-cancelled", now)
	cancelled, err := repository.RegisterAtomically(ctx, cancelledCommand)
	if err != nil {
		t.Fatalf("register participant to cancel: %v", err)
	}
	if _, err := repository.CancelRegistrationAtomically(ctx, eventID, cancelledUserID, now.Add(time.Minute)); err != nil {
		t.Fatalf("cancel participant: %v", err)
	}
	participants, err := repository.ListEventParticipants(ctx, eventID)
	if err != nil {
		t.Fatalf("list event participants: %v", err)
	}
	if len(participants) != 2 || !participants[0].IsOrganizer || participants[0].Nickname == nil || *participants[0].Nickname != organizerNickname ||
		participants[0].AvatarURL == nil || *participants[0].AvatarURL != organizerAvatarURL || participants[1].IsOrganizer ||
		participants[1].Nickname == nil || *participants[1].Nickname != firstNickname || participants[1].AvatarURL == nil || *participants[1].AvatarURL != firstAvatarURL {
		t.Fatalf("active participant filtering failed: %+v", participants)
	}
	contact, err := repository.GetEventParticipantContact(ctx, eventID, first.Registration.ID)
	if err != nil {
		t.Fatalf("get active participant contact: %v", err)
	}
	if contact == nil || contact.PhoneEncrypted != firstCommand.PhoneEncrypted || contact.EmergencyContactEncrypted != firstCommand.EmergencyContactEncrypted || contact.BikeType != firstCommand.BikeType {
		t.Fatalf("active participant contact = %+v", contact)
	}
	cancelledContact, err := repository.GetEventParticipantContact(ctx, eventID, cancelled.Registration.ID)
	if err != nil {
		t.Fatalf("get cancelled participant contact: %v", err)
	}
	if cancelledContact != nil {
		t.Fatalf("cancelled participant contact should be hidden: %+v", cancelledContact)
	}
	registrations, err := repository.ListRegistrationsByUser(ctx, firstCommand.UserID)
	if err != nil {
		t.Fatalf("list user registrations: %v", err)
	}
	if len(registrations) != 1 || registrations[0].Event.CoverURL == nil || *registrations[0].Event.CoverURL != coverURL {
		t.Fatalf("registration event did not preserve cover: %+v", registrations)
	}
	staleUpdate := event
	staleUpdate.Title = "A stale organizer update"
	staleUpdate.Version++
	staleUpdate.UpdatedAt = now.Add(time.Second)
	_, err = repository.UpdateEvent(ctx, staleUpdate)
	var versionError *domain.Error
	if !errors.As(err, &versionError) || versionError.Code != "EVENT_VERSION_CONFLICT" {
		t.Fatalf("expected stale update conflict, got %v", err)
	}

	const competitors = 10
	results := make(chan error, competitors)
	var group sync.WaitGroup
	for index := 0; index < competitors; index++ {
		group.Add(1)
		go func(index int) {
			defer group.Done()
			_, err := repository.RegisterAtomically(ctx, integrationCommand(eventID, uuid.NewString(), "integration-concurrent-"+string(rune('a'+index)), now))
			results <- err
		}(index)
	}
	group.Wait()
	close(results)
	successes := 0
	fullErrors := 0
	for result := range results {
		if result == nil {
			successes++
			continue
		}
		var domainError *domain.Error
		if errors.As(result, &domainError) && domainError.Code == "EVENT_FULL" {
			fullErrors++
			continue
		}
		t.Fatalf("unexpected registration error: %v", result)
	}
	if successes != 2 || fullErrors != competitors-2 {
		t.Fatalf("capacity violation: successes=%d fullErrors=%d", successes, fullErrors)
	}
	stored, err := repository.GetEvent(ctx, eventID)
	if err != nil {
		t.Fatal(err)
	}
	if stored == nil || stored.RegistrationCount != 3 || stored.Status != domain.EventFull {
		t.Fatalf("unexpected stored event: %+v", stored)
	}
}

func integrationCommand(eventID, userID, key string, now time.Time) domain.RegisterCommand {
	return domain.RegisterCommand{
		EventID: eventID, UserID: userID, IdempotencyKey: key,
		AbilityConfirmed: true, EquipmentConfirmed: true, WaiverVersion: "v1.0",
		PhoneEncrypted:            "v1.integration-test-ciphertext",
		EmergencyContactEncrypted: "v1.integration-test-ciphertext", BikeType: "road", Now: now,
	}
}
