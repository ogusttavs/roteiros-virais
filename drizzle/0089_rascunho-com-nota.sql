ALTER TABLE "rascunhos_tema_livre" ADD COLUMN "avaliacao" jsonb;--> statement-breakpoint
ALTER TABLE "rascunhos_tema_livre" ADD COLUMN "avaliacao_marca" text;--> statement-breakpoint
ALTER TABLE "rascunhos_tema_livre" ADD COLUMN "avaliada_em" timestamp with time zone;