package config

import (
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
)

const (
	defaultDatabasePoolSize = 10
	defaultPort             = 3000
	defaultHost             = "0.0.0.0"
	defaultAvatarUploadDir  = "/tmp/fengji-avatars"
)

var (
	placeholderPattern  = regexp.MustCompile(`(?i)(?:change[_-]?me|replace[_-]?with|placeholder)`)
	wechatAppIDPattern  = regexp.MustCompile(`(?i)^wx[0-9a-f]{16}$`)
	wechatSecretPattern = regexp.MustCompile(`(?i)^[a-z0-9]{32}$`)
)

// Config contains all process-level settings required by the API.
type Config struct {
	AuthSecret         string
	FieldEncryptionKey string
	DemoMode           bool
	DatabaseURL        string
	DatabasePoolSize   int
	WeChatAppID        string
	WeChatAppSecret    string
	Port               int
	Host               string
	AvatarUploadDir    string
}

// Load reads and validates configuration from the process environment.
func Load() (Config, error) {
	return Resolve(os.Getenv)
}

// Resolve validates configuration obtained through getenv. Keeping the input
// injectable makes startup validation deterministic in tests.
func Resolve(getenv func(string) string) (Config, error) {
	authSecret := getenv("JWT_SECRET")
	if len(authSecret) < 32 {
		return Config{}, fmt.Errorf("JWT_SECRET must contain at least 32 characters")
	}
	fieldEncryptionKey := getenv("FIELD_ENCRYPTION_KEY")
	if len(fieldEncryptionKey) < 32 {
		return Config{}, fmt.Errorf("FIELD_ENCRYPTION_KEY must contain at least 32 characters")
	}

	demoMode := getenv("DEMO_MODE") == "true"
	databaseURL := getenv("DATABASE_URL")
	if !demoMode && databaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL is required unless DEMO_MODE=true")
	}

	wechatAppID := getenv("WECHAT_APP_ID")
	wechatAppSecret := getenv("WECHAT_APP_SECRET")
	if !demoMode && (wechatAppID == "" || wechatAppSecret == "") {
		return Config{}, fmt.Errorf("WECHAT_APP_ID and WECHAT_APP_SECRET are required unless DEMO_MODE=true")
	}
	if (wechatAppID == "") != (wechatAppSecret == "") {
		return Config{}, fmt.Errorf("WECHAT_APP_ID and WECHAT_APP_SECRET must be configured together")
	}
	if wechatAppID != "" && (!wechatAppIDPattern.MatchString(wechatAppID) || placeholderPattern.MatchString(wechatAppID)) {
		return Config{}, fmt.Errorf("WECHAT_APP_ID must be the formal mini program AppID, not a placeholder")
	}
	if wechatAppSecret != "" && (!wechatSecretPattern.MatchString(wechatAppSecret) || placeholderPattern.MatchString(wechatAppSecret)) {
		return Config{}, fmt.Errorf("WECHAT_APP_SECRET must be the formal 32-character mini program AppSecret, not a placeholder")
	}

	databasePoolSize, err := positiveInt(getenv("DATABASE_POOL_SIZE"), defaultDatabasePoolSize)
	if err != nil {
		return Config{}, fmt.Errorf("DATABASE_POOL_SIZE must be a positive integer")
	}
	port, err := positiveInt(getenv("PORT"), defaultPort)
	if err != nil || port > 65535 {
		return Config{}, fmt.Errorf("PORT must be an integer between 1 and 65535")
	}
	host := strings.TrimSpace(getenv("HOST"))
	if host == "" {
		host = defaultHost
	}
	avatarUploadDir := strings.TrimSpace(getenv("AVATAR_UPLOAD_DIR"))
	if avatarUploadDir == "" {
		avatarUploadDir = defaultAvatarUploadDir
	}

	return Config{
		AuthSecret:         authSecret,
		FieldEncryptionKey: fieldEncryptionKey,
		DemoMode:           demoMode,
		DatabaseURL:        databaseURL,
		DatabasePoolSize:   databasePoolSize,
		WeChatAppID:        wechatAppID,
		WeChatAppSecret:    wechatAppSecret,
		Port:               port,
		Host:               host,
		AvatarUploadDir:    avatarUploadDir,
	}, nil
}

func positiveInt(value string, defaultValue int) (int, error) {
	if value == "" {
		return defaultValue, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 1 {
		return 0, fmt.Errorf("not a positive integer")
	}
	return parsed, nil
}
