/**
 * Fecha o pool do Postgres uma vez so, depois de todos os arquivos de e2e
 * rodarem. playwright.config.ts trava em um worker (workers: 1), entao mais
 * de um arquivo de teste roda no mesmo processo Node; cada arquivo fechando
 * o proprio pool no afterAll quebrava o pool compartilhado (globalThis) para
 * o arquivo seguinte no mesmo worker (achado ao acrescentar o segundo
 * arquivo que toca o banco, etapa 5 parte 2).
 */
import { getPool } from "../../src/db";

export default async function globalTeardown() {
  await getPool().end();
}
