package collectorengine

import (
	"errors"
	"fmt"
	"sort"
	"sync"
)

// Port de packages/collectors-core/src/registry.ts — SourceRegistry.
//
// Único ponto que conhece o conjunto de estratégias disponíveis. O núcleo
// resolve fontes por aqui, nunca com `if (kind === 'tjam')`. Concorrência-safe
// (RWMutex). Sem singleton global, sem reflection, sem DI framework.

// ProcessDataSourceFactory — port de ProcessDataSourceFactory: cria uma
// instância NOVA de fonte a cada chamada (injeção de config por instância).
type ProcessDataSourceFactory func() ProcessDataSource

// SourceAlreadyRegisteredError — port de SourceAlreadyRegisteredError.
type SourceAlreadyRegisteredError struct {
	Kind string
}

func (e *SourceAlreadyRegisteredError) Error() string {
	return fmt.Sprintf("Fonte '%s' já registrada.", e.Kind)
}

// SourceRegistry — port da classe SourceRegistry.
type SourceRegistry struct {
	mu        sync.RWMutex
	factories map[string]ProcessDataSourceFactory
}

// NewSourceRegistry cria um registro vazio.
func NewSourceRegistry() *SourceRegistry {
	return &SourceRegistry{factories: make(map[string]ProcessDataSourceFactory)}
}

// Register associa um source_kind a uma factory. Factory nil é rejeitada;
// kind já registrado → *SourceAlreadyRegisteredError.
func (r *SourceRegistry) Register(kind string, factory ProcessDataSourceFactory) error {
	if factory == nil {
		return errors.New("SourceRegistry.Register: factory nil para " + kind)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.factories[kind]; exists {
		return &SourceAlreadyRegisteredError{Kind: kind}
	}
	r.factories[kind] = factory
	return nil
}

// Has diz se há uma factory registrada para o kind (somente leitura).
func (r *SourceRegistry) Has(kind string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	_, ok := r.factories[kind]
	return ok
}

// Kinds devolve os kinds registrados, ordenados, num slice novo.
func (r *SourceRegistry) Kinds() []string {
	r.mu.RLock()
	out := make([]string, 0, len(r.factories))
	for k := range r.factories {
		out = append(out, k)
	}
	r.mu.RUnlock()
	sort.Strings(out)
	return out
}

// Create instancia a fonte do kind. Kind não registrado →
// *SourceNotRegisteredError.
func (r *SourceRegistry) Create(kind string) (ProcessDataSource, error) {
	r.mu.RLock()
	factory, ok := r.factories[kind]
	r.mu.RUnlock()
	if !ok {
		return nil, &SourceNotRegisteredError{Kind: kind}
	}
	return factory(), nil
}
