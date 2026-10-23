CREATE TABLE "interessados" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "interessados_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"nome" text NOT NULL,
	"email" text NOT NULL,
	"whatsapp" text NOT NULL,
	"ramo" text NOT NULL,
	"aceitou_contato_em" timestamp with time zone NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "interessados_email" ON "interessados" USING btree ("email");--> statement-breakpoint
CREATE INDEX "interessados_criado_em" ON "interessados" USING btree ("criado_em");