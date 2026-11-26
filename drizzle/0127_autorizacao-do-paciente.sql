ALTER TABLE "carrossel_fotos" ADD COLUMN "autorizado_por" text;--> statement-breakpoint
ALTER TABLE "carrossel_fotos" ADD COLUMN "autorizado_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "carrossel_fotos" ADD CONSTRAINT "carrossel_fotos_autorizado_por_user_id_fk" FOREIGN KEY ("autorizado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;