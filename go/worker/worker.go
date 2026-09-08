package worker

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"juriflow/collectorengine"
)

// Worker orquestra um ciclo claim → dispatch → engine → submit. Não guarda a
// DATABASE_URL nem qualquer segredo.
type Worker struct {
	repo            Repository
	registry        *collectorengine.SourceRegistry
	resolveCategory collectorengine.CategoryResolver
	pollInterval    time.Duration
	logger          *slog.Logger
	now             func() time.Time
}

// NewWorker monta o Worker. `resolveCategory` nil vira um resolvedor que não
// resolve nada (needs_review alto) — a resolução real (consulta a
// movement_categories) será ligada quando o primeiro adapter de produção
// existir. `logger` nil usa slog.Default().
func NewWorker(
	repo Repository,
	registry *collectorengine.SourceRegistry,
	resolveCategory collectorengine.CategoryResolver,
	pollInterval time.Duration,
	logger *slog.Logger,
) *Worker {
	if resolveCategory == nil {
		resolveCategory = func(collectorengine.CategoryHint) *collectorengine.ResolvedCategory { return nil }
	}
	if logger == nil {
		logger = slog.Default()
	}
	if pollInterval <= 0 {
		pollInterval = defaultPollInterval
	}
	return &Worker{
		repo:            repo,
		registry:        registry,
		resolveCategory: resolveCategory,
		pollInterval:    pollInterval,
		logger:          logger,
		now:             time.Now,
	}
}

// Run é o loop de polling. Serial: UMA coleta por vez, sem pool de goroutines.
// Enquanto um poll encontrar trabalho, o próximo poll acontece imediatamente
// (drena a fila); quando não há trabalho, espera pollInterval. Encerra quando
// ctx é cancelado.
func (w *Worker) Run(ctx context.Context) error {
	w.logger.Info("worker iniciado", "poll_interval", w.pollInterval.String())

	for {
		if ctx.Err() != nil {
			w.logger.Info("worker encerrado", "reason", ctx.Err())
			return ctx.Err()
		}

		worked, err := w.RunOnce(ctx)
		if err != nil {
			// Erro de infraestrutura pontual: registra e continua o loop (o
			// próximo poll tenta de novo). Não aborta o Worker.
			w.logger.Error("ciclo falhou", "error", err)
		}
		if worked {
			continue // pode haver mais trabalho — próximo poll já
		}

		select {
		case <-ctx.Done():
			w.logger.Info("worker encerrado", "reason", ctx.Err())
			return ctx.Err()
		case <-time.After(w.pollInterval):
		}
	}
}

// RunOnce executa no máximo UM ciclo.
//
// Retorno:
//   - (false, nil)  → não havia trabalho neste poll (não é erro);
//   - (true,  nil)  → uma collection_run foi processada e submetida
//     (independente de o resultado ter sido success/partial/failed);
//   - (true,  err)  → a run foi reclamada mas o SUBMIT falhou (erro de infra);
//   - (false, err)  → o CLAIM falhou (erro de infra); nenhuma run foi
//     reclamada, então nada é submetido (regra 11).
func (w *Worker) RunOnce(ctx context.Context) (bool, error) {
	claim, err := w.repo.Claim(ctx)
	if err != nil {
		return false, fmt.Errorf("claim: %w", err)
	}
	if claim == nil {
		return false, nil
	}

	log := w.logger.With(
		"collection_run_id", claim.RunID,
		"source_kind", claim.SourceKind,
		"trigger", claim.Trigger,
		"attempt", claim.Attempt,
	)
	start := w.now()
	log.Info("coleta iniciada")

	status, submitErr := w.process(ctx, claim, log)
	durMS := w.now().Sub(start).Milliseconds()

	if submitErr != nil {
		// A run foi reclamada (está 'running' no banco) mas o submit falhou.
		// NÃO tenta submeter de novo nem cascatear — a run fica 'running' e o
		// reaper (etapa futura) cuidará dela.
		log.Error("submit falhou", "error", submitErr, "duration_ms", durMS)
		return true, fmt.Errorf("submit da run %s: %w", claim.RunID, submitErr)
	}

	log.Info("coleta concluída", "status", status, "duration_ms", durMS)
	return true, nil
}

// process resolve o adapter, roda o Collector Engine e submete o resultado ou a
// falha. Devolve o status submetido e um erro SÓ se o submit em si falhou.
func (w *Worker) process(ctx context.Context, claim *ClaimData, log *slog.Logger) (string, error) {
	target := collectorengine.SourceTarget{
		CNJNumber: claim.CNJNumber,
		CourtID:   claim.CourtID,
		Params:    claim.SourceParams,
	}

	source, err := w.registry.Create(claim.SourceKind)
	if err != nil {
		// source_kind sem adapter registrado. Sem fallback, sem escolher outro
		// adapter, sem rodar RunCollection. Classificado pelo mesmo
		// collectorengine.ClassifyError que o engine usa: *SourceNotRegisteredError
		// → {code: "unknown", retriable: false}.
		log.Warn("source_kind sem adapter registrado", "error", err)
		return "failed", w.submitClassified(ctx, claim.RunID, collectorengine.ClassifyError(err))
	}

	if !source.CanHandle(target) {
		// Adapter existe mas não sabe atender este alvo. Mesma semântica de
		// registry.resolveFor no TS (que lança SourceNotRegisteredError nesse
		// caso) → classificação idêntica, sem criar código de banco novo.
		log.Warn("adapter não pode atender o alvo (CanHandle=false)")
		notReg := &collectorengine.SourceNotRegisteredError{Kind: claim.SourceKind}
		return "failed", w.submitClassified(ctx, claim.RunID, collectorengine.ClassifyError(notReg))
	}

	outcome := collectorengine.RunCollection(collectorengine.RunCollectionInput{
		Source:            source,
		Target:            target,
		Since:             w.parseSince(claim.Since, log),
		RequestID:         &claim.RunID,
		IsFirstSync:       claim.IsFirstSync,
		Known:             toKnown(claim.Known),
		PreviousStateHash: claim.StateHashBefore,
		SourceKind:        claim.SourceKind,
		ResolveCategory:   w.resolveCategory,
	})

	if outcome.Status == collectorengine.RunStatusFailed {
		e := outcome.Error // *ClassifiedErrorRecord — produzido pelo engine, não pelo Worker
		return "failed", w.repo.SubmitFailure(ctx, claim.RunID, FailurePayload{
			ErrorCode:    string(e.Code),
			ErrorMessage: e.Message,
			HTTPStatus:   e.HTTPStatus,
			Retriable:    e.Retriable,
		})
	}

	return string(outcome.Status), w.repo.SubmitResult(ctx, claim.RunID, ResultPayload{
		Status:             string(outcome.Status),
		CollectedAt:        outcome.CollectedAt,
		RawPayload:         outcome.RawPayload,
		Movements:          outcome.Movements,
		Events:             outcome.Events,
		StateHash:          outcome.StateHash,
		FirstSyncCompleted: outcome.FirstSyncCompleted,
		Counts:             outcome.Counts,
	})
}

func (w *Worker) submitClassified(ctx context.Context, runID string, c collectorengine.ClassifiedError) error {
	return w.repo.SubmitFailure(ctx, runID, FailurePayload{
		ErrorCode:    string(c.Code),
		ErrorMessage: c.Message,
		HTTPStatus:   c.HTTPStatus,
		Retriable:    c.Retriable,
	})
}

// parseSince converte o `since` ISO do claim em *time.Time. `since` é uma
// otimização opcional: se vier malformado (não deveria — o formato é do
// próprio banco), loga e segue com nil em vez de falhar a run inteira.
func (w *Worker) parseSince(since *string, log *slog.Logger) *time.Time {
	if since == nil || *since == "" {
		return nil
	}
	t, err := time.Parse(time.RFC3339, *since)
	if err != nil {
		log.Warn("since do claim é malformado — ignorando", "error", err)
		return nil
	}
	return &t
}

func toKnown(rows []KnownMovementRow) []collectorengine.KnownMovement {
	out := make([]collectorengine.KnownMovement, 0, len(rows))
	for _, r := range rows {
		out = append(out, collectorengine.KnownMovement{
			ContentHash:      r.ContentHash,
			SourceMovementID: r.SourceMovementID,
		})
	}
	return out
}
