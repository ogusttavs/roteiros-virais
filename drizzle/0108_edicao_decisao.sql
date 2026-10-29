ALTER TABLE "edicoes" ADD COLUMN "decisao" jsonb;--> statement-breakpoint
ALTER TABLE "edicoes" ADD COLUMN "resultado" jsonb;--> statement-breakpoint
ALTER TABLE "edicoes" ADD COLUMN "tentativas_da_decisao" integer DEFAULT 0 NOT NULL;