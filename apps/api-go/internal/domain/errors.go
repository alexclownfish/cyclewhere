package domain

import "fmt"

type Error struct {
	Code       string
	Message    string
	StatusCode int
	Details    any
}

func (e *Error) Error() string { return e.Message }

func NewError(code, message string, status int) *Error {
	return &Error{Code: code, Message: message, StatusCode: status}
}

func NotFound(resource string) *Error {
	return NewError("NOT_FOUND", fmt.Sprintf("%s不存在", resource), 404)
}

func Forbidden(message string) *Error { return NewError("FORBIDDEN", message, 403) }

func Conflict(code, message string) *Error { return NewError(code, message, 409) }

func InvalidState(message string) *Error { return NewError("INVALID_STATE", message, 409) }
