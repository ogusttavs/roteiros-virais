ALTER TABLE "roteiros" ADD COLUMN "estilo" text DEFAULT 'falado' NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "sem_fala" boolean;