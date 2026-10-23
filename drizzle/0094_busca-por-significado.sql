-- E17 parte 1 (busca por significado). Escrita a mao por cima do que o drizzle-kit gerou: o kit nao emite CREATE EXTENSION.
-- Exige um Postgres com o pgvector instalado (imagem pgvector/pgvector:0.8.7-pg16-bookworm; ver entregaveis/revisoes/e17-escopo.md).
-- So CREATE EXTENSION IF NOT EXISTS e CREATE TABLE: nada que apague ou altere coluna existente.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "embeddings_video" (
	"video_id" integer NOT NULL,
	"modelo" text NOT NULL,
	"ficha_hash" text NOT NULL,
	"vetor" vector(1024) NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "embeddings_video" ADD CONSTRAINT "embeddings_video_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "embeddings_video_video_modelo" ON "embeddings_video" USING btree ("video_id","modelo");