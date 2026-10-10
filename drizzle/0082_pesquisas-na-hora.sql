CREATE TABLE "pesquisas_na_hora" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pesquisas_na_hora_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cliente_id" integer NOT NULL,
	"pedido" text NOT NULL,
	"tema" text,
	"profundidade" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'pesquisando' NOT NULL,
	"achados" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"selecionados" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"premissa" jsonb,
	"pergunta_de_posicao" jsonb,
	"posicao_da_pessoa" text,
	"decisao_da_premissa" text,
	"buscas" integer DEFAULT 0 NOT NULL,
	"custo_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"motivo" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"terminado_em" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pesquisas_na_hora" ADD CONSTRAINT "pesquisas_na_hora_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pesquisas_na_hora_cliente" ON "pesquisas_na_hora" USING btree ("cliente_id","criado_em");