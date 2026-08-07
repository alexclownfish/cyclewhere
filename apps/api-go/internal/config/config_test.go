package config

import (
	"strings"
	"testing"
)

func env(values map[string]string) func(string) string {
	return func(key string) string { return values[key] }
}

func required() map[string]string {
	return map[string]string{
		"JWT_SECRET":           "jwt-secret-with-at-least-thirty-two-characters",
		"FIELD_ENCRYPTION_KEY": "field-secret-with-at-least-thirty-two-characters",
	}
}

func TestResolveRequiresProductionDependencies(t *testing.T) {
	values := required()
	values["DATABASE_URL"] = "postgresql://localhost/fengji"
	_, err := Resolve(env(values))
	if err == nil || !strings.Contains(err.Error(), "WECHAT_APP_ID and WECHAT_APP_SECRET are required") {
		t.Fatalf("expected missing WeChat credentials error, got %v", err)
	}
}

func TestResolveAllowsExplicitDemoMode(t *testing.T) {
	values := required()
	values["DEMO_MODE"] = "true"
	got, err := Resolve(env(values))
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	if !got.DemoMode || got.DatabaseURL != "" || got.Port != 3000 || got.DatabasePoolSize != 10 {
		t.Fatalf("unexpected demo config: %+v", got)
	}
	if got.Host != "0.0.0.0" || got.AvatarUploadDir != "/tmp/fengji-avatars" {
		t.Fatalf("unexpected defaults: %+v", got)
	}
}

func TestResolveAcceptsProductionConfig(t *testing.T) {
	values := required()
	values["DATABASE_URL"] = "postgresql://localhost/fengji"
	values["WECHAT_APP_ID"] = "wxa8740b5ae9c3f2dd"
	values["WECHAT_APP_SECRET"] = "0123456789abcdef0123456789abcdef"
	values["DATABASE_POOL_SIZE"] = "12"
	values["PORT"] = "8080"
	got, err := Resolve(env(values))
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	if got.DatabasePoolSize != 12 || got.Port != 8080 || got.WeChatAppID != values["WECHAT_APP_ID"] {
		t.Fatalf("unexpected production config: %+v", got)
	}
}

func TestResolveRejectsInvalidValues(t *testing.T) {
	tests := []struct {
		name    string
		mutate  func(map[string]string)
		message string
	}{
		{"short jwt", func(v map[string]string) { v["JWT_SECRET"] = "short" }, "JWT_SECRET"},
		{"placeholder app id", func(v map[string]string) { v["WECHAT_APP_ID"] = "wx_replace_with_formal_app_id" }, "formal mini program AppID"},
		{"long generated app secret", func(v map[string]string) { v["WECHAT_APP_SECRET"] = strings.Repeat("a", 64) }, "formal 32-character"},
		{"invalid pool", func(v map[string]string) { v["DATABASE_POOL_SIZE"] = "zero" }, "positive integer"},
		{"invalid port", func(v map[string]string) { v["PORT"] = "65536" }, "between 1 and 65535"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			values := required()
			values["DATABASE_URL"] = "postgresql://localhost/fengji"
			values["WECHAT_APP_ID"] = "wxa8740b5ae9c3f2dd"
			values["WECHAT_APP_SECRET"] = "0123456789abcdef0123456789abcdef"
			test.mutate(values)
			_, err := Resolve(env(values))
			if err == nil || !strings.Contains(err.Error(), test.message) {
				t.Fatalf("expected %q error, got %v", test.message, err)
			}
		})
	}
}
