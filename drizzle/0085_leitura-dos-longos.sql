ALTER TABLE "videos" ADD COLUMN "analise_longa" jsonb;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "analise_longa_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "proxima_tentativa_analise_longa" timestamp with time zone;