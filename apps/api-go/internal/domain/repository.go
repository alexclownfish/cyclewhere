package domain

import (
	"context"
	"time"
)

type EventListQuery struct {
	Status     *EventStatus
	Difficulty *Difficulty
	Cursor     *string
	Limit      int
}

type RegisterCommand struct {
	EventID                   string
	UserID                    string
	IdempotencyKey            string
	AbilityConfirmed          bool
	EquipmentConfirmed        bool
	WaiverVersion             string
	PhoneEncrypted            string
	EmergencyContactEncrypted string
	BikeType                  string
	Now                       time.Time
}

type Repository interface {
	GetUserProfile(context.Context, string) (*UserProfile, error)
	UpsertUserProfile(context.Context, UserProfile) (UserProfile, error)
	GetUserIDByPhoneHash(context.Context, string) (*string, error)
	BindUserPhone(context.Context, string, string, string, string, time.Time) error
	CreateEvent(context.Context, Event) (Event, error)
	UpdateEvent(context.Context, Event) (Event, error)
	UpdateEventWithChange(context.Context, Event, EventChange) (Event, error)
	GetEvent(context.Context, string) (*Event, error)
	ListEventChanges(context.Context, string) ([]EventChange, error)
	ListEvents(context.Context, EventListQuery) (Page[Event], error)
	ListEventsByOrganizer(context.Context, string) ([]Event, error)
	CreateRoadbook(context.Context, Roadbook) (Roadbook, error)
	GetRoadbook(context.Context, string) (*Roadbook, error)
	ListRoadbooks(context.Context, int, *string) (Page[Roadbook], error)
	RegisterAtomically(context.Context, RegisterCommand) (RegistrationResult, error)
	CancelRegistrationAtomically(context.Context, string, string, time.Time) (RegistrationResult, error)
	GetRegistration(context.Context, string, string) (*Registration, error)
	ListRegistrationsByUser(context.Context, string) ([]UserRegistration, error)
	ListEventParticipants(context.Context, string) ([]EventParticipant, error)
	GetEventParticipantContact(context.Context, string, string) (*EventParticipantContact, error)
}
