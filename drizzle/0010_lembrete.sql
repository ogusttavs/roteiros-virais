ALTER TABLE "clientes" ADD COLUMN "hora_lembrete" text DEFAULT '08:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "ultimo_acesso_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "aceitou_termos_em" timestamp with time zone;