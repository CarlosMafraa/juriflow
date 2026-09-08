// Command worker é o binário do Worker de coleta do JuriFlow.
//
// Composição (nenhuma lógica aqui): lê config do ambiente, abre o pool
// PostgreSQL, monta um SourceRegistry vazio (nenhum adapter de produção nesta
// etapa) e roda o loop serial de polling.
//
// Nenhum adapter registrado ⇒ toda collection_run reclamada resulta em
// submit_collection_failure classificada como 'unknown'/não-retriável — é o
// comportamento esperado até o primeiro adapter real ser ligado.
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"juriflow/collectorengine"
	"juriflow/worker"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))

	cfg, err := worker.ConfigFromEnv()
	if err != nil {
		logger.Error("configuração inválida", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	repo, err := worker.NewPgxRepository(ctx, cfg.DatabaseURL)
	if err != nil {
		// A DATABASE_URL NÃO é incluída no log.
		logger.Error("falha ao conectar ao PostgreSQL", "error", err)
		os.Exit(1)
	}
	defer repo.Close()

	registry := collectorengine.NewSourceRegistry()

	// resolveCategory real (consulta a movement_categories) será ligado quando
	// o primeiro adapter de produção existir — até lá, nil (não resolve nada).
	w := worker.NewWorker(repo, registry, nil, cfg.PollInterval, logger)

	if err := w.Run(ctx); err != nil && ctx.Err() == nil {
		logger.Error("worker terminou com erro", "error", err)
		os.Exit(1)
	}
}
