CREATE TABLE "capas_video" (
	"video_id" integer PRIMARY KEY NOT NULL,
	"situacao" text NOT NULL,
	"tipo" text,
	"bytes" "bytea",
	"url_tentada" text,
	"tentativas" integer DEFAULT 0 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "capas_video" ADD CONSTRAINT "capas_video_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;