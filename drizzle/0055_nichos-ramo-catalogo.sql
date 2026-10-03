ALTER TABLE "nichos" ADD COLUMN "ramo_catalogo" text;--> statement-breakpoint
CREATE UNIQUE INDEX "nichos_ramo_catalogo_unico" ON "nichos" USING btree ("ramo_catalogo") WHERE "nichos"."ramo_catalogo" is not null;

--> statement-breakpoint
-- E45, PR 1: os cinco setores que ja existem entram nos ramos do catalogo (decisao do Gustavo em 02/10/2026; `pesquisa/catalogo-de-ramos.md`,
-- "Onde entram os setores que ja existem"). Casa por slug (preferido) ou por nome, NUNCA por id: o id muda de banco para banco. So onde o setor
-- ainda nao tem ramo e o ramo ainda nao tem setor, e no maximo uma linha por ramo, entao rodar de novo nao muda nada, um banco vazio (dev, testes)
-- nao casa linha nenhuma, e nada aqui pode quebrar o indice unico. Nao apaga nem troca coluna; so o nome do setor do Overtake muda (o slug fica).
-- Dr.Wash
UPDATE "nichos" SET "ramo_catalogo" = 'limpeza-e-organizacao-da-casa' WHERE "id" = (SELECT "id" FROM "nichos" WHERE "ramo_catalogo" IS NULL AND ("slug" = 'produtos-de-limpeza' OR lower("nome") = 'produtos de limpeza') ORDER BY ("slug" = 'produtos-de-limpeza') DESC, "id" LIMIT 1) AND NOT EXISTS (SELECT 1 FROM "nichos" WHERE "ramo_catalogo" = 'limpeza-e-organizacao-da-casa');
--> statement-breakpoint
-- Overtake Pro, o nome muda e o slug fica
UPDATE "nichos" SET "ramo_catalogo" = 'estetica-automotiva', "nome" = 'Estética automotiva' WHERE "id" = (SELECT "id" FROM "nichos" WHERE "ramo_catalogo" IS NULL AND ("slug" = 'adesivo-automotivo' OR lower("nome") = 'adesivo automotivo') ORDER BY ("slug" = 'adesivo-automotivo') DESC, "id" LIMIT 1) AND NOT EXISTS (SELECT 1 FROM "nichos" WHERE "ramo_catalogo" = 'estetica-automotiva');
--> statement-breakpoint
-- Bruno e Uli
UPDATE "nichos" SET "ramo_catalogo" = 'empreendedorismo-e-negocios' WHERE "id" = (SELECT "id" FROM "nichos" WHERE "ramo_catalogo" IS NULL AND ("slug" = 'empreendedorismo-e-construcao-de-marcas' OR lower("nome") = 'empreendedorismo e construção de marcas') ORDER BY ("slug" = 'empreendedorismo-e-construcao-de-marcas') DESC, "id" LIMIT 1) AND NOT EXISTS (SELECT 1 FROM "nichos" WHERE "ramo_catalogo" = 'empreendedorismo-e-negocios');
--> statement-breakpoint
-- sem conta, continua parado
UPDATE "nichos" SET "ramo_catalogo" = 'maquiagem-e-cosmeticos' WHERE "id" = (SELECT "id" FROM "nichos" WHERE "ramo_catalogo" IS NULL AND ("slug" = 'cosmeticos' OR lower("nome") = 'cosméticos') ORDER BY ("slug" = 'cosmeticos') DESC, "id" LIMIT 1) AND NOT EXISTS (SELECT 1 FROM "nichos" WHERE "ramo_catalogo" = 'maquiagem-e-cosmeticos');
--> statement-breakpoint
-- sem conta, continua parado
UPDATE "nichos" SET "ramo_catalogo" = 'infantil-e-brinquedos' WHERE "id" = (SELECT "id" FROM "nichos" WHERE "ramo_catalogo" IS NULL AND ("slug" = 'brinquedos-infantis' OR lower("nome") = 'brinquedos infantis') ORDER BY ("slug" = 'brinquedos-infantis') DESC, "id" LIMIT 1) AND NOT EXISTS (SELECT 1 FROM "nichos" WHERE "ramo_catalogo" = 'infantil-e-brinquedos');
