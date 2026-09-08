package collectorengine

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

// Testes de contrato TS↔Go: carregam contracts/collector-engine/*.json
// (gerados executando o TypeScript real por scripts/extract-contract-vectors.mjs)
// e provam que o port Go produz EXATAMENTE os mesmos content_hash / state_hash /
// eventos / classificação de erro.

func loadContract(t *testing.T, file string, dst any) {
	t.Helper()
	p := filepath.Join("..", "..", "contracts", "collector-engine", file)
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("lendo %s: %v", p, err)
	}
	if err := json.Unmarshal(b, dst); err != nil {
		t.Fatalf("json %s: %v", p, err)
	}
}

// resolver de teste igual ao de scripts/extract-contract-vectors.mjs
func contractResolver(h CategoryHint) *ResolvedCategory {
	code := ""
	if h.Code != nil {
		code = *h.Code
	}
	label := ""
	if h.Label != nil {
		label = *h.Label
	}
	if code == "26" || containsFoldCE(label, "distribu") {
		return &ResolvedCategory{Code: "26", Label: "Distribuição"}
	}
	return nil
}

func containsFoldCE(s, sub string) bool {
	ls := make([]rune, 0, len(s))
	for _, r := range s {
		if r >= 'A' && r <= 'Z' {
			r += 'a' - 'A'
		}
		ls = append(ls, r)
	}
	l := string(ls)
	for i := 0; i+len(sub) <= len(l); i++ {
		if l[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

func strP(s string) *string { return &s }

// =========================================================================
// normalize-movement.json
// =========================================================================

type nmVector struct {
	Name string `json:"name"`
	Raw  struct {
		SourceKind       string  `json:"sourceKind"`
		SourceMovementID *string `json:"sourceMovementId"`
		OccurredAt       *string `json:"occurredAt"`
		Description      string  `json:"description"`
		Raw              any     `json:"raw"`
	} `json:"raw"`
	SourceKind string `json:"sourceKind"`
	Expected   struct {
		SourceKind       string  `json:"sourceKind"`
		SourceMovementID *string `json:"sourceMovementId"`
		OccurredAt       *string `json:"occurredAt"`
		CategoryCode     *string `json:"categoryCode"`
		CategoryLabel    *string `json:"categoryLabel"`
		Description      string  `json:"description"`
		ContentHash      string  `json:"contentHash"`
		NeedsReview      bool    `json:"needsReview"`
	} `json:"expected"`
}

func TestNormalizeMovementContractVectors(t *testing.T) {
	var doc struct {
		Vectors    []nmVector `json:"vectors"`
		Invariants []struct {
			Name               string   `json:"name"`
			EqualContentHashOf []string `json:"equalContentHashOf"`
		} `json:"invariants"`
	}
	loadContract(t, "normalize-movement.json", &doc)
	if len(doc.Vectors) == 0 {
		t.Fatal("nenhum vetor")
	}

	hashByName := map[string]string{}
	for _, v := range doc.Vectors {
		v := v
		t.Run(v.Name, func(t *testing.T) {
			raw := RawMovement{
				SourceKind:       v.Raw.SourceKind,
				SourceMovementID: v.Raw.SourceMovementID,
				OccurredAt:       v.Raw.OccurredAt,
				Description:      v.Raw.Description,
				Raw:              v.Raw.Raw,
			}
			got := NormalizeMovement(raw, NormalizeContext{SourceKind: v.SourceKind, ResolveCategory: contractResolver})
			hashByName[v.Name] = got.ContentHash

			if got.ContentHash != v.Expected.ContentHash {
				t.Fatalf("contentHash\n got  %s\n want %s", got.ContentHash, v.Expected.ContentHash)
			}
			if got.Description != v.Expected.Description {
				t.Fatalf("description %q != %q", got.Description, v.Expected.Description)
			}
			if got.NeedsReview != v.Expected.NeedsReview {
				t.Fatalf("needsReview %v != %v", got.NeedsReview, v.Expected.NeedsReview)
			}
			if !eqStrPtr(got.OccurredAt, v.Expected.OccurredAt) {
				t.Fatalf("occurredAt %v != %v", deref(got.OccurredAt), deref(v.Expected.OccurredAt))
			}
			if !eqStrPtr(got.CategoryCode, v.Expected.CategoryCode) {
				t.Fatalf("categoryCode %v != %v", deref(got.CategoryCode), deref(v.Expected.CategoryCode))
			}
			if !eqStrPtr(got.CategoryLabel, v.Expected.CategoryLabel) {
				t.Fatalf("categoryLabel %v != %v", deref(got.CategoryLabel), deref(v.Expected.CategoryLabel))
			}
			if !eqStrPtr(got.SourceMovementID, v.Expected.SourceMovementID) {
				t.Fatalf("sourceMovementId %v != %v", deref(got.SourceMovementID), deref(v.Expected.SourceMovementID))
			}
		})
	}

	for _, inv := range doc.Invariants {
		inv := inv
		t.Run("invariant/"+inv.Name, func(t *testing.T) {
			if len(inv.EqualContentHashOf) < 2 {
				return
			}
			first := hashByName[inv.EqualContentHashOf[0]]
			for _, n := range inv.EqualContentHashOf[1:] {
				if hashByName[n] != first {
					t.Fatalf("contentHash de %q (%s) != de %q (%s)", inv.EqualContentHashOf[0], first, n, hashByName[n])
				}
			}
		})
	}
}

// =========================================================================
// detect-changes.json
// =========================================================================

type canonJSON struct {
	SourceKind       string  `json:"sourceKind"`
	SourceMovementID *string `json:"sourceMovementId"`
	OccurredAt       *string `json:"occurredAt"`
	CategoryCode     *string `json:"categoryCode"`
	CategoryLabel    *string `json:"categoryLabel"`
	Description      string  `json:"description"`
	Raw              any     `json:"raw"`
	ContentHash      string  `json:"contentHash"`
	NeedsReview      bool    `json:"needsReview"`
}

func (c canonJSON) toCanonical() CanonicalMovement {
	return CanonicalMovement{
		SourceKind: c.SourceKind, SourceMovementID: c.SourceMovementID, OccurredAt: c.OccurredAt,
		CategoryCode: c.CategoryCode, CategoryLabel: c.CategoryLabel, Description: c.Description,
		Raw: c.Raw, ContentHash: c.ContentHash, NeedsReview: c.NeedsReview,
	}
}

func TestDetectChangesContractVectors(t *testing.T) {
	var doc struct {
		Vectors []struct {
			Name  string `json:"name"`
			Input struct {
				Canonical []canonJSON `json:"canonical"`
				Known     []struct {
					ContentHash      string  `json:"contentHash"`
					SourceMovementID *string `json:"sourceMovementId"`
				} `json:"known"`
				IsFirstSync            bool `json:"isFirstSync"`
				AllowFirstSyncComplete bool `json:"allowFirstSyncComplete"`
			} `json:"input"`
			Expected struct {
				StateHash                string   `json:"stateHash"`
				NewMovementContentHashes []string `json:"newMovementContentHashes"`
				AmendedMovements         []struct {
					ContentHash        string `json:"contentHash"`
					RevisesContentHash string `json:"revisesContentHash"`
				} `json:"amendedMovements"`
				EventTypes         []string `json:"eventTypes"`
				FirstSyncCompleted bool     `json:"firstSyncCompleted"`
			} `json:"expected"`
		} `json:"vectors"`
		Invariants []struct {
			Name             string   `json:"name"`
			EqualStateHashOf []string `json:"equalStateHashOf"`
		} `json:"invariants"`
	}
	loadContract(t, "detect-changes.json", &doc)

	stateByName := map[string]string{}
	for _, v := range doc.Vectors {
		v := v
		t.Run(v.Name, func(t *testing.T) {
			canon := make([]CanonicalMovement, len(v.Input.Canonical))
			for i, c := range v.Input.Canonical {
				canon[i] = c.toCanonical()
			}
			known := make([]KnownMovement, len(v.Input.Known))
			for i, k := range v.Input.Known {
				known[i] = KnownMovement{ContentHash: k.ContentHash, SourceMovementID: k.SourceMovementID}
			}
			got := DetectChanges(DetectInput{
				Canonical: canon, Known: known,
				IsFirstSync: v.Input.IsFirstSync, AllowFirstSyncComplete: v.Input.AllowFirstSyncComplete,
			})
			stateByName[v.Name] = got.StateHash

			if got.StateHash != v.Expected.StateHash {
				t.Fatalf("stateHash\n got  %s\n want %s", got.StateHash, v.Expected.StateHash)
			}
			if got.FirstSyncCompleted != v.Expected.FirstSyncCompleted {
				t.Fatalf("firstSyncCompleted %v != %v", got.FirstSyncCompleted, v.Expected.FirstSyncCompleted)
			}
			gotNew := make([]string, len(got.NewMovements))
			for i, m := range got.NewMovements {
				gotNew[i] = m.ContentHash
			}
			if !eqStrSlice(gotNew, v.Expected.NewMovementContentHashes) {
				t.Fatalf("newMovementContentHashes\n got  %v\n want %v", gotNew, v.Expected.NewMovementContentHashes)
			}
			gotEv := make([]string, len(got.Events))
			for i, e := range got.Events {
				gotEv[i] = string(e.EventType)
			}
			if !eqStrSlice(gotEv, v.Expected.EventTypes) {
				t.Fatalf("eventTypes\n got  %v\n want %v", gotEv, v.Expected.EventTypes)
			}
			if len(got.AmendedMovements) != len(v.Expected.AmendedMovements) {
				t.Fatalf("amendedMovements len %d != %d", len(got.AmendedMovements), len(v.Expected.AmendedMovements))
			}
			for i, a := range got.AmendedMovements {
				if a.Movement.ContentHash != v.Expected.AmendedMovements[i].ContentHash ||
					a.RevisesContentHash != v.Expected.AmendedMovements[i].RevisesContentHash {
					t.Fatalf("amended[%d] = {%s revises %s}, want {%s revises %s}", i,
						a.Movement.ContentHash, a.RevisesContentHash,
						v.Expected.AmendedMovements[i].ContentHash, v.Expected.AmendedMovements[i].RevisesContentHash)
				}
			}
		})
	}

	for _, inv := range doc.Invariants {
		inv := inv
		t.Run("invariant/"+inv.Name, func(t *testing.T) {
			if len(inv.EqualStateHashOf) < 2 {
				return
			}
			first := stateByName[inv.EqualStateHashOf[0]]
			for _, n := range inv.EqualStateHashOf[1:] {
				if stateByName[n] != first {
					t.Fatalf("stateHash de %q != de %q", inv.EqualStateHashOf[0], n)
				}
			}
		})
	}
}

// =========================================================================
// classify-error.json
// =========================================================================

func errorForVector(name string) error {
	switch {
	case has(name, "CollectionTimeoutError"):
		return NewCollectionTimeoutError()
	case has(name, "CollectionUnavailableError"):
		return NewCollectionUnavailableError()
	case has(name, "CollectionRateLimitedError"):
		return NewCollectionRateLimitedError()
	case has(name, "CollectionAuthError"):
		return NewCollectionAuthError()
	case has(name, "CollectionParseError"):
		return NewCollectionParseError()
	case has(name, "CollectionNotFoundError"):
		return NewCollectionNotFoundError()
	case has(name, "SourceUnavailableError"):
		return &SourceUnavailableError{Kind: "datajud", Message: "simulado"}
	case has(name, "SourceNotRegisteredError"):
		return &SourceNotRegisteredError{Kind: "minha-fonte"}
	case has(name, "genérico"):
		return errBoom{}
	default:
		return nil
	}
}

type errBoom struct{}

func (errBoom) Error() string { return "boom" }

func has(s, sub string) bool { return containsFoldCE(s, toLowerCE(sub)) || indexRaw(s, sub) >= 0 }
func toLowerCE(s string) string {
	r := []rune(s)
	for i := range r {
		if r[i] >= 'A' && r[i] <= 'Z' {
			r[i] += 'a' - 'A'
		}
	}
	return string(r)
}
func indexRaw(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func TestClassifyErrorContractVectors(t *testing.T) {
	var doc struct {
		Vectors []struct {
			Name     string `json:"name"`
			Expected struct {
				Code       string `json:"code"`
				Message    string `json:"message"`
				Retriable  bool   `json:"retriable"`
				HTTPStatus *int   `json:"httpStatus"`
			} `json:"expected"`
		} `json:"vectors"`
	}
	loadContract(t, "classify-error.json", &doc)
	if len(doc.Vectors) == 0 {
		t.Fatal("nenhum vetor")
	}
	for _, v := range doc.Vectors {
		v := v
		t.Run(v.Name, func(t *testing.T) {
			err := errorForVector(v.Name)
			if err == nil {
				t.Fatalf("não sei construir o erro para %q", v.Name)
			}
			got := ClassifyError(err)
			if string(got.Code) != v.Expected.Code {
				t.Fatalf("code %q != %q", got.Code, v.Expected.Code)
			}
			if got.Message != v.Expected.Message {
				t.Fatalf("message %q != %q", got.Message, v.Expected.Message)
			}
			if got.Retriable != v.Expected.Retriable {
				t.Fatalf("retriable %v != %v", got.Retriable, v.Expected.Retriable)
			}
			if !eqIntPtr(got.HTTPStatus, v.Expected.HTTPStatus) {
				t.Fatalf("httpStatus %v != %v", got.HTTPStatus, v.Expected.HTTPStatus)
			}
		})
	}
}

// =========================================================================
// run-collection.json
// =========================================================================

type rcFakeSource struct {
	res      SourceFetchResult
	throwErr error
}

func (f rcFakeSource) Kind() string                { return "datajud" }
func (f rcFakeSource) CanHandle(SourceTarget) bool { return true }
func (f rcFakeSource) Fetch(SourceFetchInput) (SourceFetchResult, error) {
	if f.throwErr != nil {
		return SourceFetchResult{}, f.throwErr
	}
	return f.res, nil
}

func throwFor(kind string) error {
	switch kind {
	case "timeout":
		return NewCollectionTimeoutError()
	case "unavailable":
		return NewCollectionUnavailableError()
	case "rate_limited":
		return NewCollectionRateLimitedError()
	case "auth_failed":
		return NewCollectionAuthError()
	case "parse_error":
		return NewCollectionParseError()
	case "not_found":
		return NewCollectionNotFoundError()
	case "source_unavailable":
		return &SourceUnavailableError{Kind: "datajud", Message: "simulado"}
	default:
		return nil
	}
}

func TestRunCollectionContractVectors(t *testing.T) {
	var doc struct {
		Vectors []struct {
			Name  string `json:"name"`
			Input struct {
				SourceKind        string  `json:"sourceKind"`
				IsFirstSync       bool    `json:"isFirstSync"`
				PreviousStateHash *string `json:"previousStateHash"`
				Known             []struct {
					ContentHash      string  `json:"contentHash"`
					SourceMovementID *string `json:"sourceMovementId"`
				} `json:"known"`
			} `json:"input"`
			Fetch struct {
				Throw     *string          `json:"throw"`
				Movements []map[string]any `json:"movements"`
				Partial   bool             `json:"partial"`
			} `json:"fetch"`
			CategoryResolutions []*struct {
				Code  string `json:"code"`
				Label string `json:"label"`
			} `json:"categoryResolutions"`
			Expected map[string]any `json:"expected"`
		} `json:"vectors"`
	}
	loadContract(t, "run-collection.json", &doc)

	for _, v := range doc.Vectors {
		v := v
		t.Run(v.Name, func(t *testing.T) {
			var src ProcessDataSource
			if v.Fetch.Throw != nil {
				src = rcFakeSource{throwErr: throwFor(*v.Fetch.Throw)}
			} else {
				movs := make([]RawMovement, len(v.Fetch.Movements))
				for i, m := range v.Fetch.Movements {
					mb, _ := json.Marshal(m)
					var rm RawMovement
					_ = json.Unmarshal(mb, &rm)
					rm.Raw = m["raw"]
					movs[i] = rm
				}
				// espelha o deterministicSource do TS: só inclui `partial`
				// quando true (spread condicional).
				var partialPtr *bool
				if v.Fetch.Partial {
					p := true
					partialPtr = &p
				}
				src = rcFakeSource{res: SourceFetchResult{
					SourceKind:  v.Input.SourceKind,
					CollectedAt: "2024-05-01T00:00:00.000Z",
					Movements:   movs,
					Partial:     partialPtr,
				}}
			}

			idx := 0
			resolver := func(CategoryHint) *ResolvedCategory {
				if idx >= len(v.CategoryResolutions) {
					return nil
				}
				r := v.CategoryResolutions[idx]
				idx++
				if r == nil {
					return nil
				}
				return &ResolvedCategory{Code: r.Code, Label: r.Label}
			}

			known := make([]KnownMovement, len(v.Input.Known))
			for i, k := range v.Input.Known {
				known[i] = KnownMovement{ContentHash: k.ContentHash, SourceMovementID: k.SourceMovementID}
			}

			out := RunCollection(RunCollectionInput{
				Source: src, Target: SourceTarget{CourtID: "c"},
				IsFirstSync: v.Input.IsFirstSync, Known: known,
				PreviousStateHash: v.Input.PreviousStateHash,
				SourceKind:        v.Input.SourceKind, ResolveCategory: resolver,
			})

			gotJSON, _ := json.Marshal(out)
			var gotMap map[string]any
			_ = json.Unmarshal(gotJSON, &gotMap)

			want := v.Expected
			if want["status"] == "failed" {
				delete(gotMap, "collectedAt")
				delete(want, "collectedAt")
			}
			if !reflect.DeepEqual(gotMap, want) {
				g, _ := json.MarshalIndent(gotMap, "", " ")
				w, _ := json.MarshalIndent(want, "", " ")
				t.Fatalf("outcome divergente\n--- got ---\n%s\n--- want ---\n%s", g, w)
			}
		})
	}
}

// --- helpers ---

func eqStrPtr(a, b *string) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}
func eqIntPtr(a, b *int) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}
func deref(p *string) any {
	if p == nil {
		return nil
	}
	return *p
}
func eqStrSlice(a, b []string) bool {
	if len(a) == 0 && len(b) == 0 {
		return true
	}
	return reflect.DeepEqual(a, b)
}

var _ = time.Now // manter import se algum vetor futuro precisar
