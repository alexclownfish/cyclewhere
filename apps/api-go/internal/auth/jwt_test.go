package auth

import (
	"errors"
	"testing"
	"time"

	"cyclewhere/api-go/internal/domain"
	"github.com/golang-jwt/jwt/v5"
)

const testJWTSecret = "jwt-secret-with-at-least-thirty-two-characters"

func TestIssuerAndVerifierRoundTrip(t *testing.T) {
	now := time.Date(2026, 8, 7, 12, 0, 0, 0, time.UTC)
	issuer, err := newIssuer(testJWTSecret, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	token, err := issuer.Issue("9758e4bb-6ed6-5a5f-b94f-4bb9cc6f14d6")
	if err != nil {
		t.Fatal(err)
	}

	claims := &tokenClaims{}
	parsed, err := jwt.ParseWithClaims(token, claims, func(*jwt.Token) (any, error) {
		return []byte(testJWTSecret), nil
	}, jwt.WithIssuer(IssuerName), jwt.WithAudience(AudienceName), jwt.WithTimeFunc(func() time.Time { return now }))
	if err != nil || !parsed.Valid {
		t.Fatalf("token did not satisfy compatibility claims: %v", err)
	}
	if claims.Subject != "9758e4bb-6ed6-5a5f-b94f-4bb9cc6f14d6" {
		t.Fatalf("subject = %q", claims.Subject)
	}
	if got := claims.ExpiresAt.Time.Sub(claims.IssuedAt.Time); got != TokenExpiresInSec*time.Second {
		t.Fatalf("token lifetime = %v", got)
	}

	verifier, err := newVerifier(testJWTSecret, func() time.Time { return now.Add(time.Minute) })
	if err != nil {
		t.Fatal(err)
	}
	user, err := verifier.Verify("bearer " + token)
	if err != nil || user.ID != claims.Subject {
		t.Fatalf("Verify() = %+v, %v", user, err)
	}
}

func TestVerifierRejectsInvalidAuthorization(t *testing.T) {
	now := time.Date(2026, 8, 7, 12, 0, 0, 0, time.UTC)
	issuer, _ := newIssuer(testJWTSecret, func() time.Time { return now })
	token, _ := issuer.Issue("user-id")
	verifier, _ := newVerifier(testJWTSecret, func() time.Time { return now.Add(8 * 24 * time.Hour) })

	for _, authorization := range []string{"", "Basic " + token, "Bearer broken", "Bearer " + token} {
		_, err := verifier.Verify(authorization)
		var domainErr *domain.Error
		if !errors.As(err, &domainErr) || domainErr.Code != "UNAUTHORIZED" || domainErr.StatusCode != 401 {
			t.Fatalf("Verify(%q) error = %#v", authorization, err)
		}
	}
}

func TestJWTSecretLength(t *testing.T) {
	if _, err := NewIssuer("short"); err == nil {
		t.Fatal("NewIssuer accepted a short secret")
	}
	if _, err := NewVerifier("short"); err == nil {
		t.Fatal("NewVerifier accepted a short secret")
	}
}
