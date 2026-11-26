CREATE TABLE "pedidos_de_geracao" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cliente_id" integer NOT NULL,
	"tipo" text NOT NULL,
	"estado" text DEFAULT 'lendo' NOT NULL,
	"etapa_n" integer,
	"titulo" text NOT NULL,
	"parametros" jsonb NOT NULL,
	"resultado_tipo" text,
	"resultado_id" text,
	"motivo" text,
	"codigo_do_erro" text,
	"refeito_de" uuid,
	"criado_por" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"iniciado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"terminou_em" timestamp with time zone,
	"avisado_em" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pedidos_de_geracao" ADD CONSTRAINT "pedidos_de_geracao_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedidos_de_geracao" ADD CONSTRAINT "pedidos_de_geracao_criado_por_user_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pedidos_um_em_andamento_por_tipo" ON "pedidos_de_geracao" USING btree ("cliente_id","tipo") WHERE "pedidos_de_geracao"."estado" in ('na_vez', 'lendo', 'escrevendo', 'conferindo');--> statement-breakpoint
CREATE INDEX "pedidos_marca_criado" ON "pedidos_de_geracao" USING btree ("cliente_id","criado_em" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "pedidos_estado_atualizado" ON "pedidos_de_geracao" USING btree ("estado","atualizado_em");