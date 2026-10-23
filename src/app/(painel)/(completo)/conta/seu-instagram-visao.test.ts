/**
 * O que o cartão "Seu Instagram" mostra (E19 PR 2), montado no servidor: quem vê os botões, o que cada papel enxerga, a leitura do `?instagram=` e as datas no fuso do Brasil.
 */
import { describe, expect, it } from "vitest";

import type { ContaLigadaVista } from "@/servicos/conta-conectada";
import { textosLigacao } from "@/textos/conta-conectada";

import { codigoDoRetorno, estadoDoCartao, formatarDia, formatarDiaEHora, montarVisaoSeuInstagram, type EntradaDaVisao } from "./seu-instagram-visao";

function conta(extra: Partial<ContaLigadaVista> = {}): ContaLigadaVista {
  return {
    id: 1,
    contaId: "17841400000000001",
    nome: "casa.em.ordem",
    paginaNome: "Casa em Ordem",
    conectadaEm: new Date("2026-10-12T15:30:00Z"),
    ultimaLeituraEm: null,
    tokenExpiraEm: new Date("2026-12-10T15:30:00Z"),
    erro: null,
    ...extra,
  };
}

const BASE: EntradaDaVisao = { ligacaoAberta: true, aprovadoPelaMeta: false, dono: true, verComo: false, conta: null, candidatas: [], retorno: null };

describe("as datas, no fuso do Brasil", () => {
  it("o dia e a hora são os de Brasília, não os de UTC", () => {
    // 01:30 UTC de 13/10 ainda é 22:30 de 12/10 em Brasília.
    expect(formatarDia(new Date("2026-10-13T01:30:00Z"))).toBe("12/10/2026");
    expect(formatarDiaEHora(new Date("2026-10-13T01:30:00Z"))).toBe("12/10/2026 às 22:30");
    expect(formatarDiaEHora(new Date("2026-10-22T09:20:00Z"))).toBe("22/10/2026 às 06:20");
  });
});

describe("a leitura do ?instagram=", () => {
  it("aceita só os códigos que o servidor manda; o resto é ignorado", () => {
    for (const codigo of Object.keys(textosLigacao.retorno)) expect(codigoDoRetorno(codigo)).toBe(codigo);
    expect(codigoDoRetorno(undefined)).toBeNull();
    expect(codigoDoRetorno("")).toBeNull();
    expect(codigoDoRetorno("qualquer-coisa")).toBeNull();
    expect(codigoDoRetorno("<script>")).toBeNull();
    expect(codigoDoRetorno("constructor")).toBeNull();
    expect(codigoDoRetorno("__proto__")).toBeNull();
  });

  it("com o parâmetro repetido, vale o primeiro", () => {
    expect(codigoDoRetorno(["cancelou", "ligada"])).toBe("cancelou");
    expect(codigoDoRetorno(["x", "ligada"])).toBeNull();
  });
});

describe("quem vê os botões", () => {
  it("a dona da marca fora do ver como pode mexer", () => {
    expect(montarVisaoSeuInstagram(BASE).podeMexer).toBe(true);
  });

  it("quem é só membro não pode", () => {
    expect(montarVisaoSeuInstagram({ ...BASE, dono: false }).podeMexer).toBe(false);
  });

  it("no ver como ninguém pode, nem a dona", () => {
    const visao = montarVisaoSeuInstagram({ ...BASE, verComo: true });
    expect(visao.podeMexer).toBe(false);
    expect(visao.verComo).toBe(true);
  });

  it("as candidatas só aparecem para quem pode escolher", () => {
    const candidatas = [conta({ contaId: "a", nome: "a.um" }), conta({ contaId: "b", nome: "b.dois", paginaNome: null })];
    expect(montarVisaoSeuInstagram({ ...BASE, candidatas }).candidatas).toEqual([
      { contaId: "a", nome: "a.um", pagina: "Casa em Ordem" },
      { contaId: "b", nome: "b.dois", pagina: null },
    ]);
    expect(montarVisaoSeuInstagram({ ...BASE, dono: false, candidatas }).candidatas).toEqual([]);
    expect(montarVisaoSeuInstagram({ ...BASE, verComo: true, candidatas }).candidatas).toEqual([]);
  });
});

describe("a conta ligada na tela", () => {
  it("leva o nome, a página, desde quando e a última leitura formatados, e nada do acesso guardado", () => {
    const visao = montarVisaoSeuInstagram({ ...BASE, conta: conta({ ultimaLeituraEm: new Date("2026-10-22T09:20:00Z"), erro: "uma frase" }) });
    expect(visao.conta).toEqual({ nome: "casa.em.ordem", pagina: "Casa em Ordem", desde: "12/10/2026", ultimaLeitura: "22/10/2026 às 06:20", erro: "uma frase", publicar: false });
    expect(JSON.stringify(visao)).not.toMatch(/token/i);
  });

  it("sem leitura ainda, a última leitura é nula", () => {
    expect(montarVisaoSeuInstagram({ ...BASE, conta: conta() }).conta?.ultimaLeitura).toBeNull();
  });
});

describe("a frase da volta do diálogo", () => {
  it("ligada e escolher são boas; o resto é aviso", () => {
    expect(montarVisaoSeuInstagram({ ...BASE, retorno: "ligada" }).retorno).toEqual({ codigo: "ligada", frase: textosLigacao.retorno.ligada, tom: "ok" });
    expect(montarVisaoSeuInstagram({ ...BASE, retorno: "escolher" }).retorno?.tom).toBe("ok");
    for (const codigo of ["cancelou", "venceu", "permissao", "sem-instagram", "ja-ligada", "falhou", "nao-configurada", "sem-acesso"] as const) {
      expect(montarVisaoSeuInstagram({ ...BASE, retorno: codigo }).retorno).toEqual({ codigo, frase: textosLigacao.retorno[codigo], tom: "aviso" });
    }
  });

  it("sem código, sem frase", () => {
    expect(montarVisaoSeuInstagram(BASE).retorno).toBeNull();
  });
});

describe("o estado do cartão", () => {
  it("sem ligação aberta e sem conta: indisponível", () => {
    expect(estadoDoCartao(montarVisaoSeuInstagram({ ...BASE, ligacaoAberta: false }))).toBe("indisponivel");
  });
  it("ligação aberta e sem conta: sem ligação", () => {
    expect(estadoDoCartao(montarVisaoSeuInstagram(BASE))).toBe("sem-ligacao");
  });
  it("com conta: ligada, mesmo se a ligação fechou depois", () => {
    expect(estadoDoCartao(montarVisaoSeuInstagram({ ...BASE, conta: conta() }))).toBe("ligada");
    expect(estadoDoCartao(montarVisaoSeuInstagram({ ...BASE, ligacaoAberta: false, conta: conta() }))).toBe("ligada");
  });
  it("com candidatas para a dona: escolher, antes de ligada", () => {
    expect(estadoDoCartao(montarVisaoSeuInstagram({ ...BASE, conta: conta(), candidatas: [conta({ contaId: "z" })] }))).toBe("escolher");
  });
  it("candidatas que ela não pode ver não mudam o estado para os outros", () => {
    expect(estadoDoCartao(montarVisaoSeuInstagram({ ...BASE, dono: false, candidatas: [conta({ contaId: "z" })] }))).toBe("sem-ligacao");
  });
});
