package collectorengine

import (
	"errors"
	"fmt"
)

// Port de packages/collector-engine/src/errors.ts + a parte de
// packages/collectors-core/src/errors.ts que `classifyError` observa.
//
// A identificação por `err.name === '...'` do TS vira `errors.As` sobre
// tipos concretos em Go (idiomático, conforme autorizado na etapa 3), sem
// alterar a classificação final.

// CollectionErrorCode — os únicos códigos permitidos (union fechado do TS).
type CollectionErrorCode string

const (
	CodeTimeout     CollectionErrorCode = "timeout"
	CodeUnavailable CollectionErrorCode = "unavailable"
	CodeRateLimited CollectionErrorCode = "rate_limited"
	CodeAuthFailed  CollectionErrorCode = "auth_failed"
	CodeParseError  CollectionErrorCode = "parse_error"
	CodeNotFound    CollectionErrorCode = "not_found"
	CodeUnknown     CollectionErrorCode = "unknown"
)

// ClassifiedError — port de ClassifiedError. HTTPStatus é *int para
// distinguir "ausente" (JS omite a chave) de zero.
type ClassifiedError struct {
	Code       CollectionErrorCode
	Message    string
	Retriable  bool
	HTTPStatus *int
}

// CollectionError — port da classe CollectionError. Implementa `error`.
type CollectionError struct {
	Code       CollectionErrorCode
	Message    string
	Retriable  bool
	HTTPStatus *int
}

func (e *CollectionError) Error() string { return e.Message }

func intPtr(n int) *int { return &n }

func defaultMessage(given []string, fallback string) string {
	if len(given) > 0 {
		return given[0]
	}
	return fallback
}

// Construtores espelhando os defaults das subclasses TS (mensagem e
// httpStatus padrão).

func NewCollectionTimeoutError(message ...string) *CollectionError {
	return &CollectionError{
		Code:      CodeTimeout,
		Message:   defaultMessage(message, "Tempo limite excedido ao consultar a fonte."),
		Retriable: true,
	}
}

func NewCollectionUnavailableError(message ...string) *CollectionError {
	return &CollectionError{
		Code:      CodeUnavailable,
		Message:   defaultMessage(message, "A fonte está indisponível."),
		Retriable: true,
	}
}

func NewCollectionRateLimitedError(message ...string) *CollectionError {
	return &CollectionError{
		Code:       CodeRateLimited,
		Message:    defaultMessage(message, "Limite de requisições da fonte atingido."),
		Retriable:  true,
		HTTPStatus: intPtr(429),
	}
}

func NewCollectionAuthError(message ...string) *CollectionError {
	return &CollectionError{
		Code:       CodeAuthFailed,
		Message:    defaultMessage(message, "Credenciais inválidas ou expiradas para a fonte."),
		Retriable:  false,
		HTTPStatus: intPtr(401),
	}
}

func NewCollectionParseError(message ...string) *CollectionError {
	return &CollectionError{
		Code:      CodeParseError,
		Message:   defaultMessage(message, "Não foi possível interpretar a resposta da fonte."),
		Retriable: false,
	}
}

func NewCollectionNotFoundError(message ...string) *CollectionError {
	return &CollectionError{
		Code:       CodeNotFound,
		Message:    defaultMessage(message, "Processo não encontrado na fonte."),
		Retriable:  false,
		HTTPStatus: intPtr(404),
	}
}

// SourceUnavailableError — port do tipo homônimo de collectors-core, apenas
// no formato que `classifyError` observa (mensagem + identidade). A camada
// Source Registry completa NÃO faz parte da etapa 3.
type SourceUnavailableError struct {
	Kind    string
	Message string
}

func (e *SourceUnavailableError) Error() string {
	return fmt.Sprintf("Fonte '%s' indisponível: %s", e.Kind, e.Message)
}

// SourceNotRegisteredError — idem.
type SourceNotRegisteredError struct {
	Kind string
}

func (e *SourceNotRegisteredError) Error() string {
	return fmt.Sprintf("Nenhuma fonte registrada para '%s'.", e.Kind)
}

// ClassifyError — port de `classifyError` (errors.ts). Normaliza qualquer
// erro numa ClassifiedError. Desconhecido = retriável (limitado).
func ClassifyError(err error) ClassifiedError {
	var ce *CollectionError
	if errors.As(err, &ce) {
		return ClassifiedError{
			Code:       ce.Code,
			Message:    ce.Message,
			Retriable:  ce.Retriable,
			HTTPStatus: ce.HTTPStatus,
		}
	}

	var sue *SourceUnavailableError
	if errors.As(err, &sue) {
		return ClassifiedError{Code: CodeUnavailable, Message: sue.Error(), Retriable: true}
	}

	var snre *SourceNotRegisteredError
	if errors.As(err, &snre) {
		return ClassifiedError{Code: CodeUnknown, Message: snre.Error(), Retriable: false}
	}

	// `const message = err?.message ?? String(err)` — em Go, todo error tem
	// Error(). Chamador nil não é um caminho real (idioma Go: checa err != nil
	// antes de classificar); ver TestClassifyErrorNilIsNotARealPath.
	message := ""
	if err != nil {
		message = err.Error()
	}
	return ClassifiedError{Code: CodeUnknown, Message: message, Retriable: true}
}
