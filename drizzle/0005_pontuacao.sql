ALTER TABLE "contas" ADD COLUMN "base_fraca" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contas" ADD COLUMN "mediana_velocidade" numeric(14, 3);--> statement-breakpoint
CREATE INDEX "videos_conta_publicado" ON "videos" USING btree ("conta_id","publicado_em");--> statement-breakpoint
CREATE INDEX "videos_nicho_velocidade_relativa" ON "videos" USING btree ("nicho_id","velocidade_relativa");