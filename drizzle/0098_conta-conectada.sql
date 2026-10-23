CREATE TABLE "contas_conectadas" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "contas_conectadas_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cliente_id" integer NOT NULL,
	"plataforma" text DEFAULT 'instagram' NOT NULL,
	"conta_id" text NOT NULL,
	"nome" text NOT NULL,
	"pagina_id" text,
	"pagina_nome" text,
	"meta_usuario_id" text NOT NULL,
	"estado" text DEFAULT 'ativa' NOT NULL,
	"token_cifrado" text NOT NULL,
	"token_expira_em" timestamp with time zone,
	"conectado_por" text,
	"conectada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"renovada_em" timestamp with time zone,
	"ultima_leitura_em" timestamp with time zone,
	"erro" text,
	"erro_em" timestamp with time zone,
	"avisada_em" timestamp with time zone,
	"atualizada_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exclusoes_meta" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "exclusoes_meta_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"codigo" text NOT NULL,
	"recebido_em" timestamp with time zone DEFAULT now() NOT NULL,
	"concluido_em" timestamp with time zone,
	"ligacoes_apagadas" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contas_conectadas" ADD CONSTRAINT "contas_conectadas_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contas_conectadas" ADD CONSTRAINT "contas_conectadas_conectado_por_user_id_fk" FOREIGN KEY ("conectado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contas_conectadas_uma_ativa_por_marca" ON "contas_conectadas" USING btree ("cliente_id","plataforma") WHERE "contas_conectadas"."estado" = 'ativa';--> statement-breakpoint
CREATE UNIQUE INDEX "contas_conectadas_uma_marca_por_conta" ON "contas_conectadas" USING btree ("plataforma","conta_id") WHERE "contas_conectadas"."estado" = 'ativa';--> statement-breakpoint
CREATE UNIQUE INDEX "contas_conectadas_candidata_unica" ON "contas_conectadas" USING btree ("cliente_id","plataforma","conta_id");--> statement-breakpoint
CREATE INDEX "contas_conectadas_meta_usuario" ON "contas_conectadas" USING btree ("meta_usuario_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exclusoes_meta_codigo" ON "exclusoes_meta" USING btree ("codigo");