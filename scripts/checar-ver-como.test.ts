import { describe, expect, it } from "vitest";

import { funcoesExportadas, LEITURA_LIVRE, listarArquivos, semComentarios, verificarArquivo, verificarConteudo } from "./checar-ver-como-regras";

const LIVRE = "src/app/(painel)/(completo)/criar/objetivo/acoes.ts";

describe("checar-ver-como", () => {
  it("aceita a Server Action que recusa no modo como primeiro await, nas duas formas", () => {
    const fonte = [
      '"use server";',
      "export async function geraAction(): Promise<ResultadoAcao<null>> {",
      "  const recusaVerComo = await recusaDoVerComo();",
      "  if (recusaVerComo) return { ok: false, erro: recusaVerComo };",
      "  const cliente = await clienteDaSessaoAtual();",
      "  return { ok: true, dado: null };",
      "}",
      "export async function apagaAction(id: number): Promise<void> {",
      "  await exigirForaDoVerComo();",
      "  await apagar(id);",
      "}",
    ].join("\n");
    expect(verificarConteudo("x.ts", fonte)).toEqual([]);
  });

  it("reprova a Server Action que lê a sessão antes de recusar, ou que não recusa", () => {
    const fonte = [
      '"use server";',
      "export async function tarde(): Promise<void> {",
      "  const sessao = await sessaoDoPainel();",
      "  await exigirForaDoVerComo();",
      "}",
      "export async function nunca(id: number): Promise<{ ok: boolean }> {",
      "  await gravar(id);",
      "  return { ok: true };",
      "}",
    ].join("\n");
    expect(verificarConteudo("x.ts", fonte).map((p) => p.motivo.split(":")[0])).toEqual(["tarde", "nunca"]);
  });

  it("a lista de leitura livre vale por arquivo e função, não só por nome", () => {
    expect(Object.keys(LEITURA_LIVRE)).toContain("src/app/(painel)/_casca/ver-como-acoes.ts:sairDoVerComoAction");
    const fonte = '"use server";\nexport async function exemplosDaFichaAction(f: string) {\n  return [];\n}\n';
    expect(verificarConteudo(LIVRE, fonte)).toEqual([]);
    expect(verificarConteudo("src/app/(painel)/outro/acoes.ts", fonte)).toHaveLength(1);
  });

  it("acha as funções mesmo com tipo de retorno cheio de chaves", () => {
    const fonte = 'export async function a(x: { y: number }): Promise<ResultadoAcao<{ id: number }>> {\n  await exigirForaDoVerComo();\n}\n';
    expect(funcoesExportadas(fonte).map((f) => f.nome)).toEqual(["a"]);
    expect(verificarConteudo("x.ts", `"use server";\n${fonte}`)).toEqual([]);
  });

  it("vê as outras formas de exportar: seta, função anônima e export default", () => {
    const fonte = [
      '"use server";',
      "export const flecha = async (id: number) => {",
      "  await gravar(id);",
      "};",
      "export const anonima = async function (id: number) {",
      "  await gravar(id);",
      "};",
      "export default async function (id: number) {",
      "  await gravar(id);",
      "}",
      "export const certa = async () => {",
      "  await exigirForaDoVerComo();",
      "};",
    ].join("\n");
    expect(verificarConteudo("x.ts", fonte).map((p) => p.motivo.split(":")[0]).sort()).toEqual(["anonima", "default", "flecha"]);
  });

  it("aceita comentário antes da diretiva, e um comentário com o nome do guard não vale", () => {
    const fonte = [
      "/** Cabeçalho do arquivo. */",
      "// outro",
      '"use server";',
      "export async function falsa(): Promise<void> {",
      "  // await exigirForaDoVerComo();",
      "  await gravar();",
      "}",
    ].join("\n");
    expect(verificarConteudo("x.ts", fonte).map((p) => p.motivo.split(":")[0])).toEqual(["falsa"]);
  });

  it("recusaDoVerComo chamada sem devolver a recusa não vale", () => {
    const fonte = '"use server";\nexport async function a(): Promise<ResultadoAcao<null>> {\n  await recusaDoVerComo();\n  await gravar();\n  return { ok: true, dado: null };\n}\n';
    expect(verificarConteudo("x.ts", fonte)).toHaveLength(1);
  });

  it("Server Action inline reprova, e um .tsx comum sem a diretiva passa", () => {
    const inline = 'export function Tela() {\n  async function salvar() {\n    "use server";\n    await gravar();\n  }\n  return null;\n}\n';
    expect(verificarConteudo("x.tsx", inline)).toHaveLength(1);
    expect(verificarConteudo("x.tsx", "export function Tela() {\n  return null;\n}\n")).toEqual([]);
  });

  it("semComentarios mantém as linhas e não mexe em texto entre aspas", () => {
    const limpo = semComentarios('const a = "http://x"; // fora\n/* bloco\nlinhas */ const b = 1;');
    expect(limpo.split("\n")).toHaveLength(3);
    expect(limpo).toContain('"http://x"');
    expect(limpo).not.toContain("fora");
  });

  it("todas as Server Actions do painel do repositório estão em ordem", () => {
    const arquivos = listarArquivos();
    expect(arquivos.length).toBeGreaterThan(30);
    expect(arquivos.flatMap(verificarArquivo)).toEqual([]);
  });
});
