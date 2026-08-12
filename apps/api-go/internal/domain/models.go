package domain

import "time"

type EventStatus string

const (
	EventDraft     EventStatus = "draft"
	EventPublished EventStatus = "published"
	EventFull      EventStatus = "full"
	EventCompleted EventStatus = "completed"
	EventCancelled EventStatus = "cancelled"
)

type Difficulty string

const (
	DifficultyEasy        Difficulty = "easy"
	DifficultyModerate    Difficulty = "moderate"
	DifficultyChallenging Difficulty = "challenging"
	DifficultyExpert      Difficulty = "expert"
)

type Event struct {
	ID                    string      `json:"id"`
	OrganizerID           string      `json:"organizerId"`
	RouteID               *string     `json:"routeId"`
	Title                 string      `json:"title"`
	Summary               string      `json:"summary"`
	CoverURL              *string     `json:"coverUrl"`
	StartAt               time.Time   `json:"startAt"`
	RegistrationDeadline  time.Time   `json:"registrationDeadline"`
	MeetingPoint          string      `json:"meetingPoint"`
	MeetingLatitude       *float64    `json:"meetingLatitude"`
	MeetingLongitude      *float64    `json:"meetingLongitude"`
	Difficulty            Difficulty  `json:"difficulty"`
	DistanceKM            float64     `json:"distanceKm"`
	ElevationGainM        int         `json:"elevationGainM"`
	SpeedMinKPH           float64     `json:"speedMinKph"`
	SpeedMaxKPH           float64     `json:"speedMaxKph"`
	Capacity              int         `json:"capacity"`
	RegistrationCount     int         `json:"registrationCount"`
	EquipmentRequirements []string    `json:"equipmentRequirements"`
	AbilityRequirements   []string    `json:"abilityRequirements"`
	SafetyNotice          string      `json:"safetyNotice"`
	Status                EventStatus `json:"status"`
	CreatedAt             time.Time   `json:"createdAt"`
	UpdatedAt             time.Time   `json:"updatedAt"`
	Version               int         `json:"version"`
}

type TrackPoint struct {
	Longitude float64 `json:"longitude"`
	Latitude  float64 `json:"latitude"`
}

type Waypoint struct {
	Name       string  `json:"name"`
	Type       string  `json:"type"`
	Longitude  float64 `json:"longitude"`
	Latitude   float64 `json:"latitude"`
	DistanceKM float64 `json:"distanceKm"`
}

type Roadbook struct {
	ID               string       `json:"id"`
	OwnerID          string       `json:"ownerId"`
	Name             string       `json:"name"`
	Description      string       `json:"description"`
	DistanceKM       float64      `json:"distanceKm"`
	ElevationGainM   int          `json:"elevationGainM"`
	EstimatedMinutes int          `json:"estimatedMinutes"`
	Difficulty       Difficulty   `json:"difficulty"`
	Region           string       `json:"region"`
	CoordinateSystem string       `json:"coordinateSystem"`
	Track            []TrackPoint `json:"track"`
	ElevationProfile []float64    `json:"elevationProfile"`
	MaxGradient      float64      `json:"maxGradient"`
	Waypoints        []Waypoint   `json:"waypoints"`
	CreatedAt        time.Time    `json:"createdAt"`
	UpdatedAt        time.Time    `json:"updatedAt"`
}

type RegistrationStatus string

const (
	RegistrationActive    RegistrationStatus = "active"
	RegistrationCancelled RegistrationStatus = "cancelled"
)

type Registration struct {
	ID                 string             `json:"id"`
	EventID            string             `json:"eventId"`
	UserID             string             `json:"userId"`
	Status             RegistrationStatus `json:"status"`
	AbilityConfirmed   bool               `json:"abilityConfirmed"`
	EquipmentConfirmed bool               `json:"equipmentConfirmed"`
	WaiverVersion      string             `json:"waiverVersion"`
	WaiverAcceptedAt   time.Time          `json:"waiverAcceptedAt"`
	CreatedAt          time.Time          `json:"createdAt"`
	UpdatedAt          time.Time          `json:"updatedAt"`
	CancelledAt        *time.Time         `json:"cancelledAt"`
}

type RegistrationResult struct {
	Registration Registration `json:"registration"`
	Event        Event        `json:"event"`
	Replayed     bool         `json:"replayed"`
}

type UserRegistration struct {
	Registration Registration `json:"registration"`
	Event        Event        `json:"event"`
}

type EventParticipant struct {
	ID          string  `json:"-"`
	Nickname    *string `json:"nickname"`
	AvatarURL   *string `json:"avatarUrl"`
	IsOrganizer bool    `json:"isOrganizer"`
}

type EventParticipantContact struct {
	EventParticipant
	PhoneEncrypted            string
	EmergencyContactEncrypted string
	BikeType                  string
}

type UserProfile struct {
	ID          string    `json:"id"`
	Nickname    *string   `json:"nickname"`
	AvatarURL   *string   `json:"avatarUrl"`
	PhoneMasked *string   `json:"phoneMasked"`
	Gender      *int      `json:"gender"`
	Country     *string   `json:"country"`
	Province    *string   `json:"province"`
	City        *string   `json:"city"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type Page[T any] struct {
	Items      []T     `json:"items"`
	NextCursor *string `json:"nextCursor"`
}
