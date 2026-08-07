package service

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"io"
	"math"
	"regexp"
	"strings"

	"cyclewhere/api-go/internal/domain"
	"github.com/google/uuid"
)

const (
	maxGPXBytes  = 2 * 1024 * 1024
	maxGPXPoints = 10_000
)

var unsafeXML = regexp.MustCompile(`(?i)<!DOCTYPE|<!ENTITY`)

type GPXMetadata struct {
	Name        string
	Description string
	Region      string
	Difficulty  domain.Difficulty
}

type parsedGPX struct {
	Name             string
	Track            []domain.TrackPoint
	ElevationProfile []float64
	DistanceKM       float64
	ElevationGainM   int
	MaxGradient      float64
	EstimatedMinutes int
}

func (s *Catalog) ImportGPX(ctx context.Context, ownerID string, source []byte, metadata GPXMetadata) (domain.Roadbook, error) {
	parsed, err := parseGPX(source, "导入路书")
	if err != nil {
		return domain.Roadbook{}, err
	}
	if parsed.DistanceKM <= 0 || parsed.DistanceKM > 1000 || parsed.ElevationGainM > 30000 || parsed.MaxGradient > 100 {
		return domain.Roadbook{}, domain.NewError("GPX_INVALID", "GPX 轨迹距离或爬升超出支持范围", 400)
	}
	name := strings.TrimSpace(metadata.Name)
	if name == "" {
		name = parsed.Name
	}
	description := strings.TrimSpace(metadata.Description)
	if description == "" {
		description = "从 GPX 文件导入的路书"
	}
	region := strings.TrimSpace(metadata.Region)
	if region == "" {
		region = "未设置"
	}
	difficulty := metadata.Difficulty
	if !validDifficulty(difficulty) {
		switch {
		case parsed.DistanceKM > 120 || parsed.ElevationGainM > 1800:
			difficulty = domain.DifficultyChallenging
		case parsed.DistanceKM > 70 || parsed.ElevationGainM > 800:
			difficulty = domain.DifficultyModerate
		default:
			difficulty = domain.DifficultyEasy
		}
	}
	now := s.clock().UTC()
	roadbook := domain.Roadbook{
		ID: uuid.NewString(), OwnerID: ownerID, Name: truncateRunes(name, 100),
		Description: description, DistanceKM: parsed.DistanceKM, ElevationGainM: parsed.ElevationGainM,
		EstimatedMinutes: parsed.EstimatedMinutes, Difficulty: difficulty, Region: truncateRunes(region, 100),
		CoordinateSystem: "WGS84", Track: parsed.Track, ElevationProfile: parsed.ElevationProfile,
		MaxGradient: parsed.MaxGradient, CreatedAt: now, UpdatedAt: now,
		Waypoints: []domain.Waypoint{
			{Name: "起点", Type: "start", Longitude: parsed.Track[0].Longitude, Latitude: parsed.Track[0].Latitude, DistanceKM: 0},
			{Name: "终点", Type: "finish", Longitude: parsed.Track[len(parsed.Track)-1].Longitude, Latitude: parsed.Track[len(parsed.Track)-1].Latitude, DistanceKM: parsed.DistanceKM},
		},
	}
	return s.repository.CreateRoadbook(ctx, roadbook)
}

func parseGPX(source []byte, fallbackName string) (parsedGPX, error) {
	if len(source) > maxGPXBytes {
		return parsedGPX{}, domain.NewError("GPX_TOO_LARGE", "GPX 文件不能超过 2MB", 413)
	}
	if unsafeXML.Match(source) {
		return parsedGPX{}, domain.NewError("GPX_UNSAFE_XML", "GPX 文件包含不安全的 XML 声明", 400)
	}
	decoder := xml.NewDecoder(bytes.NewReader(source))
	decoder.Strict = true
	track := make([]domain.TrackPoint, 0, 1024)
	elevations := make([]float64, 0, 1024)
	name := ""
	inTrack := false
	inSegment := false
	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return parsedGPX{}, domain.NewError("GPX_INVALID", "GPX 文件格式无效", 400)
		}
		switch value := token.(type) {
		case xml.StartElement:
			switch value.Name.Local {
			case "trk":
				inTrack = true
			case "trkseg":
				if inTrack {
					inSegment = true
				}
			case "name":
				if inTrack && name == "" {
					var raw string
					if err := decoder.DecodeElement(&raw, &value); err != nil {
						return parsedGPX{}, domain.NewError("GPX_INVALID", "GPX 文件格式无效", 400)
					}
					name = strings.TrimSpace(raw)
				}
			case "trkpt":
				if !inTrack || !inSegment {
					if err := decoder.Skip(); err != nil {
						return parsedGPX{}, domain.NewError("GPX_INVALID", "GPX 文件格式无效", 400)
					}
					continue
				}
				point, elevation, err := decodeTrackPoint(decoder, value)
				if err != nil {
					return parsedGPX{}, err
				}
				track = append(track, point)
				elevations = append(elevations, elevation)
				if len(track) > maxGPXPoints {
					return parsedGPX{}, domain.NewError("GPX_POINT_LIMIT", "GPX 轨迹点数量需在 2 到 10000 之间", 400)
				}
			}
		case xml.EndElement:
			if value.Name.Local == "trkseg" {
				inSegment = false
			}
			if value.Name.Local == "trk" {
				inTrack = false
				inSegment = false
			}
		}
	}
	if len(track) < 2 {
		return parsedGPX{}, domain.NewError("GPX_POINT_LIMIT", "GPX 轨迹点数量需在 2 到 10000 之间", 400)
	}
	if name == "" {
		name = fallbackName
	}
	var distance, gain, maxGradient float64
	for index := 1; index < len(track); index++ {
		horizontal := haversineKM(track[index-1], track[index])
		distance += horizontal
		delta := elevations[index] - elevations[index-1]
		if delta > 0 {
			gain += delta
		}
		if horizontal > 0 {
			gradient := math.Abs(delta) / (horizontal * 1000) * 100
			if gradient > maxGradient {
				maxGradient = gradient
			}
		}
	}
	distance = round(distance, 2)
	return parsedGPX{
		Name: truncateRunes(name, 100), Track: track, ElevationProfile: elevations,
		DistanceKM: distance, ElevationGainM: int(math.Round(gain)), MaxGradient: round(maxGradient, 2),
		EstimatedMinutes: max(1, int(math.Round(distance/22*60))),
	}, nil
}

type xmlTrackPoint struct {
	Latitude  *float64 `xml:"lat,attr"`
	Longitude *float64 `xml:"lon,attr"`
	Elevation *float64 `xml:"ele"`
}

func decodeTrackPoint(decoder *xml.Decoder, start xml.StartElement) (domain.TrackPoint, float64, error) {
	var value xmlTrackPoint
	if err := decoder.DecodeElement(&value, &start); err != nil {
		return domain.TrackPoint{}, 0, domain.NewError("GPX_INVALID", "GPX 文件格式无效", 400)
	}
	if value.Latitude == nil || value.Longitude == nil || math.IsNaN(*value.Latitude) || math.IsInf(*value.Latitude, 0) || math.IsNaN(*value.Longitude) || math.IsInf(*value.Longitude, 0) || *value.Latitude < -90 || *value.Latitude > 90 || *value.Longitude < -180 || *value.Longitude > 180 {
		return domain.TrackPoint{}, 0, domain.NewError("GPX_INVALID_POINT", "GPX 包含非法经纬度", 400)
	}
	elevation := 0.0
	if value.Elevation != nil {
		if math.IsNaN(*value.Elevation) || math.IsInf(*value.Elevation, 0) {
			return domain.TrackPoint{}, 0, domain.NewError("GPX_INVALID_POINT", "GPX 包含非法海拔", 400)
		}
		elevation = *value.Elevation
	}
	return domain.TrackPoint{Latitude: *value.Latitude, Longitude: *value.Longitude}, elevation, nil
}

func haversineKM(left, right domain.TrackPoint) float64 {
	radians := func(degrees float64) float64 { return degrees * math.Pi / 180 }
	dLat := radians(right.Latitude - left.Latitude)
	dLon := radians(right.Longitude - left.Longitude)
	lat1 := radians(left.Latitude)
	lat2 := radians(right.Latitude)
	h := math.Pow(math.Sin(dLat/2), 2) + math.Cos(lat1)*math.Cos(lat2)*math.Pow(math.Sin(dLon/2), 2)
	return 6371 * 2 * math.Atan2(math.Sqrt(h), math.Sqrt(1-h))
}

func round(value float64, places int) float64 {
	factor := math.Pow10(places)
	return math.Round(value*factor) / factor
}

func truncateRunes(value string, limit int) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) > limit {
		runes = runes[:limit]
	}
	return string(runes)
}
