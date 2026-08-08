package httpapi

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"cyclewhere/api-go/internal/auth"
	"cyclewhere/api-go/internal/domain"
	"cyclewhere/api-go/internal/security"
	"cyclewhere/api-go/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const (
	jsonBodyLimit = 256 * 1024
	avatarLimit   = 512 * 1024
	coverLimit    = 2 * 1024 * 1024
	// Base64 expands binary data by roughly 4/3. This leaves room for the
	// encoded payload and JSON envelope while decodeAvatarBase64 enforces the
	// 512KB decoded-image limit.
	avatarBase64BodyLimit = 768 * 1024
	coverBase64BodyLimit  = 3 * 1024 * 1024
	gpxLimit              = 2 * 1024 * 1024
)

var (
	errAvatarMissing  = errors.New("avatar payload is missing")
	errAvatarInvalid  = errors.New("avatar payload is invalid")
	errAvatarTooLarge = errors.New("avatar payload is too large")
)

var avatarFileName = regexp.MustCompile(`(?i)^[0-9a-f-]{36}\.(jpg|png|webp)$`)
var eventCoverFileName = regexp.MustCompile(`(?i)^event-[0-9a-f-]{36}\.(jpg|png|webp)$`)

type Dependencies struct {
	Repository      domain.Repository
	Catalog         *service.Catalog
	Issuer          *auth.Issuer
	Verifier        *auth.Verifier
	WeChat          auth.WeChatSessionGateway
	WeChatPhone     auth.WeChatPhoneGateway
	Encryptor       *security.FieldEncryptor
	AvatarUploadDir string
	Now             func() time.Time
}

type API struct {
	repository  domain.Repository
	catalog     *service.Catalog
	issuer      *auth.Issuer
	verifier    *auth.Verifier
	wechat      auth.WeChatSessionGateway
	wechatPhone auth.WeChatPhoneGateway
	encryptor   *security.FieldEncryptor
	avatarDir   string
	now         func() time.Time
	limiter     *loginLimiter
}

func NewRouter(deps Dependencies) (*gin.Engine, error) {
	if deps.Repository == nil || deps.Catalog == nil || deps.Issuer == nil || deps.Verifier == nil || deps.WeChat == nil || deps.Encryptor == nil {
		return nil, fmt.Errorf("http api dependencies are incomplete")
	}
	if deps.Now == nil {
		deps.Now = time.Now
	}
	phoneGateway := deps.WeChatPhone
	if phoneGateway == nil {
		phoneGateway, _ = deps.WeChat.(auth.WeChatPhoneGateway)
	}
	if phoneGateway == nil {
		phoneGateway = auth.DisabledWeChatSessionGateway{}
	}
	api := &API{
		repository: deps.Repository, catalog: deps.Catalog, issuer: deps.Issuer,
		verifier: deps.Verifier, wechat: deps.WeChat, wechatPhone: phoneGateway, encryptor: deps.Encryptor,
		avatarDir: deps.AvatarUploadDir, now: deps.Now, limiter: newLoginLimiter(),
	}
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	if err := router.SetTrustedProxies([]string{"127.0.0.1", "::1", "172.16.0.0/12"}); err != nil {
		return nil, fmt.Errorf("configure trusted proxies: %w", err)
	}
	router.Use(api.recovery(), api.limitRequestBody())
	router.GET("/health", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) })

	v1 := router.Group("/api/v1")
	v1.POST("/auth/wechat/login", api.login)
	v1.POST("/auth/wechat/phone-login", api.phoneLogin)
	v1.GET("/avatars/:fileName", api.getAvatar)
	v1.GET("/event-covers/:fileName", api.getEventCover)
	v1.GET("/events", api.listEvents)
	v1.GET("/events/:id", api.optionalAuth(), api.getEvent)
	v1.GET("/events/:id/participants", api.optionalAuth(), api.listEventParticipants)
	protected := v1.Group("")
	protected.Use(api.requireAuth())
	protected.GET("/events/:id/participants/:participantId/contact", api.getEventParticipantContact)
	v1.GET("/routes", api.listRoadbooks)
	v1.GET("/routes/:id", api.getRoadbook)

	protected.GET("/me/profile", api.getProfile)
	protected.PUT("/me/profile", api.updateProfile)
	protected.POST("/me/phone", api.bindPhone)
	protected.POST("/me/avatar", api.uploadAvatar)
	protected.POST("/me/avatar/base64", api.uploadAvatarBase64)
	protected.GET("/me/events", api.listOwnedEvents)
	protected.GET("/me/registrations", api.listMyRegistrations)
	protected.POST("/events", api.createEvent)
	protected.POST("/events/:id/cover/base64", api.uploadEventCoverBase64)
	protected.POST("/events/:id/publish", api.publishEvent)
	protected.PATCH("/events/:id", api.updateEvent)
	protected.PUT("/events/:id", api.updateEvent)
	protected.POST("/routes", api.createRoadbook)
	protected.POST("/routes/import/gpx", api.importGPX)
	protected.POST("/events/:id/registrations", api.register)
	protected.DELETE("/events/:id/registrations/me", api.cancelRegistration)
	protected.GET("/events/:id/registration-status", api.registrationStatus)
	return router, nil
}

func (a *API) recovery() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if recovered := recover(); recovered != nil {
				writeError(c, domain.NewError("INTERNAL_ERROR", "服务器内部错误", 500))
				c.Abort()
			}
		}()
		c.Next()
	}
}

func (a *API) limitRequestBody() gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.Request.URL.Path
		eventCoverUpload := strings.HasPrefix(path, "/api/v1/events/") && strings.HasSuffix(path, "/cover/base64")
		upload := path == "/api/v1/me/avatar" || path == "/api/v1/me/avatar/base64" || path == "/api/v1/routes/import/gpx" || eventCoverUpload
		if !upload && c.Request.Body != nil {
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, jsonBodyLimit)
		}
		c.Next()
	}
}

func (a *API) requireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := a.verifier.Verify(c.GetHeader("Authorization"))
		if err != nil {
			writeError(c, err)
			c.Abort()
			return
		}
		c.Set("userID", user.ID)
		c.Next()
	}
}

func (a *API) optionalAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if header == "" {
			c.Next()
			return
		}
		user, err := a.verifier.Verify(header)
		if err != nil {
			writeError(c, err)
			c.Abort()
			return
		}
		c.Set("userID", user.ID)
		c.Next()
	}
}

func userID(c *gin.Context) string {
	value, _ := c.Get("userID")
	id, _ := value.(string)
	return id
}

func (a *API) login(c *gin.Context) {
	if err := a.limiter.Check(c.ClientIP(), a.now()); err != nil {
		writeError(c, err)
		return
	}
	var input struct {
		Code string `json:"code"`
	}
	if err := decodeJSON(c, &input, true); err != nil {
		writeDecodeError(c, err)
		return
	}
	if len(strings.TrimSpace(input.Code)) < 6 || len(strings.TrimSpace(input.Code)) > 256 {
		writeValidation(c)
		return
	}
	session, err := a.wechat.Exchange(c.Request.Context(), strings.TrimSpace(input.Code))
	if err != nil {
		writeError(c, err)
		return
	}
	id := auth.StableUserID(session.OpenID)
	profile, err := a.ensureDefaultProfile(c, id)
	if err != nil {
		writeError(c, err)
		return
	}
	a.writeLoginResponse(c, id, profile)
}

func (a *API) phoneLogin(c *gin.Context) {
	if err := a.limiter.Check(c.ClientIP(), a.now()); err != nil {
		writeError(c, err)
		return
	}
	var input struct {
		LoginCode string `json:"loginCode"`
		PhoneCode string `json:"phoneCode"`
	}
	if err := decodeJSON(c, &input, true); err != nil {
		writeDecodeError(c, err)
		return
	}
	input.LoginCode = strings.TrimSpace(input.LoginCode)
	input.PhoneCode = strings.TrimSpace(input.PhoneCode)
	if len(input.LoginCode) < 6 || len(input.LoginCode) > 256 || len(input.PhoneCode) < 6 || len(input.PhoneCode) > 256 {
		writeValidation(c)
		return
	}
	session, err := a.wechat.Exchange(c.Request.Context(), input.LoginCode)
	if err != nil {
		writeError(c, err)
		return
	}
	phone, err := a.wechatPhone.ExchangePhone(c.Request.Context(), input.PhoneCode)
	if err != nil {
		writeError(c, err)
		return
	}
	if !phonePattern.MatchString(phone) {
		writeError(c, domain.NewError("PHONE_UNSUPPORTED", "暂仅支持中国大陆手机号", 400))
		return
	}
	phoneHash := fmt.Sprintf("%x", sha256.Sum256([]byte(phone)))
	id := auth.StableUserID(session.OpenID)
	boundID, err := a.repository.GetUserIDByPhoneHash(c.Request.Context(), phoneHash)
	if err != nil {
		writeError(c, err)
		return
	}
	if boundID != nil {
		id = *boundID
	}
	profile, err := a.ensureDefaultProfile(c, id)
	if err != nil {
		writeError(c, err)
		return
	}
	if err := a.storePhone(c, id, phone, phoneHash); err != nil {
		writeError(c, err)
		return
	}
	profile.PhoneMasked = phoneMask(phone)
	a.writeLoginResponse(c, id, profile)
}

func (a *API) bindPhone(c *gin.Context) {
	var input struct {
		Code string `json:"code"`
	}
	if err := decodeJSON(c, &input, true); err != nil {
		writeDecodeError(c, err)
		return
	}
	input.Code = strings.TrimSpace(input.Code)
	if len(input.Code) < 6 || len(input.Code) > 256 {
		writeValidation(c)
		return
	}
	phone, err := a.wechatPhone.ExchangePhone(c.Request.Context(), input.Code)
	if err != nil {
		writeError(c, err)
		return
	}
	if !phonePattern.MatchString(phone) {
		writeError(c, domain.NewError("PHONE_UNSUPPORTED", "暂仅支持中国大陆手机号", 400))
		return
	}
	phoneHash := fmt.Sprintf("%x", sha256.Sum256([]byte(phone)))
	if err := a.storePhone(c, userID(c), phone, phoneHash); err != nil {
		writeError(c, err)
		return
	}
	profile, err := a.repository.GetUserProfile(c.Request.Context(), userID(c))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, data(gin.H{"profile": profileResponse(profile)}))
}

func (a *API) storePhone(c *gin.Context, id, phone, phoneHash string) error {
	encrypted, err := a.encryptor.Encrypt(phone)
	if err != nil {
		return err
	}
	masked := phoneMask(phone)
	return a.repository.BindUserPhone(c.Request.Context(), id, phoneHash, encrypted, *masked, a.now().UTC())
}

func phoneMask(phone string) *string {
	masked := phone
	if len(phone) >= 7 {
		masked = phone[:3] + "****" + phone[len(phone)-4:]
	}
	return &masked
}

func (a *API) ensureDefaultProfile(c *gin.Context, id string) (*domain.UserProfile, error) {
	profile, err := a.repository.GetUserProfile(c.Request.Context(), id)
	if err != nil || profile != nil {
		return profile, err
	}
	nickname := "微信骑友"
	created, err := a.repository.UpsertUserProfile(c.Request.Context(), domain.UserProfile{
		ID: id, Nickname: &nickname, UpdatedAt: a.now().UTC(),
	})
	if err != nil {
		return nil, err
	}
	return &created, nil
}

func (a *API) writeLoginResponse(c *gin.Context, id string, profile *domain.UserProfile) {
	token, err := a.issuer.Issue(id)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusCreated, data(gin.H{
		"accessToken": token, "tokenType": "Bearer", "expiresIn": auth.TokenExpiresInSec,
		"user": gin.H{"id": id, "profile": profileResponse(profile)},
	}))
}

func (a *API) getProfile(c *gin.Context) {
	profile, err := a.repository.GetUserProfile(c.Request.Context(), userID(c))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, data(gin.H{"profile": profileResponse(profile)}))
}

type profileInput struct {
	Nickname  *string `json:"nickname"`
	AvatarURL *string `json:"avatarUrl"`
	Gender    *int    `json:"gender"`
	Country   *string `json:"country"`
	Province  *string `json:"province"`
	City      *string `json:"city"`
}

func (a *API) updateProfile(c *gin.Context) {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		writeDecodeError(c, err)
		return
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(body, &fields) != nil || len(fields) != 6 {
		writeValidation(c)
		return
	}
	for _, key := range []string{"nickname", "avatarUrl", "gender", "country", "province", "city"} {
		if _, ok := fields[key]; !ok {
			writeValidation(c)
			return
		}
	}
	var input profileInput
	if strictUnmarshal(body, &input) != nil || !validProfile(input) {
		writeValidation(c)
		return
	}
	trimOptional(&input.Nickname)
	trimOptional(&input.Country)
	trimOptional(&input.Province)
	trimOptional(&input.City)
	profile, err := a.repository.UpsertUserProfile(c.Request.Context(), domain.UserProfile{
		ID: userID(c), Nickname: input.Nickname, AvatarURL: input.AvatarURL, Gender: input.Gender,
		Country: input.Country, Province: input.Province, City: input.City, UpdatedAt: a.now().UTC(),
	})
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, data(gin.H{"profile": profileResponse(&profile)}))
}

func validProfile(input profileInput) bool {
	if input.Nickname != nil {
		length := len([]rune(strings.TrimSpace(*input.Nickname)))
		if length < 1 || length > 100 {
			return false
		}
	}
	if input.AvatarURL != nil {
		parsed, err := url.ParseRequestURI(*input.AvatarURL)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" || len(*input.AvatarURL) > 500 {
			return false
		}
	}
	if input.Gender != nil && (*input.Gender < 0 || *input.Gender > 2) {
		return false
	}
	for _, value := range []*string{input.Country, input.Province, input.City} {
		if value != nil && len([]rune(strings.TrimSpace(*value))) > 100 {
			return false
		}
	}
	return true
}

func trimOptional(value **string) {
	if *value != nil {
		trimmed := strings.TrimSpace(**value)
		*value = &trimmed
	}
}

func (a *API) uploadAvatar(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, avatarLimit+64*1024)
	file, _, err := c.Request.FormFile("file")
	if errors.Is(err, http.ErrMissingFile) {
		writeError(c, domain.NewError("AVATAR_MISSING", "请选择微信头像", 400))
		return
	}
	if err != nil {
		writeError(c, domain.NewError("AVATAR_TOO_LARGE", "头像文件不能超过 512KB", 413))
		return
	}
	defer file.Close()
	buffer, err := readLimited(file, avatarLimit)
	if err != nil || len(buffer) == 0 {
		writeError(c, domain.NewError("AVATAR_TOO_LARGE", "头像文件不能超过 512KB", 413))
		return
	}
	extension, contentType := detectImage(buffer)
	if extension == "" {
		writeError(c, domain.NewError("AVATAR_INVALID", "头像仅支持 JPEG、PNG 或 WebP 图片", 400))
		return
	}
	if err := os.MkdirAll(a.avatarDir, 0o755); err != nil {
		writeError(c, err)
		return
	}
	name := userID(c) + "." + extension
	finalPath := filepath.Join(a.avatarDir, name)
	temporary, err := os.CreateTemp(a.avatarDir, name+".*.tmp")
	if err != nil {
		writeError(c, err)
		return
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if _, err = temporary.Write(buffer); err == nil {
		err = temporary.Sync()
	}
	if closeErr := temporary.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(temporaryPath, finalPath)
	}
	if err != nil {
		_ = os.Remove(finalPath)
		err = os.Rename(temporaryPath, finalPath)
	}
	if err != nil {
		writeError(c, err)
		return
	}
	for _, other := range []string{"jpg", "png", "webp"} {
		if other != extension {
			_ = os.Remove(filepath.Join(a.avatarDir, userID(c)+"."+other))
		}
	}
	_ = contentType
	host := firstForwarded(c.GetHeader("X-Forwarded-Host"))
	if host == "" {
		host = firstForwarded(c.Request.Host)
	}
	if host == "" {
		writeError(c, domain.NewError("PUBLIC_HOST_MISSING", "服务器公开域名配置缺失", 500))
		return
	}
	protocol := firstForwarded(c.GetHeader("X-Forwarded-Proto"))
	if protocol == "" {
		protocol = "https"
	}
	avatarURL := fmt.Sprintf("%s://%s/api/v1/avatars/%s?v=%d", protocol, host, name, a.now().UnixMilli())
	profile, err := a.repository.GetUserProfile(c.Request.Context(), userID(c))
	if err != nil {
		writeError(c, err)
		return
	}
	if profile == nil {
		writeError(c, errors.New("User profile must be created before uploading an avatar"))
		return
	}
	profile.AvatarURL = &avatarURL
	profile.UpdatedAt = a.now().UTC()
	updated, err := a.repository.UpsertUserProfile(c.Request.Context(), *profile)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusCreated, data(gin.H{"profile": profileResponse(&updated)}))
}

// uploadAvatarBase64 is intended for wx.request. wx.uploadFile requires a
// separately configured uploadFile domain, while request domains are already
// available to the mini program. The payload accepts either raw base64 or a
// data URL such as data:image/jpeg;base64,... .
func (a *API) uploadAvatarBase64(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, avatarBase64BodyLimit)
	var input struct {
		Data string `json:"data"`
	}
	if err := decodeJSON(c, &input, true); err != nil {
		writeDecodeError(c, err)
		return
	}
	buffer, err := decodeImageBase64(input.Data, avatarLimit)
	if errors.Is(err, errAvatarMissing) {
		writeError(c, domain.NewError("AVATAR_MISSING", "请选择微信头像", 400))
		return
	}
	if errors.Is(err, errAvatarTooLarge) {
		writeError(c, domain.NewError("AVATAR_TOO_LARGE", "头像文件不能超过 512KB", 413))
		return
	}
	if err != nil {
		writeError(c, domain.NewError("AVATAR_INVALID", "头像仅支持 JPEG、PNG 或 WebP 图片", 400))
		return
	}
	extension, _ := detectImage(buffer)
	if extension == "" {
		writeError(c, domain.NewError("AVATAR_INVALID", "头像仅支持 JPEG、PNG 或 WebP 图片", 400))
		return
	}
	if err := a.storeAvatarBytes(c, buffer, extension); err != nil {
		writeError(c, err)
	}
}

func decodeImageBase64(raw string, limit int) ([]byte, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return nil, errAvatarMissing
	}
	if strings.HasPrefix(strings.ToLower(value), "data:") {
		separator := strings.IndexByte(value, ',')
		if separator < 0 || !strings.Contains(strings.ToLower(value[:separator]), ";base64") {
			return nil, errAvatarInvalid
		}
		value = strings.TrimSpace(value[separator+1:])
	}
	if value == "" {
		return nil, errAvatarMissing
	}
	if len(value) > base64.StdEncoding.EncodedLen(limit)+4 {
		return nil, errAvatarTooLarge
	}
	decoded, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		decoded, err = base64.RawStdEncoding.DecodeString(value)
	}
	if err != nil {
		return nil, errAvatarInvalid
	}
	if len(decoded) == 0 {
		return nil, errAvatarMissing
	}
	if len(decoded) > limit {
		return nil, errAvatarTooLarge
	}
	return decoded, nil
}

func decodeAvatarBase64(raw string) ([]byte, error) { return decodeImageBase64(raw, avatarLimit) }

func (a *API) storeAvatarBytes(c *gin.Context, buffer []byte, extension string) error {
	if err := os.MkdirAll(a.avatarDir, 0o755); err != nil {
		return err
	}
	name := userID(c) + "." + extension
	finalPath := filepath.Join(a.avatarDir, name)
	temporary, err := os.CreateTemp(a.avatarDir, name+".*.tmp")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if _, err = temporary.Write(buffer); err == nil {
		err = temporary.Sync()
	}
	if closeErr := temporary.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(temporaryPath, finalPath)
	}
	if err != nil {
		_ = os.Remove(finalPath)
		err = os.Rename(temporaryPath, finalPath)
	}
	if err != nil {
		return err
	}
	for _, other := range []string{"jpg", "png", "webp"} {
		if other != extension {
			_ = os.Remove(filepath.Join(a.avatarDir, userID(c)+"."+other))
		}
	}
	host := firstForwarded(c.GetHeader("X-Forwarded-Host"))
	if host == "" {
		host = firstForwarded(c.Request.Host)
	}
	if host == "" {
		return domain.NewError("PUBLIC_HOST_MISSING", "服务器公开域名配置缺失", 500)
	}
	protocol := firstForwarded(c.GetHeader("X-Forwarded-Proto"))
	if protocol == "" {
		protocol = "https"
	}
	avatarURL := fmt.Sprintf("%s://%s/api/v1/avatars/%s?v=%d", protocol, host, name, a.now().UnixMilli())
	profile, err := a.repository.GetUserProfile(c.Request.Context(), userID(c))
	if err != nil {
		return err
	}
	if profile == nil {
		return errors.New("User profile must be created before uploading an avatar")
	}
	profile.AvatarURL = &avatarURL
	profile.UpdatedAt = a.now().UTC()
	updated, err := a.repository.UpsertUserProfile(c.Request.Context(), *profile)
	if err != nil {
		return err
	}
	c.JSON(http.StatusCreated, data(gin.H{"profile": profileResponse(&updated)}))
	return nil
}

func (a *API) getAvatar(c *gin.Context) {
	name := c.Param("fileName")
	if !avatarFileName.MatchString(name) {
		writeError(c, domain.NotFound("头像"))
		return
	}
	buffer, err := os.ReadFile(filepath.Join(a.avatarDir, name))
	if errors.Is(err, os.ErrNotExist) {
		writeError(c, domain.NotFound("头像"))
		return
	}
	if err != nil {
		writeError(c, err)
		return
	}
	_, contentType := detectImage(buffer)
	c.Header("Cache-Control", "public, max-age=31536000, immutable")
	c.Data(http.StatusOK, contentType, buffer)
}

func (a *API) uploadEventCoverBase64(c *gin.Context) {
	if !validID(c.Param("id")) {
		writeValidation(c)
		return
	}
	event, err := a.catalog.GetEvent(c.Request.Context(), c.Param("id"))
	if err != nil {
		writeError(c, err)
		return
	}
	if event.OrganizerID != userID(c) {
		writeError(c, domain.Forbidden("仅活动组织者可以上传封面"))
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, coverBase64BodyLimit)
	var input struct {
		Data string `json:"data"`
	}
	if err := decodeJSON(c, &input, true); err != nil {
		writeDecodeError(c, err)
		return
	}
	buffer, err := decodeImageBase64(input.Data, coverLimit)
	if errors.Is(err, errAvatarMissing) {
		writeError(c, domain.NewError("COVER_MISSING", "请选择活动封面", 400))
		return
	}
	if errors.Is(err, errAvatarTooLarge) {
		writeError(c, domain.NewError("COVER_TOO_LARGE", "活动封面不能超过 2MB", 413))
		return
	}
	if err != nil {
		writeError(c, domain.NewError("COVER_INVALID", "活动封面仅支持 JPEG、PNG 或 WebP 图片", 400))
		return
	}
	extension, _ := detectImage(buffer)
	if extension == "" {
		writeError(c, domain.NewError("COVER_INVALID", "活动封面仅支持 JPEG、PNG 或 WebP 图片", 400))
		return
	}
	if err := os.MkdirAll(a.avatarDir, 0o755); err != nil {
		writeError(c, err)
		return
	}
	name := "event-" + event.ID + "." + extension
	finalPath := filepath.Join(a.avatarDir, name)
	temporary, err := os.CreateTemp(a.avatarDir, name+".*.tmp")
	if err != nil {
		writeError(c, err)
		return
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if _, err = temporary.Write(buffer); err == nil {
		err = temporary.Sync()
	}
	if closeErr := temporary.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(temporaryPath, finalPath)
	}
	if err != nil {
		_ = os.Remove(finalPath)
		err = os.Rename(temporaryPath, finalPath)
	}
	if err != nil {
		writeError(c, err)
		return
	}
	host := firstForwarded(c.GetHeader("X-Forwarded-Host"))
	if host == "" {
		host = firstForwarded(c.Request.Host)
	}
	if host == "" {
		writeError(c, domain.NewError("PUBLIC_HOST_MISSING", "服务器公开域名配置缺失", 500))
		return
	}
	protocol := firstForwarded(c.GetHeader("X-Forwarded-Proto"))
	if protocol == "" {
		protocol = "https"
	}
	coverURL := fmt.Sprintf("%s://%s/api/v1/event-covers/%s?v=%d", protocol, host, name, a.now().UnixMilli())
	coverURLValue := coverURL
	coverURLPtr := &coverURLValue
	updated, err := a.catalog.UpdateEvent(c.Request.Context(), event.ID, userID(c), service.EventPatch{CoverURL: &coverURLPtr})
	if err != nil {
		_ = os.Remove(finalPath)
		writeError(c, err)
		return
	}
	for _, other := range []string{"jpg", "png", "webp"} {
		if other != extension {
			_ = os.Remove(filepath.Join(a.avatarDir, "event-"+event.ID+"."+other))
		}
	}
	c.JSON(http.StatusCreated, data(eventResponse(updated)))
}

func (a *API) getEventCover(c *gin.Context) {
	name := c.Param("fileName")
	if !eventCoverFileName.MatchString(name) {
		writeError(c, domain.NotFound("活动封面"))
		return
	}
	buffer, err := os.ReadFile(filepath.Join(a.avatarDir, name))
	if errors.Is(err, os.ErrNotExist) {
		writeError(c, domain.NotFound("活动封面"))
		return
	}
	if err != nil {
		writeError(c, err)
		return
	}
	_, contentType := detectImage(buffer)
	c.Header("Cache-Control", "public, max-age=31536000, immutable")
	c.Data(http.StatusOK, contentType, buffer)
}

func (a *API) listEvents(c *gin.Context) {
	limit, ok := parseLimit(c.Query("limit"))
	if !ok {
		writeValidation(c)
		return
	}
	query := domain.EventListQuery{Limit: limit}
	if raw := c.Query("cursor"); raw != "" {
		if len(strings.TrimSpace(raw)) < 1 || len(strings.TrimSpace(raw)) > 100 {
			writeValidation(c)
			return
		}
		value := strings.TrimSpace(raw)
		query.Cursor = &value
	}
	if raw := c.Query("status"); raw != "" {
		value := domain.EventStatus(raw)
		if value != domain.EventPublished && value != domain.EventFull && value != domain.EventCompleted {
			writeValidation(c)
			return
		}
		query.Status = &value
	}
	if raw := c.Query("difficulty"); raw != "" {
		value := domain.Difficulty(raw)
		if !validDifficulty(value) {
			writeValidation(c)
			return
		}
		query.Difficulty = &value
	}
	page, err := a.catalog.ListEvents(c.Request.Context(), query)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, data(pageEventResponse(page)))
}

func (a *API) getEvent(c *gin.Context) {
	if !validID(c.Param("id")) {
		writeValidation(c)
		return
	}
	event, err := a.catalog.GetPublicEvent(c.Request.Context(), c.Param("id"), userID(c))
	if err != nil {
		writeError(c, err)
		return
	}
	organizer, err := a.repository.GetUserProfile(c.Request.Context(), event.OrganizerID)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, data(eventDetailResponse(*event, organizer, userID(c) != "" && event.OrganizerID == userID(c))))
}

func (a *API) listEventParticipants(c *gin.Context) {
	if uuid.Validate(strings.TrimSpace(c.Param("id"))) != nil {
		writeValidation(c)
		return
	}
	event, err := a.catalog.GetPublicEvent(c.Request.Context(), c.Param("id"), userID(c))
	if err != nil {
		writeError(c, err)
		return
	}
	participants, err := a.repository.ListEventParticipants(c.Request.Context(), c.Param("id"))
	if err != nil {
		writeError(c, err)
		return
	}
	items := make([]any, len(participants))
	includeContactIDs := userID(c) != "" && userID(c) == event.OrganizerID
	for index, participant := range participants {
		item := participantResponse(participant)
		if includeContactIDs && !participant.IsOrganizer {
			item["contactId"] = participant.ID
		}
		items[index] = item
	}
	c.JSON(http.StatusOK, data(gin.H{"items": items}))
}

func (a *API) getEventParticipantContact(c *gin.Context) {
	if uuid.Validate(strings.TrimSpace(c.Param("id"))) != nil || uuid.Validate(strings.TrimSpace(c.Param("participantId"))) != nil {
		writeValidation(c)
		return
	}
	event, err := a.catalog.GetEvent(c.Request.Context(), c.Param("id"))
	if err != nil {
		writeError(c, err)
		return
	}
	if event == nil {
		writeError(c, domain.NotFound("娲诲姩"))
		return
	}
	if event.OrganizerID != userID(c) {
		writeError(c, domain.Forbidden("仅活动组织者可以查看报名联系方式"))
		return
	}
	contact, err := a.repository.GetEventParticipantContact(c.Request.Context(), c.Param("id"), c.Param("participantId"))
	if err != nil {
		writeError(c, err)
		return
	}
	if contact == nil {
		writeError(c, domain.NotFound("报名骑友"))
		return
	}
	phone, err := a.encryptor.Decrypt(contact.PhoneEncrypted)
	if err != nil {
		writeError(c, domain.NewError("CONTACT_UNAVAILABLE", "报名联系方式暂不可用", http.StatusInternalServerError))
		return
	}
	emergencyContact, err := a.encryptor.Decrypt(contact.EmergencyContactEncrypted)
	if err != nil {
		writeError(c, domain.NewError("CONTACT_UNAVAILABLE", "报名联系方式暂不可用", http.StatusInternalServerError))
		return
	}
	c.JSON(http.StatusOK, data(participantContactResponse(*contact, phone, emergencyContact)))
}

func (a *API) createEvent(c *gin.Context) {
	var input service.EventInput
	if err := decodeJSON(c, &input, false); err != nil {
		writeDecodeError(c, err)
		return
	}
	event, err := a.catalog.CreateEvent(c.Request.Context(), userID(c), input)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusCreated, data(eventResponse(event)))
}

func (a *API) publishEvent(c *gin.Context) {
	if !validID(c.Param("id")) {
		writeValidation(c)
		return
	}
	event, err := a.catalog.PublishEvent(c.Request.Context(), c.Param("id"), userID(c))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, data(eventResponse(event)))
}

func (a *API) updateEvent(c *gin.Context) {
	if !validID(c.Param("id")) {
		writeValidation(c)
		return
	}
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		writeDecodeError(c, err)
		return
	}
	var patch service.EventPatch
	if strictUnmarshal(body, &patch) != nil {
		writeValidation(c)
		return
	}
	var raw map[string]json.RawMessage
	if json.Unmarshal(body, &raw) != nil {
		writeValidation(c)
		return
	}
	if value, exists := raw["routeId"]; exists {
		var route *string
		if !bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			var parsed string
			if json.Unmarshal(value, &parsed) != nil || !validID(parsed) {
				writeValidation(c)
				return
			}
			route = &parsed
		}
		patch.RouteID = &route
	}
	event, err := a.catalog.UpdateEvent(c.Request.Context(), c.Param("id"), userID(c), patch)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, data(eventResponse(event)))
}

func (a *API) listOwnedEvents(c *gin.Context) {
	items, err := a.catalog.ListOwnedEvents(c.Request.Context(), userID(c))
	if err != nil {
		writeError(c, err)
		return
	}
	response := make([]any, len(items))
	for index, item := range items {
		response[index] = eventResponse(item)
	}
	c.JSON(http.StatusOK, data(gin.H{"items": response}))
}

func (a *API) listRoadbooks(c *gin.Context) {
	limit, ok := parseLimit(c.Query("limit"))
	if !ok {
		writeValidation(c)
		return
	}
	var cursor *string
	if raw := c.Query("cursor"); raw != "" {
		value := strings.TrimSpace(raw)
		if !validID(value) {
			writeValidation(c)
			return
		}
		cursor = &value
	}
	page, err := a.catalog.ListRoadbooks(c.Request.Context(), limit, cursor)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, data(pageRoadbookResponse(page)))
}

func (a *API) getRoadbook(c *gin.Context) {
	if !validID(c.Param("id")) {
		writeValidation(c)
		return
	}
	roadbook, err := a.catalog.GetRoadbook(c.Request.Context(), c.Param("id"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, data(roadbookResponse(*roadbook)))
}

func (a *API) createRoadbook(c *gin.Context) {
	var input service.RoadbookInput
	if err := decodeJSON(c, &input, false); err != nil {
		writeDecodeError(c, err)
		return
	}
	roadbook, err := a.catalog.CreateRoadbook(c.Request.Context(), userID(c), input)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusCreated, data(roadbookResponse(roadbook)))
}

func (a *API) importGPX(c *gin.Context) {
	var source []byte
	metadata := service.GPXMetadata{}
	contentType := c.GetHeader("Content-Type")
	if strings.HasPrefix(contentType, "multipart/form-data") {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, gpxLimit+128*1024)
		file, header, err := c.Request.FormFile("file")
		if err != nil {
			writeError(c, domain.NewError("GPX_MISSING", "请上传 GPX 文件", 400))
			return
		}
		defer file.Close()
		if !strings.HasSuffix(strings.ToLower(header.Filename), ".gpx") {
			writeError(c, domain.NewError("GPX_INVALID", "仅支持 .gpx 文件", 400))
			return
		}
		source, err = readLimited(file, gpxLimit)
		if err != nil {
			writeError(c, domain.NewError("GPX_TOO_LARGE", "GPX 文件不能超过 2MB", 413))
			return
		}
		metadata = metadataFromForm(c.Request.MultipartForm)
	} else if strings.HasPrefix(contentType, "application/json") {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, gpxLimit+128*1024)
		var input struct {
			GPX         string            `json:"gpx"`
			Name        string            `json:"name"`
			Description string            `json:"description"`
			Region      string            `json:"region"`
			Difficulty  domain.Difficulty `json:"difficulty"`
		}
		if err := decodeJSON(c, &input, false); err != nil {
			writeDecodeError(c, err)
			return
		}
		source = []byte(input.GPX)
		metadata = service.GPXMetadata{Name: input.Name, Description: input.Description, Region: input.Region, Difficulty: input.Difficulty}
	} else {
		var err error
		source, err = readLimited(c.Request.Body, gpxLimit)
		if err != nil {
			writeError(c, domain.NewError("GPX_TOO_LARGE", "GPX 文件不能超过 2MB", 413))
			return
		}
	}
	if len(source) == 0 {
		writeError(c, domain.NewError("GPX_MISSING", "请上传 GPX 文件", 400))
		return
	}
	if !validGPXMetadata(metadata) {
		writeValidation(c)
		return
	}
	roadbook, err := a.catalog.ImportGPX(c.Request.Context(), userID(c), source, metadata)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusCreated, data(roadbookResponse(roadbook)))
}

type registrationInput struct {
	Phone              string `json:"phone"`
	EmergencyContact   string `json:"emergencyContact"`
	BikeType           string `json:"bikeType"`
	AbilityConfirmed   bool   `json:"abilityConfirmed"`
	EquipmentConfirmed bool   `json:"equipmentConfirmed"`
	WaiverVersion      string `json:"waiverVersion"`
}

var phonePattern = regexp.MustCompile(`^1\d{10}$`)
var waiverPattern = regexp.MustCompile(`^v\d+(?:\.\d+)*$`)

func (a *API) register(c *gin.Context) {
	if !validID(c.Param("id")) {
		writeValidation(c)
		return
	}
	key := strings.TrimSpace(c.GetHeader("Idempotency-Key"))
	if len(key) < 8 || len(key) > 128 {
		writeError(c, domain.NewError("INVALID_IDEMPOTENCY_KEY", "Idempotency-Key 长度应为 8 至 128", 400))
		return
	}
	var input registrationInput
	if err := decodeJSON(c, &input, false); err != nil {
		writeDecodeError(c, err)
		return
	}
	if !validRegistrationInput(input) {
		writeValidation(c)
		return
	}
	phone, err := a.encryptor.Encrypt(strings.TrimSpace(input.Phone))
	if err != nil {
		writeError(c, err)
		return
	}
	emergency, err := a.encryptor.Encrypt(strings.TrimSpace(input.EmergencyContact))
	if err != nil {
		writeError(c, err)
		return
	}
	result, err := a.catalog.Register(c.Request.Context(), domain.RegisterCommand{
		EventID: c.Param("id"), UserID: userID(c), IdempotencyKey: key,
		AbilityConfirmed: input.AbilityConfirmed, EquipmentConfirmed: input.EquipmentConfirmed,
		WaiverVersion: strings.TrimSpace(input.WaiverVersion), PhoneEncrypted: phone,
		EmergencyContactEncrypted: emergency, BikeType: strings.TrimSpace(input.BikeType), Now: a.now(),
	})
	if err != nil {
		writeError(c, err)
		return
	}
	status := http.StatusCreated
	if result.Replayed {
		status = http.StatusOK
	}
	c.JSON(status, data(registrationResultResponse(result)))
}

func (a *API) cancelRegistration(c *gin.Context) {
	if !validID(c.Param("id")) {
		writeValidation(c)
		return
	}
	result, err := a.catalog.CancelRegistration(c.Request.Context(), c.Param("id"), userID(c))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, data(registrationResultResponse(result)))
}

func (a *API) registrationStatus(c *gin.Context) {
	if !validID(c.Param("id")) {
		writeValidation(c)
		return
	}
	registration, err := a.catalog.RegistrationStatus(c.Request.Context(), c.Param("id"), userID(c))
	if err != nil {
		writeError(c, err)
		return
	}
	if registration == nil {
		c.JSON(http.StatusOK, data(nil))
		return
	}
	c.JSON(http.StatusOK, data(registrationResponse(*registration)))
}

func (a *API) listMyRegistrations(c *gin.Context) {
	items, err := a.catalog.ListMyRegistrations(c.Request.Context(), userID(c))
	if err != nil {
		writeError(c, err)
		return
	}
	response := make([]any, len(items))
	for index, item := range items {
		response[index] = gin.H{"registration": registrationResponse(item.Registration), "event": eventResponse(item.Event)}
	}
	c.JSON(http.StatusOK, data(gin.H{"items": response}))
}

func decodeJSON(c *gin.Context, destination any, strict bool) error {
	decoder := json.NewDecoder(c.Request.Body)
	if strict {
		decoder.DisallowUnknownFields()
	}
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return fmt.Errorf("multiple JSON values")
	}
	return nil
}

func strictUnmarshal(source []byte, destination any) error {
	decoder := json.NewDecoder(bytes.NewReader(source))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return fmt.Errorf("multiple JSON values")
	}
	return nil
}

func readLimited(reader io.Reader, maximum int64) ([]byte, error) {
	buffer, err := io.ReadAll(io.LimitReader(reader, maximum+1))
	if err != nil {
		return nil, err
	}
	if int64(len(buffer)) > maximum {
		return nil, fmt.Errorf("body too large")
	}
	return buffer, nil
}

func detectImage(buffer []byte) (string, string) {
	if len(buffer) >= 3 && buffer[0] == 0xff && buffer[1] == 0xd8 && buffer[2] == 0xff {
		return "jpg", "image/jpeg"
	}
	png := []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}
	if len(buffer) >= len(png) && bytes.Equal(buffer[:len(png)], png) {
		return "png", "image/png"
	}
	if len(buffer) >= 12 && string(buffer[:4]) == "RIFF" && string(buffer[8:12]) == "WEBP" {
		return "webp", "image/webp"
	}
	return "", ""
}

func firstForwarded(value string) string {
	return strings.TrimSpace(strings.Split(value, ",")[0])
}

func parseLimit(raw string) (int, bool) {
	if raw == "" {
		return 20, true
	}
	value, err := strconv.Atoi(raw)
	return value, err == nil && value >= 1 && value <= 100
}

func validID(value string) bool {
	length := len(strings.TrimSpace(value))
	return length >= 1 && length <= 100
}

func validDifficulty(value domain.Difficulty) bool {
	return value == domain.DifficultyEasy || value == domain.DifficultyModerate || value == domain.DifficultyChallenging || value == domain.DifficultyExpert
}

func validGPXMetadata(metadata service.GPXMetadata) bool {
	if metadata.Name != "" && (len([]rune(strings.TrimSpace(metadata.Name))) < 1 || len([]rune(strings.TrimSpace(metadata.Name))) > 100) {
		return false
	}
	if metadata.Description != "" && (len([]rune(strings.TrimSpace(metadata.Description))) < 2 || len([]rune(strings.TrimSpace(metadata.Description))) > 1000) {
		return false
	}
	if metadata.Region != "" && (len([]rune(strings.TrimSpace(metadata.Region))) < 1 || len([]rune(strings.TrimSpace(metadata.Region))) > 100) {
		return false
	}
	return metadata.Difficulty == "" || validDifficulty(metadata.Difficulty)
}

func metadataFromForm(form *multipart.Form) service.GPXMetadata {
	if form == nil {
		return service.GPXMetadata{}
	}
	first := func(name string) string {
		values := form.Value[name]
		if len(values) == 0 {
			return ""
		}
		return values[0]
	}
	return service.GPXMetadata{Name: first("name"), Description: first("description"), Region: first("region"), Difficulty: domain.Difficulty(first("difficulty"))}
}

func validRegistrationInput(input registrationInput) bool {
	emergencyLength := len([]rune(strings.TrimSpace(input.EmergencyContact)))
	bikeLength := len([]rune(strings.TrimSpace(input.BikeType)))
	waiver := strings.TrimSpace(input.WaiverVersion)
	return phonePattern.MatchString(strings.TrimSpace(input.Phone)) && emergencyLength >= 4 && emergencyLength <= 100 &&
		bikeLength >= 2 && bikeLength <= 30 && input.AbilityConfirmed && input.EquipmentConfirmed && len(waiver) <= 30 && waiverPattern.MatchString(waiver)
}

func data(value any) gin.H { return gin.H{"data": value} }

func writeValidation(c *gin.Context) {
	writeError(c, &domain.Error{Code: "VALIDATION_ERROR", Message: "请求参数不合法", StatusCode: 400, Details: gin.H{"formErrors": []string{}, "fieldErrors": gin.H{}}})
}

func writeDecodeError(c *gin.Context, err error) {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		writeError(c, domain.NewError("PAYLOAD_TOO_LARGE", "请求内容过大", 413))
		return
	}
	writeValidation(c)
}

func writeError(c *gin.Context, err error) {
	var domainError *domain.Error
	if errors.As(err, &domainError) {
		details := domainError.Details
		if details == nil {
			details = nil
		}
		c.JSON(domainError.StatusCode, gin.H{"error": gin.H{"code": domainError.Code, "message": domainError.Message, "details": details}})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_ERROR", "message": "服务器内部错误", "details": nil}})
}

type loginWindow struct {
	count   int
	started time.Time
}
type loginLimiter struct {
	mu          sync.Mutex
	attempts    map[string]loginWindow
	lastCleanup time.Time
}

func newLoginLimiter() *loginLimiter { return &loginLimiter{attempts: make(map[string]loginWindow)} }
func (l *loginLimiter) Check(key string, now time.Time) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.lastCleanup.IsZero() || now.Sub(l.lastCleanup) >= time.Minute {
		for candidate, candidateWindow := range l.attempts {
			if now.Sub(candidateWindow.started) >= time.Minute {
				delete(l.attempts, candidate)
			}
		}
		l.lastCleanup = now
	}
	window, exists := l.attempts[key]
	if !exists || now.Sub(window.started) >= time.Minute {
		if len(l.attempts) >= 10_000 {
			return domain.NewError("RATE_LIMITED", "登录请求过于频繁", 429)
		}
		l.attempts[key] = loginWindow{count: 1, started: now}
		return nil
	}
	if window.count >= 20 {
		return domain.NewError("RATE_LIMITED", "登录请求过于频繁", 429)
	}
	window.count++
	l.attempts[key] = window
	return nil
}
