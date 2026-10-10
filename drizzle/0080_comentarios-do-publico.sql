CREATE TABLE "comentarios_video" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "comentarios_video_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"video_id" integer NOT NULL,
	"id_externo" text NOT NULL,
	"texto" text NOT NULL,
	"curtidas" integer DEFAULT 0 NOT NULL,
	"publicado_em" timestamp with time zone,
	"coletado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nichos" ADD COLUMN "vozes" jsonb;--> statement-breakpoint
ALTER TABLE "nichos" ADD COLUMN "vozes_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "comentarios_analise" jsonb;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "comentarios_coletados_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "comentarios_video" ADD CONSTRAINT "comentarios_video_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comentarios_video_unico" ON "comentarios_video" USING btree ("video_id","id_externo");