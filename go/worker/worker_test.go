package worker

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"juriflow/collectorengine"
)

// --- test doubles ---

type claimResult struct {
	data *ClaimData
	err  error
}

// mockRepo grava as chamadas de submit e serve claims de uma fila programada.
type mockRepo struct {
	mu sync.Mutex

	claimQueue []claimResult // consumido em ordem; vazio ⇒ (nil, nil)
	claimCalls int

	resultCalls  []recordedResult
	failureCalls []recordedFailure

	resultErr  error // injeta erro em SubmitResult
	failureErr error // injeta erro em SubmitFailure
}

type recordedResult struct {
	runID   string
	payload ResultPayload
}
type recordedFailure struct {
	runID   string
	payload FailurePayload
}

func (m *mockRepo) Claim(_ context.Context) (*ClaimData, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.claimCalls++
	if len(m.claimQueue) == 0 {
		return nil, nil
	}
	cr := m.claimQueue[0]
	m.claimQueue = m.claimQueue[1:]
	return cr.data, cr.err
}

func (m *mockRepo) SubmitResult(_ context.Context, runID string, p ResultPayload) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.resultCalls = append(m.resultCalls, recordedResult{runID, p})
	return m.resultErr
}

func (m *mockRepo) SubmitFailure(_ context.Context, runID string, p FailurePayload) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.failureCalls = append(m.failureCalls, recordedFailure{runID, p})
	return m.failureErr
}

func (m *mockRepo) results() []recordedResult {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]recordedResult(nil), m.resultCalls...)
}
func (m *mockRepo) failures() []recordedFailure {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]recordedFailure(nil), m.failureCalls...)
}

// fakeSource é um ProcessDataSource fake EXCLUSIVO de teste. Grava o
// SourceFetchInput recebido para provar o repasse de since/requestId.
type fakeSource struct {
	kind          string
	canHandle     bool
	result        collectorengine.SourceFetchResult
	fetchErr      error
	fetchCalls    int
	recordedInput *collectorengine.SourceFetchInput
}

func (f *fakeSource) Kind() string { return f.kind }

func (f *fakeSource) CanHandle(collectorengine.SourceTarget) bool { return f.canHandle }

func (f *fakeSource) Fetch(in collectorengine.SourceFetchInput) (collectorengine.SourceFetchResult, error) {
	f.fetchCalls++
	f.recordedInput = &in
	if f.fetchErr != nil {
		return collectorengine.SourceFetchResult{}, f.fetchErr
	}
	return f.result, nil
}

// --- helpers ---

func strptr(s string) *string { return &s }

func rawMov(desc, occurredAt, sid string) collectorengine.RawMovement {
	var occ, s *string
	if occurredAt != "" {
		occ = &occurredAt
	}
	if sid != "" {
		s = &sid
	}
	return collectorengine.RawMovement{
		SourceKind:       "datajud",
		SourceMovementID: s,
		OccurredAt:       occ,
		Description:      desc,
		Raw:              map[string]any{"description": desc},
	}
}

// resolverDistribu espelha o resolvedor de teste do engine
// (code=="26" || label contém "distribu"), só para os testes do Worker terem
// alguma categoria resolvida.
func resolverDistribu(h collectorengine.CategoryHint) *collectorengine.ResolvedCategory {
	label := ""
	if h.Label != nil {
		label = *h.Label
	}
	if (h.Code != nil && *h.Code == "26") || containsFold(label, "distribu") {
		return &collectorengine.ResolvedCategory{Code: "26", Label: "Distribuição"}
	}
	return nil
}

func containsFold(s, sub string) bool {
	// suficiente para os testes (ASCII)
	ls := ""
	for _, r := range s {
		if r >= 'A' && r <= 'Z' {
			r += 'a' - 'A'
		}
		ls += string(r)
	}
	return len(sub) == 0 || indexOf(ls, sub) >= 0
}
func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func newTestWorker(repo Repository, reg *collectorengine.SourceRegistry) *Worker {
	return NewWorker(repo, reg, resolverDistribu, time.Millisecond, nil)
}

func claimFor(kind string, firstSync bool) *ClaimData {
	return &ClaimData{
		RunID:       "run-001",
		ProcessID:   "proc-001",
		SpaceID:     "space-001",
		SourceKind:  kind,
		Trigger:     "scheduled",
		Attempt:     1,
		CNJNumber:   strptr("0000001-23.2024.8.04.0001"),
		CourtID:     "court-1",
		IsFirstSync: firstSync,
		Known:       []KnownMovementRow{},
	}
}

// =========================================================================
// 1. claim → source → fetch → engine → submit success
// =========================================================================

func TestRunOnceSuccess(t *testing.T) {
	src := &fakeSource{
		kind:      "datajud",
		canHandle: true,
		result: collectorengine.SourceFetchResult{
			SourceKind:  "datajud",
			CollectedAt: "2024-05-01T00:00:00.000Z",
			Movements:   []collectorengine.RawMovement{rawMov("Distribuído", "2024-03-01T00:00:00Z", "S1")},
		},
	}
	reg := collectorengine.NewSourceRegistry()
	if err := reg.Register("datajud", func() collectorengine.ProcessDataSource { return src }); err != nil {
		t.Fatal(err)
	}
	repo := &mockRepo{claimQueue: []claimResult{{data: claimFor("datajud", true)}}}
	w := newTestWorker(repo, reg)

	worked, err := w.RunOnce(context.Background())
	if !worked || err != nil {
		t.Fatalf("RunOnce = (%v, %v), esperado (true, nil)", worked, err)
	}
	if src.fetchCalls != 1 {
		t.Fatalf("Fetch chamado %d vez(es), esperado 1", src.fetchCalls)
	}
	if len(repo.failures()) != 0 {
		t.Fatalf("não deveria ter chamado SubmitFailure: %+v", repo.failures())
	}
	rs := repo.results()
	if len(rs) != 1 {
		t.Fatalf("esperava 1 SubmitResult, obteve %d", len(rs))
	}
	got := rs[0]
	if got.runID != "run-001" {
		t.Fatalf("runID = %q", got.runID)
	}
	if got.payload.Status != "success" {
		t.Fatalf("status = %q, esperado success", got.payload.Status)
	}
	if len(got.payload.Movements) != 1 || !got.payload.FirstSyncCompleted {
		t.Fatalf("payload inesperado: movements=%d firstSyncCompleted=%v", len(got.payload.Movements), got.payload.FirstSyncCompleted)
	}
	if got.payload.Counts != (collectorengine.RunCounts{Fetched: 1, New: 1, Updated: 0}) {
		t.Fatalf("counts = %+v", got.payload.Counts)
	}
	if got.payload.Movements[0].CategoryCode == nil || *got.payload.Movements[0].CategoryCode != "26" {
		t.Fatalf("categoria não resolvida como esperado: %+v", got.payload.Movements[0].CategoryCode)
	}
}

// =========================================================================
// 10. Worker é pass-through: content_hash/state_hash iguais aos do engine
// =========================================================================

func TestRunOnceSubmitsExactlyWhatEngineProduces(t *testing.T) {
	mov := rawMov("Juntada de petição", "2024-03-05T00:00:00Z", "S2")
	fetchResult := collectorengine.SourceFetchResult{
		SourceKind:  "datajud",
		CollectedAt: "2024-05-01T00:00:00.000Z",
		Movements:   []collectorengine.RawMovement{mov},
	}

	src := &fakeSource{kind: "datajud", canHandle: true, result: fetchResult}
	reg := collectorengine.NewSourceRegistry()
	_ = reg.Register("datajud", func() collectorengine.ProcessDataSource { return src })
	repo := &mockRepo{claimQueue: []claimResult{{data: claimFor("datajud", true)}}}
	w := newTestWorker(repo, reg)

	if _, err := w.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}

	// mesma entrada, chamando o engine diretamente
	direct := collectorengine.RunCollection(collectorengine.RunCollectionInput{
		Source:          &fakeSource{kind: "datajud", canHandle: true, result: fetchResult},
		Target:          collectorengine.SourceTarget{CNJNumber: strptr("0000001-23.2024.8.04.0001"), CourtID: "court-1"},
		RequestID:       strptr("run-001"),
		IsFirstSync:     true,
		Known:           []collectorengine.KnownMovement{},
		SourceKind:      "datajud",
		ResolveCategory: resolverDistribu,
	})

	got := repo.results()[0].payload
	if got.StateHash != direct.StateHash {
		t.Fatalf("state_hash submetido (%s) != produzido pelo engine (%s)", got.StateHash, direct.StateHash)
	}
	if got.Movements[0].ContentHash != direct.Movements[0].ContentHash {
		t.Fatalf("content_hash submetido != produzido pelo engine")
	}
	if got.Movements[0].NeedsReview != direct.Movements[0].NeedsReview {
		t.Fatalf("needs_review divergente entre worker e engine")
	}
}

// =========================================================================
// 2. coleta partial → submit result com status partial
// =========================================================================

func TestRunOncePartial(t *testing.T) {
	yes := true
	src := &fakeSource{
		kind:      "datajud",
		canHandle: true,
		result: collectorengine.SourceFetchResult{
			SourceKind:  "datajud",
			CollectedAt: "2024-05-01T00:00:00.000Z",
			Movements:   []collectorengine.RawMovement{rawMov("p1", "", "")},
			Partial:     &yes,
		},
	}
	reg := collectorengine.NewSourceRegistry()
	_ = reg.Register("datajud", func() collectorengine.ProcessDataSource { return src })
	repo := &mockRepo{claimQueue: []claimResult{{data: claimFor("datajud", true)}}}
	w := newTestWorker(repo, reg)

	if _, err := w.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(repo.failures()) != 0 {
		t.Fatalf("partial não deveria virar failure")
	}
	rs := repo.results()
	if len(rs) != 1 || rs[0].payload.Status != "partial" {
		t.Fatalf("esperava 1 SubmitResult status=partial, obteve %+v", rs)
	}
	if rs[0].payload.FirstSyncCompleted {
		t.Fatalf("partial na 1ª sync não deve fechar first_sync_completed")
	}
}

// =========================================================================
// 3. Fetch falha → submit failure com o ClassifiedError do engine
// =========================================================================

func TestRunOnceFetchErrorGoesToSubmitFailure(t *testing.T) {
	src := &fakeSource{kind: "datajud", canHandle: true, fetchErr: collectorengine.NewCollectionTimeoutError()}
	reg := collectorengine.NewSourceRegistry()
	_ = reg.Register("datajud", func() collectorengine.ProcessDataSource { return src })
	repo := &mockRepo{claimQueue: []claimResult{{data: claimFor("datajud", true)}}}
	w := newTestWorker(repo, reg)

	worked, err := w.RunOnce(context.Background())
	if !worked || err != nil {
		t.Fatalf("RunOnce = (%v, %v)", worked, err)
	}
	if len(repo.results()) != 0 {
		t.Fatalf("não deveria ter SubmitResult")
	}
	fs := repo.failures()
	if len(fs) != 1 {
		t.Fatalf("esperava 1 SubmitFailure, obteve %d", len(fs))
	}
	if fs[0].runID != "run-001" || fs[0].payload.ErrorCode != "timeout" || !fs[0].payload.Retriable {
		t.Fatalf("failure payload inesperado: %+v", fs[0])
	}
	if fs[0].payload.HTTPStatus != nil {
		t.Fatalf("timeout não tem http_status, veio %v", *fs[0].payload.HTTPStatus)
	}
}

// =========================================================================
// 4. source_kind não registrado
// =========================================================================

func TestRunOnceUnknownSourceKind(t *testing.T) {
	reg := collectorengine.NewSourceRegistry() // vazio
	repo := &mockRepo{claimQueue: []claimResult{{data: claimFor("tjam_esaj", true)}}}
	w := newTestWorker(repo, reg)

	worked, err := w.RunOnce(context.Background())
	if !worked || err != nil {
		t.Fatalf("RunOnce = (%v, %v)", worked, err)
	}
	if len(repo.results()) != 0 {
		t.Fatalf("não deveria ter SubmitResult")
	}
	fs := repo.failures()
	if len(fs) != 1 {
		t.Fatalf("esperava 1 SubmitFailure, obteve %d", len(fs))
	}
	if fs[0].payload.ErrorCode != "unknown" || fs[0].payload.Retriable {
		t.Fatalf("esperava error_code=unknown, retriable=false; veio %+v", fs[0].payload)
	}
	if fs[0].payload.ErrorMessage == "" {
		t.Fatalf("error_message não deveria ser vazio")
	}
}

// =========================================================================
// 5. CanHandle retorna false → não chama Fetch, vira submit failure
// =========================================================================

func TestRunOnceCanHandleFalse(t *testing.T) {
	src := &fakeSource{kind: "datajud", canHandle: false}
	reg := collectorengine.NewSourceRegistry()
	_ = reg.Register("datajud", func() collectorengine.ProcessDataSource { return src })
	repo := &mockRepo{claimQueue: []claimResult{{data: claimFor("datajud", true)}}}
	w := newTestWorker(repo, reg)

	worked, err := w.RunOnce(context.Background())
	if !worked || err != nil {
		t.Fatalf("RunOnce = (%v, %v)", worked, err)
	}
	if src.fetchCalls != 0 {
		t.Fatalf("Fetch NÃO deveria ter sido chamado (CanHandle=false), foi %d vez(es)", src.fetchCalls)
	}
	if len(repo.results()) != 0 {
		t.Fatalf("não deveria ter SubmitResult")
	}
	fs := repo.failures()
	if len(fs) != 1 || fs[0].payload.ErrorCode != "unknown" || fs[0].payload.Retriable {
		t.Fatalf("esperava 1 SubmitFailure unknown/não-retriável, veio %+v", fs)
	}
}

// =========================================================================
// 6. erro no claim (infra) → nada é submetido
// =========================================================================

func TestRunOnceClaimErrorSubmitsNothing(t *testing.T) {
	repo := &mockRepo{claimQueue: []claimResult{{err: errors.New("connection refused")}}}
	reg := collectorengine.NewSourceRegistry()
	w := newTestWorker(repo, reg)

	worked, err := w.RunOnce(context.Background())
	if worked {
		t.Fatalf("worked deveria ser false quando o claim falha")
	}
	if err == nil {
		t.Fatalf("erro de claim deveria ser propagado")
	}
	if len(repo.results()) != 0 || len(repo.failures()) != 0 {
		t.Fatalf("NENHUM submit deveria ocorrer sem run reclamada; results=%d failures=%d",
			len(repo.results()), len(repo.failures()))
	}
}

// =========================================================================
// 7. nenhum trabalho disponível
// =========================================================================

func TestRunOnceNoWork(t *testing.T) {
	repo := &mockRepo{} // fila vazia
	reg := collectorengine.NewSourceRegistry()
	w := newTestWorker(repo, reg)

	worked, err := w.RunOnce(context.Background())
	if worked || err != nil {
		t.Fatalf("sem trabalho deveria ser (false, nil), veio (%v, %v)", worked, err)
	}
	if repo.claimCalls != 1 {
		t.Fatalf("Claim deveria ter sido chamado 1 vez, foi %d", repo.claimCalls)
	}
	if len(repo.results()) != 0 || len(repo.failures()) != 0 {
		t.Fatalf("nada deveria ser submetido")
	}
}

// =========================================================================
// 8. submit success falha → propaga erro, não cascateia
// =========================================================================

func TestRunOnceSubmitResultErrorPropagatesWithoutCascade(t *testing.T) {
	src := &fakeSource{
		kind: "datajud", canHandle: true,
		result: collectorengine.SourceFetchResult{
			SourceKind: "datajud", CollectedAt: "2024-05-01T00:00:00.000Z",
			Movements: []collectorengine.RawMovement{rawMov("Distribuído", "2024-03-01T00:00:00Z", "S1")},
		},
	}
	reg := collectorengine.NewSourceRegistry()
	_ = reg.Register("datajud", func() collectorengine.ProcessDataSource { return src })
	repo := &mockRepo{
		claimQueue: []claimResult{{data: claimFor("datajud", true)}},
		resultErr:  errors.New("db write failed"),
	}
	w := newTestWorker(repo, reg)

	worked, err := w.RunOnce(context.Background())
	if !worked || err == nil {
		t.Fatalf("RunOnce = (%v, %v), esperado (true, erro)", worked, err)
	}
	if len(repo.results()) != 1 {
		t.Fatalf("SubmitResult deveria ter sido tentado 1 vez, foi %d", len(repo.results()))
	}
	if len(repo.failures()) != 0 {
		t.Fatalf("NÃO deveria cascatear para SubmitFailure quando o SubmitResult falha")
	}
}

// =========================================================================
// 9. submit failure falha → propaga erro, não retenta
// =========================================================================

func TestRunOnceSubmitFailureErrorPropagatesWithoutRetry(t *testing.T) {
	src := &fakeSource{kind: "datajud", canHandle: true, fetchErr: collectorengine.NewCollectionUnavailableError()}
	reg := collectorengine.NewSourceRegistry()
	_ = reg.Register("datajud", func() collectorengine.ProcessDataSource { return src })
	repo := &mockRepo{
		claimQueue: []claimResult{{data: claimFor("datajud", true)}},
		failureErr: errors.New("db down"),
	}
	w := newTestWorker(repo, reg)

	worked, err := w.RunOnce(context.Background())
	if !worked || err == nil {
		t.Fatalf("RunOnce = (%v, %v), esperado (true, erro)", worked, err)
	}
	if len(repo.failures()) != 1 {
		t.Fatalf("SubmitFailure deveria ter sido tentado exatamente 1 vez, foi %d", len(repo.failures()))
	}
}

// =========================================================================
// 11. since + requestId são repassados ao Fetch
// =========================================================================

func TestRunOnceForwardsSinceAndRequestID(t *testing.T) {
	src := &fakeSource{
		kind: "datajud", canHandle: true,
		result: collectorengine.SourceFetchResult{SourceKind: "datajud", CollectedAt: "2024-05-01T00:00:00.000Z", Movements: []collectorengine.RawMovement{}},
	}
	reg := collectorengine.NewSourceRegistry()
	_ = reg.Register("datajud", func() collectorengine.ProcessDataSource { return src })

	claim := claimFor("datajud", false)
	claim.Since = strptr("2024-02-22T03:04:05.678Z")
	repo := &mockRepo{claimQueue: []claimResult{{data: claim}}}
	w := newTestWorker(repo, reg)

	if _, err := w.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if src.recordedInput == nil {
		t.Fatal("Fetch não recebeu input")
	}
	if src.recordedInput.RequestID == nil || *src.recordedInput.RequestID != "run-001" {
		t.Fatalf("requestId não repassado: %+v", src.recordedInput.RequestID)
	}
	if src.recordedInput.Since == nil {
		t.Fatalf("since não repassado")
	}
	want := time.Date(2024, 2, 22, 3, 4, 5, 678_000_000, time.UTC)
	if !src.recordedInput.Since.Equal(want) {
		t.Fatalf("since = %v, esperado %v", src.recordedInput.Since, want)
	}
}

// =========================================================================
// 12. loop de polling: drena a fila e encerra no cancelamento do contexto
// =========================================================================

func TestRunDrainsQueueThenStopsOnContextCancel(t *testing.T) {
	src := &fakeSource{
		kind: "datajud", canHandle: true,
		result: collectorengine.SourceFetchResult{SourceKind: "datajud", CollectedAt: "2024-05-01T00:00:00.000Z", Movements: []collectorengine.RawMovement{}},
	}
	reg := collectorengine.NewSourceRegistry()
	_ = reg.Register("datajud", func() collectorengine.ProcessDataSource { return src })

	c1 := claimFor("datajud", true)
	c1.RunID = "run-A"
	c2 := claimFor("datajud", true)
	c2.RunID = "run-B"
	repo := &mockRepo{claimQueue: []claimResult{{data: c1}, {data: c2}}}
	w := NewWorker(repo, reg, resolverDistribu, 20*time.Millisecond, nil)

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	err := w.Run(ctx)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Run deveria terminar com context.DeadlineExceeded, veio %v", err)
	}
	rs := repo.results()
	if len(rs) != 2 {
		t.Fatalf("esperava as 2 runs da fila processadas, obteve %d", len(rs))
	}
	if rs[0].runID != "run-A" || rs[1].runID != "run-B" {
		t.Fatalf("ordem de processamento inesperada: %s, %s", rs[0].runID, rs[1].runID)
	}
}
