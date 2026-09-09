ALTER TABLE "videos" ADD COLUMN "execucao_id" integer;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_execucao_id_execucoes_job_id_fk" FOREIGN KEY ("execucao_id") REFERENCES "public"."execucoes_job"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "videos_execucao_id" ON "videos" USING btree ("execucao_id");