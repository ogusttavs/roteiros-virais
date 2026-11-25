/**
 * E56 PR 2, envio em lote (só do admin, no servidor): `npm run posts:enviar -- <id da marca> <pasta> [--criar]`. A pasta tem subpastas `NN-nome/` com as imagens (PNG ou JPG, na ordem do nome do arquivo) e um
 * `legendas.md` (um bloco por post, que começa com `## NN-nome` e vai até o próximo `## `). Sem `--criar` só mostra o que faria (nada é gravado). Com `--criar`, cada subpasta vira um post na fila da marca,
 * na ordem do número, e a fila publica um por vez com o intervalo `PUBLICAR_INTERVALO_MIN` (precisa de `PUBLICAR_IMAGENS_ATIVO=1` no ambiente do worker). Usa `DATABASE_URL` e `PUBLICAR_PASTA_TEMP` do
 * ambiente. Rodar duas vezes duplica os posts: confira a fila antes.
 */
import "dotenv/config";

import { eq } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { clientes } from "../src/db/schema";
import { importarPostsDaPasta, lerPastaDePosts } from "../src/servicos/post-pronto-lote";

async function main() {
  const [idBruto, pasta] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const id = Number(idBruto);
  if (!Number.isInteger(id) || id <= 0 || !pasta) {
    console.error("uso: npm run posts:enviar -- <id da marca> <pasta> [--criar]");
    process.exit(1);
  }
  const [marca] = await db().select({ id: clientes.id, nome: clientes.nome }).from(clientes).where(eq(clientes.id, id));
  if (!marca) {
    console.error(`A marca ${id} nao existe.`);
    process.exit(1);
  }
  const posts = await lerPastaDePosts(pasta);
  console.log(`Marca ${marca.id} (${marca.nome}): ${posts.length} post(s) na pasta.`);
  for (const p of posts) console.log(`  ${p.pasta}: ${p.imagens.length} imagem(ns), legenda ${p.legenda === null ? "AUSENTE" : `${[...p.legenda].length} letras`}`);
  if (!process.argv.includes("--criar")) {
    console.log("Nada foi criado. Rode de novo com --criar para pôr todos na fila.");
    return;
  }
  const r = await importarPostsDaPasta({ clienteId: id, pasta });
  console.log(`Criados: ${r.criados.length}.`);
  for (const p of r.problemas) console.log(`  PROBLEMA em ${p.pasta}: ${p.frase}`);
  if (r.problemas.length > 0) process.exitCode = 1;
}

main()
  .catch((erro) => {
    console.error(`posts:enviar: ${String(erro?.message ?? erro)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPool().end();
  });
