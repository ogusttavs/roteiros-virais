ALTER TABLE "metricas_video_cliente" ADD COLUMN "saves" integer;--> statement-breakpoint
ALTER TABLE "metricas_video_cliente" ADD COLUMN "shares" integer;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "ficha_catalogo" text;--> statement-breakpoint
CREATE INDEX "videos_nicho_ficha" ON "videos" USING btree ("nicho_id","ficha_catalogo");