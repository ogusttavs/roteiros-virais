CREATE TABLE "pesquisa_do_foco" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pesquisa_do_foco_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cliente_id" integer NOT NULL,
	"foco_usado" text NOT NULL,
	"foco_hash" text NOT NULL,
	"termos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"canais_sugeridos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"canais" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conferidos_em" timestamp with time zone,
	"ultima_coleta_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pesquisa_do_foco_dia" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pesquisa_do_foco_dia_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cliente_id" integer NOT NULL,
	"data" date NOT NULL,
	"buscas" integer DEFAULT 0 NOT NULL,
	"unidades" integer DEFAULT 0 NOT NULL,
	"videos" integer DEFAULT 0 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pesquisa_do_foco" ADD CONSTRAINT "pesquisa_do_foco_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pesquisa_do_foco_dia" ADD CONSTRAINT "pesquisa_do_foco_dia_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pesquisa_do_foco_cliente" ON "pesquisa_do_foco" USING btree ("cliente_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pesquisa_do_foco_dia_cliente_data" ON "pesquisa_do_foco_dia" USING btree ("cliente_id","data");