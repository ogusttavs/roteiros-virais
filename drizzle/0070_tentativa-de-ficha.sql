ALTER TABLE "lotes_ia" ADD COLUMN "so_ficha" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "formato_tentado_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "ficha_tentada_em" timestamp with time zone;