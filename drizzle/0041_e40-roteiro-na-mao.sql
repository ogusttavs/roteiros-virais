ALTER TABLE "plano_gravacoes" ADD COLUMN "objetivo_do_video" text;--> statement-breakpoint
ALTER TABLE "roteiros" ADD COLUMN "objetivo_do_video" text;--> statement-breakpoint
ALTER TABLE "roteiros" ADD COLUMN "conteudo_original" jsonb;--> statement-breakpoint
ALTER TABLE "roteiros" ADD COLUMN "editado_pela_pessoa" boolean DEFAULT false NOT NULL;