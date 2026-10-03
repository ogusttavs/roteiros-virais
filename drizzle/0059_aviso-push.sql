CREATE TABLE "inscricoes_push" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "inscricoes_push_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"usuario_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"sistema" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"ultima_falha_em" timestamp with time zone,
	"falhas_seguidas" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "preferencias_usuario" ADD COLUMN "instalado_em_sistema" text;--> statement-breakpoint
ALTER TABLE "preferencias_usuario" ADD COLUMN "push_adiado_ate" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inscricoes_push" ADD CONSTRAINT "inscricoes_push_usuario_id_user_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inscricoes_push_endpoint" ON "inscricoes_push" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "inscricoes_push_usuario" ON "inscricoes_push" USING btree ("usuario_id");