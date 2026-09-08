package collectorengine

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"strings"
)

// Port de packages/movement-normalizer/src/hash.ts.
//
// sep é o separador entre partes do hash — o control char U+0001, igual ao
// `SEP` do TS (invisível no fonte; ver testes de bytes na Etapa 2).
const sep = "\x01"

// Sha256Hex é o port de `sha256Hex`: SHA-256 (hex) determinístico de um
// conjunto ORDENADO de partes, unidas por sep.
func Sha256Hex(parts []string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, sep)))
	return hex.EncodeToString(sum[:])
}

// StateHashOf é o port de `stateHashOf`: hash do conjunto de content_hash
// conhecidos — deduplica e ordena antes de hashear (o `[...new Set()].sort()`
// do TS).
func StateHashOf(contentHashes []string) string {
	seen := make(map[string]struct{}, len(contentHashes))
	uniq := make([]string, 0, len(contentHashes))
	for _, h := range contentHashes {
		if _, ok := seen[h]; ok {
			continue
		}
		seen[h] = struct{}{}
		uniq = append(uniq, h)
	}
	sort.Strings(uniq)
	return Sha256Hex(uniq)
}
