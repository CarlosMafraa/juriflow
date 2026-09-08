package worker

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// pgConn é a fatia mínima de *pgxpool.Pool que o PgxRepository usa. Existe só
// para o teste conseguir observar o SQL e os argumentos enviados às RPCs — não
// é uma abstração de banco. *pgxpool.Pool a satisfaz diretamente.
type pgConn interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Close()
}

// PgxRepository é a implementação real de Repository sobre PostgreSQL/Supabase,
// via pgx/v5. Só chama as três RPCs SECURITY DEFINER da Acompanhamento-A
// (migration 0021) — nenhuma query direta a tabela de domínio, nenhum
// INSERT/UPDATE/DELETE. Toda a persistência de domínio acontece dentro das
// próprias RPCs.
type PgxRepository struct {
	db pgConn
}

// NewPgxRepository abre o pool de conexões. A string de conexão nunca é logada.
func NewPgxRepository(ctx context.Context, databaseURL string) (*PgxRepository, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("abrindo pool PostgreSQL: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping PostgreSQL: %w", err)
	}
	return &PgxRepository{db: pool}, nil
}

// Close libera o pool.
func (r *PgxRepository) Close() {
	r.db.Close()
}

// SQL das três RPCs — exportado a nível de pacote para os testes afirmarem o
// texto exato enviado.
const (
	sqlClaim         = "select public.claim_pending_collection_run()"
	sqlSubmitResult  = "select public.submit_collection_result($1::uuid, $2::jsonb)"
	sqlSubmitFailure = "select public.submit_collection_failure($1::uuid, $2::jsonb)"
)

// Claim chama public.claim_pending_collection_run(). A RPC devolve SQL NULL
// quando não há trabalho → (nil, nil). Caso contrário, decodifica o jsonb no
// ClaimData e devolve.
func (r *PgxRepository) Claim(ctx context.Context) (*ClaimData, error) {
	var raw []byte
	if err := r.db.QueryRow(ctx, sqlClaim).Scan(&raw); err != nil {
		return nil, fmt.Errorf("claim_pending_collection_run: %w", err)
	}
	if raw == nil {
		return nil, nil // sem trabalho — não é erro
	}

	var cd ClaimData
	if err := json.Unmarshal(raw, &cd); err != nil {
		return nil, fmt.Errorf("claim: JSON de resposta inválido: %w", err)
	}
	if cd.RunID == "" {
		return nil, fmt.Errorf("claim: resposta sem run_id")
	}
	return &cd, nil
}

// SubmitResult chama public.submit_collection_result(p_run_id uuid, p_result jsonb).
// O payload é o RunCollectionOutcome já pronto — o repositório não recalcula
// nada, apenas serializa.
func (r *PgxRepository) SubmitResult(ctx context.Context, runID string, payload ResultPayload) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("serializando p_result: %w", err)
	}
	if _, err := r.db.Exec(ctx, sqlSubmitResult, runID, string(body)); err != nil {
		return fmt.Errorf("submit_collection_result: %w", err)
	}
	return nil
}

// SubmitFailure chama public.submit_collection_failure(p_run_id uuid, p_error jsonb).
func (r *PgxRepository) SubmitFailure(ctx context.Context, runID string, payload FailurePayload) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("serializando p_error: %w", err)
	}
	if _, err := r.db.Exec(ctx, sqlSubmitFailure, runID, string(body)); err != nil {
		return fmt.Errorf("submit_collection_failure: %w", err)
	}
	return nil
}
