package collectorengine

import (
	"regexp"
	"strings"
	"time"

	"golang.org/x/text/unicode/norm"
)

// Port de packages/movement-normalizer/src/text.ts.

var (
	// COMBINING_MARKS do TS: /[̀-ͯ]/g
	combiningMarks = regexp.MustCompile(`[\x{0300}-\x{036f}]`)
	// /\s+/g
	whitespaceRun = regexp.MustCompile(`\s+`)
	// /[^\p{L}\p{N}\s]/gu  (RE2 suporta \p{L}/\p{N})
	nonLetterDigitSpace = regexp.MustCompile(`[^\p{L}\p{N}\s]`)
)

// NormalizeDescription — port de `normalizeDescription`: normaliza para
// EXIBIÇÃO (colapso de espaços + trim).
func NormalizeDescription(value string) string {
	return strings.TrimSpace(whitespaceRun.ReplaceAllString(value, " "))
}

// NormalizeForHash — port de `normalizeForHash`: minúsculas, sem acentos
// (NFD + remoção de combining marks), sem pontuação irrelevante, espaços
// colapsados. Preserva EXATAMENTE a ordem de operações do TS.
func NormalizeForHash(value string) string {
	s := norm.NFD.String(value)
	s = combiningMarks.ReplaceAllString(s, "")
	s = strings.ToLower(s)
	s = nonLetterDigitSpace.ReplaceAllString(s, " ")
	s = whitespaceRun.ReplaceAllString(s, " ")
	return strings.TrimSpace(s)
}

// IsoDay — port de `isoDay`: data truncada ao dia (UTC), ou "" se
// ausente/inválida. Escopo de formatos aceitos: o que `new Date().toISOString()`
// produz (RFC3339 + ms + Z) — não a leniência geral de `new Date()`.
func IsoDay(value string) string {
	if value == "" {
		return ""
	}
	t, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return ""
	}
	return t.UTC().Format("2006-01-02")
}
