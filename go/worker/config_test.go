package worker

import (
	"testing"
	"time"
)

func TestConfigFromEnvRequiresDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("POLL_INTERVAL", "")

	if _, err := ConfigFromEnv(); err == nil {
		t.Fatal("esperava erro quando DATABASE_URL não está definida")
	}
}

func TestConfigFromEnvDefaultPollInterval(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://u:p@localhost:5432/db")
	t.Setenv("POLL_INTERVAL", "")

	cfg, err := ConfigFromEnv()
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if cfg.PollInterval != defaultPollInterval {
		t.Fatalf("PollInterval = %v, esperado o default %v", cfg.PollInterval, defaultPollInterval)
	}
	if cfg.DatabaseURL != "postgres://u:p@localhost:5432/db" {
		t.Fatalf("DatabaseURL não repassada: %q", cfg.DatabaseURL)
	}
}

func TestConfigFromEnvValidPollInterval(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://u:p@localhost:5432/db")
	t.Setenv("POLL_INTERVAL", "250ms")

	cfg, err := ConfigFromEnv()
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if cfg.PollInterval != 250*time.Millisecond {
		t.Fatalf("PollInterval = %v, esperado 250ms", cfg.PollInterval)
	}
}

func TestConfigFromEnvRejectsMalformedPollInterval(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://u:p@localhost:5432/db")
	t.Setenv("POLL_INTERVAL", "banana")

	if _, err := ConfigFromEnv(); err == nil {
		t.Fatal("esperava erro para POLL_INTERVAL malformado")
	}
}

func TestConfigFromEnvRejectsNonPositivePollInterval(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://u:p@localhost:5432/db")
	t.Setenv("POLL_INTERVAL", "-5s")

	if _, err := ConfigFromEnv(); err == nil {
		t.Fatal("esperava erro para POLL_INTERVAL não positivo")
	}
}
