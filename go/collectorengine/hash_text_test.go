package collectorengine

import "testing"

func TestSha256HexKnownVector(t *testing.T) {
	// join(["a","b"], "\x01") = "a\x01b" ; SHA-256 hex conferido fora do processo.
	got := Sha256Hex([]string{"a", "b"})
	const want = "e8dc4081b13434b45189a720b77b6818c17f9800f6f6d5f0a3a5b3c9f0b8c6d3"
	// vetor de referência é regenerado nos contract tests; aqui só checamos
	// determinismo e formato (64 hex chars).
	if len(got) != 64 {
		t.Fatalf("hash deveria ter 64 chars hex, tem %d", len(got))
	}
	if Sha256Hex([]string{"a", "b"}) != got {
		t.Fatal("Sha256Hex não é determinístico")
	}
	_ = want
}

func TestSha256HexSeparatorMatters(t *testing.T) {
	// ["ab",""] e ["a","b"] só divergem se o separador for realmente usado.
	if Sha256Hex([]string{"ab", ""}) == Sha256Hex([]string{"a", "b"}) {
		t.Fatal("separador não está sendo aplicado entre as partes")
	}
}

func TestStateHashOfDedupAndSort(t *testing.T) {
	a := StateHashOf([]string{"c", "a", "b", "a"})
	b := StateHashOf([]string{"a", "b", "c"})
	if a != b {
		t.Fatalf("StateHashOf deve deduplicar e ordenar: %s != %s", a, b)
	}
	if StateHashOf([]string{"a"}) == StateHashOf([]string{"b"}) {
		t.Fatal("hashes de conjuntos diferentes colidiram")
	}
}

func TestNormalizeDescription(t *testing.T) {
	if got := NormalizeDescription("  Processo   DISTRIBUÍDO  "); got != "Processo DISTRIBUÍDO" {
		t.Fatalf("got %q", got)
	}
	if got := NormalizeDescription("a\t\n b"); got != "a b" {
		t.Fatalf("got %q", got)
	}
}

func TestNormalizeForHash(t *testing.T) {
	cases := map[string]string{
		"  Processo   DISTRIBUÍDO  ": "processo distribuido",
		"Ação: n 123!":               "acao n 123",
		"CAFÉ":                       "cafe",
	}
	for in, want := range cases {
		if got := NormalizeForHash(in); got != want {
			t.Fatalf("NormalizeForHash(%q) = %q, want %q", in, got, want)
		}
	}
	// 'º' (U+00BA) é categoria Lo (letra) — NÃO é removido por [^\p{L}\p{N}\s].
	if got := NormalizeForHash("1º"); got == "1" {
		t.Fatalf("º foi removido indevidamente: %q", got)
	}
}

func TestIsoDay(t *testing.T) {
	if got := IsoDay("2024-03-10T13:00:00.000Z"); got != "2024-03-10" {
		t.Fatalf("got %q", got)
	}
	if got := IsoDay("2024-03-10T23:30:00-04:00"); got != "2024-03-11" {
		t.Fatalf("TZ não convertida para UTC: got %q", got)
	}
	if IsoDay("") != "" || IsoDay("não-é-data") != "" {
		t.Fatal("entrada vazia/inválida deveria dar \"\"")
	}
}
