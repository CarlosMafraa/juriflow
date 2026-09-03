# ADR-0002 — npm workspaces em vez de pnpm + Nx

**Status:** Aceito · **Data:** 2026-09-02 · **Fase:** 2

## Contexto

A Fase 1 sugeriu pnpm + Nx (DP-18). No ambiente de desenvolvimento alvo:

- `pnpm` não está instalado e `corepack enable` exige privilégio de
  administrador (escreve shims em `C:\Program Files\nodejs`).
- Nx adiciona complexidade de configuração desproporcional ao tamanho atual do
  repositório.

Classificação da Fase 1: `INFERÊNCIA TÉCNICA` — a escolha do gerenciador de
pacotes e do task runner não altera comportamento de produto.

## Decisão

- **npm workspaces** (npm já está no PATH, sem admin, funciona igual no CI).
- Sem Nx. Orquestração via scripts do `package.json` raiz + `tsc -b` (project
  references) para os pacotes.

## Consequências

- `npm install` na raiz resolve todos os workspaces.
- Reavaliar se o build ficar lento ou se precisarmos de cache distribuído — a
  migração para pnpm/Nx é local a este ADR e ao `package.json` raiz.
