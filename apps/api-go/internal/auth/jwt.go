package auth

import (
	"fmt"
	"strings"
	"time"

	"cyclewhere/api-go/internal/domain"
	"github.com/golang-jwt/jwt/v5"
)

const (
	IssuerName        = "fengji-api"
	AudienceName      = "fengji-miniprogram"
	TokenExpiresInSec = 7 * 24 * 60 * 60
)

type User struct {
	ID string `json:"id"`
}

type tokenClaims struct {
	jwt.RegisteredClaims
}

type Issuer struct {
	secret []byte
	now    func() time.Time
}

func NewIssuer(secret string) (*Issuer, error) {
	return newIssuer(secret, time.Now)
}

func newIssuer(secret string, now func() time.Time) (*Issuer, error) {
	if len(secret) < 32 {
		return nil, fmt.Errorf("JWT_SECRET must contain at least 32 characters")
	}
	return &Issuer{secret: []byte(secret), now: now}, nil
}

func (i *Issuer) Issue(userID string) (string, error) {
	now := i.now()
	claims := tokenClaims{RegisteredClaims: jwt.RegisteredClaims{
		Issuer:    IssuerName,
		Subject:   userID,
		Audience:  jwt.ClaimStrings{AudienceName},
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(TokenExpiresInSec * time.Second)),
	}}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(i.secret)
}

type Verifier struct {
	secret []byte
	now    func() time.Time
}

func NewVerifier(secret string) (*Verifier, error) {
	return newVerifier(secret, time.Now)
}

func newVerifier(secret string, now func() time.Time) (*Verifier, error) {
	if len(secret) < 32 {
		return nil, fmt.Errorf("JWT_SECRET must contain at least 32 characters")
	}
	return &Verifier{secret: []byte(secret), now: now}, nil
}

func (v *Verifier) Verify(authorization string) (User, error) {
	parts := strings.Fields(authorization)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
		return User{}, domain.NewError("UNAUTHORIZED", "缺少有效的 Bearer token", 401)
	}

	claims := &tokenClaims{}
	token, err := jwt.ParseWithClaims(parts[1], claims, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return v.secret, nil
	},
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer(IssuerName),
		jwt.WithAudience(AudienceName),
		jwt.WithExpirationRequired(),
		jwt.WithTimeFunc(v.now),
	)
	if err != nil || !token.Valid || claims.Subject == "" || len(claims.Subject) > 100 {
		return User{}, domain.NewError("UNAUTHORIZED", "登录凭证无效或已过期", 401)
	}
	return User{ID: claims.Subject}, nil
}
