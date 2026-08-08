package auth

import (
	"context"
	"encoding/json"
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

func TestWeChatPhoneGatewayExchangesOfficialPhoneCode(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			if r.URL.Query().Get("grant_type") != "client_credential" {
				t.Fatalf("unexpected token query: %v", r.URL.Query())
			}
			_, _ = w.Write([]byte(`{"access_token":"access-token","expires_in":7200}`))
			return
		}
		var body map[string]string
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body["code"] != "phone-code" || r.URL.Query().Get("access_token") != "access-token" {
			t.Fatalf("unexpected phone request: query=%v body=%v err=%v", r.URL.Query(), body, err)
		}
		_, _ = w.Write([]byte(`{"errcode":0,"phone_info":{"purePhoneNumber":"13800138000"}}`))
	}))
	defer server.Close()

	gateway, err := NewWeChatHTTPGatewayWithClient("app", "secret", server.Client(), server.URL)
	if err != nil {
		t.Fatal(err)
	}
	gateway.tokenEndpoint = server.URL
	gateway.phoneEndpoint = server.URL
	phone, err := gateway.ExchangePhone(context.Background(), "phone-code")
	if err != nil || phone != "13800138000" {
		t.Fatalf("ExchangePhone() = %q, %v", phone, err)
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
