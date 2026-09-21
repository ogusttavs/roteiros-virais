import { describe, expect, it } from "vitest";

import { listarArquivos, verificarArquivo, verificarConteudo } from "./checar-admin-protegido-regras";

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
