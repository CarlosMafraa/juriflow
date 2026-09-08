package worker

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"sort"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"juriflow/collectorengine"
)

// =========================================================================
// Test doubles para a fatia pgConn — observam o SQL e os argumentos enviados
// às RPCs. NÃO simulam comportamento SQL.
// =========================================================================

type spyCall struct {
	sql  string
	args []any
}

type spyConn struct {
	calls []spyCall

	claimJSON    []byte // corpo devolvido pelo QueryRow.Scan (nil => SQL NULL)
	claimScanErr error

	execErr error
	execTag pgconn.CommandTag
}

func (s *spyConn) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	s.calls = append(s.calls, spyCall{sql: sql, args: args})
	return &spyRow{json: s.claimJSON, err: s.claimScanErr}
}

func (s *spyConn) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	s.calls = append(s.calls, spyCall{sql: sql, args: args})
	return s.execTag, s.execErr
}

func (s *spyConn) Close() {}

type spyRow struct {
	json []byte
	err  error
}

func (r *spyRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) != 1 {
		return errors.New("spyRow: esperava exatamente 1 destino")
	}
	p, ok := dest[0].(*[]byte)
	if !ok {
		return errors.New("spyRow: destino não é *[]byte")
	}
	if r.json == nil {
		*p = nil
		return nil
	}
	*p = append([]byte(nil), r.json...)
	return nil
}

func newSpyRepo(s *spyConn) *PgxRepository { return &PgxRepository{db: s} }

// =========================================================================
// 1. Claim — sem trabalho (RPC devolve SQL NULL)
// =========================================================================

func TestPgxClaimNoWorkReturnsNilNil(t *testing.T) {
	s := &spyConn{claimJSON: nil}
	claim, err := newSpyRepo(s).Claim(context.Background())
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if claim != nil {
		t.Fatalf("esperava claim nil, obteve %+v", claim)
	}
	if len(s.calls) != 1 || s.calls[0].sql != sqlClaim {
		t.Fatalf("SQL de claim inesperado: %+v", s.calls)
	}
	if len(s.calls[0].args) != 0 {
		t.Fatalf("claim_pending_collection_run() não leva argumentos, veio %v", s.calls[0].args)
	}
}

// =========================================================================
// 2. Claim — decodifica o JSONB do contrato real da migration 0021
// =========================================================================

func TestPgxClaimDecodesRealContractShape(t *testing.T) {
	// Cópia fiel do jsonb_build_object de public.claim_pending_collection_run().
	raw := []byte(`{
		"run_id": "11111111-1111-1111-1111-111111111111",
		"process_id": "22222222-2222-2222-2222-222222222222",
		"space_id": "33333333-3333-3333-3333-333333333333",
		"source_kind": "datajud",
		"trigger": "scheduled",
		"attempt": 2,
		"cnj_number": "0000001-23.2024.8.04.0001",
		"court_id": "44444444-4444-4444-4444-444444444444",
		"source_params": {"instancia": "1"},
		"is_first_sync": false,
		"since": "2024-02-22T03:04:05.678Z",
		"state_hash_before": "abc123",
		"known": [
			{"content_hash": "h1", "source_movement_id": "S1"},
			{"content_hash": "h2", "source_movement_id": null}
		]
	}`)
	s := &spyConn{claimJSON: raw}

	claim, err := newSpyRepo(s).Claim(context.Background())
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	want := &ClaimData{
		RunID:           "11111111-1111-1111-1111-111111111111",
		ProcessID:       "22222222-2222-2222-2222-222222222222",
		SpaceID:         "33333333-3333-3333-3333-333333333333",
		SourceKind:      "datajud",
		Trigger:         "scheduled",
		Attempt:         2,
		CNJNumber:       strptrT("0000001-23.2024.8.04.0001"),
		CourtID:         "44444444-4444-4444-4444-444444444444",
		SourceParams:    map[string]any{"instancia": "1"},
		IsFirstSync:     false,
		Since:           strptrT("2024-02-22T03:04:05.678Z"),
		StateHashBefore: strptrT("abc123"),
		Known: []KnownMovementRow{
			{ContentHash: "h1", SourceMovementID: strptrT("S1")},
			{ContentHash: "h2", SourceMovementID: nil},
		},
	}
	if !reflect.DeepEqual(claim, want) {
		t.Fatalf("ClaimData divergente:\n got  %#v\n want %#v", claim, want)
	}
}

// =========================================================================
// 3. Claim — campos opcionais ausentes / nulos (primeira sincronização)
// =========================================================================

func TestPgxClaimHandlesNullOptionalFields(t *testing.T) {
	// Forma que a RPC devolve na 1ª sync: since/state_hash_before nulos,
	// cnj_number nulo, known = [] (coalesce no SQL), source_params = {}.
	raw := []byte(`{
		"run_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
		"process_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
		"space_id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
		"source_kind": "datajud",
		"trigger": "manual",
		"attempt": 1,
		"cnj_number": null,
		"court_id": "dddddddd-dddd-dddd-dddd-dddddddddddd",
		"source_params": {},
		"is_first_sync": true,
		"since": null,
		"state_hash_before": null,
		"known": []
	}`)
	claim, err := newSpyRepo(&spyConn{claimJSON: raw}).Claim(context.Background())
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if claim.CNJNumber != nil {
		t.Fatalf("cnj_number nulo deveria virar nil, veio %q", *claim.CNJNumber)
	}
	if claim.Since != nil {
		t.Fatalf("since nulo deveria virar nil, veio %q", *claim.Since)
	}
	if claim.StateHashBefore != nil {
		t.Fatalf("state_hash_before nulo deveria virar nil")
	}
	if !claim.IsFirstSync {
		t.Fatalf("is_first_sync deveria ser true")
	}
	if claim.Known == nil || len(claim.Known) != 0 {
		t.Fatalf("known = [] deveria desserializar como slice vazio não-nil, veio %#v", claim.Known)
	}
	if claim.SourceParams == nil || len(claim.SourceParams) != 0 {
		t.Fatalf("source_params = {} deveria virar map vazio, veio %#v", claim.SourceParams)
	}
}

// =========================================================================
// 4. Claim — JSON malformado e resposta sem run_id são erros de infra
// =========================================================================

func TestPgxClaimMalformedJSONIsError(t *testing.T) {
	_, err := newSpyRepo(&spyConn{claimJSON: []byte(`{not json`)}).Claim(context.Background())
	if err == nil {
		t.Fatal("esperava erro para JSON malformado")
	}
}

func TestPgxClaimMissingRunIDIsError(t *testing.T) {
	_, err := newSpyRepo(&spyConn{claimJSON: []byte(`{"process_id":"x"}`)}).Claim(context.Background())
	if err == nil {
		t.Fatal("esperava erro quando o JSON não tem run_id")
	}
}

// =========================================================================
// 5. Claim — erro de scan (transporte) é propagado com contexto
// =========================================================================

func TestPgxClaimScanErrorPropagates(t *testing.T) {
	sentinel := errors.New("connection reset by peer")
	_, err := newSpyRepo(&spyConn{claimScanErr: sentinel}).Claim(context.Background())
	if err == nil || !errors.Is(err, sentinel) {
		t.Fatalf("erro de scan deveria ser propagado (wrapped), veio %v", err)
	}
}

// =========================================================================
// 6. SubmitResult — SQL, argumentos e forma exata do p_result
// =========================================================================

func TestPgxSubmitResultSendsExactArgsAndPayloadShape(t *testing.T) {
	s := &spyConn{}
	occ := "2024-03-01T00:00:00.000Z"
	revises := "old-hash"
	payload := ResultPayload{
		Status:      "success",
		CollectedAt: "2024-05-01T00:00:00.000Z",
		RawPayload:  map[string]any{"sourceKind": "datajud", "movements": []any{}},
		Movements: []collectorengine.MovementRecord{{
			ContentHash:        "ch-1",
			SourceMovementID:   strptrT("S1"),
			OccurredAt:         &occ,
			CategoryCode:       strptrT("26"),
			CategoryLabel:      strptrT("Distribuição"),
			Description:        "Distribuído",
			Raw:                map[string]any{"x": 1},
			NeedsReview:        false,
			IsFirstSync:        true,
			RevisesContentHash: &revises,
		}},
		Events: []collectorengine.EventRecord{{
			EventType:   collectorengine.EventFirstSyncCompleted,
			ContentHash: nil,
			OccurredAt:  nil,
			Payload:     map[string]any{"source_kind": "datajud", "movements": 1},
		}},
		StateHash:          "state-1",
		FirstSyncCompleted: true,
		Counts:             collectorengine.RunCounts{Fetched: 1, New: 1, Updated: 0},
	}

	if err := newSpyRepo(s).SubmitResult(context.Background(), "run-xyz", payload); err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if len(s.calls) != 1 {
		t.Fatalf("esperava 1 chamada, obteve %d", len(s.calls))
	}
	c := s.calls[0]
	if c.sql != sqlSubmitResult {
		t.Fatalf("SQL = %q, esperado %q", c.sql, sqlSubmitResult)
	}
	if len(c.args) != 2 {
		t.Fatalf("esperava 2 args (uuid, jsonb), obteve %d", len(c.args))
	}
	if c.args[0] != "run-xyz" {
		t.Fatalf("arg[0] deveria ser o run_id cru, veio %#v", c.args[0])
	}
	body, ok := c.args[1].(string)
	if !ok {
		t.Fatalf("arg[1] deveria ser string JSON, veio %T", c.args[1])
	}

	var got map[string]any
	if err := json.Unmarshal([]byte(body), &got); err != nil {
		t.Fatalf("p_result não é JSON válido: %v", err)
	}

	// Chaves de topo == exatamente as que a RPC lê (+ collected_at, paridade
	// com o caller TS runtime.ts; a RPC ignora essa chave).
	assertKeys(t, "p_result", got, []string{
		"status", "collected_at", "raw_payload", "movements", "events",
		"state_hash", "first_sync_completed", "counts",
	})
	assertKeys(t, "p_result.counts", got["counts"].(map[string]any), []string{"fetched", "new", "updated"})

	mv := got["movements"].([]any)[0].(map[string]any)
	assertKeys(t, "p_result.movements[0]", mv, []string{
		"content_hash", "source_movement_id", "occurred_at", "category_code",
		"category_label", "description", "raw", "needs_review", "is_first_sync",
		"revises_content_hash",
	})
	ev := got["events"].([]any)[0].(map[string]any)
	assertKeys(t, "p_result.events[0]", ev, []string{"event_type", "content_hash", "occurred_at", "payload"})

	if got["status"] != "success" || got["state_hash"] != "state-1" || got["first_sync_completed"] != true {
		t.Fatalf("valores escalares divergentes: %#v", got)
	}
	if ev["event_type"] != "first_sync_completed" {
		t.Fatalf("event_type serializado = %v, esperado first_sync_completed", ev["event_type"])
	}
	if mv["revises_content_hash"] != "old-hash" {
		t.Fatalf("revises_content_hash = %v", mv["revises_content_hash"])
	}
}

// =========================================================================
// 7. SubmitResult — slices vazias viram [] no JSON (não null); a RPC faz
//    jsonb_array_elements(coalesce(...,'[]')), que quebra em 'null'::jsonb.
// =========================================================================

func TestPgxSubmitResultEmptySlicesSerializeAsJSONArray(t *testing.T) {
	s := &spyConn{}
	payload := ResultPayload{
		Status:    "success",
		Movements: []collectorengine.MovementRecord{},
		Events:    []collectorengine.EventRecord{},
		Counts:    collectorengine.RunCounts{},
	}
	if err := newSpyRepo(s).SubmitResult(context.Background(), "r1", payload); err != nil {
		t.Fatal(err)
	}
	body := s.calls[0].args[1].(string)
	var got map[string]any
	if err := json.Unmarshal([]byte(body), &got); err != nil {
		t.Fatal(err)
	}
	if _, isArr := got["movements"].([]any); !isArr {
		t.Fatalf("movements deveria ser array JSON, veio %T (%v)", got["movements"], got["movements"])
	}
	if _, isArr := got["events"].([]any); !isArr {
		t.Fatalf("events deveria ser array JSON, veio %T (%v)", got["events"], got["events"])
	}
}

// =========================================================================
// 8. Garantia de que o motor NUNCA entrega slices nil ao repositório —
//    é o que mantém o caminho real seguro contra jsonb_array_elements(null).
// =========================================================================

func TestEngineOutcomeNeverHasNilMovementOrEventSlices(t *testing.T) {
	src := &fakeSource{
		kind: "datajud", canHandle: true,
		result: collectorengine.SourceFetchResult{
			SourceKind:  "datajud",
			CollectedAt: "2024-05-01T00:00:00.000Z",
			Movements:   []collectorengine.RawMovement{}, // zero movimentações
		},
	}
	out := collectorengine.RunCollection(collectorengine.RunCollectionInput{
		Source: src, Target: collectorengine.SourceTarget{CourtID: "c1"},
		IsFirstSync: false, Known: []collectorengine.KnownMovement{}, SourceKind: "datajud",
	})
	if out.Movements == nil {
		t.Fatal("RunCollection devolveu Movements nil — quebraria a RPC")
	}
	if out.Events == nil {
		t.Fatal("RunCollection devolveu Events nil — quebraria a RPC")
	}
	// e o payload do Worker preserva isso
	rp := ResultPayload{Movements: out.Movements, Events: out.Events}
	b, _ := json.Marshal(rp)
	var m map[string]any
	_ = json.Unmarshal(b, &m)
	if _, ok := m["movements"].([]any); !ok {
		t.Fatalf("movements não serializou como array: %v", m["movements"])
	}
}

// =========================================================================
// 9. SubmitFailure — SQL, argumentos e forma do p_error; http_status *int
// =========================================================================

func TestPgxSubmitFailureShapeWithHTTPStatus(t *testing.T) {
	s := &spyConn{}
	code := 429
	payload := FailurePayload{
		ErrorCode:    "rate_limited",
		ErrorMessage: "limite atingido",
		HTTPStatus:   &code,
		Retriable:    true,
	}
	if err := newSpyRepo(s).SubmitFailure(context.Background(), "run-9", payload); err != nil {
		t.Fatal(err)
	}
	c := s.calls[0]
	if c.sql != sqlSubmitFailure {
		t.Fatalf("SQL = %q", c.sql)
	}
	if c.args[0] != "run-9" {
		t.Fatalf("arg[0] = %#v", c.args[0])
	}
	var got map[string]any
	if err := json.Unmarshal([]byte(c.args[1].(string)), &got); err != nil {
		t.Fatal(err)
	}
	assertKeys(t, "p_error", got, []string{"error_code", "error_message", "http_status", "retriable"})
	if got["error_code"] != "rate_limited" || got["retriable"] != true {
		t.Fatalf("escalares divergentes: %#v", got)
	}
	// JSON numérico desserializa como float64; a RPC faz ->>'http_status' que dá "429".
	if n, ok := got["http_status"].(float64); !ok || n != 429 {
		t.Fatalf("http_status = %#v, esperado 429", got["http_status"])
	}
}

// =========================================================================
// 10. SubmitFailure — http_status ausente serializa como null (paridade com
//     `err.httpStatus ?? null` do runtime.ts; a RPC faz nullif(...,'')::int).
// =========================================================================

func TestPgxSubmitFailureNilHTTPStatusIsJSONNull(t *testing.T) {
	s := &spyConn{}
	payload := FailurePayload{ErrorCode: "timeout", ErrorMessage: "estourou", Retriable: true}
	if err := newSpyRepo(s).SubmitFailure(context.Background(), "run-10", payload); err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal([]byte(s.calls[0].args[1].(string)), &got); err != nil {
		t.Fatal(err)
	}
	v, present := got["http_status"]
	if !present {
		t.Fatal("a chave http_status deveria estar presente (valor null), não ausente")
	}
	if v != nil {
		t.Fatalf("http_status deveria ser null, veio %#v", v)
	}
}

// =========================================================================
// 11. Erro da RPC (Exec) é propagado com contexto em ambos os submits
// =========================================================================

func TestPgxSubmitErrorsPropagateWrapped(t *testing.T) {
	sentinel := errors.New(`ERROR: Execução X não está em andamento. (SQLSTATE 23514)`)

	err := newSpyRepo(&spyConn{execErr: sentinel}).
		SubmitResult(context.Background(), "r", ResultPayload{Status: "success"})
	if err == nil || !errors.Is(err, sentinel) {
		t.Fatalf("SubmitResult deveria propagar o erro da RPC, veio %v", err)
	}

	err = newSpyRepo(&spyConn{execErr: sentinel}).
		SubmitFailure(context.Background(), "r", FailurePayload{ErrorCode: "unknown"})
	if err == nil || !errors.Is(err, sentinel) {
		t.Fatalf("SubmitFailure deveria propagar o erro da RPC, veio %v", err)
	}
}

// =========================================================================
// 12. Os 7 códigos de erro do engine == o enum public.collection_error_code
//     (valores conferidos na migration 0016). Serialização não os altera.
// =========================================================================

func TestPgxFailureErrorCodesMatchEnumDomain(t *testing.T) {
	enum := map[string]bool{
		"timeout": true, "unavailable": true, "rate_limited": true,
		"auth_failed": true, "parse_error": true, "not_found": true, "unknown": true,
	}
	for _, code := range []collectorengine.CollectionErrorCode{
		collectorengine.CodeTimeout, collectorengine.CodeUnavailable, collectorengine.CodeRateLimited,
		collectorengine.CodeAuthFailed, collectorengine.CodeParseError, collectorengine.CodeNotFound,
		collectorengine.CodeUnknown,
	} {
		s := &spyConn{}
		_ = newSpyRepo(s).SubmitFailure(context.Background(), "r", FailurePayload{ErrorCode: string(code)})
		var got map[string]any
		_ = json.Unmarshal([]byte(s.calls[0].args[1].(string)), &got)
		if !enum[got["error_code"].(string)] {
			t.Fatalf("error_code %q não pertence ao enum public.collection_error_code", got["error_code"])
		}
	}
}

// --- helpers ---

func strptrT(s string) *string { return &s }

func assertKeys(t *testing.T, where string, obj map[string]any, want []string) {
	t.Helper()
	got := make([]string, 0, len(obj))
	for k := range obj {
		got = append(got, k)
	}
	sort.Strings(got)
	w := append([]string(nil), want...)
	sort.Strings(w)
	if !reflect.DeepEqual(got, w) {
		t.Fatalf("%s: chaves\n got  %v\n want %v", where, got, w)
	}
}
