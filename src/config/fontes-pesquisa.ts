/**
 * E54, a pesquisa na hora: as fontes que ela pode usar. Decisão do Gustavo em 06/10/2026: "só mídia grande" e "tem que ser fonte
 * confiável e tudo que trazer tem que ser verídico pelas fontes". A lista vai como `allowed_domains` da ferramenta de busca na web
 * (resultado de fora nem chega ao modelo) e o código a confere de novo em cada achado (`servicos/pesquisa-na-hora.ts`): defesa em
 * duas camadas, porque a confiança não pode depender de a ferramenta ou o modelo acertarem.
 *
 * A lista inicial é a dos portais da E53 mais os órgãos oficiais. Mudou a lista, atualiza a data. Quem mantém é o Gustavo (uma fonte
 * que a pessoa pede e falta entra aqui, nunca por pesquisa).
 */
export const DATA_DA_LISTA_DE_FONTES = "2026-10-10";

export type TipoDeFonte = "oficial" | "imprensa";

export type FonteDePesquisa = {
  /** Sem esquema nem caminho (o formato do `allowed_domains`); os subdomínios entram junto. */
  dominio: string;
  /** Como a pessoa lê: "IBGE", "G1". */
  nome: string;
  tipo: TipoDeFonte;
};

export const FONTES_DE_PESQUISA: FonteDePesquisa[] = [
  // Órgãos oficiais: a fonte primária vem antes da matéria que a cita.
  { dominio: "ibge.gov.br", nome: "IBGE", tipo: "oficial" },
  { dominio: "bcb.gov.br", nome: "Banco Central", tipo: "oficial" },
  { dominio: "ipea.gov.br", nome: "Ipea", tipo: "oficial" },
  { dominio: "anvisa.gov.br", nome: "Anvisa", tipo: "oficial" },
  { dominio: "planalto.gov.br", nome: "Planalto", tipo: "oficial" },
  { dominio: "camara.leg.br", nome: "Câmara dos Deputados", tipo: "oficial" },
  { dominio: "senado.leg.br", nome: "Senado Federal", tipo: "oficial" },
  { dominio: "consumidor.gov.br", nome: "Consumidor.gov.br", tipo: "oficial" },
  { dominio: "gov.br", nome: "Governo federal", tipo: "oficial" },
  { dominio: "sebrae.com.br", nome: "Sebrae", tipo: "oficial" },
  // Imprensa grande.
  { dominio: "g1.globo.com", nome: "G1", tipo: "imprensa" },
  { dominio: "folha.uol.com.br", nome: "Folha de S.Paulo", tipo: "imprensa" },
  { dominio: "estadao.com.br", nome: "Estadão", tipo: "imprensa" },
  // O UOL hospeda blog e página de terceiros sob a mesma marca: só as editorias de notícia e economia entram (decisão do Fable, 10/10/2026).
  { dominio: "noticias.uol.com.br", nome: "UOL Notícias", tipo: "imprensa" },
  { dominio: "economia.uol.com.br", nome: "UOL Economia", tipo: "imprensa" },
  { dominio: "cnnbrasil.com.br", nome: "CNN Brasil", tipo: "imprensa" },
  { dominio: "exame.com", nome: "Exame", tipo: "imprensa" },
  { dominio: "valor.globo.com", nome: "Valor Econômico", tipo: "imprensa" },
];

/** O host de um endereço, em minúsculas e sem "www."; `null` para o que não é um endereço http ou https. */
export function hostDoEndereco(endereco: string): string | null {
  try {
    const url = new URL(endereco);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * A fonte da lista a que um endereço pertence (o domínio ou um subdomínio dele), a mais específica primeiro: `ibge.gov.br` vence `gov.br`.
 * `null` quando o endereço não é de nenhuma fonte da lista.
 */
export function fonteDoEndereco(endereco: string, fontes: FonteDePesquisa[] = FONTES_DE_PESQUISA): FonteDePesquisa | null {
  const host = hostDoEndereco(endereco);
  if (!host) return null;
  const achadas = fontes.filter((f) => host === f.dominio || host.endsWith(`.${f.dominio}`));
  if (achadas.length === 0) return null;
  const melhor = achadas.reduce((a, b) => (b.dominio.length > a.dominio.length ? b : a));
  // "gov.br" cobre todo órgão público (uma prefeitura, uma secretaria): quem publicou é o próprio host, não "o governo federal".
  if (melhor.dominio === "gov.br" && host !== "gov.br" && !fontes.some((f) => f.dominio === host)) return { ...melhor, nome: host };
  return melhor;
}

/**
 * Os domínios que vão no `allowed_domains`: sem os que um irmão mais amplo já cobre (os subdomínios entram junto), para a lista
 * mandada à ferramenta ser a menor possível.
 */
export function dominiosPermitidos(fontes: FonteDePesquisa[] = FONTES_DE_PESQUISA): string[] {
  const dominios = [...new Set(fontes.map((f) => f.dominio))];
  return dominios.filter((d) => !dominios.some((outro) => outro !== d && d.endsWith(`.${outro}`)));
}
