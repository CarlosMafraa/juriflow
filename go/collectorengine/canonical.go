package collectorengine

// Tipos canônicos — port de packages/movement-normalizer/src/canonical.ts.
//
// Regras de modelagem (Acompanhamento-G, etapa 3):
//   - `string | null` do TS vira *string em Go (nil = null; distinto de "").
//   - `unknown` (o campo `raw`) vira `any`, porque é literalmente isso no TS:
//     um payload opaco preservado sem interpretação.
//   - slices são sempre não-nil (`[]T{}`), como os arrays `[]` do TS.

// RawMovement é a movimentação como veio do adapter, ainda não normalizada.
// Port de RawMovement (packages/collectors-core/src/source.ts).
type RawMovement struct {
	SourceKind       string  `json:"sourceKind"`
	SourceMovementID *string `json:"sourceMovementId"`
	OccurredAt       *string `json:"occurredAt"`
	Description      string  `json:"description"`
	Raw              any     `json:"raw"`
}

// CanonicalMovement é a movimentação já normalizada para o modelo interno.
type CanonicalMovement struct {
	SourceKind       string  `json:"sourceKind"`
	SourceMovementID *string `json:"sourceMovementId"`
	// OccurredAt em ISO-8601, ou nil se a fonte não informou / valor inválido.
	OccurredAt    *string `json:"occurredAt"`
	CategoryCode  *string `json:"categoryCode"`
	CategoryLabel *string `json:"categoryLabel"`
	// Description já normalizada para exibição. O original fica em Raw.
	Description string `json:"description"`
	Raw         any    `json:"raw"`
	ContentHash string `json:"contentHash"`
	// NeedsReview é true quando falta data ou categoria.
	NeedsReview bool `json:"needsReview"`
}

// CategoryHint é o que se passa ao CategoryResolver. Os dois campos podem ser
// nil (o TS os tipa como `string | null | undefined`).
type CategoryHint struct {
	Code  *string
	Label *string
}

// ResolvedCategory é o retorno de sucesso do CategoryResolver — no TS,
// `{ code: string; label: string }` (ambos sempre presentes).
type ResolvedCategory struct {
	Code  string
	Label string
}

// CategoryResolver resolve uma dica de categoria numa categoria conhecida, ou
// nil quando não reconhece. A resolução real (consulta a movement_categories)
// vive fora deste pacote puro — aqui é injetada.
type CategoryResolver func(hint CategoryHint) *ResolvedCategory

// NormalizeContext são as dependências de NormalizeMovement.
type NormalizeContext struct {
	SourceKind      string
	ResolveCategory CategoryResolver
}

// KnownMovement é o par (content_hash, source_movement_id) de uma movimentação
// já conhecida — usado por DetectChanges.
type KnownMovement struct {
	ContentHash      string  `json:"contentHash"`
	SourceMovementID *string `json:"sourceMovementId"`
}
