CREATE INDEX "execucoes_job_iniciado_em" ON "execucoes_job" USING btree ("iniciado_em");--> statement-breakpoint
CREATE INDEX "geracoes_ia_criado_em" ON "geracoes_ia" USING btree ("criado_em");--> statement-breakpoint
CREATE INDEX "roteiros_data" ON "roteiros" USING btree ("data");--> statement-breakpoint
CREATE INDEX "videos_coletado_em" ON "videos" USING btree ("coletado_em");--> statement-breakpoint
CREATE INDEX "videos_transcrito_em" ON "videos" USING btree ("transcrito_em");--> statement-breakpoint
CREATE INDEX "videos_analise_visual_em" ON "videos" USING btree ("analise_visual_em");