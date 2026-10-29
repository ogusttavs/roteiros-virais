CREATE TABLE "edicoes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "edicoes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cliente_id" integer NOT NULL,
	"roteiro_id" integer NOT NULL,
	"estado" text DEFAULT 'subindo' NOT NULL,
	"motivo" text,
	"tamanho_bytes" integer NOT NULL,
	"tipo_do_arquivo" text NOT NULL,
	"caminho_bruto" text,
	"caminho_editado" text,
	"duracao_s" numeric(8, 3),
	"largura" integer,
	"altura" integer,
	"rotacao" integer,
	"tentativas" integer DEFAULT 0 NOT NULL,
	"idioma" text,
	"palavras" jsonb,
	"energia" jsonb,
	"custo_transcricao_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"custo_ia_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"criada_por" text,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"recebida_em" timestamp with time zone,
	"bruto_expira_em" timestamp with time zone,
	"bruto_apagado_em" timestamp with time zone,
	"editado_expira_em" timestamp with time zone,
	"editado_apagado_em" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "edicoes" ADD CONSTRAINT "edicoes_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edicoes" ADD CONSTRAINT "edicoes_roteiro_id_roteiros_id_fk" FOREIGN KEY ("roteiro_id") REFERENCES "public"."roteiros"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edicoes" ADD CONSTRAINT "edicoes_criada_por_user_id_fk" FOREIGN KEY ("criada_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "edicoes_marca_mes" ON "edicoes" USING btree ("cliente_id","criada_em");--> statement-breakpoint
CREATE INDEX "edicoes_marca_roteiro" ON "edicoes" USING btree ("cliente_id","roteiro_id");