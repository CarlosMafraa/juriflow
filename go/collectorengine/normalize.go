package collectorengine

import "time"

// toIso é o port da função interna `toIso` de
// packages/movement-normalizer/src/normalize.ts:
//
//	function toIso(value: string | null): string | null {
//	  if (!value) return null;
//	  const d = new Date(value);
//	  return Number.isNaN(d.getTime()) ? null : d.toISOString();
//	}
//
// Devolve a forma CANÔNICA de toISOString() do JS ("AAAA-MM-DDTHH:mm:ss.sssZ",
// sempre UTC, sempre com 3 casas de milissegundo), ou nil se ausente/inválido.
// Escopo de formatos aceitos igual ao de IsoDay (ver text.go): apenas o que
// um adapter que já emite ISO ou o próprio toISOString() produzem — não a
// leniência geral de `new Date()`.
func toIso(value string) *string {
	if value == "" {
		return nil
	}
	t, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return nil
	}
	s := t.UTC().Format("2006-01-02T15:04:05.000Z07:00")
	return &s
}

// readHint é o port da função interna `readHint` de normalize.ts: lê
// movementCode/movementLabel de `raw` SE `raw` for um objeto E os campos
// forem strings; caso contrário devolve nil para cada um.
func readHint(raw any) (code *string, label *string) {
	m, ok := raw.(map[string]any)
	if !ok {
		return nil, nil
	}
	if s, ok := m["movementCode"].(string); ok {
		code = &s
	}
	if s, ok := m["movementLabel"].(string); ok {
		label = &s
	}
	return code, label
}

// NormalizeMovement é o port de `normalizeMovement` (normalize.ts): converte
// uma RawMovement na CanonicalMovement do JuriFlow. Puro. Não faz I/O.
//
// Preserva EXATAMENTE a composição do content_hash do TS:
//
//	sha256Hex([
//	  isoDay(occurredAt),                       // occurredAt já é o toIso()
//	  category?.code ?? normalizeForHash(hint.label ?? description),
//	  normalizeForHash(description),
//	  raw.sourceMovementId ?? '',
//	  ctx.sourceKind,
//	])
func NormalizeMovement(raw RawMovement, ctx NormalizeContext) CanonicalMovement {
	occurredAt := toIso(ptrOrEmpty(raw.OccurredAt))
	description := NormalizeDescription(raw.Description)

	hintCode, hintLabel := readHint(raw.Raw)

	// resolveCategory({ code: hint.code, label: hint.label ?? description })
	hintLabelOrDesc := description
	if hintLabel != nil {
		hintLabelOrDesc = *hintLabel
	}
	var category *ResolvedCategory
	if ctx.ResolveCategory != nil {
		category = ctx.ResolveCategory(CategoryHint{Code: hintCode, Label: &hintLabelOrDesc})
	}

	// categoryKey = category?.code ?? normalizeForHash(hint.label ?? description)
	var categoryKey string
	if category != nil {
		categoryKey = category.Code
	} else {
		categoryKey = NormalizeForHash(hintLabelOrDesc)
	}

	contentHash := Sha256Hex([]string{
		IsoDay(ptrOrEmpty(occurredAt)),
		categoryKey,
		NormalizeForHash(description),
		ptrOrEmpty(raw.SourceMovementID),
		ctx.SourceKind,
	})

	// categoryCode = category?.code ?? null
	// categoryLabel = category?.label ?? hint.label ?? null
	var categoryCode, categoryLabel *string
	if category != nil {
		c, l := category.Code, category.Label
		categoryCode = &c
		categoryLabel = &l
	} else if hintLabel != nil {
		categoryLabel = hintLabel
	}

	return CanonicalMovement{
		SourceKind:       ctx.SourceKind,
		SourceMovementID: raw.SourceMovementID,
		OccurredAt:       occurredAt,
		CategoryCode:     categoryCode,
		CategoryLabel:    categoryLabel,
		Description:      description,
		Raw:              raw.Raw,
		ContentHash:      contentHash,
		NeedsReview:      occurredAt == nil || category == nil,
	}
}

// ptrOrEmpty devolve "" para nil, senão o valor apontado — o equivalente Go
// dos vários `x ?? ”` do TS quando a semântica falsy só distingue null/"".
func ptrOrEmpty(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
