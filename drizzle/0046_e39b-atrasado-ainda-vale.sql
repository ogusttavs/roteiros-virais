ALTER TABLE "roteiros" ADD COLUMN "arquivado_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "roteiros" ADD COLUMN "ainda_vale_checado_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "roteiros" ADD COLUMN "ainda_vale_resultado" jsonb;