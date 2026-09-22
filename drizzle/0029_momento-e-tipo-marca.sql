ALTER TABLE "clientes" ADD COLUMN "tipo" text DEFAULT 'negocio' NOT NULL;--> statement-breakpoint
ALTER TABLE "roteiros" ADD COLUMN "momento" jsonb;