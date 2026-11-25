CREATE TABLE "carrosseis" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "carrosseis_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cliente_id" integer NOT NULL,
	"origem" text NOT NULL,
	"origem_ref" jsonb,
	"tema" text NOT NULL,
	"quantidade" integer NOT NULL,
	"cor" text NOT NULL,
	"slides" jsonb NOT NULL,
	"legenda" text NOT NULL,
	"hashtags" jsonb NOT NULL,
	"estado" text DEFAULT 'gerado' NOT NULL,
	"geracao_id" integer,
	"avisos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carrossel_fotos" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "carrossel_fotos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"carrossel_id" integer NOT NULL,
	"cliente_id" integer NOT NULL,
	"ordem" integer NOT NULL,
	"tipo" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"tamanho" integer NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "cor_marca" text;--> statement-breakpoint
ALTER TABLE "carrosseis" ADD CONSTRAINT "carrosseis_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrosseis" ADD CONSTRAINT "carrosseis_geracao_id_geracoes_ia_id_fk" FOREIGN KEY ("geracao_id") REFERENCES "public"."geracoes_ia"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrossel_fotos" ADD CONSTRAINT "carrossel_fotos_carrossel_id_carrosseis_id_fk" FOREIGN KEY ("carrossel_id") REFERENCES "public"."carrosseis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrossel_fotos" ADD CONSTRAINT "carrossel_fotos_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "carrosseis_marca" ON "carrosseis" USING btree ("cliente_id","criado_em");--> statement-breakpoint
CREATE INDEX "carrossel_fotos_carrossel" ON "carrossel_fotos" USING btree ("carrossel_id","ordem");