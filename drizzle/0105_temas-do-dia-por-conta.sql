CREATE TABLE "temas_dia_conta" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "temas_dia_conta_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cliente_id" integer NOT NULL,
	"data" date NOT NULL,
	"temas" jsonb NOT NULL,
	"foco_usado" text NOT NULL,
	"foco_hash" text NOT NULL,
	"candidatos_hash" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "temas_dia_conta" ADD CONSTRAINT "temas_dia_conta_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "temas_dia_conta_cliente_data" ON "temas_dia_conta" USING btree ("cliente_id","data");