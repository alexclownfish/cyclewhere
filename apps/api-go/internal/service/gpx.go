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
	maxGPXBytes             = 2 * 1024 * 1024
	maxGPXPoints            = 10_000
	minGradientWindowMeters = 30.0
	elevationNoiseMeters    = 3.0
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
	switch {
	case parsed.DistanceKM <= 0:
		return domain.Roadbook{}, domain.NewError("GPX_INVALID", "GPX 轨迹没有有效移动距离，请检查轨迹点", 400)
	case parsed.DistanceKM > 1000:
		return domain.Roadbook{}, domain.NewError("GPX_INVALID", "GPX 轨迹距离超过 1000 公里", 400)
	case parsed.ElevationGainM > 30000:
		return domain.Roadbook{}, domain.NewError("GPX_INVALID", "GPX 累计爬升超过 30000 米", 400)
	case parsed.MaxGradient > 100:
		return domain.Roadbook{}, domain.NewError("GPX_INVALID", "GPX 包含超过 100% 的异常坡度，请检查海拔数据", 400)
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
	segmentStarts := make([]bool, 0, 1024)
	name := ""
	inTrack := false
	inSegment := false
	segmentPointCount := 0
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
					segmentPointCount = 0
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
				segmentStarts = append(segmentStarts, segmentPointCount == 0)
				segmentPointCount++
				if len(track) > maxGPXPoints {
					return parsedGPX{}, domain.NewError("GPX_POINT_LIMIT", "GPX 轨迹点数量需在 2 到 10000 之间", 400)
				}
			}
		case xml.EndElement:
			if value.Name.Local == "trkseg" {
				inSegment = false
				segmentPointCount = 0
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
	elevations = normalizeElevations(elevations, segmentStarts)
	smoothedElevations := smoothElevations(elevations, segmentStarts)
	var distance, gain, maxGradient float64
	for index := 1; index < len(track); index++ {
		if segmentStarts[index] {
			continue
		}
		horizontal := haversineKM(track[index-1], track[index])
		distance += horizontal
	}
	gain = elevationGain(smoothedElevations, segmentStarts)
	maxGradient = gradientOverWindow(track, smoothedElevations, segmentStarts, minGradientWindowMeters)
	distance = round(distance, 2)
	return parsedGPX{
		Name: truncateRunes(name, 100), Track: track, ElevationProfile: smoothedElevations,
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
	elevation := math.NaN()
	if value.Elevation != nil {
		if math.IsNaN(*value.Elevation) || math.IsInf(*value.Elevation, 0) {
			return domain.TrackPoint{}, 0, domain.NewError("GPX_INVALID_POINT", "GPX 包含非法海拔", 400)
		}
		elevation = *value.Elevation
	}
	return domain.TrackPoint{Latitude: *value.Latitude, Longitude: *value.Longitude}, elevation, nil
}

func normalizeElevations(values []float64, segmentStarts []bool) []float64 {
	result := append([]float64(nil), values...)
	for start := 0; start < len(result); {
		end := start + 1
		for end < len(result) && !segmentStarts[end] {
			end++
		}
		firstValid := -1
		for index := start; index < end; index++ {
			if !math.IsNaN(result[index]) {
				firstValid = index
				break
			}
		}
		if firstValid == -1 {
			for index := start; index < end; index++ {
				result[index] = 0
			}
			start = end
			continue
		}
		for index := start; index < firstValid; index++ {
			result[index] = result[firstValid]
		}
		lastValid := firstValid
		for index := firstValid + 1; index < end; index++ {
			if math.IsNaN(result[index]) {
				continue
			}
			gap := index - lastValid
			for offset := 1; offset < gap; offset++ {
				ratio := float64(offset) / float64(gap)
				result[lastValid+offset] = result[lastValid] + (result[index]-result[lastValid])*ratio
			}
			lastValid = index
		}
		for index := lastValid + 1; index < end; index++ {
			result[index] = result[lastValid]
		}
		start = end
	}
	return result
}

func smoothElevations(values []float64, segmentStarts []bool) []float64 {
	result := make([]float64, len(values))
	for start := 0; start < len(values); {
		end := start + 1
		for end < len(values) && !segmentStarts[end] {
			end++
		}
		for index := start; index < end; index++ {
			windowStart := max(start, index-2)
			windowEnd := min(end, index+3)
			window := append([]float64(nil), values[windowStart:windowEnd]...)
			for left := 1; left < len(window); left++ {
				for right := left; right > 0 && window[right] < window[right-1]; right-- {
					window[right], window[right-1] = window[right-1], window[right]
				}
			}
			result[index] = window[len(window)/2]
		}
		start = end
	}
	return result
}

func elevationGain(values []float64, segmentStarts []bool) float64 {
	var gain float64
	for start := 0; start < len(values); {
		end := start + 1
		for end < len(values) && !segmentStarts[end] {
			end++
		}
		baseline := values[start]
		for index := start + 1; index < end; index++ {
			delta := values[index] - baseline
			if delta >= elevationNoiseMeters {
				gain += delta
				baseline = values[index]
			} else if delta <= -elevationNoiseMeters {
				baseline = values[index]
			}
		}
		start = end
	}
	return gain
}

func gradientOverWindow(track []domain.TrackPoint, elevations []float64, segmentStarts []bool, minWindowMeters float64) float64 {
	var maxGradient float64
	for start := 0; start < len(track); {
		end := start + 1
		for end < len(track) && !segmentStarts[end] {
			end++
		}
		windowStart := start
		var windowMeters float64
		for index := start + 1; index < end; index++ {
			windowMeters += haversineKM(track[index-1], track[index]) * 1000
			for windowStart+1 < index {
				firstLeg := haversineKM(track[windowStart], track[windowStart+1]) * 1000
				if windowMeters-firstLeg < minWindowMeters {
					break
				}
				windowMeters -= firstLeg
				windowStart++
			}
			if windowMeters >= minWindowMeters {
				gradient := math.Abs(elevations[index]-elevations[windowStart]) / windowMeters * 100
				maxGradient = max(maxGradient, gradient)
			}
		}
		start = end
	}
	return maxGradient
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
