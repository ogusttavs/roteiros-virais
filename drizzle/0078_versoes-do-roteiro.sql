CREATE TABLE "versoes_do_roteiro" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "versoes_do_roteiro_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cliente_id" integer NOT NULL,
	"grupo" text NOT NULL,
	"ordem" integer NOT NULL,
	"parametros" jsonb NOT NULL,
	"valores" jsonb NOT NULL,
	"notas" jsonb,
	"escolhida_em" timestamp with time zone,
	"roteiro_id" integer,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "versoes_do_roteiro" ADD CONSTRAINT "versoes_do_roteiro_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versoes_do_roteiro" ADD CONSTRAINT "versoes_do_roteiro_roteiro_id_roteiros_id_fk" FOREIGN KEY ("roteiro_id") REFERENCES "public"."roteiros"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "versoes_do_roteiro_grupo_ordem" ON "versoes_do_roteiro" USING btree ("grupo","ordem");--> statement-breakpoint
CREATE INDEX "versoes_do_roteiro_cliente" ON "versoes_do_roteiro" USING btree ("cliente_id","criado_em");