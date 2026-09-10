ALTER TABLE "geracoes_ia" ADD COLUMN "motivos_avaliacao" jsonb;--> statement-breakpoint
ALTER TABLE "roteiros" ADD COLUMN "reprovado_em" timestamp with time zone;