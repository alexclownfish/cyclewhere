package security

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"strings"
)

const encryptedFieldVersion = "v1"

type FieldEncryptor struct {
	aead cipher.AEAD
	rand io.Reader
}

func NewFieldEncryptor(secret string) (*FieldEncryptor, error) {
	if len(secret) < 32 {
		return nil, fmt.Errorf("FIELD_ENCRYPTION_KEY must contain at least 32 characters")
	}
	key := sha256.Sum256([]byte(secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, fmt.Errorf("create field cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create field AEAD: %w", err)
	}
	return &FieldEncryptor{aead: aead, rand: rand.Reader}, nil
}

func (e *FieldEncryptor) Encrypt(value string) (string, error) {
	iv := make([]byte, e.aead.NonceSize())
	if _, err := io.ReadFull(e.rand, iv); err != nil {
		return "", fmt.Errorf("generate field nonce: %w", err)
	}
	sealed := e.aead.Seal(nil, iv, []byte(value), nil)
	tagStart := len(sealed) - e.aead.Overhead()
	ciphertext, tag := sealed[:tagStart], sealed[tagStart:]
	encode := base64.RawURLEncoding.EncodeToString
	return strings.Join([]string{encryptedFieldVersion, encode(iv), encode(tag), encode(ciphertext)}, "."), nil
}

func (e *FieldEncryptor) Decrypt(payload string) (string, error) {
	parts := strings.Split(payload, ".")
	if len(parts) != 4 || parts[0] != encryptedFieldVersion || parts[1] == "" || parts[2] == "" || parts[3] == "" {
		return "", fmt.Errorf("invalid encrypted field")
	}
	decode := base64.RawURLEncoding.DecodeString
	iv, err := decode(parts[1])
	if err != nil || len(iv) != e.aead.NonceSize() {
		return "", fmt.Errorf("invalid encrypted field")
	}
	tag, err := decode(parts[2])
	if err != nil || len(tag) != e.aead.Overhead() {
		return "", fmt.Errorf("invalid encrypted field")
	}
	ciphertext, err := decode(parts[3])
	if err != nil {
		return "", fmt.Errorf("invalid encrypted field")
	}
	sealed := append(append(make([]byte, 0, len(ciphertext)+len(tag)), ciphertext...), tag...)
	plaintext, err := e.aead.Open(nil, iv, sealed, nil)
	if err != nil {
		return "", fmt.Errorf("invalid encrypted field")
	}
	return string(plaintext), nil
}
