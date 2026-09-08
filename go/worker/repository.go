package worker

import (
	"context"

	"juriflow/collectorengine"
)

// KnownMovementRow é um item do array `known` devolvido pelo claim
// (jsonb_build_object('content_hash', ..., 'source_movement_id', ...)).
type KnownMovementRow struct {
	ContentHash      string  `json:"content_hash"`
	SourceMovementID *string `json:"source_movement_id"`
}

// ClaimData é a forma Go do JSON devolvido por
// public.claim_pending_collection_run() (migration 0021). Os nomes vêm
// EXATAMENTE do jsonb_build_object da RPC — nada é inventado.
type ClaimData struct {
	RunID           string             `json:"run_id"`
	ProcessID       string             `json:"process_id"`
	SpaceID         string             `json:"space_id"`
	SourceKind      string             `json:"source_kind"`
	Trigger         string             `json:"trigger"`
	Attempt         int                `json:"attempt"`
	CNJNumber       *string            `json:"cnj_number"`
	CourtID         string             `json:"court_id"`
	SourceParams    map[string]any     `json:"source_params"`
	IsFirstSync     bool               `json:"is_first_sync"`
	Since           *string            `json:"since"`
	StateHashBefore *string            `json:"state_hash_before"`
	Known           []KnownMovementRow `json:"known"`
}

// ResultPayload é o `p_result` de public.submit_collection_result(uuid, jsonb).
// As chaves são as que a RPC lê + as que o caller TS já existente
// (packages/adapter-datajud/src/runtime.ts) envia. `movements`/`events` são os
// próprios MovementRecord/EventRecord do Collector Engine, sem reformatação.
type ResultPayload struct {
	Status             string                           `json:"status"`
	CollectedAt        string                           `json:"collected_at"`
	RawPayload         any                              `json:"raw_payload"`
	Movements          []collectorengine.MovementRecord `json:"movements"`
	Events             []collectorengine.EventRecord    `json:"events"`
	StateHash          string                           `json:"state_hash"`
	FirstSyncCompleted bool                             `json:"first_sync_completed"`
	Counts             collectorengine.RunCounts        `json:"counts"`
}

// FailurePayload é o `p_error` de public.submit_collection_failure(uuid, jsonb).
// `http_status` é *int e serializa como `null` quando ausente (paridade com o
// `err.httpStatus ?? null` do runtime.ts).
type FailurePayload struct {
	ErrorCode    string `json:"error_code"`
	ErrorMessage string `json:"error_message"`
	HTTPStatus   *int   `json:"http_status"`
	Retriable    bool   `json:"retriable"`
}

// Repository é o contrato mínimo de persistência do Worker: SÓ as três RPCs de
// runtime da Acompanhamento-A. Não é uma abstração genérica de banco.
//
// Toda escrita no domínio (process_movements, process_change_events,
// process_tracking_state, collection_runs) acontece DENTRO dessas RPCs
// SECURITY DEFINER — o Worker nunca faz INSERT/UPDATE direto nessas tabelas.
type Repository interface {
	// Claim reclama a próxima collection_run pendente
	// (public.claim_pending_collection_run()).
	//
	// Devolve (nil, nil) quando não há trabalho — isso NÃO é erro.
	// Devolve (nil, err) para erro de infraestrutura (conexão, JSON inválido).
	Claim(ctx context.Context) (*ClaimData, error)

	// SubmitResult persiste um resultado success/partial
	// (public.submit_collection_result(runID, payload)).
	SubmitResult(ctx context.Context, runID string, payload ResultPayload) error

	// SubmitFailure persiste uma falha classificada
	// (public.submit_collection_failure(runID, payload)).
	SubmitFailure(ctx context.Context, runID string, payload FailurePayload) error
}
