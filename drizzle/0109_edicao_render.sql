ALTER TABLE "edicoes" ADD COLUMN "caminho_previa" text;--> statement-breakpoint
ALTER TABLE "edicoes" ADD COLUMN "progresso_do_render" integer;--> statement-breakpoint
ALTER TABLE "edicoes" ADD COLUMN "tentativas_do_render" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "edicoes" ADD COLUMN "pedidos_de_ajuste" jsonb;--> statement-breakpoint
ALTER TABLE "edicoes" ADD COLUMN "refeitas" integer DEFAULT 0 NOT NULL;