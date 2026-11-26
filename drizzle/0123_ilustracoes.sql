CREATE TABLE "carrossel_ilustracoes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "carrossel_ilustracoes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"carrossel_id" integer NOT NULL,
	"cliente_id" integer NOT NULL,
	"indice" integer NOT NULL,
	"tipo" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"tamanho" integer NOT NULL,
	"generica" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "carrossel_ilustracoes" ADD CONSTRAINT "carrossel_ilustracoes_carrossel_id_carrosseis_id_fk" FOREIGN KEY ("carrossel_id") REFERENCES "public"."carrosseis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrossel_ilustracoes" ADD CONSTRAINT "carrossel_ilustracoes_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "carrossel_ilustracoes_slide" ON "carrossel_ilustracoes" USING btree ("carrossel_id","indice");