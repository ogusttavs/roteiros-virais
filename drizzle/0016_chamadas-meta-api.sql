CREATE TABLE "chamadas_meta_api" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chamadas_meta_api_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "chamadas_meta_api_criado_em" ON "chamadas_meta_api" USING btree ("criado_em");