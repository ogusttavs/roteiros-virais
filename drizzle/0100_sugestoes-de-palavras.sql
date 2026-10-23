CREATE TABLE "sugestoes_de_palavras" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sugestoes_de_palavras_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"chave" text NOT NULL,
	"palavras" jsonb NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sugestoes_de_palavras_chave" ON "sugestoes_de_palavras" USING btree ("chave");