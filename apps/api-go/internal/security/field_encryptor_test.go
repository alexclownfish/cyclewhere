package security

import (
	"encoding/base64"
	"strings"
	"testing"
)

const testFieldSecret = "test-field-encryption-key-with-at-least-32-characters"

func TestFieldEncryptorRoundTripAndRandomNonce(t *testing.T) {
	encryptor, err := NewFieldEncryptor(testFieldSecret)
	if err != nil {
		t.Fatal(err)
	}
	first, err := encryptor.Encrypt("13800006721")
	if err != nil {
		t.Fatal(err)
	}
	second, err := encryptor.Encrypt("13800006721")
	if err != nil {
		t.Fatal(err)
	}
	if first == second || strings.Contains(first, "13800006721") {
		t.Fatalf("encryption is not randomized: %q, %q", first, second)
	}
	plain, err := encryptor.Decrypt(first)
	if err != nil || plain != "13800006721" {
		t.Fatalf("Decrypt() = %q, %v", plain, err)
	}
}

func TestFieldEncryptorDecryptsNodeCiphertext(t *testing.T) {
	encryptor, _ := NewFieldEncryptor(testFieldSecret)
	const nodePayload = "v1.ABEiM0RVZneImaq7.c5Ot65VXODYrsHGdQBn9HQ.LvCVElP5_6pfDYo"
	plain, err := encryptor.Decrypt(nodePayload)
	if err != nil || plain != "13800006721" {
		t.Fatalf("Decrypt(Node payload) = %q, %v", plain, err)
	}
}

func TestFieldEncryptorRejectsTamperingAndMalformedFields(t *testing.T) {
	encryptor, _ := NewFieldEncryptor(testFieldSecret)
	payload, _ := encryptor.Encrypt("13800006721")
	parts := strings.Split(payload, ".")
	ciphertext, _ := base64.RawURLEncoding.DecodeString(parts[3])
	ciphertext[0] ^= 1
	parts[3] = base64.RawURLEncoding.EncodeToString(ciphertext)
	if _, err := encryptor.Decrypt(strings.Join(parts, ".")); err == nil {
		t.Fatal("Decrypt accepted tampered ciphertext")
	}
	for _, malformed := range []string{"", "v2.a.b.c", "v1...", "v1.bad.bad.bad"} {
		if _, err := encryptor.Decrypt(malformed); err == nil {
			t.Fatalf("Decrypt(%q) succeeded", malformed)
		}
	}
}

func TestFieldEncryptionKeyLength(t *testing.T) {
	if _, err := NewFieldEncryptor("short"); err == nil {
		t.Fatal("NewFieldEncryptor accepted a short secret")
	}
}
