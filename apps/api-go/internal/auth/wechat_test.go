package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"cyclewhere/api-go/internal/domain"
)

func TestStableUserID(t *testing.T) {
	first := StableUserID("sensitive-openid")
	if first != StableUserID("sensitive-openid") || first == StableUserID("other-openid") {
		t.Fatalf("stable id derivation is not deterministic: %q", first)
	}
	if first != "f7e966a5-221b-50f6-b03c-0d9cde506a05" {
		t.Fatalf("StableUserID() = %q; Node compatibility changed", first)
	}
}

func TestWeChatHTTPGatewaySuccessAndQuery(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query()
		if query.Get("appid") != "wxa8740b5ae9c3f2dd" || query.Get("secret") == "" || query.Get("js_code") != "login-code" || query.Get("grant_type") != "authorization_code" {
			t.Errorf("unexpected query: %v", query)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"openid":"openid-1","unionid":"union-1"}`))
	}))
	defer server.Close()

	gateway, err := NewWeChatHTTPGatewayWithClient("wxa8740b5ae9c3f2dd", "0123456789abcdef0123456789abcdef", server.Client(), server.URL)
	if err != nil {
		t.Fatal(err)
	}
	session, err := gateway.Exchange(context.Background(), "login-code")
	if err != nil || session.OpenID != "openid-1" || session.UnionID != "union-1" {
		t.Fatalf("Exchange() = %+v, %v", session, err)
	}
}

func TestWeChatHTTPGatewayErrorMapping(t *testing.T) {
	tests := []struct {
		name       string
		response   string
		statusCode int
		code       string
	}{
		{"busy", `{"errcode":-1}`, 503, "WECHAT_UNAVAILABLE"},
		{"rate limited", `{"errcode":45011}`, 429, "RATE_LIMITED"},
		{"invalid app id", `{"errcode":40013}`, 503, "WECHAT_CONFIG_INVALID"},
		{"invalid app secret", `{"errcode":40125}`, 503, "WECHAT_CONFIG_INVALID"},
		{"invalid code", `{"errcode":40029}`, 401, "INVALID_WECHAT_CODE"},
		{"missing open id", `{}`, 401, "INVALID_WECHAT_CODE"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				_, _ = w.Write([]byte(test.response))
			}))
			defer server.Close()
			gateway, _ := NewWeChatHTTPGatewayWithClient("app", "secret", server.Client(), server.URL)
			_, err := gateway.Exchange(context.Background(), "code")
			var domainErr *domain.Error
			if !errors.As(err, &domainErr) || domainErr.Code != test.code || domainErr.StatusCode != test.statusCode {
				t.Fatalf("Exchange() error = %#v", err)
			}
		})
	}
}

func TestWeChatHTTPGatewayTransportFailures(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	serverURL := server.URL
	server.Close()
	gateway, _ := NewWeChatHTTPGatewayWithClient("app", "secret", server.Client(), serverURL)
	_, err := gateway.Exchange(context.Background(), "code")
	var domainErr *domain.Error
	if !errors.As(err, &domainErr) || domainErr.Code != "WECHAT_UNAVAILABLE" || domainErr.StatusCode != 503 {
		t.Fatalf("Exchange() error = %#v", err)
	}
}

func TestDisabledWeChatGateway(t *testing.T) {
	_, err := (DisabledWeChatSessionGateway{}).Exchange(context.Background(), "code")
	var domainErr *domain.Error
	if !errors.As(err, &domainErr) || domainErr.Code != "WECHAT_LOGIN_DISABLED" {
		t.Fatalf("Exchange() error = %#v", err)
	}
}
