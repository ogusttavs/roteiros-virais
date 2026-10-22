CREATE TABLE "assinaturas" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "assinaturas_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cliente_id" integer NOT NULL,
	"status" text NOT NULL,
	"stripe_cliente_id" text NOT NULL,
	"stripe_assinatura_id" text NOT NULL,
	"stripe_preco_id" text,
	"periodo_inicio" timestamp with time zone,
	"periodo_fim" timestamp with time zone,
	"cancela_no_fim_do_periodo" boolean DEFAULT false NOT NULL,
	"ultimo_evento_em" timestamp with time zone NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eventos_stripe" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "eventos_stripe_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"evento_id" text NOT NULL,
	"tipo" text NOT NULL,
	"recebido_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "cortesia" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assinaturas" ADD CONSTRAINT "assinaturas_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assinaturas_stripe_assinatura" ON "assinaturas" USING btree ("stripe_assinatura_id");--> statement-breakpoint
CREATE INDEX "assinaturas_cliente" ON "assinaturas" USING btree ("cliente_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eventos_stripe_evento" ON "eventos_stripe" USING btree ("evento_id");