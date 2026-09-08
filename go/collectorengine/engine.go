package collectorengine

import "time"

// Port de packages/collector-engine/src/engine.ts — `runCollection`.
//
// Núcleo da coleta. Depende apenas do contrato ProcessDataSource — nunca de
// um adapter concreto. Não faz I/O de banco: devolve o plano completo para
// as RPCs de persistência (submit_collection_result / submit_collection_failure).
// Orquestrador: reutiliza NormalizeMovement, DetectChanges e ClassifyError
// (etapas 2 e 3) sem duplicar nada.

// --- contrato mínimo de fonte (ProcessDataSource) — sem adapter real ---

// SourceTarget — port de SourceTarget (collectors-core/src/source.ts).
type SourceTarget struct {
	CNJNumber *string        `json:"cnjNumber"`
	CourtID   string         `json:"courtId"`
	Params    map[string]any `json:"params,omitempty"`
}

// SourceFetchInput — port de SourceFetchInput. `Since`/`RequestID` são
// opcionais; no TS o engine só os inclui no objeto quando presentes
// (`...(input.since ? { since } : {})`).
type SourceFetchInput struct {
	Target    SourceTarget
	Since     *time.Time
	RequestID *string
}

// SourceFetchResult — port de SourceFetchResult. `Partial` é *bool: nil =
// chave ausente (coleta completa), como o `partial?: boolean` do TS.
type SourceFetchResult struct {
	SourceKind  string        `json:"sourceKind"`
	CollectedAt string        `json:"collectedAt"`
	Movements   []RawMovement `json:"movements"`
	Partial     *bool         `json:"partial,omitempty"`
}

// ProcessDataSource — port da interface homônima. O SourceRegistry (resolução
// por source_kind, factory de adapters) NÃO faz parte desta etapa.
type ProcessDataSource interface {
	Kind() string
	CanHandle(target SourceTarget) bool
	Fetch(input SourceFetchInput) (SourceFetchResult, error)
}

// --- saída ---

type RunStatus string

const (
	RunStatusSuccess RunStatus = "success"
	RunStatusPartial RunStatus = "partial"
	RunStatusFailed  RunStatus = "failed"
)

// MovementRecord — port de MovementRecord (nomes em snake_case, prontos para
// submit_collection_result).
type MovementRecord struct {
	ContentHash        string  `json:"content_hash"`
	SourceMovementID   *string `json:"source_movement_id"`
	OccurredAt         *string `json:"occurred_at"`
	CategoryCode       *string `json:"category_code"`
	CategoryLabel      *string `json:"category_label"`
	Description        string  `json:"description"`
	Raw                any     `json:"raw"`
	NeedsReview        bool    `json:"needs_review"`
	IsFirstSync        bool    `json:"is_first_sync"`
	RevisesContentHash *string `json:"revises_content_hash"`
}

// EventRecord — port de EventRecord.
type EventRecord struct {
	EventType   TrackingEventType `json:"event_type"`
	ContentHash *string           `json:"content_hash"`
	OccurredAt  *string           `json:"occurred_at"`
	Payload     map[string]any    `json:"payload"`
}

// RunCounts — port de `counts: { fetched, new, updated }`.
type RunCounts struct {
	Fetched int `json:"fetched"`
	New     int `json:"new"`
	Updated int `json:"updated"`
}

// ClassifiedErrorRecord — a ClassifiedError na forma serializável do outcome
// (`httpStatus` omitido quando ausente, como o spread condicional do TS).
type ClassifiedErrorRecord struct {
	Code       CollectionErrorCode `json:"code"`
	Message    string              `json:"message"`
	Retriable  bool                `json:"retriable"`
	HTTPStatus *int                `json:"httpStatus,omitempty"`
}

// RunCollectionOutcome — port de RunCollectionOutcome. `Error` só aparece no
// caminho de falha (`omitempty` + ponteiro).
type RunCollectionOutcome struct {
	Status             RunStatus              `json:"status"`
	CollectedAt        string                 `json:"collectedAt"`
	RawPayload         any                    `json:"rawPayload"`
	Movements          []MovementRecord       `json:"movements"`
	Events             []EventRecord          `json:"events"`
	StateHash          string                 `json:"stateHash"`
	FirstSyncCompleted bool                   `json:"firstSyncCompleted"`
	Counts             RunCounts              `json:"counts"`
	Error              *ClassifiedErrorRecord `json:"error,omitempty"`
}

// RunCollectionInput — port de RunCollectionInput.
type RunCollectionInput struct {
	Source            ProcessDataSource
	Target            SourceTarget
	Since             *time.Time
	RequestID         *string
	IsFirstSync       bool
	Known             []KnownMovement
	PreviousStateHash *string
	SourceKind        string
	ResolveCategory   CategoryResolver
}

// nowISO reproduz `new Date().toISOString()` (UTC, milissegundos, sufixo Z).
func nowISO() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000Z07:00")
}

// RunCollection — port de `runCollection`. Preserva a sequência exata do TS:
// captura collectedAt, tenta fetch (classifica erro no catch), normaliza,
// detecta, monta MovementRecord/EventRecord e devolve o outcome.
func RunCollection(input RunCollectionInput) RunCollectionOutcome {
	collectedAt := nowISO()

	fetchInput := SourceFetchInput{Target: input.Target}
	if input.Since != nil {
		fetchInput.Since = input.Since
	}
	if input.RequestID != nil {
		fetchInput.RequestID = input.RequestID
	}

	result, err := input.Source.Fetch(fetchInput)
	if err != nil {
		// `catch (err) { return { status: 'failed', ..., stateHash: input.previousStateHash ?? '', error: classifyError(err) } }`
		stateHash := ""
		if input.PreviousStateHash != nil {
			stateHash = *input.PreviousStateHash
		}
		c := ClassifyError(err)
		return RunCollectionOutcome{
			Status:             RunStatusFailed,
			CollectedAt:        collectedAt,
			RawPayload:         nil,
			Movements:          []MovementRecord{},
			Events:             []EventRecord{},
			StateHash:          stateHash,
			FirstSyncCompleted: false,
			Counts:             RunCounts{Fetched: 0, New: 0, Updated: 0},
			Error: &ClassifiedErrorRecord{
				Code:       c.Code,
				Message:    c.Message,
				Retriable:  c.Retriable,
				HTTPStatus: c.HTTPStatus,
			},
		}
	}

	partial := result.Partial != nil && *result.Partial

	canonical := make([]CanonicalMovement, 0, len(result.Movements))
	for _, m := range result.Movements {
		canonical = append(canonical, NormalizeMovement(m, NormalizeContext{
			SourceKind:      input.SourceKind,
			ResolveCategory: input.ResolveCategory,
		}))
	}

	det := DetectChanges(DetectInput{
		Canonical:              canonical,
		Known:                  input.Known,
		IsFirstSync:            input.IsFirstSync,
		AllowFirstSyncComplete: !partial,
	})

	revisesByHash := make(map[string]string, len(det.AmendedMovements))
	for _, a := range det.AmendedMovements {
		revisesByHash[a.Movement.ContentHash] = a.RevisesContentHash
	}

	movements := make([]MovementRecord, 0, len(canonical))
	for _, c := range canonical {
		var revises *string
		if rh, ok := revisesByHash[c.ContentHash]; ok {
			rh := rh
			revises = &rh
		}
		movements = append(movements, MovementRecord{
			ContentHash:        c.ContentHash,
			SourceMovementID:   c.SourceMovementID,
			OccurredAt:         c.OccurredAt,
			CategoryCode:       c.CategoryCode,
			CategoryLabel:      c.CategoryLabel,
			Description:        c.Description,
			Raw:                c.Raw,
			NeedsReview:        c.NeedsReview,
			IsFirstSync:        input.IsFirstSync,
			RevisesContentHash: revises,
		})
	}

	events := make([]EventRecord, 0, len(det.Events))
	for _, e := range det.Events {
		events = append(events, EventRecord{
			EventType:   e.EventType,
			ContentHash: e.ContentHash,
			OccurredAt:  e.OccurredAt,
			Payload:     e.Payload,
		})
	}

	// `fetch.collectedAt ?? collectedAt` — em Go, string não é nullável;
	// o zero-value "" é o único análogo de "ausente", então o fallback usa
	// "". Equivalente para todo input real (adapters sempre preenchem
	// collectedAt) e para o propósito defensivo do `??` no TS.
	outCollectedAt := result.CollectedAt
	if outCollectedAt == "" {
		outCollectedAt = collectedAt
	}

	status := RunStatusSuccess
	if partial {
		status = RunStatusPartial
	}

	newCount := len(det.NewMovements)
	if input.IsFirstSync {
		newCount = len(canonical)
	}

	return RunCollectionOutcome{
		Status:             status,
		CollectedAt:        outCollectedAt,
		RawPayload:         result,
		Movements:          movements,
		Events:             events,
		StateHash:          det.StateHash,
		FirstSyncCompleted: det.FirstSyncCompleted,
		Counts: RunCounts{
			Fetched: len(canonical),
			New:     newCount,
			Updated: len(det.AmendedMovements),
		},
	}
}
