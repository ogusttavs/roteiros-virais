CREATE TABLE "plano_gravacoes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "plano_gravacoes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cliente_id" integer NOT NULL,
	"dia" date NOT NULL,
	"ordem" integer NOT NULL,
	"lugar" text NOT NULL,
	"situacao" text NOT NULL,
	"o_que_mostrar" text NOT NULL,
	"objetivo" text NOT NULL,
	"marca_id" integer,
	"estado" text DEFAULT 'sugerido' NOT NULL,
	"roteiro_id" integer,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plano_gravacoes" ADD CONSTRAINT "plano_gravacoes_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plano_gravacoes" ADD CONSTRAINT "plano_gravacoes_marca_id_clientes_id_fk" FOREIGN KEY ("marca_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plano_gravacoes" ADD CONSTRAINT "plano_gravacoes_roteiro_id_roteiros_id_fk" FOREIGN KEY ("roteiro_id") REFERENCES "public"."roteiros"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plano_gravacoes_cliente_dia" ON "plano_gravacoes" USING btree ("cliente_id","dia");