package collectorengine

import (
	"errors"
	"sync"
	"testing"
)

type registryMockSource struct{ kind string }

func (m registryMockSource) Kind() string                { return m.kind }
func (m registryMockSource) CanHandle(SourceTarget) bool { return true }
func (m registryMockSource) Fetch(SourceFetchInput) (SourceFetchResult, error) {
	return SourceFetchResult{SourceKind: m.kind, Movements: []RawMovement{}}, nil
}

func serialFactory(kind string) ProcessDataSourceFactory {
	var n int
	var mu sync.Mutex
	return func() ProcessDataSource {
		mu.Lock()
		n++
		mu.Unlock()
		return registryMockSource{kind: kind}
	}
}

func TestSourceRegistryRegisterAndCreate(t *testing.T) {
	r := NewSourceRegistry()
	if err := r.Register("datajud", serialFactory("datajud")); err != nil {
		t.Fatal(err)
	}
	if !r.Has("datajud") {
		t.Fatal("Has(datajud) deveria ser true")
	}
	s, err := r.Create("datajud")
	if err != nil {
		t.Fatal(err)
	}
	if s.Kind() != "datajud" {
		t.Fatalf("Kind = %q", s.Kind())
	}
}

func TestSourceRegistryRejectsNilFactory(t *testing.T) {
	if err := NewSourceRegistry().Register("x", nil); err == nil {
		t.Fatal("factory nil deveria ser rejeitada")
	}
}

func TestSourceRegistryDuplicateRegister(t *testing.T) {
	r := NewSourceRegistry()
	_ = r.Register("datajud", serialFactory("datajud"))
	err := r.Register("datajud", serialFactory("datajud"))
	var dup *SourceAlreadyRegisteredError
	if !errors.As(err, &dup) {
		t.Fatalf("esperava *SourceAlreadyRegisteredError, veio %v", err)
	}
	if dup.Kind != "datajud" {
		t.Fatalf("Kind = %q", dup.Kind)
	}
}

func TestSourceRegistryCreateMissing(t *testing.T) {
	_, err := NewSourceRegistry().Create("inexistente")
	var nre *SourceNotRegisteredError
	if !errors.As(err, &nre) {
		t.Fatalf("esperava *SourceNotRegisteredError, veio %v", err)
	}
}

func TestSourceRegistryKindsSortedAndFresh(t *testing.T) {
	r := NewSourceRegistry()
	_ = r.Register("zeta", serialFactory("zeta"))
	_ = r.Register("alpha", serialFactory("alpha"))
	_ = r.Register("mid", serialFactory("mid"))
	k := r.Kinds()
	if len(k) != 3 || k[0] != "alpha" || k[1] != "mid" || k[2] != "zeta" {
		t.Fatalf("Kinds não está ordenado: %v", k)
	}
	k[0] = "MUTATED"
	if r.Kinds()[0] != "alpha" {
		t.Fatal("Kinds() deveria devolver um slice novo a cada chamada")
	}
}

func TestSourceRegistryFactoryReturnsFreshInstance(t *testing.T) {
	r := NewSourceRegistry()
	_ = r.Register("datajud", func() ProcessDataSource { return &registryMockSource{kind: "datajud"} })
	a, _ := r.Create("datajud")
	b, _ := r.Create("datajud")
	if a == b {
		t.Fatal("Create deveria devolver uma instância nova a cada chamada")
	}
}

func TestSourceRegistryConcurrentReadWrite(t *testing.T) {
	r := NewSourceRegistry()
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(2)
		i := i
		go func() { defer wg.Done(); _ = r.Register(string(rune('a'+i)), serialFactory("x")) }()
		go func() { defer wg.Done(); _ = r.Has("a"); _ = r.Kinds() }()
	}
	wg.Wait()
	if len(r.Kinds()) != 20 {
		t.Fatalf("esperava 20 kinds, veio %d", len(r.Kinds()))
	}
}

func TestSourceRegistryConcurrentDuplicateRegister(t *testing.T) {
	r := NewSourceRegistry()
	var wg sync.WaitGroup
	var okCount int
	var mu sync.Mutex
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := r.Register("racing", serialFactory("racing")); err == nil {
				mu.Lock()
				okCount++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if okCount != 1 {
		t.Fatalf("exatamente 1 Register deveria vencer, venceram %d", okCount)
	}
}
