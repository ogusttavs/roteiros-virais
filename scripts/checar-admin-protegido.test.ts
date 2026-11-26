import { describe, expect, it } from "vitest";

import { listarArquivos, PADRAO_ACOES, PADRAO_ROTAS, verificarArquivoDeRota, verificarRota, verificarAcoes, verificarArquivoDeAcoes, verificarArquivo, verificarConteudo } from "./checar-admin-protegido-regras";

describe("verificarConteudo", () => {
  it("aceita exigirAdmin() antes de qualquer outra consulta", () => {
    const conteudo = `
export default async function AdminClientes() {
  await exigirAdmin();

  const dados = await listarClientesAdmin();
  return null;
}
`;
    expect(verificarConteudo("fixture.tsx", conteudo)).toEqual([]);
  });

  it("aceita await params antes de exigirAdmin(), so nao aceita consulta antes", () => {
    // params (o proprio pedido) nao e dado de outro cliente; so a consulta importa.
    const conteudo = `
export default async function AdminNichoDetalhe({ params }) {
  await exigirAdmin();

  const { slug } = await params;
  const nicho = await nichoPorSlug(slug);
  return null;
}
`;
    expect(verificarConteudo("fixture.tsx", conteudo)).toEqual([]);
  });

  it("reprova uma consulta antes de exigirAdmin() (o defeito de verdade)", () => {
    const conteudo = `
export default async function AdminClienteDetalhe({ params }) {
  const { id } = await params;
  const cliente = await clienteDetalheAdmin(Number(id));
  await exigirAdmin();
  return null;
}
`;
    const problemas = verificarConteudo("fixture.tsx", conteudo);
    expect(problemas.length).toBe(1);
    expect(problemas[0].motivo).toContain("exigirAdmin");
  });

  it("reprova uma consulta sem nenhum exigirAdmin() no arquivo (mesmo motivo, pega no primeiro await)", () => {
    const conteudo = `
export default async function AdminClientes() {
  const dados = await listarClientesAdmin();
  return null;
}
`;
    const problemas = verificarConteudo("fixture.tsx", conteudo);
    expect(problemas.length).toBe(1);
    expect(problemas[0].motivo).toContain("exigirAdmin");
  });

  it("reprova quando exigirAdmin() nunca e chamado e tambem nao ha nenhum outro await", () => {
    const conteudo = `
export default async function AdminClientes() {
  return null;
}
`;
    const problemas = verificarConteudo("fixture.tsx", conteudo);
    expect(problemas.length).toBe(1);
    expect(problemas[0].motivo).toContain("nao chama exigirAdmin");
  });
});

describe("verificarArquivo, contra as paginas de verdade", () => {
  it("nenhuma page.tsx do admin de hoje reprova", () => {
    const arquivos = listarArquivos();
    expect(arquivos.length).toBeGreaterThan(0);
    for (const arquivo of arquivos) {
      expect(verificarArquivo(arquivo)).toEqual([]);
    }
  });
});


describe("verificarAcoes (Server Actions do admin)", () => {
  it("aceita garantirSessaoAdmin logo depois de ler a sessao, direto ou por ajudante", () => {
    const conteudo = `
"use server";
async function comAdmin(tarefa) {
  const sessao = await sessaoAtual();
  garantirSessaoAdmin(sessao);
  return tarefa();
}
export async function direta(id) {
  garantirSessaoAdmin(await sessaoAtual());
  await fazer(id);
}
export async function porAjudante(id) {
  return comAdmin(async () => { await fazer(id); });
}
`;
    expect(verificarAcoes("acoes.ts", conteudo)).toEqual([]);
  });

  it("reprova a ação que grava antes de conferir o admin, e a que nunca confere", () => {
    const conteudo = `
export async function gravaPrimeiro(id) {
  await fazer(id);
  garantirSessaoAdmin(await sessaoAtual());
}
export async function nuncaConfere(id) {
  await fazer(id);
}
`;
    const problemas = verificarAcoes("acoes.ts", conteudo);
    expect(problemas.map((p) => p.motivo.match(/Action (\w+)/)?.[1])).toEqual(["gravaPrimeiro", "nuncaConfere"]);
  });

  it("todas as Server Actions de hoje do admin passam", () => {
    const arquivos = listarArquivos(PADRAO_ACOES);
    expect(arquivos.length).toBeGreaterThan(0);
    expect(arquivos.flatMap(verificarArquivoDeAcoes)).toEqual([]);
  });
});

describe("verificarRota (rotas de API do admin, E69)", () => {
  it("aceita adminDaRota logo no comeco, mesmo depois de ler os params", () => {
    const conteudo = `
export async function GET(_r: Request, contexto: { params: Promise<{ id: string }> }) {
  const admin = await adminDaRota();
  const id = (await contexto.params).id;
  return null;
}
export async function PUT(request: Request, contexto: { params: Promise<{ id: string }> }) {
  const parametros = await contexto.params;
  const admin = await adminDaRota();
  return null;
}
`;
    expect(verificarRota("route.ts", conteudo)).toEqual([]);
  });

  it("reprova a funcao que le o banco antes de conferir o admin e a que nunca confere", () => {
    const conteudo = `
export async function GET() {
  const dados = await lerDoBanco();
  const admin = await adminDaRota();
  return null;
}
export async function DELETE() {
  return null;
}
`;
    expect(verificarRota("route.ts", conteudo).map((p) => p.motivo.match(/rota (\w+)/)?.[1])).toEqual(["GET", "DELETE"]);
  });

  it("uma rota sem funcao de metodo reprova, e as rotas de hoje passam", () => {
    expect(verificarRota("route.ts", "export const x = 1;")).toHaveLength(1);
    const arquivos = listarArquivos(PADRAO_ROTAS);
    expect(arquivos.length).toBeGreaterThan(0);
    expect(arquivos.flatMap(verificarArquivoDeRota)).toEqual([]);
  });
});
