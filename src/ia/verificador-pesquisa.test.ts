/**
 * A trava do roteiro com pesquisa (E54, parte 2): todo número com cara de dado do roteiro, e toda quantidade por extenso, tem de estar nas fontes (os dados que a
 * pessoa marcou, o perfil, o tema), com a mesma unidade e escala, a mesma trava que o motor aplicou ao dado. A entrega (ganchos, o que pode aparecer, atenção) não
 * passa por aqui: o código tira o item que falha (`servicos/entrega-da-pesquisa.ts`), o roteiro não cai por um item secundário.
 */
import { describe, expect, it } from "vitest";

import { verificarLocalmente } from "./verificador";

const FONTES = [
  "Perfil do cliente: vende o kit tira-mancha por 89 reais.",
  "Tema: o preço dos produtos de limpeza.",
  "IBGE, 31 de agosto de 2026: A inflação oficial acumulou 4,5% em 12 meses. | trecho: O IPCA acumulado ficou em 4,5% em 12 meses.",
  "Folha, 2 de setembro de 2026: Os produtos de limpeza tiveram alta de 6,2% no ano, ou R$ 1.250 por mês na média. | trecho: alta média de 6,2% no acumulado do ano",
].join("\n");

const verificar = (campos: Record<string, string>, fontes: string | undefined = FONTES) => verificarLocalmente(campos, { fontesDosNumeros: fontes });

describe("verificarLocalmente: os números do roteiro com pesquisa", () => {
  it("o número dos dados, do mesmo jeito, passa (porcentagem, dinheiro, ano)", () => {
    expect(verificar({ corpo: "Segundo o IBGE, em 2026, a inflação oficial acumulou 4,5% em 12 meses. O kit custa R$ 89." }).aprovado).toBe(true);
    expect(verificar({ corpo: "A alta foi de 6,2% no ano, ou R$ 1.250 por mês." }).aprovado).toBe(true);
    // a escala conta: "1,25 mil reais" é o mesmo valor que "R$ 1.250"
    expect(verificar({ corpo: "Dá 1,25 mil reais por mês na média." }).aprovado).toBe(true);
  });

  it("o número que nenhuma fonte tem reprova, com o número e o campo no motivo", () => {
    const r = verificar({ corpo: "O preço subiu 37% desde 2019." });
    expect(r.aprovado).toBe(false);
    const motivo = r.motivos.join(" ");
    expect(motivo).toContain("corpo: tem");
    expect(motivo).toContain('"37%"');
    expect(motivo).toContain('"2019"');
    expect(motivo).toContain("não está nas fontes");
  });

  it("a unidade trocada reprova: 12% não é 12 meses, R$ 4,5 não é 4,5%", () => {
    expect(verificar({ corpo: "A inflação foi de 12%." }).aprovado).toBe(false);
    expect(verificar({ corpo: "Custa R$ 4,5." }).aprovado).toBe(false);
    expect(verificar({ corpo: "Foram 12 meses." }).aprovado).toBe(true);
  });

  it("a escala trocada reprova: R$ 89 mil não é R$ 89", () => {
    expect(verificar({ corpo: "O kit custa R$ 89 mil." }).aprovado).toBe(false);
  });

  it("o número que não é dado (passos, minutos, segundos, ordem) não pede fonte", () => {
    expect(verificar({ corpo: "Em 3 passos, deixe agir por 15 minutos e repita 2 vezes." }).aprovado).toBe(true);
  });

  it("a fronteira dos mil: 999 clientes é quantidade de passo, 1000 clientes é dado", () => {
    expect(verificar({ corpo: "Foram 999 clientes." }).aprovado).toBe(true);
    expect(verificar({ corpo: "Foram 1000 clientes." }).aprovado).toBe(false);
  });

  it("o número grande ou o ano que as fontes não têm reprova mesmo sem unidade", () => {
    expect(verificar({ corpo: "Foram 5.000 clientes em 2025." }).aprovado).toBe(false);
    expect(verificar({ corpo: "Foram 5.000 clientes." }, `${FONTES}\nA loja atendeu 5.000 clientes.`).aprovado).toBe(true);
  });

  it("a escala colada é dado, e a resolução do vídeo, o código e o telefone não são", () => {
    expect(verificar({ corpo: "Chegamos a 10k seguidores." }).aprovado).toBe(false);
    expect(verificar({ corpo: "Chegamos a 10 mil seguidores." }).aprovado).toBe(false);
    expect(verificar({ corpo: "Chegamos a 10k seguidores." }, `${FONTES}\nA conta tem 10 mil seguidores.`).aprovado).toBe(true);
    expect(verificar({ corpo: "Grave em 1080p ou em 4k, na vertical 1080x1920." }).aprovado).toBe(true);
    expect(verificar({ corpo: "Chame no (11) 98765-4321." }).aprovado).toBe(true);
  });

  it("a quantidade por extenso é conferida como o dígito: 'trinta por cento', 'metade', 'dobrou'", () => {
    expect(verificar({ corpo: "Trinta por cento dos clientes voltam." }).aprovado).toBe(false);
    expect(verificar({ corpo: "Metade das lojas já faz isso." }).aprovado).toBe(false);
    expect(verificar({ corpo: "O preço dobrou no ano." }).aprovado).toBe(false);
    expect(verificar({ corpo: "7 em cada 10 donos de loja concordam." }).aprovado).toBe(false);
    // a mesma palavra nas fontes libera
    expect(verificar({ corpo: "Metade das lojas já faz isso." }, `${FONTES}\nA pesquisa diz que metade das lojas já faz isso.`).aprovado).toBe(true);
    // dois a dez, por extenso, são passos e ordem, não dado
    expect(verificar({ corpo: "Faça em três passos e repita duas vezes." }).aprovado).toBe(true);
  });

  it("vale para os campos do roteiro (gancho, corpo, legenda), com a entrega fora: o código tira o item que falha", () => {
    expect(verificar({ gancho: "Os preços subiram 99% e ninguém conta." }).aprovado).toBe(false);
    expect(verificar({ legenda: "Alta de 6,2% no ano." }).aprovado).toBe(true);
    // os campos da entrega começam por "pesquisa": não derrubam o roteiro
    expect(verificar({ pesquisaGancho0: "Os preços subiram 99% e ninguém conta.", pesquisaAtencao0: "Confira se os 40% ainda valem." }).aprovado).toBe(true);
  });

  it("sem a opção (roteiro sem pesquisa), o número solto não é conferido: o comportamento de antes", () => {
    expect(verificarLocalmente({ corpo: "O preço subiu 37% desde 2019." }, {}).aprovado).toBe(true);
  });

  it("o texto das fontes vazio é uma fonte vazia: todo número com cara de dado reprova", () => {
    expect(verificar({ corpo: "Alta de 6,2%." }, "").aprovado).toBe(false);
  });

  it("o número que não deu para ler (lista, data com ponto) reprova se não estiver escrito igual nas fontes", () => {
    expect(verificar({ corpo: "Vale de 1,2,3 até 10.05.2026." }).aprovado).toBe(false);
    expect(verificar({ corpo: "Vale de 1,2,3." }, `${FONTES}\nCódigos 1,2,3.`).aprovado).toBe(true);
  });
});
