package collectorengine

// Port de packages/movement-normalizer/src/detect.ts — detector de mudanças.
// Puro. Recebe o estado conhecido + a coleta atual e devolve o novo
// state_hash, as movimentações novas/alteradas e os eventos.

// TrackingEventType — port do union 'new_movement' | 'movement_amended' |
// 'first_sync_completed'.
type TrackingEventType string

const (
	EventNewMovement        TrackingEventType = "new_movement"
	EventMovementAmended    TrackingEventType = "movement_amended"
	EventFirstSyncCompleted TrackingEventType = "first_sync_completed"
)

// DetectedEvent — port de DetectedEvent. `Payload` é map[string]any porque o
// TS o tipa como Record<string, unknown>.
type DetectedEvent struct {
	EventType   TrackingEventType
	ContentHash *string
	OccurredAt  *string
	Payload     map[string]any
}

// AmendedMovement — port de AmendedMovement.
type AmendedMovement struct {
	Movement           CanonicalMovement
	RevisesContentHash string
}

// DetectInput — port de DetectInput.
type DetectInput struct {
	Canonical              []CanonicalMovement `json:"canonical"`
	Known                  []KnownMovement     `json:"known"`
	IsFirstSync            bool                `json:"isFirstSync"`
	AllowFirstSyncComplete bool                `json:"allowFirstSyncComplete"`
}

// DetectResult — port de DetectResult.
type DetectResult struct {
	StateHash          string
	NewMovements       []CanonicalMovement
	AmendedMovements   []AmendedMovement
	Events             []DetectedEvent
	FirstSyncCompleted bool
}

// eventPayload — port da função interna `eventPayload` de detect.ts:
//
//	{ category_code, category_label, description: m.description.slice(0, 280), source_kind }
//
// `description.slice(0, 280)` do JS conta unidades UTF-16; aqui usa-se
// truncamento por rune (code point), idêntico para todo o BMP — ou seja,
// para 100% do texto processual em português. Caracteres fora do BMP (raros)
// contariam como 1 rune aqui e 2 unidades UTF-16 no JS; caso limite conhecido
// e documentado, não exercido por nenhum vetor.
func eventPayload(m CanonicalMovement) map[string]any {
	return map[string]any{
		"category_code":  ptrToAny(m.CategoryCode),
		"category_label": ptrToAny(m.CategoryLabel),
		"description":    truncateRunes(m.Description, 280),
		"source_kind":    m.SourceKind,
	}
}

// DetectChanges — port de `detectChanges`. RN11: na 1ª sincronização não
// emite new_movement, apenas first_sync_completed (quando permitido).
func DetectChanges(input DetectInput) DetectResult {
	knownHashes := make(map[string]struct{}, len(input.Known))
	for _, k := range input.Known {
		knownHashes[k.ContentHash] = struct{}{}
	}

	// `for (const k of input.known) { if (k.sourceMovementId) ... }` — o `if`
	// é truthy: pula tanto null quanto "".
	knownBySourceID := make(map[string]string)
	for _, k := range input.Known {
		if k.SourceMovementID != nil && *k.SourceMovementID != "" {
			knownBySourceID[*k.SourceMovementID] = k.ContentHash
		}
	}

	// allHashes = [...knownHashes(Set), ...canonical.map(c => c.contentHash)];
	// stateHashOf deduplica e ordena internamente, então a ordem aqui é
	// irrelevante para o resultado.
	allHashes := make([]string, 0, len(knownHashes)+len(input.Canonical))
	for h := range knownHashes {
		allHashes = append(allHashes, h)
	}
	for _, c := range input.Canonical {
		allHashes = append(allHashes, c.ContentHash)
	}
	stateHash := StateHashOf(allHashes)

	newMovements := []CanonicalMovement{}
	amendedMovements := []AmendedMovement{}
	for _, c := range input.Canonical {
		if _, isKnown := knownHashes[c.ContentHash]; isKnown {
			continue
		}
		// `c.sourceMovementId != null ? knownBySourceId.get(...) : undefined`
		var priorHash string
		var hasPrior bool
		if c.SourceMovementID != nil {
			priorHash, hasPrior = knownBySourceID[*c.SourceMovementID]
		}
		if hasPrior && priorHash != c.ContentHash {
			amendedMovements = append(amendedMovements, AmendedMovement{
				Movement:           c,
				RevisesContentHash: priorHash,
			})
		} else {
			newMovements = append(newMovements, c)
		}
	}

	events := []DetectedEvent{}
	firstSyncCompleted := false

	if input.IsFirstSync {
		if input.AllowFirstSyncComplete {
			firstSyncCompleted = true
			// payload: { source_kind: canonical[0]?.sourceKind ?? null, movements: canonical.length }
			var sourceKind any
			if len(input.Canonical) > 0 {
				sourceKind = input.Canonical[0].SourceKind
			}
			events = append(events, DetectedEvent{
				EventType:   EventFirstSyncCompleted,
				ContentHash: nil,
				OccurredAt:  nil,
				Payload: map[string]any{
					"source_kind": sourceKind,
					"movements":   len(input.Canonical),
				},
			})
		}
	} else {
		for _, m := range newMovements {
			m := m
			events = append(events, DetectedEvent{
				EventType:   EventNewMovement,
				ContentHash: strPtr(m.ContentHash),
				OccurredAt:  m.OccurredAt,
				Payload:     eventPayload(m),
			})
		}
		for _, a := range amendedMovements {
			payload := eventPayload(a.Movement)
			payload["revises"] = a.RevisesContentHash
			events = append(events, DetectedEvent{
				EventType:   EventMovementAmended,
				ContentHash: strPtr(a.Movement.ContentHash),
				OccurredAt:  a.Movement.OccurredAt,
				Payload:     payload,
			})
		}
	}

	return DetectResult{
		StateHash:          stateHash,
		NewMovements:       newMovements,
		AmendedMovements:   amendedMovements,
		Events:             events,
		FirstSyncCompleted: firstSyncCompleted,
	}
}

// --- helpers pequenos ---

func strPtr(s string) *string { return &s }

// ptrToAny devolve nil (interface nil) para *string nil, ou o valor. Espelha
// como o JS coloca `null` num objeto quando o campo é null.
func ptrToAny(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}

func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}
