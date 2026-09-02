CREATE TABLE "consumo_api" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "consumo_api_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"fonte" text NOT NULL,
	"data" date NOT NULL,
	"unidades" integer DEFAULT 0 NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "audio" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "consumo_api_fonte_data" ON "consumo_api" USING btree ("fonte","data");