package httpapi

import (
	"time"

	"cyclewhere/api-go/internal/domain"
	"github.com/gin-gonic/gin"
)

func isoTime(value time.Time) string {
	return value.UTC().Format("2006-01-02T15:04:05.000Z")
}

func eventResponse(event domain.Event) gin.H {
	equipment := event.EquipmentRequirements
	if equipment == nil {
		equipment = []string{}
	}
	ability := event.AbilityRequirements
	if ability == nil {
		ability = []string{}
	}
	return gin.H{
		"id": event.ID, "organizerId": event.OrganizerID, "routeId": event.RouteID,
		"title": event.Title, "summary": event.Summary, "coverUrl": event.CoverURL, "startAt": isoTime(event.StartAt),
		"registrationDeadline": isoTime(event.RegistrationDeadline), "meetingPoint": event.MeetingPoint,
		"difficulty": event.Difficulty, "distanceKm": event.DistanceKM, "elevationGainM": event.ElevationGainM,
		"speedMinKph": event.SpeedMinKPH, "speedMaxKph": event.SpeedMaxKPH, "capacity": event.Capacity,
		"registrationCount": event.RegistrationCount, "equipmentRequirements": equipment,
		"abilityRequirements": ability, "safetyNotice": event.SafetyNotice, "status": event.Status,
		"createdAt": isoTime(event.CreatedAt), "updatedAt": isoTime(event.UpdatedAt), "version": event.Version,
	}
}

func pageEventResponse(page domain.Page[domain.Event]) gin.H {
	items := make([]any, len(page.Items))
	for index, item := range page.Items {
		items[index] = eventResponse(item)
	}
	return gin.H{"items": items, "nextCursor": page.NextCursor}
}

func roadbookResponse(roadbook domain.Roadbook) gin.H {
	track := roadbook.Track
	if track == nil {
		track = []domain.TrackPoint{}
	}
	elevation := roadbook.ElevationProfile
	if elevation == nil {
		elevation = []float64{}
	}
	waypoints := roadbook.Waypoints
	if waypoints == nil {
		waypoints = []domain.Waypoint{}
	}
	return gin.H{
		"id": roadbook.ID, "ownerId": roadbook.OwnerID, "name": roadbook.Name,
		"description": roadbook.Description, "distanceKm": roadbook.DistanceKM,
		"elevationGainM": roadbook.ElevationGainM, "estimatedMinutes": roadbook.EstimatedMinutes,
		"difficulty": roadbook.Difficulty, "region": roadbook.Region,
		"coordinateSystem": roadbook.CoordinateSystem, "track": track,
		"elevationProfile": elevation, "maxGradient": roadbook.MaxGradient,
		"waypoints": waypoints, "createdAt": isoTime(roadbook.CreatedAt), "updatedAt": isoTime(roadbook.UpdatedAt),
	}
}

func pageRoadbookResponse(page domain.Page[domain.Roadbook]) gin.H {
	items := make([]any, len(page.Items))
	for index, item := range page.Items {
		items[index] = roadbookResponse(item)
	}
	return gin.H{"items": items, "nextCursor": page.NextCursor}
}

func registrationResponse(registration domain.Registration) gin.H {
	var cancelledAt any
	if registration.CancelledAt != nil {
		cancelledAt = isoTime(*registration.CancelledAt)
	}
	return gin.H{
		"id": registration.ID, "eventId": registration.EventID, "userId": registration.UserID,
		"status": registration.Status, "abilityConfirmed": registration.AbilityConfirmed,
		"equipmentConfirmed": registration.EquipmentConfirmed, "waiverVersion": registration.WaiverVersion,
		"waiverAcceptedAt": isoTime(registration.WaiverAcceptedAt), "createdAt": isoTime(registration.CreatedAt),
		"updatedAt": isoTime(registration.UpdatedAt), "cancelledAt": cancelledAt,
	}
}

func registrationResultResponse(result domain.RegistrationResult) gin.H {
	return gin.H{"registration": registrationResponse(result.Registration), "event": eventResponse(result.Event), "replayed": result.Replayed}
}

func profileResponse(profile *domain.UserProfile) any {
	if profile == nil {
		return nil
	}
	return gin.H{
		"id": profile.ID, "nickname": profile.Nickname, "avatarUrl": profile.AvatarURL,
		"phoneMasked": profile.PhoneMasked,
		"gender":      profile.Gender, "country": profile.Country, "province": profile.Province,
		"city": profile.City, "updatedAt": isoTime(profile.UpdatedAt),
	}
}
