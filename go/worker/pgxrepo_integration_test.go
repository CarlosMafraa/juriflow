package worker

import (
	"context"
	"log/slog"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"juriflow/collectorengine"
)

// Testes de integração REAIS contra um PostgreSQL/Supabase com as migrations
// 0001..0023 aplicadas. Rodam apenas quando JURIFLOW_TEST_DATABASE_URL está
// definida (ex.: postgresql://postgres:postgres@127.0.0.1:55322/postgres) —
// caso contrário, t.Skip. Exercitam o caminho:
//
//	Worker → PgxRepository → RPC (migration 0021) → PostgreSQL → retorno → Worker
//
// Conectam como `postgres` (superusuário) para o seed ignorar RLS; as RPCs em
// si são SECURITY DEFINER e independem do papel do chamador.

func itDSN(t *testing.T) string {
	t.Helper()
	dsn := os.Getenv("JURIFLOW_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("JURIFLOW_TEST_DATABASE_URL não definida — integração real não executada por ausência de ambiente PostgreSQL/Supabase disponível")
	}
	return dsn
}

func itPool(t *testing.T, dsn string) *pgxpool.Pool {
	t.Helper()
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// seedIDs são os identificadores criados pelo seed.
type seedIDs struct {
	userID, spaceID, courtID, processID, configID string
}

// resetAcomp limpa o grafo de acompanhamento + fixtures de teste.
//
// Várias tabelas do domínio são append-only / imutáveis por gatilho
// (process_movements, process_change_events, process_responsible_history).
// Para a limpeza de teste — e SÓ para ela — os gatilhos são suspensos com
// `set local session_replication_role = 'replica'` dentro de uma transação,
// que reverte o ajuste ao terminar. Nada disso toca o código sob teste nem
// as RPCs (que permanecem SECURITY DEFINER e com gatilhos ativos).
func resetAcomp(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("resetAcomp begin: %v", err)
	}
	defer tx.Rollback(ctx)

	stmts := []string{
		`set local session_replication_role = 'replica'`,
		`delete from public.collection_raw_payloads`,
		`delete from public.process_change_events`,
		`delete from public.process_movements`,
		`delete from public.collection_runs`,
		`delete from public.process_tracking_state`,
		`delete from public.process_tracking_configs`,
		`delete from public.process_responsible_history where process_id in (select id from public.processes where space_id in (select id from public.spaces where slug = 'wrk-it-space'))`,
		`delete from public.processes where space_id in (select id from public.spaces where slug = 'wrk-it-space')`,
		`delete from public.court_tracking_strategies where court_id in (select id from public.courts where name = 'WRK IT Court')`,
		`delete from public.space_members where space_id in (select id from public.spaces where slug = 'wrk-it-space')`,
		`delete from public.courts where name = 'WRK IT Court'`,
		`delete from public.spaces where slug = 'wrk-it-space'`,
		// gatilhos suspensos ⇒ o cascade auth.users→profiles não dispara; apaga explícito.
		`delete from public.profiles where email = 'wrk-it@example.com'`,
		`delete from auth.users where email = 'wrk-it@example.com'`,
	}
	for _, s := range stmts {
		if _, err := tx.Exec(ctx, s); err != nil {
			t.Fatalf("resetAcomp %q: %v", s, err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("resetAcomp commit: %v", err)
	}
}

// seedGraph cria users→space→member→court→strategy→process→config. Sem run.
func seedGraph(t *testing.T, pool *pgxpool.Pool) seedIDs {
	t.Helper()
	var s seedIDs

	mustScan(t, pool, &s.userID, `insert into auth.users (id, email, aud, role)
		values (gen_random_uuid(), 'wrk-it@example.com', 'authenticated', 'authenticated') returning id`)
	mustScan(t, pool, &s.spaceID, `insert into public.spaces (name, slug, created_by)
		values ('WRK IT Space', 'wrk-it-space', $1) returning id`, s.userID)
	mustExec(t, pool, `insert into public.space_members (space_id, profile_id, role, status)
		values ($1, $2, 'ADMIN', 'active')`, s.spaceID, s.userID)
	mustScan(t, pool, &s.courtID, `insert into public.courts (name, type, jurisdiction, created_by)
		values ('WRK IT Court', 'TJ', 'AM', $1) returning id`, s.userID)
	mustExec(t, pool, `insert into public.court_tracking_strategies (court_id, source_kind, enabled, requires_cnj)
		values ($1, 'datajud', true, false)`, s.courtID)
	mustScan(t, pool, &s.processID, `insert into public.processes
		(space_id, cnj_number, court_id, assigned_user_id, created_by, status)
		values ($1, '0000001-23.2024.8.04.0001', $2, $3, $3, 'active') returning id`,
		s.spaceID, s.courtID, s.userID)
	mustScan(t, pool, &s.configID, `insert into public.process_tracking_configs
		(process_id, source_kind, created_by, enabled) values ($1, 'datajud', $2, true) returning id`,
		s.processID, s.userID)
	return s
}

func seedPendingRun(t *testing.T, pool *pgxpool.Pool, s seedIDs, attempt int) string {
	t.Helper()
	var runID string
	mustScan(t, pool, &runID, `insert into public.collection_runs
		(process_id, tracking_config_id, source_kind, trigger, status, attempt)
		values ($1, $2, 'datajud', 'manual', 'pending', $3) returning id`,
		s.processID, s.configID, attempt)
	return runID
}

func mustExec(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("exec %q: %v", sql, err)
	}
}
func mustScan(t *testing.T, pool *pgxpool.Pool, dst any, sql string, args ...any) {
	t.Helper()
	if err := pool.QueryRow(context.Background(), sql, args...).Scan(dst); err != nil {
		t.Fatalf("scan %q: %v", sql, err)
	}
}

func itRepo(t *testing.T, dsn string) *PgxRepository {
	t.Helper()
	repo, err := NewPgxRepository(context.Background(), dsn)
	if err != nil {
		t.Fatalf("NewPgxRepository: %v", err)
	}
	t.Cleanup(repo.Close)
	return repo
}

func itWorker(repo Repository) *Worker {
	reg := collectorengine.NewSourceRegistry()
	w := NewWorker(repo, reg, resolverDistribu, time.Millisecond, slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn})))
	return w
}

// =========================================================================
// A. claim sem trabalho pendente → (nil, nil)
// =========================================================================

func TestIntegration_ClaimNoPendingRun(t *testing.T) {
	dsn := itDSN(t)
	pool := itPool(t, dsn)
	resetAcomp(t, pool)
	t.Cleanup(func() { resetAcomp(t, pool) })

	claim, err := itRepo(t, dsn).Claim(context.Background())
	if err != nil {
		t.Fatalf("Claim: %v", err)
	}
	if claim != nil {
		t.Fatalf("esperava nil (sem trabalho), veio %+v", claim)
	}
}

// =========================================================================
// B. Ciclo completo de SUCESSO pelo Worker: claim → fake source → RunCollection
//    → submit_collection_result → estado persistido pelas RPCs.
// =========================================================================

func TestIntegration_WorkerFullCycleSuccess(t *testing.T) {
	dsn := itDSN(t)
	pool := itPool(t, dsn)
	resetAcomp(t, pool)
	t.Cleanup(func() { resetAcomp(t, pool) })

	s := seedGraph(t, pool)
	runID := seedPendingRun(t, pool, s, 1)

	src := &fakeSource{
		kind: "datajud", canHandle: true,
		result: collectorengine.SourceFetchResult{
			SourceKind:  "datajud",
			CollectedAt: "2024-05-01T00:00:00.000Z",
			Movements: []collectorengine.RawMovement{
				rawMov("Distribuído", "2024-03-01T00:00:00Z", "S1"),
				rawMov("Juntada de petição", "2024-03-05T00:00:00Z", "S2"),
			},
		},
	}
	repo := itRepo(t, dsn)
	w := itWorker(repo)
	if err := w.registry.Register("datajud", func() collectorengine.ProcessDataSource { return src }); err != nil {
		t.Fatal(err)
	}

	// referência: o que o engine produz para a MESMA entrada
	want := collectorengine.RunCollection(collectorengine.RunCollectionInput{
		Source:          &fakeSource{kind: "datajud", canHandle: true, result: src.result},
		Target:          collectorengine.SourceTarget{CNJNumber: strptr("0000001-23.2024.8.04.0001"), CourtID: s.courtID},
		RequestID:       &runID,
		IsFirstSync:     true,
		Known:           []collectorengine.KnownMovement{},
		SourceKind:      "datajud",
		ResolveCategory: resolverDistribu,
	})

	worked, err := w.RunOnce(context.Background())
	if !worked || err != nil {
		t.Fatalf("RunOnce = (%v, %v), esperado (true, nil)", worked, err)
	}
	if src.fetchCalls != 1 {
		t.Fatalf("Fetch chamado %d vezes", src.fetchCalls)
	}

	ctx := context.Background()
	var status string
	var fetched, newC, updated int
	var stateAfter *string
	mustScan(t, pool, &status, `select status from public.collection_runs where id = $1`, runID)
	if status != "success" {
		t.Fatalf("collection_runs.status = %q, esperado success", status)
	}
	if err := pool.QueryRow(ctx, `select movements_fetched, movements_new, movements_updated, state_hash_after
		from public.collection_runs where id = $1`, runID).Scan(&fetched, &newC, &updated, &stateAfter); err != nil {
		t.Fatal(err)
	}
	if fetched != want.Counts.Fetched || newC != want.Counts.New || updated != want.Counts.Updated {
		t.Fatalf("counts DB = {%d,%d,%d}, engine = {%d,%d,%d}", fetched, newC, updated,
			want.Counts.Fetched, want.Counts.New, want.Counts.Updated)
	}
	if stateAfter == nil || *stateAfter != want.StateHash {
		t.Fatalf("state_hash_after DB = %v, engine = %q", stateAfter, want.StateHash)
	}

	var movCount int
	mustScan(t, pool, &movCount, `select count(*) from public.process_movements where process_id = $1`, s.processID)
	if movCount != len(want.Movements) {
		t.Fatalf("process_movements = %d, engine produziu %d", movCount, len(want.Movements))
	}
	// content_hash exatamente os do engine — o Worker não recalcula nada
	for _, m := range want.Movements {
		var n int
		mustScan(t, pool, &n, `select count(*) from public.process_movements
			where process_id = $1 and source_kind = 'datajud' and content_hash = $2`, s.processID, m.ContentHash)
		if n != 1 {
			t.Fatalf("content_hash %q do engine não encontrado no banco (n=%d)", m.ContentHash, n)
		}
	}

	var evType string
	mustScan(t, pool, &evType, `select event_type from public.process_change_events where process_id = $1`, s.processID)
	if evType != string(collectorengine.EventFirstSyncCompleted) {
		t.Fatalf("event_type = %q, esperado first_sync_completed", evType)
	}

	var fsDone bool
	var stateHash *string
	if err := pool.QueryRow(ctx, `select first_sync_done, state_hash from public.process_tracking_state
		where process_id = $1 and source_kind = 'datajud'`, s.processID).Scan(&fsDone, &stateHash); err != nil {
		t.Fatal(err)
	}
	if !fsDone {
		t.Fatal("process_tracking_state.first_sync_done deveria ser true")
	}
	if stateHash == nil || *stateHash != want.StateHash {
		t.Fatalf("process_tracking_state.state_hash = %v, engine = %q", stateHash, want.StateHash)
	}

	var payloadPresent int
	mustScan(t, pool, &payloadPresent, `select count(*) from public.collection_raw_payloads where collection_run_id = $1`, runID)
	if payloadPresent != 1 {
		t.Fatalf("collection_raw_payloads: esperava 1 linha, veio %d", payloadPresent)
	}
}

// =========================================================================
// C. Ciclo completo de FALHA: fake source erra → submit_collection_failure.
// =========================================================================

func TestIntegration_WorkerFullCycleFailure(t *testing.T) {
	dsn := itDSN(t)
	pool := itPool(t, dsn)
	resetAcomp(t, pool)
	t.Cleanup(func() { resetAcomp(t, pool) })

	s := seedGraph(t, pool)
	runID := seedPendingRun(t, pool, s, 1)

	src := &fakeSource{kind: "datajud", canHandle: true, fetchErr: collectorengine.NewCollectionUnavailableError()}
	repo := itRepo(t, dsn)
	w := itWorker(repo)
	_ = w.registry.Register("datajud", func() collectorengine.ProcessDataSource { return src })

	worked, err := w.RunOnce(context.Background())
	if !worked || err != nil {
		t.Fatalf("RunOnce = (%v, %v), esperado (true, nil)", worked, err)
	}

	var status, code string
	var msg *string
	mustScan(t, pool, &status, `select status from public.collection_runs where id = $1`, runID)
	if status != "failed" {
		t.Fatalf("status = %q, esperado failed", status)
	}
	if err := pool.QueryRow(context.Background(), `select error_code, error_message
		from public.collection_runs where id = $1`, runID).Scan(&code, &msg); err != nil {
		t.Fatal(err)
	}
	if code != "unavailable" {
		t.Fatalf("error_code = %q, esperado unavailable", code)
	}
	if msg == nil || *msg == "" {
		t.Fatal("error_message não deveria ser vazio")
	}

	// retriable && attempt < 5 → a RPC enfileira uma retry (attempt 2)
	var retryCount int
	mustScan(t, pool, &retryCount, `select count(*) from public.collection_runs
		where tracking_config_id = $1 and trigger = 'retry' and status = 'pending' and attempt = 2`, s.configID)
	if retryCount != 1 {
		t.Fatalf("esperava 1 run de retry enfileirada pela RPC, veio %d", retryCount)
	}
}

// =========================================================================
// D. Erro de RPC propagado: submit_collection_result numa run que não está
//    'running' → check_violation → PgxRepository embrulha e propaga.
// =========================================================================

func TestIntegration_SubmitResultToNonRunningRunPropagates(t *testing.T) {
	dsn := itDSN(t)
	pool := itPool(t, dsn)
	resetAcomp(t, pool)
	t.Cleanup(func() { resetAcomp(t, pool) })

	s := seedGraph(t, pool)
	runID := seedPendingRun(t, pool, s, 1) // fica 'pending' — nunca reclamada

	err := itRepo(t, dsn).SubmitResult(context.Background(), runID, ResultPayload{
		Status:    "success",
		Movements: []collectorengine.MovementRecord{},
		Events:    []collectorengine.EventRecord{},
	})
	if err == nil {
		t.Fatal("esperava erro ao submeter resultado de run não 'running'")
	}
	if !containsFold(err.Error(), "submit_collection_result") {
		t.Fatalf("erro deveria citar a RPC: %v", err)
	}
}

// =========================================================================
// E. SKIP LOCKED: uma única run pendente, N claims concorrentes → exatamente
//    um vencedor; os demais recebem (nil, nil), sem erro.
// =========================================================================

func TestIntegration_ClaimSkipLockedSingleWinner(t *testing.T) {
	dsn := itDSN(t)
	pool := itPool(t, dsn)
	resetAcomp(t, pool)
	t.Cleanup(func() { resetAcomp(t, pool) })

	s := seedGraph(t, pool)
	runID := seedPendingRun(t, pool, s, 1)

	repo := itRepo(t, dsn)
	const n = 6
	var wg sync.WaitGroup
	wins := make([]*ClaimData, n)
	errs := make([]error, n)
	start := make(chan struct{})
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			wins[i], errs[i] = repo.Claim(context.Background())
		}(i)
	}
	close(start)
	wg.Wait()

	got := 0
	for i := 0; i < n; i++ {
		if errs[i] != nil {
			t.Fatalf("claim %d retornou erro: %v", i, errs[i])
		}
		if wins[i] != nil {
			got++
			if wins[i].RunID != runID {
				t.Fatalf("claim %d devolveu run_id inesperado %q", i, wins[i].RunID)
			}
		}
	}
	if got != 1 {
		t.Fatalf("esperava exatamente 1 vencedor do claim concorrente, veio %d", got)
	}

	var running int
	mustScan(t, pool, &running, `select count(*) from public.collection_runs where id = $1 and status = 'running'`, runID)
	if running != 1 {
		t.Fatalf("a run reclamada deveria estar 'running', veio %d", running)
	}
}
