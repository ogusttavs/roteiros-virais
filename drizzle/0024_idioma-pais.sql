ALTER TABLE "contas" ADD COLUMN "pais" text;--> statement-breakpoint
ALTER TABLE "contas" ADD COLUMN "idioma_principal" text;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "idioma" text;--> statement-breakpoint
CREATE INDEX "videos_nicho_idioma" ON "videos" USING btree ("nicho_id","idioma");