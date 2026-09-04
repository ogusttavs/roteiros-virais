ALTER TABLE "roteiros" ADD COLUMN "versao_de" integer;--> statement-breakpoint
ALTER TABLE "roteiros" ADD COLUMN "geracao_id" integer;--> statement-breakpoint
ALTER TABLE "roteiros" ADD CONSTRAINT "roteiros_versao_de_roteiros_id_fk" FOREIGN KEY ("versao_de") REFERENCES "public"."roteiros"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roteiros" ADD CONSTRAINT "roteiros_geracao_id_geracoes_ia_id_fk" FOREIGN KEY ("geracao_id") REFERENCES "public"."geracoes_ia"("id") ON DELETE no action ON UPDATE no action;