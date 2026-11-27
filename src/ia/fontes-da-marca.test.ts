import { describe, expect, it } from "vitest";

import type { PerfilCompilado } from "@/db/schema";
import { formatarPerfilCompilado, perfilDaMarca } from "@/servicos/briefing";
import { formatarCamadaExclusiva } from "@/servicos/roteiro";

import { montarFontesDaMarca } from "./fontes-da-marca";
import { montarFontesDosFatos } from "./prompts/roteiro";
import { fatoApoiadoPelasFontes } from "./prompts/verificarTexto";

const MOMENTO = { onde: "na recepção", oQueEstaAcontecendo: "chegou uma paciente com medo", oQueDaParaMostrar: "a sala" };
const GANCHO_DE_OUTRO = "Minha paciente chegou chorando com medo da anestesia";
const FATO = "uma paciente minha chegou chorando com medo da anestesia";

const PERFIL = {
  fatos: { oQueVende: "limpeza de dentes", preco: "R$ 180", clienteIdeal: "mora no bairro", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: [], concorrentes: [], perfisAdmirados: [] },
  resumo: "clínica odontológica de bairro",
  referencias: [`medo de dentista: ${GANCHO_DE_OUTRO}`],
  contextoConfirmado: [{ categoria: "servicos", texto: "Lido do site: atendemos criança com choro" }],
} as unknown as PerfilCompilado;

const CLIENTE = { alcance: "local", regiao: "Campinas", pais: null, paises: null, camadaExclusiva: { concorrentes: ["@outro.dentista"], perfisAdmirados: [], termos: [] } } as unknown as Parameters<typeof formatarCamadaExclusiva>[0];
const LEITURA = [{ handle: "@outro.dentista", leitura: `Esse perfil conta ${GANCHO_DE_OUTRO.toLowerCase()} e depois mostra o consultório` }];

describe("montarFontesDaMarca", () => {
  it("deriva: com perfil e camada limpos, os rótulos, o tema, o momento, o objetivo e o pedido aparecem literalmente e na ordem em montarFontesDosFatos", () => {
    const limpo = { ...PERFIL, referencias: [], contextoConfirmado: undefined } as PerfilCompilado;
    const casos = [
      { tema: "medo de anestesia", objetivoDoVideo: "mostrar o cuidado", observacao: "fale do preço" },
      { momento: MOMENTO, tema: "ignorado" },
      {},
    ];
    for (const extra of casos) {
      const dados = { perfilCompilado: formatarPerfilCompilado(limpo), camadaExclusiva: formatarCamadaExclusiva(CLIENTE, []), ...extra };
      const marca = montarFontesDaMarca({ ...dados, perfilCompilado: perfilDaMarca(limpo) });
      const completa = montarFontesDosFatos({
        ...dados,
        noticia: { titulo: "Notícia de terceiros", resumo: null, angulo: null },
        evidencias: [{ assunto: "a", gancho: GANCHO_DE_OUTRO, estrutura: "b", fechamento: "", chamadaFinal: "" }],
      });
      for (const parte of marca.split("\n\n")) expect(completa).toContain(parte);
      expect(completa.startsWith(marca)).toBe(true);
    }
  });

  it("não traz a evidência, a notícia, a pesquisa, os comentários nem a marca citada, e traz o perfil", () => {
    const marca = montarFontesDaMarca({ perfilCompilado: perfilDaMarca(PERFIL), camadaExclusiva: "", tema: "tema da pessoa" });
    expect(marca).toContain("clínica odontológica de bairro");
    expect(marca).not.toMatch(/Evidência|Notícia|Dados da pesquisa|comentários|Marca citada/);
  });

  it("porta 1: a referência favoritada (gancho de outra conta, no perfil compilado) fica fora; com o perfil inteiro o fato do outro passaria", () => {
    const camada = formatarCamadaExclusiva(CLIENTE, []);
    const comReferencia = montarFontesDaMarca({ perfilCompilado: formatarPerfilCompilado(PERFIL), camadaExclusiva: camada });
    expect(fatoApoiadoPelasFontes(FATO, GANCHO_DE_OUTRO, comReferencia)).toBe(true);
    const daMarca = montarFontesDaMarca({ perfilCompilado: perfilDaMarca(PERFIL), camadaExclusiva: camada });
    expect(daMarca).not.toContain(GANCHO_DE_OUTRO);
    expect(daMarca).not.toContain("Lido do site");
    expect(fatoApoiadoPelasFontes(FATO, GANCHO_DE_OUTRO, daMarca)).toBe(false);
  });

  it("porta 2: a leitura do perfil de um concorrente (escrita pela IA) fica fora; com ela o fato do outro passaria", () => {
    const comLeitura = montarFontesDaMarca({ perfilCompilado: perfilDaMarca(PERFIL), camadaExclusiva: formatarCamadaExclusiva(CLIENTE, LEITURA) });
    expect(fatoApoiadoPelasFontes(FATO, GANCHO_DE_OUTRO.toLowerCase(), comLeitura)).toBe(true);
    const daMarca = montarFontesDaMarca({ perfilCompilado: perfilDaMarca(PERFIL), camadaExclusiva: formatarCamadaExclusiva(CLIENTE, []) });
    expect(daMarca).not.toContain("Esse perfil conta");
    expect(daMarca).toContain("Concorrente citado pelo cliente: @outro.dentista");
    expect(fatoApoiadoPelasFontes(FATO, GANCHO_DE_OUTRO.toLowerCase(), daMarca)).toBe(false);
  });
});
