CREATE TABLE "aprendizado_cliente" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "aprendizado_cliente_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cliente_id" integer NOT NULL,
	"regra" text NOT NULL,
	"motivo_origem" text,
	"contagem" integer DEFAULT 1 NOT NULL,
	"primeira_em" timestamp with time zone DEFAULT now() NOT NULL,
	"ultima_em" timestamp with time zone DEFAULT now() NOT NULL,
	"ativa" boolean DEFAULT true NOT NULL,
	"desativada_em" timestamp with time zone,
	"origem" text DEFAULT 'reprovacao' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aprendizado_cliente" ADD CONSTRAINT "aprendizado_cliente_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "aprendizado_cliente_cliente_id" ON "aprendizado_cliente" USING btree ("cliente_id");