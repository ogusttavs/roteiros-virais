-- E17 parte 1 (refeita em 23/10/2026): escrito a mao, o drizzle-kit nao gera extensao nem funcao. Regerada sobre a main de 23/10/2026 (0096).
-- As duas extensoes sao "contrib" e ja vem na imagem postgres:16-alpine de producao (conferido em pg_available_extensions); nao ha troca de imagem.
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
-- A versao imutavel do unaccent: o original e "stable", e coluna gerada so aceita funcao imutavel. Dicionario e esquema qualificados para a
-- funcao nao depender do search_path de quem a chama (o pg_dump zera o search_path ao restaurar).
CREATE OR REPLACE FUNCTION public.f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "busca_sem_acento" "tsvector" GENERATED ALWAYS AS (to_tsvector('portuguese', f_unaccent(coalesce(titulo, '') || ' ' || coalesce(analise ->> 'assunto', '') || ' ' || left(coalesce(transcricao, ''), 1500)))) STORED;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "texto_curto" text GENERATED ALWAYS AS (lower(f_unaccent(coalesce(titulo, '') || ' ' || coalesce(analise ->> 'assunto', '')))) STORED;