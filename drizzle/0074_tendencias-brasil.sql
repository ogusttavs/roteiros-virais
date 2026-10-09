CREATE TABLE "tendencias_avaliadas" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tendencias_avaliadas_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"nicho_id" integer NOT NULL,
	"rodada_em" timestamp with time zone NOT NULL,
	"resultado" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tendencias_brasil" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tendencias_brasil_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"coletada_em" timestamp with time zone NOT NULL,
	"assunto" text NOT NULL,
	"chave" text NOT NULL,
	"termos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fontes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"posicao" integer NOT NULL,
	"sensivel" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tendencias_avaliadas" ADD CONSTRAINT "tendencias_avaliadas_nicho_id_nichos_id_fk" FOREIGN KEY ("nicho_id") REFERENCES "public"."nichos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tendencias_avaliadas_nicho_rodada" ON "tendencias_avaliadas" USING btree ("nicho_id","rodada_em");--> statement-breakpoint
CREATE INDEX "tendencias_brasil_rodada" ON "tendencias_brasil" USING btree ("coletada_em");