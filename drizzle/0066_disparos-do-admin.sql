CREATE TABLE "disparos_do_admin" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "disparos_do_admin_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"fila" text NOT NULL,
	"por_usuario_id" text,
	"em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "disparos_do_admin" ADD CONSTRAINT "disparos_do_admin_por_usuario_id_user_id_fk" FOREIGN KEY ("por_usuario_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "disparos_do_admin_fila_em" ON "disparos_do_admin" USING btree ("fila","em");