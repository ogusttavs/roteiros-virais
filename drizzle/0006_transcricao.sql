CREATE TABLE "lotes_ia" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lotes_ia_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tarefa" text NOT NULL,
	"lote_id_externo" text NOT NULL,
	"video_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'em_andamento' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"concluido_em" timestamp with time zone,
	CONSTRAINT "lotes_ia_lote_id_externo_unique" UNIQUE("lote_id_externo")
);
--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "proxima_tentativa_transcricao" timestamp with time zone;