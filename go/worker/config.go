// Package worker é o primeiro fluxo real do Worker de coleta do JuriFlow:
//
//	claim_pending_collection_run
//	      → resolver source_kind (SourceRegistry)
//	      → ProcessDataSource (via RunCollection)
//	      → collectorengine.RunCollection
//	      → submit_collection_result | submit_collection_failure
//
// O Worker é SÓ orquestração — nenhuma regra de negócio do Collector Engine
// (normalização, detecção, hash, classificação de erro) é reimplementada aqui.
//
// Fora do escopo desta etapa: TJAM/e-SAJ/PROJUDI, HTTP externo, Docker,
// retry/backoff/reaper, concorrência (pool de goroutines), MAX_CONCURRENT_CLAIMS.
package worker

import (
	"errors"
	"fmt"
	"os"
	"time"
)

// defaultPollInterval é usado quando POLL_INTERVAL não é definido.
const defaultPollInterval = 5 * time.Second

// Config é a configuração mínima do Worker, lida do ambiente.
//
// Variáveis de ambiente:
//   - DATABASE_URL  (obrigatória) — string de conexão PostgreSQL/Supabase.
//     NUNCA é logada.
//   - POLL_INTERVAL (opcional)    — intervalo ocioso entre polls sem trabalho,
//     no formato de time.ParseDuration (ex.: "5s", "500ms"). Default: 5s.
type Config struct {
	// DatabaseURL fica só na Config e é passada ao repositório na composição
	// (main). O struct Worker não a guarda, para não haver risco de log.
	DatabaseURL  string
	PollInterval time.Duration
}

// ConfigFromEnv lê a configuração do ambiente. Erra se DATABASE_URL faltar ou
// se POLL_INTERVAL for inválido.
func ConfigFromEnv() (Config, error) {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return Config{}, errors.New("DATABASE_URL não definida")
	}

	interval := defaultPollInterval
	if raw := os.Getenv("POLL_INTERVAL"); raw != "" {
		d, err := time.ParseDuration(raw)
		if err != nil {
			return Config{}, fmt.Errorf("POLL_INTERVAL inválido (%q): %w", raw, err)
		}
		if d <= 0 {
			return Config{}, fmt.Errorf("POLL_INTERVAL deve ser positivo, recebeu %q", raw)
		}
		interval = d
	}

	return Config{DatabaseURL: dbURL, PollInterval: interval}, nil
}
