CREATE TABLE "hashtags_meta_usadas" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hashtags_meta_usadas_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"termo" text NOT NULL,
	"hashtag_id" text NOT NULL,
	"ultimo_uso_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "sem_dono" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "hashtags_meta_usadas_termo" ON "hashtags_meta_usadas" USING btree ("termo");