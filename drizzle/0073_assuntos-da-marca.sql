CREATE TABLE "assuntos_da_marca" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "assuntos_da_marca_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cliente_id" integer NOT NULL,
	"texto" text NOT NULL,
	"termos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fixado" boolean DEFAULT false NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"ultimo_aberto_em" timestamp with time zone,
	"expirado_em" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "noticias_do_assunto" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "noticias_do_assunto_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"assunto_id" integer NOT NULL,
	"titulo" text NOT NULL,
	"veiculo" text NOT NULL,
	"url" text NOT NULL,
	"publicado_em" timestamp with time zone,
	"imagem_url" text,
	"imagem_credito" text,
	"resumo_nosso" text,
	"origem" text NOT NULL,
	"coletado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"aberta_em" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "assuntos_da_marca" ADD CONSTRAINT "assuntos_da_marca_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "noticias_do_assunto" ADD CONSTRAINT "noticias_do_assunto_assunto_id_assuntos_da_marca_id_fk" FOREIGN KEY ("assunto_id") REFERENCES "public"."assuntos_da_marca"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assuntos_da_marca_cliente" ON "assuntos_da_marca" USING btree ("cliente_id","ativo");--> statement-breakpoint
CREATE UNIQUE INDEX "assuntos_da_marca_texto_unico" ON "assuntos_da_marca" USING btree ("cliente_id",lower("texto")) WHERE "assuntos_da_marca"."ativo";--> statement-breakpoint
CREATE UNIQUE INDEX "noticias_do_assunto_url" ON "noticias_do_assunto" USING btree ("assunto_id","url");--> statement-breakpoint
CREATE INDEX "noticias_do_assunto_recentes" ON "noticias_do_assunto" USING btree ("assunto_id","publicado_em");