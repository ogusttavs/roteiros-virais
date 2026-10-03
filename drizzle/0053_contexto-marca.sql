CREATE TABLE "contexto_marca" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "contexto_marca_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cliente_id" integer NOT NULL,
	"hash_fontes" text,
	"ultima_leitura_ok_em" timestamp with time zone,
	"ultima_tentativa_em" timestamp with time zone,
	"proxima_tentativa_em" timestamp with time zone,
	"lendo_desde" timestamp with time zone,
	"fontes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contexto_marca_cliente_id_unique" UNIQUE("cliente_id")
);
--> statement-breakpoint
CREATE TABLE "contexto_marca_itens" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "contexto_marca_itens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cliente_id" integer NOT NULL,
	"categoria" text NOT NULL,
	"origem" text NOT NULL,
	"texto" text NOT NULL,
	"texto_confirmado" text,
	"estado" text DEFAULT 'para_confirmar' NOT NULL,
	"estado_anterior" text,
	"novidade" text,
	"sumiu_em" timestamp with time zone,
	"ultima_vez_visto_em" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmado_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "perfis_analisados" ADD COLUMN "motivo" text;--> statement-breakpoint
ALTER TABLE "contexto_marca" ADD CONSTRAINT "contexto_marca_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contexto_marca_itens" ADD CONSTRAINT "contexto_marca_itens_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contexto_marca_itens_cliente_id" ON "contexto_marca_itens" USING btree ("cliente_id");