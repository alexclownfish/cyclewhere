package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"cyclewhere/api-go/internal/domain"
)

const (
	defaultWeChatEndpoint = "https://api.weixin.qq.com/sns/jscode2session"
	wechatTimeout         = 5 * time.Second
)

type WeChatSession struct {
	OpenID  string
	UnionID string
}

type WeChatSessionGateway interface {
	Exchange(context.Context, string) (WeChatSession, error)
}

type WeChatHTTPGateway struct {
	appID     string
	appSecret string
	client    *http.Client
	endpoint  string
}

func NewWeChatHTTPGateway(appID, appSecret string) (*WeChatHTTPGateway, error) {
	return NewWeChatHTTPGatewayWithClient(appID, appSecret, &http.Client{Timeout: wechatTimeout}, defaultWeChatEndpoint)
}

// NewWeChatHTTPGatewayWithClient supports deterministic HTTP contract tests.
func NewWeChatHTTPGatewayWithClient(appID, appSecret string, client *http.Client, endpoint string) (*WeChatHTTPGateway, error) {
	if appID == "" || appSecret == "" {
		return nil, fmt.Errorf("WECHAT_APP_ID and WECHAT_APP_SECRET are required")
	}
	if client == nil {
		client = &http.Client{Timeout: wechatTimeout}
	}
	if endpoint == "" {
		endpoint = defaultWeChatEndpoint
	}
	return &WeChatHTTPGateway{appID: appID, appSecret: appSecret, client: client, endpoint: endpoint}, nil
}

type weChatSessionPayload struct {
	OpenID  string `json:"openid"`
	UnionID string `json:"unionid"`
	ErrCode int    `json:"errcode"`
	ErrMsg  string `json:"errmsg"`
}

func (g *WeChatHTTPGateway) Exchange(ctx context.Context, code string) (WeChatSession, error) {
	requestURL, err := url.Parse(g.endpoint)
	if err != nil {
		return WeChatSession{}, wechatUnavailable()
	}
	query := requestURL.Query()
	query.Set("appid", g.appID)
	query.Set("secret", g.appSecret)
	query.Set("js_code", code)
	query.Set("grant_type", "authorization_code")
	requestURL.RawQuery = query.Encode()

	requestCtx, cancel := context.WithTimeout(ctx, wechatTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, requestURL.String(), nil)
	if err != nil {
		return WeChatSession{}, wechatUnavailable()
	}
	response, err := g.client.Do(req)
	if err != nil {
		return WeChatSession{}, wechatUnavailable()
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, response.Body)
		return WeChatSession{}, wechatUnavailable()
	}

	var payload weChatSessionPayload
	decoder := json.NewDecoder(io.LimitReader(response.Body, 1<<20))
	if err := decoder.Decode(&payload); err != nil {
		return WeChatSession{}, wechatUnavailable()
	}
	if payload.ErrCode != 0 || payload.OpenID == "" {
		return WeChatSession{}, wechatSessionError(payload.ErrCode)
	}
	return WeChatSession{OpenID: payload.OpenID, UnionID: payload.UnionID}, nil
}

type DisabledWeChatSessionGateway struct{}

func (DisabledWeChatSessionGateway) Exchange(context.Context, string) (WeChatSession, error) {
	return WeChatSession{}, domain.NewError("WECHAT_LOGIN_DISABLED", "当前环境未配置微信登录", 503)
}

func wechatUnavailable() error {
	return domain.NewError("WECHAT_UNAVAILABLE", "微信登录服务暂不可用", 503)
}

func wechatSessionError(code int) error {
	switch code {
	case -1:
		return wechatUnavailable()
	case 45011:
		return domain.NewError("RATE_LIMITED", "登录请求过于频繁", 429)
	case 40013, 40125:
		return domain.NewError("WECHAT_CONFIG_INVALID", "服务器微信 AppID 或 AppSecret 配置无效", 503)
	default:
		return domain.NewError("INVALID_WECHAT_CODE", "微信登录凭证无效或已过期", 401)
	}
}

// StableUserID creates the same non-reversible UUID-shaped identifier as the
// Node implementation, without storing the WeChat OpenID.
func StableUserID(openID string) string {
	sum := sha256.Sum256([]byte("fengji:" + openID))
	bytes := append([]byte(nil), sum[:16]...)
	bytes[6] = (bytes[6] & 0x0f) | 0x50
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	hexValue := hex.EncodeToString(bytes)
	return hexValue[:8] + "-" + hexValue[8:12] + "-" + hexValue[12:16] + "-" + hexValue[16:20] + "-" + hexValue[20:]
}
