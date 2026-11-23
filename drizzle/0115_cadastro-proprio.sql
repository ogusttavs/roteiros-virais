CREATE TABLE "cadastros_proprios" (
	"usuario_id" text PRIMARY KEY NOT NULL,
	"cliente_id" integer NOT NULL,
	"termos_versao" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "confirmacoes_de_email" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "confirmacoes_de_email_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"usuario_id" text NOT NULL,
	"codigo_hash" text NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"usado_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "confirmacoes_de_email_codigo_hash_unique" UNIQUE("codigo_hash")
);
--> statement-breakpoint
CREATE TABLE "setores_de_cadastro" (
	"nicho_id" integer PRIMARY KEY NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cadastros_proprios" ADD CONSTRAINT "cadastros_proprios_usuario_id_user_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadastros_proprios" ADD CONSTRAINT "cadastros_proprios_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmacoes_de_email" ADD CONSTRAINT "confirmacoes_de_email_usuario_id_user_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setores_de_cadastro" ADD CONSTRAINT "setores_de_cadastro_nicho_id_nichos_id_fk" FOREIGN KEY ("nicho_id") REFERENCES "public"."nichos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cadastros_proprios_cliente" ON "cadastros_proprios" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "cadastros_proprios_criado_em" ON "cadastros_proprios" USING btree ("criado_em");--> statement-breakpoint
CREATE INDEX "confirmacoes_de_email_usuario" ON "confirmacoes_de_email" USING btree ("usuario_id","criado_em");