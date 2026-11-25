ALTER TABLE "roteiros" ADD COLUMN "ganchos_alternativos" jsonb;--> statement-breakpoint
ALTER TABLE "roteiros" ADD COLUMN "gancho_escolhido" text;--> statement-breakpoint
ALTER TABLE "roteiros" ADD COLUMN "gancho_escolhido_em" timestamp with time zone;